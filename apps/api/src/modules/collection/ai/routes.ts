// ========================================================================
// 采集系统 - AI 维护：REST API
// 挂载于 /api/collection/ai（父路由已经做过 requireAuth + requireAdmin）
// ========================================================================

import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, t } from '../../../core/db.js';
import { AppError } from '../../../core/errors.js';
import { asyncHandler, ok } from '../../../core/respond.js';
import { body, validate } from '../../../middleware/validate.js';
import { audit } from '../../admin/audit.js';
import {
  listMessages,
  resolvePendingToolCalls,
  sendUserMessage,
  testProfileConnection,
} from './agent.js';
import { toolCatalog } from './tools.js';

export const collectionAiRouter: Router = Router();

/** 回给前端的脱敏占位符；原样传回来视为「不修改」 */
const MASKED_KEY = '••••••••';

const profileSchema = z.object({
  name: z.string().min(1).max(60),
  endpoint: z.string().min(1).max(300),
  model: z.string().min(1).max(80),
  apiKey: z.string().max(300).default(''),
  systemPrompt: z.string().max(4000).default(''),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxSteps: z.coerce.number().int().min(1).max(20).default(8),
  autoApprove: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const profilePatchSchema = profileSchema.partial();

const conversationSchema = z.object({
  title: z.string().max(120).optional(),
  profileId: z.string().uuid().optional().nullable(),
  autoApprove: z.boolean().optional(),
});

const messageSchema = z.object({
  content: z.string().min(1).max(4000),
});

const confirmSchema = z.object({
  approve: z.boolean(),
});

type ProfileRow = typeof t.collectionAiProfiles.$inferSelect;

function maskProfile(row: ProfileRow) {
  return { ...row, apiKey: row.apiKey ? MASKED_KEY : '' };
}

// ==========================================================================
// AI 接口配置
// ==========================================================================

/** GET /profiles - 配置列表（apiKey 脱敏） */
collectionAiRouter.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(t.collectionAiProfiles)
      .orderBy(desc(t.collectionAiProfiles.updatedAt));
    ok(res, rows.map(maskProfile));
  }),
);

/** POST /profiles - 新增配置 */
collectionAiRouter.post(
  '/profiles',
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof profileSchema>>(req);
    const [row] = await db.insert(t.collectionAiProfiles).values(input).returning();
    await audit(req, 'collection.ai.profile.create', { type: 'collectionAiProfile', id: row!.id });
    ok(res, maskProfile(row!), '配置已保存');
  }),
);

/** PUT /profiles/:id - 更新配置 */
collectionAiRouter.put(
  '/profiles/:id',
  validate({ body: profilePatchSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = body<z.infer<typeof profilePatchSchema>>(req);

    // 脱敏占位符或空串都代表「沿用已保存的密钥」
    if (input.apiKey === MASKED_KEY || input.apiKey === '') delete input.apiKey;

    const [row] = await db
      .update(t.collectionAiProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(t.collectionAiProfiles.id, id))
      .returning();
    if (!row) throw AppError.notFound('配置不存在');

    await audit(req, 'collection.ai.profile.update', { type: 'collectionAiProfile', id });
    ok(res, maskProfile(row), '配置已更新');
  }),
);

/** DELETE /profiles/:id - 删除配置 */
collectionAiRouter.delete(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [row] = await db
      .delete(t.collectionAiProfiles)
      .where(eq(t.collectionAiProfiles.id, id))
      .returning({ id: t.collectionAiProfiles.id });
    if (!row) throw AppError.notFound('配置不存在');

    await audit(req, 'collection.ai.profile.delete', { type: 'collectionAiProfile', id });
    ok(res, null, '配置已删除');
  }),
);

/** POST /profiles/:id/test - 测试接口连通性 */
collectionAiRouter.post(
  '/profiles/:id/test',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [profile] = await db
      .select()
      .from(t.collectionAiProfiles)
      .where(eq(t.collectionAiProfiles.id, id))
      .limit(1);
    if (!profile) throw AppError.notFound('配置不存在');
    if (!profile.apiKey) throw AppError.badRequest('请先填写 API Key');

    try {
      const reply = await testProfileConnection(profile);
      ok(res, { reply }, '接口连通');
    } catch (error) {
      throw AppError.badRequest(error instanceof Error ? error.message : String(error));
    }
  }),
);

/** GET /tools - 助手可调用的能力清单（前端展示用） */
collectionAiRouter.get(
  '/tools',
  asyncHandler(async (_req, res) => {
    ok(res, toolCatalog());
  }),
);

// ==========================================================================
// 会话
// ==========================================================================

