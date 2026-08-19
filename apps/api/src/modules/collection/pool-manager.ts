// ========================================================================
// 号池管理系统
// ========================================================================

import { eq, and, or, gt, isNull, sql, like, ilike } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import type { AccountPoolEntry } from './types.js';

/**
 * 号池管理器
 * 负责账号的增删改查、轮询策略、健康检查和自动降级
 */
export class AccountPoolManager {
  private static instance: AccountPoolManager;
  
  private constructor() {}
  
  public static getInstance(): AccountPoolManager {
    if (!AccountPoolManager.instance) {
      AccountPoolManager.instance = new AccountPoolManager();
    }
    return AccountPoolManager.instance;
  }
  
  /**
   * 添加账号到号池
   */
  async addAccount(params: {
    targetSite: string;
    uid: string;
    token: string;
    username?: string;
    isVip: boolean;
    vipExpiresAt?: string;
  }): Promise<string> {
    const [account] = await db
      .insert(t.accountPools)
      .values({
        targetSite: params.targetSite,
        uid: params.uid,
        token: params.token,
        username: params.username ?? null,
        isVip: params.isVip,
        vipExpiresAt: params.vipExpiresAt ? new Date(params.vipExpiresAt) : null,
        status: 'active',
        usageCount: 0,
      })
      .returning();

    logger.info({ accountId: account.id, targetSite: params.targetSite }, '账号添加成功');
    return account.id;
  }
  
  /**
   * 批量导入账号
   */
  async batchAddAccounts(accounts: Array<{
    uid: string;
    token: string;
    username?: string;
    isVip: boolean;
    vipExpiresAt?: string;
  }>, targetSite: string): Promise<string[]> {
    const ids: string[] = [];

    for (const account of accounts) {
      const [newAccount] = await db
        .insert(t.accountPools)
        .values({
          targetSite,
          uid: account.uid,
          token: account.token,
          username: account.username ?? null,
          isVip: account.isVip,
          vipExpiresAt: account.vipExpiresAt ? new Date(account.vipExpiresAt) : null,
          status: 'active',
          usageCount: 0,
        })
        .returning();
      ids.push(newAccount.id);
    }
    
    logger.info({ count: ids.length, targetSite }, '批量导入完成');
    return ids;
  }
  
  /**
   * 获取可用账号（轮询 + 权重策略）
   */
  async getAvailableAccount(targetSite: string): Promise<AccountPoolEntry | null> {
    // 先获取所有可用的账号
    const available = await this.getAvailableAccounts(targetSite);
    
    if (available.length === 0) {
      logger.warn({ targetSite }, '号池中无可用账号');
      return null;
    }
    
    // VIP 账号权重更高（默认 3 倍）
    const config = await this.loadPoolConfig(targetSite);
    const vipWeight = typeof config?.vipWeightMultiplier === 'number'
      ? (config.vipWeightMultiplier as number)
      : 3;
    
    // 加权随机选择
    const weightedList: AccountPoolEntry[] = [];
    
    for (const account of available) {
      const weight = account.isVip ? vipWeight : 1;
      for (let i = 0; i < weight; i++) {
        weightedList.push(account);
      }
    }
    
    const selected = weightedList[Math.floor(Math.random() * weightedList.length)];
    
    // 更新使用计数
    await this.recordUsage(selected.id);
    
    return selected;
  }
  
  /**
   * 获取所有可用账号
   *
   * 过滤规则：
   * - status = active
   * - 非 VIP 账号直接可用
   * - VIP 账号需 VIP 未过期（vipExpiresAt 为空时保守跳过）
   */
  private async getAvailableAccounts(targetSite: string): Promise<AccountPoolEntry[]> {
    const accounts = await db
      .select()
      .from(t.accountPools)
      .where(
        and(
          eq(t.accountPools.targetSite, targetSite),
          eq(t.accountPools.status, 'active'),
          or(
            eq(t.accountPools.isVip, false),
            and(
              isNull(t.accountPools.vipExpiresAt),
              eq(t.accountPools.isVip, false),
            ),
          ),
        ),
      );

    // VIP 过期时间在应用层再筛一道：SQL 里比较 timestamptz 与字符串容易踩时区坑。
    const now = Date.now();
    const eligible = accounts.filter((acc) => {
      if (!acc.isVip) return true;
      if (!acc.vipExpiresAt) return false; // VIP 但不知道过期时间，保守跳过
      return acc.vipExpiresAt.getTime() > now;
    });

    return eligible as unknown as AccountPoolEntry[];
  }
  
