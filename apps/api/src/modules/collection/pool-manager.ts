// ========================================================================
// 号池管理系统
// ========================================================================

import { eq, and, or, sql, like, ilike } from 'drizzle-orm';
import { db, t } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import type { AccountPoolEntry } from './types.js';
import { decryptCredential, encryptCredential } from './credential-vault.js';
import {
  isTokenDueForRefresh,
  selectAccountsDueForTokenRefresh,
  type TokenRefreshCandidate,
} from './pool-schedule.js';
import { writePoolEvent, type TokenRefreshSource } from './token-monitor.js';
import { YitongKanApiClient, createClientFromAccount } from './yitongkan/api-client.js';

function sourceLabel(source: TokenRefreshSource): string {
  if (source === 'checkout') return '采集取号前已自动登录并写入新 token';
  if (source === 'health_check') return '健康检查后已自动登录并写入新 token（与手动刷新相同）';
  if (source === 'scheduled') return '定时自动登录并写入新 token（与手动刷新相同）';
  if (source === 'credentials_update') return '更新登录凭据后已自动登录并写入新 token';
  if (source === 'login') return '账号密码登录成功，已自动写入 token';
  return '已手动刷新 token';
}

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
    loginUsername?: string;
    loginPassword?: string;
  }): Promise<string> {
    const [account] = await db
      .insert(t.accountPools)
      .values({
        targetSite: params.targetSite,
        uid: params.uid,
        token: params.token,
        username: params.username ?? null,
        loginUsername: params.loginUsername ?? null,
        loginPasswordEncrypted: params.loginPassword ? encryptCredential(params.loginPassword) : null,
        isVip: params.isVip,
        vipExpiresAt: params.vipExpiresAt ? new Date(params.vipExpiresAt) : null,
        tokenUpdatedAt: new Date(),
        status: 'active',
        usageCount: 0,
      })
      .returning();

    logger.info({ accountId: account.id, targetSite: params.targetSite }, '账号添加成功');
    return account.id;
  }

  /** 登录并添加账号，管理员无需手工获取 token。 */
  async addAccountWithCredentials(params: {
    targetSite: string;
    username: string;
    password: string;
  }): Promise<string> {
    const login = await YitongKanApiClient.login(params.username, params.password);
    const id = await this.addAccount({
      targetSite: params.targetSite,
      uid: login.uid,
      token: login.token,
      username: login.username,
      isVip: login.isVip,
      vipExpiresAt: login.vipExpiresAt,
      loginUsername: params.username,
      loginPassword: params.password,
    });
    await writePoolEvent({
      level: 'info',
      message: '账号密码登录成功，已自动写入 token 并开启监控',
      accountId: id,
      event: 'token_login',
      uid: login.uid,
      source: 'login',
    });
    return id;
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
          tokenUpdatedAt: new Date(),
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
    
    let selected = weightedList[Math.floor(Math.random() * weightedList.length)];

    // 源站 token 生命周期较短；有托管凭据且 token 已到期时先静默刷新（与手动刷新相同）。
    if (selected.loginUsername && selected.loginPasswordEncrypted && isTokenDueForRefresh(selected.tokenUpdatedAt)) {
      try {
        selected = (await this.refreshAccountToken(selected.id, 'checkout')) ?? selected;
      } catch (error) {
        await this.recordFailure(selected.id, error, false);
        logger.warn({ accountId: selected.id }, '取号前 token 刷新失败，继续使用现有 token');
        await writePoolEvent({
          level: 'warn',
          message: '取号前自动登录刷新 token 失败，继续使用现有 token',
          accountId: selected.id,
          event: 'token_refresh_failed',
          uid: selected.uid,
          source: 'checkout',
        });
      }
    }
    
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

  /** 使用加密保存的账号密码重新登录并原子更新 token。 */
  async refreshAccountToken(
    accountId: string,
    source: TokenRefreshSource = 'manual',
  ): Promise<AccountPoolEntry | null> {
    const account = await this.getAccountById(accountId);
    if (!account?.loginUsername || !account.loginPasswordEncrypted) return null;

    const password = decryptCredential(account.loginPasswordEncrypted);
    const login = await YitongKanApiClient.login(account.loginUsername, password);
    const [updated] = await db
      .update(t.accountPools)
      .set({
        uid: login.uid,
        token: login.token,
        username: login.username || account.username,
        isVip: login.isVip,
        vipExpiresAt: login.vipExpiresAt ? new Date(login.vipExpiresAt) : null,
        tokenUpdatedAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
        status: 'active',
        lastCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(t.accountPools.id, accountId))
      .returning();

    logger.info({ accountId, source }, '号池 token 已自动刷新');
    await writePoolEvent({
      level: 'info',
      message: sourceLabel(source),
      accountId,
      event: 'token_refresh',
      uid: login.uid,
      source,
    });
    return (updated as unknown as AccountPoolEntry) ?? null;
  }

  /** 更新源站登录凭据；密码仅以密文写入数据库。 */
  async updateAccountCredentials(accountId: string, username: string, password: string): Promise<void> {
    await db
      .update(t.accountPools)
      .set({
        loginUsername: username,
        loginPasswordEncrypted: encryptCredential(password),
        updatedAt: new Date(),
      })
      .where(eq(t.accountPools.id, accountId));
  }

  private async recordFailure(accountId: string, error: unknown, inactive: boolean): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = {
      consecutiveFailures: sql`${t.accountPools.consecutiveFailures} + 1`,
      lastError: message.slice(0, 500),
      lastCheckAt: new Date(),
      updatedAt: new Date(),
    };
    if (inactive) patch.status = 'inactive';
    await db
      .update(t.accountPools)
      .set(patch)
      .where(eq(t.accountPools.id, accountId));
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
      // 到期 token 直接重新登录，不再只在 /me 失败时才换号。
      if (
        account.loginUsername &&
        account.loginPasswordEncrypted &&
        isTokenDueForRefresh(account.tokenUpdatedAt)
      ) {
        return Boolean(await this.refreshAccountToken(accountId, 'health_check'));
      }

      const result = await createClientFromAccount(account).getMemberInfo();
      if (result.code === '200') {
        await this.markHealthy(accountId, result.data);
        return true;
      }
      if (account.loginUsername && account.loginPasswordEncrypted) {
        return Boolean(await this.refreshAccountToken(accountId, 'health_check'));
      }
      await this.recordFailure(accountId, new Error('源站返回无效 token'), true);
      await writePoolEvent({
        level: 'warn',
        message: 'token 已失效且未托管密码，无法自动续期',
        accountId,
        event: 'token_refresh_failed',
        uid: account.uid,
        source: 'health_check',
      });
      return false;
    } catch (error) {
      try {
        if (account.loginUsername && account.loginPasswordEncrypted) {
          return Boolean(await this.refreshAccountToken(accountId, 'health_check'));
        }
      } catch (refreshError) {
        await this.recordFailure(accountId, refreshError, true);
        logger.warn({ accountId, error: refreshError }, '账号自动登录失败');
        await writePoolEvent({
          level: 'error',
          message: '健康检查后自动登录失败',
          accountId,
          event: 'token_refresh_failed',
          uid: account.uid,
          source: 'health_check',
        });
        return false;
      }
      await this.recordFailure(accountId, error, false);
      logger.error({ accountId, error }, '健康检查异常');
      await writePoolEvent({
        level: 'error',
        message: '健康检查异常，且该账号没有托管密码',
        accountId,
        event: 'token_refresh_failed',
        uid: account.uid,
        source: 'health_check',
      });
      return false;
    }
  }

  private async markHealthy(accountId: string, data: { isVip?: boolean; vipExpiresAt?: string; username?: string }): Promise<void> {
    await db
      .update(t.accountPools)
      .set({
        status: 'active',
        isVip: data.isVip ?? false,
        vipExpiresAt: data.vipExpiresAt ? new Date(data.vipExpiresAt) : null,
        username: data.username,
        consecutiveFailures: 0,
        lastError: null,
        lastCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(t.accountPools.id, accountId));
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

    let valid = 0;
    let invalid = 0;
    let failed = 0;

    for (const account of accounts) {
      // banned 账号跳过检查
      if (account.status === 'banned') {
        invalid++;
        continue;
      }

      const ok = await this.healthCheckAccount(account.id);
      const latest = await this.getAccountById(account.id);
      if (ok) valid++;
      else if (latest?.status === 'inactive') invalid++;
      else failed++;
    }

    logger.info({ targetSite, valid, invalid, failed }, '批量健康检查结果');
    await writePoolEvent({
      level: valid === 0 ? 'warn' : 'info',
      message: `号池巡检完成：${valid} 有效 / ${invalid} 失效 / ${failed} 失败`,
      event: 'pool_health_check',
      extra: { valid, invalid, failed, targetSite },
    });

    return { valid, invalid, failed };
  }

  /**
   * 定时自动刷新到期 token，效果与后台「刷新」按钮相同：重新登录并写入新 token。
   * 不失效正在播放的热链 m3u8（播放地址缓存在独立缓存里）。
   */
  async refreshDueTokens(targetSite: string): Promise<{
    due: number;
    refreshed: number;
    failed: number;
    skipped: number;
  }> {
    const accounts = await db
      .select()
      .from(t.accountPools)
      .where(eq(t.accountPools.targetSite, targetSite));

    const due = selectAccountsDueForTokenRefresh(accounts as unknown as TokenRefreshCandidate[]);
    let refreshed = 0;
    let failed = 0;

    for (const account of due) {
      try {
        const updated = await this.refreshAccountToken(account.id, 'scheduled');
        if (updated) refreshed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(account.id, error, false);
        logger.warn({ accountId: account.id, err: error }, '定时自动刷新 token 失败');
        await writePoolEvent({
          level: 'error',
          message: '定时自动登录刷新 token 失败',
          accountId: account.id,
          event: 'token_refresh_failed',
          uid: account.uid,
          source: 'scheduled',
        });
      }
    }

    if (due.length > 0) {
      await writePoolEvent({
        level: failed > 0 && refreshed === 0 ? 'warn' : 'info',
        message: `定时自动刷新 token：${refreshed} 成功 / ${failed} 失败 / ${due.length} 到期`,
        event: 'token_scheduled_refresh',
        extra: { targetSite, refreshed, failed, due: due.length },
      });
    }

    return {
      due: due.length,
      refreshed,
      failed,
      skipped: accounts.length - due.length,
    };
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
