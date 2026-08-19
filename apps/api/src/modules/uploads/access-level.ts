/** 秒传只能复用同档、同加密形态的 HLS。跨档必须重转或拒绝。 */
export function canReuseInstantAssets(
  source: { accessLevel: string; isEncrypted: boolean },
  targetAccessLevel: 'free' | 'login' | 'vip',
): boolean {
  if (source.accessLevel !== targetAccessLevel) return false;
  return source.isEncrypted === (targetAccessLevel === 'vip');
}