  /**
   * 记录账号使用情况
   */
  private async recordUsage(accountId: string): Promise<void> {
    await db
      .update(t.accountPools)
      .set({
        usageCount: sql`${t.accountPools.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(t.accountPools.id, accountId));
  }
  
  /**
   * 更新账号状态
   */
  async updateAccountStatus(accountId: string, status: 'active' | 'inactive' | 'banned'): Promise<void> {
    await db
      .update(t.accountPools)
      .set({ status, lastCheckAt: new Date() })
      .where(eq(t.accountPools.id, accountId));
    
    logger.info({ accountId, status }, '账号状态已更新');
  }
  
  /**
   * 健康检查 - 验证单个账号有效性
   */
  async healthCheckAccount(accountId: string): Promise<boolean> {
    const account = await this.getAccountById(accountId);
    if (!account) {
      logger.warn({ accountId }, '账号不存在，跳过健康检查');
      return false;
    }

    try {
      const { createClientFromAccount } = await import('./yitongkan/api-client.js');
      const client = createClientFromAccount(account);

      // 调用会员接口测试有效性
      const result = await client.getMemberInfo();

      if (result.code === '200') {
        const isVip = result.data?.isVip ?? false;

        await db
          .update(t.accountPools)
          .set({
            status: 'active',
            isVip,
            vipExpiresAt: result.data?.vipExpiresAt ? new Date(result.data.vipExpiresAt) : null,
            lastCheckAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(t.accountPools.id, accountId));

        logger.info({ accountId, isVip }, '健康检查通过');
        return true;
      } else {
        await this.updateAccountStatus(accountId, 'inactive');
        logger.warn({ accountId }, '健康检查失败 - 返回错误码');
        return false;
      }
    } catch (error) {
      logger.error({ accountId, error }, '健康检查异常');
      await db
        .update(t.accountPools)
        .set({ lastCheckAt: new Date() })
        .where(eq(t.accountPools.id, accountId));
      return false;
    }
  }
  
  /**
   * 批量健康检查
   */
  async healthCheckAll(targetSite: string): Promise<{
    valid: number;
    invalid: number;
    failed: number;
  }> {
    const accounts = await db
      .select()
      .from(t.accountPools)
      .where(eq(t.accountPools.targetSite, targetSite));

    const { createClientFromAccount } = await import('./yitongkan/api-client.js');

    let valid = 0;
    let invalid = 0;
    let failed = 0;

    for (const account of accounts) {
      // banned 账号跳过检查
      if (account.status === 'banned') {
        invalid++;
        continue;
      }

      try {
        const client = createClientFromAccount(account);
        const member = await client.getMemberInfo();
        if (member.code === '200') {
          const isVip = member.data?.isVip ?? false;
          const vipExpiresAt = member.data?.vipExpiresAt ? new Date(member.data.vipExpiresAt) : null;
          await db
            .update(t.accountPools)
            .set({
              status: 'active',
              isVip,
              vipExpiresAt,
              username: member.data?.username ?? account.username,
              lastCheckAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(t.accountPools.id, account.id));
          valid++;
        } else {
          await this.updateAccountStatus(account.id, 'inactive');
          invalid++;
        }
      } catch {
        // 网络异常等：不改状态，只计失败
        failed++;
        await db
          .update(t.accountPools)
          .set({ lastCheckAt: new Date() })
          .where(eq(t.accountPools.id, account.id));
      }
    }

    logger.info({ targetSite, valid, invalid, failed }, '批量健康检查结果');

    return { valid, invalid, failed };
  }
  
  /**
   * 获取账号详情
   */
  async getAccountById(id: string): Promise<AccountPoolEntry | null> {
    const accounts = await db
      .select()
      .from(t.accountPools)
      .where(eq(t.accountPools.id, id))
      .limit(1);
    
    return (accounts[0] as unknown as AccountPoolEntry) ?? null;
  }
  
  /**
   * 删除账号
   */
  async deleteAccount(id: string): Promise<void> {
    await db
      .delete(t.accountPools)
      .where(eq(t.accountPools.id, id));
    
    logger.info({ id }, '账号已删除');
  }
  
  /**
   * 获取账号列表（分页）
   */
  async getList(
    targetSite: string,
    page: number = 1,
    pageSize: number = 20,
    filters?: {
      status?: 'active' | 'inactive' | 'banned';
      isVip?: boolean;
      search?: string; // 按 username/uid 搜索
    }
  ): Promise<{
    total: number;
    items: AccountPoolEntry[];
  }> {
    let whereClause = eq(t.accountPools.targetSite, targetSite);

    if (filters?.status) {
      whereClause = and(whereClause, eq(t.accountPools.status, filters.status))!;
    }

    if (typeof filters?.isVip === 'boolean') {
      whereClause = and(whereClause, eq(t.accountPools.isVip, filters.isVip))!;
    }

    if (filters?.search) {
      const pattern = `%${filters.search}%`;
      whereClause = and(
        whereClause,
        or(ilike(t.accountPools.username, pattern), like(t.accountPools.uid, pattern)),
      )!;
    }
    
    const [totalResult, items] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::integer` })
        .from(t.accountPools)
        .where(whereClause),
      db
        .select()
        .from(t.accountPools)
        .where(whereClause)
        .orderBy(t.accountPools.createdAt)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    
    return {
      total: totalResult[0]?.count ?? 0,
      items: items as unknown as AccountPoolEntry[],
    };
  }
  
