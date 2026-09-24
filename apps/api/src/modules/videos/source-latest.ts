// ========================================================================
// 「最新」对齐源站列表：按源站视频号倒序。
//
// 源站 https://yitongkan.com/ 的「最新上传」走 `sort=latest`，实测它连 `sort=default`
// 都返回同一份顺序。把线上第 1 页（36 条）逐条拉出来看：
//
//   1000009681, 1000009680, 1000009677, 1000009676, 1000009675, 1000009672,
//   1000009664, 1000009661, 1000009660, 1000009659, 1000009658, 1000009655,
//   1000009649, 1000009648, 1000009591, 1000009559, 1000009556, 1000009534,
//   1000009519, 1000009509, 1000009497, 1000009493, 1000009465, 1000009464, ...
//
// 前 24 条严格按视频号递减——这就是源站列表顺序，也就等于「刚发布的排最前」。
//
// 试过但否掉的两条路：
// 1. 采集页码 + 采集时间升序（原先的写法）。采集从第 1 页往后连续跑，第 1 页最早入库，
//    升序等于把最旧的一批顶到「最新」第一屏，这正是要修的 bug。
// 2. 从封面文件名里解析「源站发布时间」。看着很美，但实测与视频号的相关性只有 0.23
//    （封面是异步生成的，时间戳跟上传顺序对不上），排出来的顺序反而偏离源站。
//
// 源站号在它自己的老片批量入库段里是升序的（一批同秒写入、按号升序落库），那一段我们的
// 顺序与之相反；但那是一整批同期的老内容，源站自身在该段内也没有可靠次序，不值得为它
// 引入特例。本地上传没有源站号，恒定视为最新，排在最前。
// ========================================================================

export interface SourceLatestKey {
  /** 源站视频号，非采集视频（本地上传）为 null。 */
  externalId: string | null;
  /** videos.published_at，本地上传之间用它比较。 */
  publishedAtMs: number | null;
  /** videos.created_at，始终存在，最后的兜底。 */
  createdAtMs: number;
  /** videos.id，保证排序是全序、翻页不抖动。 */
  videoId: string;
}

/** 视频号在本库里一律是纯数字串；非数字（换片源后可能出现）视作没有号。 */
export function numericExternalId(externalId: string | null): number | null {
  if (!externalId) return null;
  if (!/^[0-9]+$/.test(externalId)) return null;
  const value = Number(externalId);
  return Number.isSafeInteger(value) ? value : null;
}

/** 与 SQL 里的 coalesce 链一一对应。 */
export function localRecencyOf(key: SourceLatestKey): number {
  return key.publishedAtMs ?? key.createdAtMs;
}

/** 与 listVideos(sort=latest) 的 SQL 顺序一致，供单测锁契约。 */
export function compareSourceLatest(a: SourceLatestKey, b: SourceLatestKey): number {
  // 1. 本地上传恒排最前——它一定是站上最新的东西，而且没有源站号可比。
  const aCollected = numericExternalId(a.externalId) !== null;
  const bCollected = numericExternalId(b.externalId) !== null;
  if (aCollected !== bCollected) return aCollected ? 1 : -1;

  // 2. 采集片之间按源站视频号倒序。
  if (aCollected && bCollected) {
    const ea = numericExternalId(a.externalId)!;
    const eb = numericExternalId(b.externalId)!;
    if (ea !== eb) return eb - ea;
  } else {
    // 3. 本地上传之间按自身发布时间倒序。
    const byTime = localRecencyOf(b) - localRecencyOf(a);
    if (byTime !== 0) return byTime;
  }

  // 4. 全序兜底。
  if (a.videoId === b.videoId) return 0;
  return a.videoId < b.videoId ? 1 : -1;
}
