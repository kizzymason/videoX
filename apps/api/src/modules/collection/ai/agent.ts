// ========================================================================
// 采集系统 - AI 维护：会话执行引擎
//
// 一轮对话 = 反复「问模型 → 执行它要的工具 → 把结果喂回去」，直到模型给出
// 纯文本回答或撞到 maxSteps。写类工具在未开启自动执行时会停在 pending，
// 等管理员点确认后从断点继续。
// ========================================================================

import { and, asc, desc, eq } from 'drizzle-orm';
import { db, t } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { logger } from '../../../core/logger.js';
import { buildLlmMessages } from './history.js';
import { chatCompletion, type LlmToolCall } from './llm.js';
import { findTool, toolDefinitions, type AiToolContext } from './tools.js';

export type MessageRow = typeof t.collectionAiMessages.$inferSelect;
type ConversationRow = typeof t.collectionAiConversations.$inferSelect;
type ProfileRow = typeof t.collectionAiProfiles.$inferSelect;

/** 单条工具结果最多喂回去多少字符 */
const MAX_TOOL_RESULT_CHARS = 6000;

const BASE_SYSTEM_PROMPT = [
  '你是视频站采集系统的运维助手，服务对象是后台管理员，请始终用简体中文回答。',
  '',
  '你可以通过工具直接操作采集系统：查看总览与队列、增删改采集任务、维护号池账号与动态 token、把采集到的视频入库并发布、调整采集配置。',
  '',
  '工作原则：',
  '1. 先查后改。动手之前先用只读工具（get_overview / list_tasks / get_logs 等）确认现状，不要凭猜测下结论。',
  '2. 参数要具体。调用工具时把页码、ID、数量写清楚，缺少必要信息就先问管理员，不要自己编 ID。',
  '3. 写操作可能需要管理员确认。被拒绝就换个方案或者问清楚，不要反复重试同一个操作。',
  '4. 工具报错时读懂错误信息再决定下一步，同一个工具连续失败两次就停下来向管理员说明。',
  '5. 最后用一段话总结你做了什么、结果如何、还有什么需要人工跟进，不要罗列原始 JSON。',
].join('\n');

// --------------------------------------------------------------------------
// 读取
// --------------------------------------------------------------------------

async function loadConversation(conversationId: string): Promise<ConversationRow> {
  const [row] = await db
    .select()
    .from(t.collectionAiConversations)
    .where(eq(t.collectionAiConversations.id, conversationId))
    .limit(1);
  if (!row) throw AppError.notFound('会话不存在');
  return row;
}

/** 会话没绑定配置时退回到当前启用的那个，管理员换配置不用重建会话 */
async function loadProfile(conversation: ConversationRow): Promise<ProfileRow> {
  if (conversation.profileId) {
    const [row] = await db
      .select()
      .from(t.collectionAiProfiles)
      .where(eq(t.collectionAiProfiles.id, conversation.profileId))
      .limit(1);
    if (row) return requireUsable(row);
  }

  const [active] = await db
    .select()
    .from(t.collectionAiProfiles)
    .where(eq(t.collectionAiProfiles.isActive, true))
    .orderBy(desc(t.collectionAiProfiles.updatedAt))
    .limit(1);
  if (!active) throw AppError.badRequest('还没有可用的 AI 接口配置，请先在「AI 接口」中添加并启用');
  return requireUsable(active);
}

function requireUsable(profile: ProfileRow): ProfileRow {
  if (!profile.apiKey) throw AppError.badRequest(`AI 配置「${profile.name}」缺少 API Key`);
  return profile;
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(t.collectionAiMessages)
    .where(eq(t.collectionAiMessages.conversationId, conversationId))
    .orderBy(asc(t.collectionAiMessages.createdAt));
}

// --------------------------------------------------------------------------
// 工具执行
// --------------------------------------------------------------------------

function parseToolArgs(raw: string): unknown {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`参数不是合法 JSON：${raw.slice(0, 200)}`);
  }
}

function serializeToolResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'null';
  } catch {
    text = String(value);
  }
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(结果过长已截断)`
    : text;
}

async function executeToolCalls(
  conversationId: string,
  toolCalls: LlmToolCall[],
  ctx: AiToolContext,
): Promise<void> {
  for (const call of toolCalls) {
    const tool = findTool(call.function.name);
    let payload: unknown;

    if (!tool) {
      payload = { ok: false, error: `未知工具 ${call.function.name}` };
    } else {
      try {
        payload = { ok: true, data: await tool.execute(parseToolArgs(call.function.arguments), ctx) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ tool: call.function.name, err: message }, 'AI 维护工具执行失败');
        payload = { ok: false, error: message };
      }
    }

    await db.insert(t.collectionAiMessages).values({
      conversationId,
      role: 'tool',
      content: serializeToolResult(payload),
      toolCallId: call.id,
      toolName: call.function.name,
    });
  }
}

// --------------------------------------------------------------------------
// 主循环
// --------------------------------------------------------------------------

export type TurnStatus = 'idle' | 'awaiting_confirm';

async function runLoop(
  conversation: ConversationRow,
  profile: ProfileRow,
  ctx: AiToolContext,
): Promise<TurnStatus> {
  const systemPrompt = profile.systemPrompt.trim()
    ? `${BASE_SYSTEM_PROMPT}\n\n补充要求：\n${profile.systemPrompt.trim()}`
    : BASE_SYSTEM_PROMPT;
  const tools = toolDefinitions();

  for (let step = 0; step < profile.maxSteps; step += 1) {
    const history = await listMessages(conversation.id);
    const completion = await chatCompletion({
      endpoint: profile.endpoint,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: profile.temperature,
      messages: buildLlmMessages(history, systemPrompt),
      tools,
    });

    if (completion.toolCalls.length === 0) {
      await db.insert(t.collectionAiMessages).values({
        conversationId: conversation.id,
        role: 'assistant',
        content: completion.content || '(模型没有返回内容)',
      });
      return 'idle';
    }

    const needsConfirm =
      !conversation.autoApprove &&
      completion.toolCalls.some((call) => findTool(call.function.name)?.readOnly === false);

    await db.insert(t.collectionAiMessages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: completion.content,
      toolCalls: completion.toolCalls as unknown as Record<string, unknown>[],
      toolStatus: needsConfirm ? 'pending' : 'executed',
    });

    if (needsConfirm) return 'awaiting_confirm';

    await executeToolCalls(conversation.id, completion.toolCalls, ctx);
  }

  await db.insert(t.collectionAiMessages).values({
    conversationId: conversation.id,
    role: 'assistant',
    content: `已连续调用 ${profile.maxSteps} 轮工具仍未得出结论，本轮先停下。请补充信息或把任务拆小一些。`,
  });
  return 'idle';
}

async function finishTurn(conversationId: string, status: TurnStatus, profileId: string): Promise<void> {
  await db
    .update(t.collectionAiConversations)
    .set({ status, updatedAt: new Date() })
    .where(eq(t.collectionAiConversations.id, conversationId));
  await db
    .update(t.collectionAiProfiles)
    .set({ lastUsedAt: new Date() })
    .where(eq(t.collectionAiProfiles.id, profileId));
}

export interface TurnResult {
  status: TurnStatus;
  messages: MessageRow[];
}

/**
 * 一轮对话可能要打好几次模型，耗时以十秒计。前端重复点击或多开标签页会让
 * 两条链路交替往同一个会话写消息，历史直接乱掉，所以进程内串行化。
 */
const runningConversations = new Set<string>();

async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  if (runningConversations.has(conversationId)) {
    throw AppError.conflict('该会话正在处理中，请稍候');
  }
  runningConversations.add(conversationId);
  try {
    return await fn();
  } finally {
    runningConversations.delete(conversationId);
  }
}

/** 管理员发一条消息，跑完一轮（可能停在待确认）。 */
export async function sendUserMessage(params: {
  conversationId: string;
  userId: string;
  content: string;
}): Promise<TurnResult> {
  return withConversationLock(params.conversationId, async () => {
    const conversation = await loadConversation(params.conversationId);
    if (conversation.status === 'awaiting_confirm') {
      throw AppError.badRequest('还有待确认的操作，请先确认或拒绝后再继续对话');
    }
    const profile = await loadProfile(conversation);

    await db.insert(t.collectionAiMessages).values({
      conversationId: conversation.id,
      role: 'user',
      content: params.content,
    });

    // 首条消息顺手当标题，省得列表里全是「新会话」
    if (conversation.title === '新会话') {
      await db
        .update(t.collectionAiConversations)
        .set({ title: params.content.slice(0, 40) })
        .where(eq(t.collectionAiConversations.id, conversation.id));
    }

    const status = await runTurnSafely(conversation, profile, { userId: params.userId });
    return { status, messages: await listMessages(conversation.id) };
  });
}

/** 确认或拒绝挂起的写操作，然后让模型基于结果继续。 */
export async function resolvePendingToolCalls(params: {
  conversationId: string;
  userId: string;
  approve: boolean;
}): Promise<TurnResult> {
  return withConversationLock(params.conversationId, async () => {
    const conversation = await loadConversation(params.conversationId);
    if (conversation.status !== 'awaiting_confirm') {
      throw AppError.badRequest('当前没有待确认的操作');
    }
    const profile = await loadProfile(conversation);

    const [pending] = await db
      .select()
      .from(t.collectionAiMessages)
      .where(
        and(
          eq(t.collectionAiMessages.conversationId, conversation.id),
          eq(t.collectionAiMessages.toolStatus, 'pending'),
        ),
      )
      .orderBy(desc(t.collectionAiMessages.createdAt))
      .limit(1);

    if (!pending) {
      await db
        .update(t.collectionAiConversations)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(t.collectionAiConversations.id, conversation.id));
      throw AppError.badRequest('待确认的操作已失效，请重新发起');
    }

    const toolCalls = (pending.toolCalls ?? []) as unknown as LlmToolCall[];

    if (params.approve) {
      await executeToolCalls(conversation.id, toolCalls, { userId: params.userId });
    } else {
      for (const call of toolCalls) {
        await db.insert(t.collectionAiMessages).values({
          conversationId: conversation.id,
          role: 'tool',
          content: JSON.stringify({ ok: false, error: '管理员拒绝执行该操作' }),
          toolCallId: call.id,
          toolName: call.function.name,
        });
      }
    }

    await db
      .update(t.collectionAiMessages)
      .set({ toolStatus: params.approve ? 'executed' : 'rejected' })
      .where(eq(t.collectionAiMessages.id, pending.id));

    const status = await runTurnSafely({ ...conversation, status: 'idle' }, profile, {
      userId: params.userId,
    });
    return { status, messages: await listMessages(conversation.id) };
  });
}

/**
 * 模型/网络异常不能把会话卡在中间态：把错误写成一条 assistant 消息落库，
 * 会话回到 idle，管理员刷新页面还能看到发生了什么。
 */
async function runTurnSafely(
  conversation: ConversationRow,
  profile: ProfileRow,
  ctx: AiToolContext,
): Promise<TurnStatus> {
  try {
    const status = await runLoop(conversation, profile, ctx);
    await finishTurn(conversation.id, status, profile.id);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ conversationId: conversation.id, err: message }, 'AI 维护会话执行失败');
    await db.insert(t.collectionAiMessages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: `执行出错：${message}`,
    });
    await finishTurn(conversation.id, 'idle', profile.id);
    return 'idle';
  }
}

/** 「测试连通性」按钮：不带工具打一次最短的招呼。 */
export async function testProfileConnection(profile: ProfileRow): Promise<string> {
  const completion = await chatCompletion({
    endpoint: profile.endpoint,
    apiKey: profile.apiKey,
    model: profile.model,
    temperature: profile.temperature,
    messages: [{ role: 'user', content: '回复两个字：就绪' }],
    timeoutMs: 30_000,
  });
  return completion.content.trim() || '(接口连通，但没有返回内容)';
}
