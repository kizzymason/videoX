import type { Job } from 'bullmq';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, t } from '@videox/api/core/db';
import type { AiScoringJobData } from '@videox/api/core/queue';
import { logger } from '../logger.js';

interface ScoredItem {
  id: string;
  score: number;
  reason?: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是视频平台的内容质量评估专家。你会收到一批视频的元数据，请为每条视频给出 0-100 的推荐分与一句简短理由。
评分维度：标题信息量、内容稀缺度、分类与标签契合度、真实互动表现（播放/点赞/完播率）。
只输出 JSON，格式：{"items":[{"id":"<视频id>","score":<0-100>,"reason":"<不超过40字>"}]}`;

const DEFAULT_USER_TEMPLATE = `请评估以下 {{count}} 条视频：\n{{videos}}`;

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/**
 * 从模型回复里挖出 JSON。
 *
 * 即便提示词要求「只输出 JSON」，模型仍常见地裹上 ```json 代码块或前后加解释，
 * 所以先剥代码块，再退化到「第一个 { 到最后一个 }」的截取。
 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseScores(payload: unknown): ScoredItem[] {
  const root = payload as { items?: unknown } | unknown[];
  const list = Array.isArray(root) ? root : Array.isArray(root?.items) ? root.items : [];
  const out: ScoredItem[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = typeof raw?.id === 'string' ? raw.id : null;
    const score = Number(raw?.score);
    if (!id || !Number.isFinite(score)) continue;
    out.push({
      id,
      score: Math.max(0, Math.min(100, score)),
      reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : undefined,
    });
  }
  return out;
}

async function callModel(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  // 兼容 OpenAI Chat Completions 协议：填 base 地址时自动补全路径。
  const url = /\/(chat\/)?completions$/.test(params.endpoint)
    ? params.endpoint
    : `${params.endpoint.replace(/\/+$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`AI 接口返回 ${response.status}：${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? '';
}

export async function runAiScoringJob(job: Job<AiScoringJobData>): Promise<void> {
  const { profileId, runId, videoIds } = job.data;
  const log = logger.child({ profileId, runId });

  const [profile] = await db.select().from(t.aiProfiles).where(eq(t.aiProfiles.id, profileId)).limit(1);
  if (!profile) throw new Error('AI 配置不存在');

  try {
    const rows = await db
      .select({
        id: t.videos.id,
        title: t.videos.title,
        description: t.videos.description,
        category: t.categories.name,
        durationSeconds: t.videos.durationSeconds,
        viewCount: t.videos.viewCount,
        likeCount: t.videos.likeCount,
        completionRate: t.videos.completionRate,
      })
      .from(t.videos)
      .leftJoin(t.categories, eq(t.categories.id, t.videos.categoryId))
      .where(
        videoIds && videoIds.length > 0
          ? inArray(t.videos.id, videoIds)
          : and(
              inArray(t.videos.status, ['ready', 'partially_ready']),
              eq(t.videos.visibility, 'public'),
              // 没打过分的优先，其次是 7 天前打的（内容表现会变）。
              or(isNull(t.videos.aiScoredAt), sql`${t.videos.aiScoredAt} < now() - interval '7 days'`),
            ),
      )
      .orderBy(desc(t.videos.createdAt))
      .limit(videoIds?.length ? videoIds.length : 500);

    await db.update(t.aiScoringRuns).set({ totalVideos: rows.length }).where(eq(t.aiScoringRuns.id, runId));

    if (rows.length === 0) {
      await db
        .update(t.aiScoringRuns)
        .set({ status: 'completed', finishedAt: new Date() })
        .where(eq(t.aiScoringRuns.id, runId));
      log.info('没有需要打分的视频');
      return;
    }

    const batchSize = Math.max(1, profile.batchSize);
    let scored = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const digest = batch
        .map(
          (v) =>
            `- id=${v.id} | 标题：${v.title} | 分类：${v.category ?? '未分类'} | 时长：${v.durationSeconds}s | 播放：${v.viewCount} | 点赞：${v.likeCount} | 完播率：${(v.completionRate * 100).toFixed(1)}% | 简介：${(v.description ?? '').slice(0, 120)}`,
        )
        .join('\n');

      const userPrompt = renderTemplate(profile.userPromptTemplate || DEFAULT_USER_TEMPLATE, {
        count: String(batch.length),
        videos: digest,
      });

      try {
        const content = await callModel({
          endpoint: profile.endpoint,
          apiKey: profile.apiKey,
          model: profile.model,
          temperature: profile.temperature,
          systemPrompt: profile.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          userPrompt,
        });

        const items = parseScores(extractJson(content));
        const allowed = new Set(batch.map((v) => v.id));

        for (const item of items) {
          if (!allowed.has(item.id)) continue;
          await db
            .update(t.videos)
            .set({
              // 归一化到 0~1，和 quality_score 同量纲，方便推荐打分加权。
              aiScore: item.score / 100,
              aiReason: item.reason ?? null,
              aiScoredAt: new Date(),
            })
            .where(eq(t.videos.id, item.id));
          scored += 1;
        }
      } catch (error) {
        // 单批失败不该拖垮整轮，记日志继续下一批。
        log.warn({ err: error, batch: i / batchSize }, 'AI 打分批次失败');
      }

      await db.update(t.aiScoringRuns).set({ scoredVideos: scored }).where(eq(t.aiScoringRuns.id, runId));
      await job.updateProgress(Math.round(((i + batch.length) / rows.length) * 100));
    }

    await db
      .update(t.aiScoringRuns)
      .set({ status: 'completed', scoredVideos: scored, finishedAt: new Date() })
      .where(eq(t.aiScoringRuns.id, runId));
    await db.update(t.aiProfiles).set({ lastRunAt: new Date() }).where(eq(t.aiProfiles.id, profileId));

    log.info({ scored, total: rows.length }, 'AI 打分完成');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(t.aiScoringRuns)
      .set({ status: 'failed', errorMessage: message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(t.aiScoringRuns.id, runId));
    throw error;
  }
}
