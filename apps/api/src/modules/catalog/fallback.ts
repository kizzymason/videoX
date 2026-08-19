/** 推荐挂了也不能拖垮发现页：吞掉异常，交给 latest / 7 日热门 / 分类精选。 */
export async function settleRecommend<T>(load: () => Promise<T[]>): Promise<{ items: T[]; degraded: boolean }> {
  try {
    return { items: await load(), degraded: false };
  } catch {
    return { items: [], degraded: true };
  }
}