/** 新会话没指定时，沿用接口配置上设定的默认放行策略 */
async function defaultAutoApprove(profileId?: string | null): Promise<boolean> {
  const [profile] = await db
    .select({ autoApprove: t.collectionAiProfiles.autoApprove })
    .from(t.collectionAiProfiles)
    .where(
      profileId
        ? eq(t.collectionAiProfiles.id, profileId)
        : eq(t.collectionAiProfiles.isActive, true),
    )
    .orderBy(desc(t.collectionAiProfiles.updatedAt))
    .limit(1);
  return profile?.autoApprove ?? false;
}

/** GET /conversations - 会话列表 */
collectionAiRouter.get(
  '/conversations',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: t.collectionAiConversations.id,
        title: t.collectionAiConversations.title,
        status: t.collectionAiConversations.status,
        profileId: t.collectionAiConversations.profileId,
        autoApprove: t.collectionAiConversations.autoApprove,
        createdAt: t.collectionAiConversations.createdAt,
        updatedAt: t.collectionAiConversations.updatedAt,
        messageCount: sql<number>`(
          select count(*)::int from ${t.collectionAiMessages}
          where ${t.collectionAiMessages.conversationId} = ${t.collectionAiConversations.id}
        )`,
      })
      .from(t.collectionAiConversations)
      .orderBy(desc(t.collectionAiConversations.updatedAt))
      .limit(50);
    ok(res, rows);
  }),
);

/** POST /conversations - 新建会话 */
collectionAiRouter.post(
  '/conversations',
  validate({ body: conversationSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof conversationSchema>>(req);
    const [row] = await db
      .insert(t.collectionAiConversations)
      .values({
        title: input.title || '新会话',
        profileId: input.profileId ?? null,
        autoApprove: input.autoApprove ?? (await defaultAutoApprove(input.profileId)),
        userId: req.auth!.id,
      })
      .returning();
    ok(res, row, '会话已创建');
  }),
);

/** PUT /conversations/:id - 改标题 / 换配置 / 开关自动执行 */
collectionAiRouter.put(
  '/conversations/:id',
  validate({ body: conversationSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = body<z.infer<typeof conversationSchema>>(req);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.profileId !== undefined) patch.profileId = input.profileId;
    if (input.autoApprove !== undefined) patch.autoApprove = input.autoApprove;

    const [row] = await db
      .update(t.collectionAiConversations)
      .set(patch)
      .where(eq(t.collectionAiConversations.id, id))
      .returning();
    if (!row) throw AppError.notFound('会话不存在');

    ok(res, row, '已更新');
  }),
);

/** DELETE /conversations/:id - 删除会话（消息级联删除） */
collectionAiRouter.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [row] = await db
      .delete(t.collectionAiConversations)
      .where(eq(t.collectionAiConversations.id, id))
      .returning({ id: t.collectionAiConversations.id });
    if (!row) throw AppError.notFound('会话不存在');

    await audit(req, 'collection.ai.conversation.delete', { type: 'collectionAiConversation', id });
    ok(res, null, '会话已删除');
  }),
);

/** GET /conversations/:id/messages - 拉取完整对话 */
collectionAiRouter.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const [conversation] = await db
      .select()
      .from(t.collectionAiConversations)
      .where(eq(t.collectionAiConversations.id, id))
      .limit(1);
    if (!conversation) throw AppError.notFound('会话不存在');

    ok(res, { status: conversation.status, messages: await listMessages(id) });
  }),
);

/** POST /conversations/:id/messages - 发消息并等模型跑完一轮 */
collectionAiRouter.post(
  '/conversations/:id/messages',
  validate({ body: messageSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = body<z.infer<typeof messageSchema>>(req);

    const result = await sendUserMessage({
      conversationId: id,
      userId: req.auth!.id,
      content: input.content,
    });

    await audit(req, 'collection.ai.chat', { type: 'collectionAiConversation', id });
    ok(res, result);
  }),
);

/** POST /conversations/:id/confirm - 放行或拒绝挂起的写操作 */
collectionAiRouter.post(
  '/conversations/:id/confirm',
  validate({ body: confirmSchema }),
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    const input = body<z.infer<typeof confirmSchema>>(req);

    const result = await resolvePendingToolCalls({
      conversationId: id,
      userId: req.auth!.id,
      approve: input.approve,
    });

    await audit(req, input.approve ? 'collection.ai.tool.approve' : 'collection.ai.tool.reject', {
      type: 'collectionAiConversation',
      id,
    });
    ok(res, result, input.approve ? '已执行' : '已拒绝');
  }),
);
