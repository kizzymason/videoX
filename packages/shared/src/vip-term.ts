/**
 * 会员时长计算：兑换卡密、管理员赠送、新用户注册赠送、渠道购买都走这一份规则。
 *
 * 唯一的约定是**续期不顺延到「今天」而是顺延到「原到期时间」**：
 * 已是会员时再拿一次 30 天，应当从原来的到期日往后加 30 天，
 * 而不是从现在重新起算 30 天 —— 否则用户剩余的会员天数会被白吃掉。
 * 已过期或从未开通时，才从当前时刻起算。
 */

export const MS_PER_DAY = 86_400_000;

/** 当前是「续期」还是「新开通」。 */
export function isVipRenewal(current: Date | null | undefined, now: Date = new Date()): boolean {
  return current != null && current.getTime() > now.getTime();
}

/** 在现有到期时间上加 days 天，返回新的到期时间。 */
export function extendVipExpiry(
  current: Date | null | undefined,
  days: number,
  now: Date = new Date(),
): Date {
  const base = isVipRenewal(current, now) && current ? current : now;
  return new Date(base.getTime() + days * MS_PER_DAY);
}