  /**
   * 获取统计信息
   */
  async getStats(targetSite: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    banned: number;
    vip: number;
    free: number;
  }> {
    const stats = await db
      .select({
        total: sql<number>`count(*)::integer`,
        active: sql<number>`sum(CASE WHEN ${t.accountPools.status} = 'active' THEN 1 ELSE 0 END)::integer`,
        inactive: sql<number>`sum(CASE WHEN ${t.accountPools.status} = 'inactive' THEN 1 ELSE 0 END)::integer`,
        banned: sql<number>`sum(CASE WHEN ${t.accountPools.status} = 'banned' THEN 1 ELSE 0 END)::integer`,
        vip: sql<number>`sum(CASE WHEN ${t.accountPools.isVip} THEN 1 ELSE 0 END)::integer`,
        free: sql<number>`sum(CASE WHEN NOT ${t.accountPools.isVip} THEN 1 ELSE 0 END)::integer`,
      })
      .from(t.accountPools)
      .where(eq(t.accountPools.targetSite, targetSite));
    
    return {
      total: stats[0]?.total ?? 0,
      active: stats[0]?.active ?? 0,
      inactive: stats[0]?.inactive ?? 0,
      banned: stats[0]?.banned ?? 0,
      vip: stats[0]?.vip ?? 0,
      free: stats[0]?.free ?? 0,
    };
  }
  
  /**
   * 加载号池配置
   */
  private async loadPoolConfig(targetSite: string): Promise<Record<string, unknown>> {
    const config = await db
      .select()
      .from(t.collectionConfigs)
      .where(eq(t.collectionConfigs.key, `pool:${targetSite}`))
      .limit(1);

    return config[0]?.value ?? {};
  }

  /**
   * 获取号池中指定状态的账号数（用于健康度监控）
   */
  async countByStatus(targetSite: string): Promise<{ total: number; active: number }> {
    const stats = await db
      .select({
        total: sql<number>`count(*)::integer`,
        active: sql<number>`sum(CASE WHEN ${t.accountPools.status} = 'active' THEN 1 ELSE 0 END)::integer`,
      })
      .from(t.accountPools)
      .where(eq(t.accountPools.targetSite, targetSite));

    return { total: stats[0]?.total ?? 0, active: stats[0]?.active ?? 0 };
  }
}
