# videoX 开发清单

- 日期：2026-08-19（修订：C 端不做投稿；不做弹幕）
- 仓库：https://github.com/kizzymason/videoX
- HEAD（对照时）：`e331274`（仅一次 Initial commit）
- 原则：以代码为准，不以 README 宣传为准。

对照来源：Mux / Cloudflare Stream 的上传-转码-HLS-鉴权契约；YouTube / Bilibili 的产品形态；Netflix 的播放手感；MediaCMS / PeerTube 的自建站完整度。

## 产品拍板（必须遵守）

1. **不做 C 端创作者上传。** 投稿入口、创作者中心「我的稿件 / 投稿」、用户侧 UGC 上传都不要做。上传只保留管理后台。
2. **不做弹幕。** 不进 P1，不进本周排期，列入明确不做。

P0 补 storage、跑通「管理端上传 → 转码 → 播放」主链路不变。

## 已经对齐、先别再加码

代码里已经有，继续堆只会变重：

- 分片上传 API（init / part / complete，断点续传、秒传）和管理后台上传页
- BullMQ + ffmpeg 多码率 HLS：360p 先可播（`partially_ready`），封面 / 雪碧图 / `thumbnails.vtt`
- 自研播放器：hls.js ABR、手选清晰度、续播、倍速、PiP、试看门禁、票据续签、桌面热键、移动手势、进度条预览
- HMAC playToken + 会员档 HLS AES-128；卡密兑换行锁防双花
- 评论楼中楼、点赞 / 收藏 / 关注、观看历史 / 继续观看、分类标签搜索（pg_trgm）
- 算法召回 + AI 打分双轨推荐（一期已经超配，不要再加码大模型）
- PC / 移动 PWA / 管理后台三端

注意：上传 / 转码 / HLS 的**逻辑写了**，但都依赖缺失的 `storage` 模块，当前树编译不过、主链路跑不起来。

## P0 没有就不稳

0. **补回 `apps/api/src/modules/storage/`（今天第一件事）**  
   `uploads` / `media` / `admin` / `worker/transcode` 都在 import，`@videox/api` 还 export 了 `"./storage": "./src/modules/storage/index.ts"`，目录却没进 git。至少要有：
   - `keys.ts`：source / hlsDir / master / poster 等键
   - `driver.ts`：local + S3，`get/put/putFile/head/delete/deletePrefix`
   - `service.ts`：读 `storage_profiles` 热切换、测试连接、激活互斥
   - `index.ts` 对齐 package exports  
   验收：`npm run typecheck` 过；admin「测试连接」成功；**管理后台**上传小 mp4 → 360p → PC 能播。
   没补上之前，不要开推荐优化或新页面。

1. **种子不要假装可播**  
   演示视频 `status=ready` 但没有 HLS。要么 seed 后入队转码，要么列表过滤无 rendition 的条目。

2. **真跑通管理端主链路**  
   `setup → 管理后台上传 → 转码 → PC/移动播放` 和 `scripts/e2e-pipeline.mjs`。存储补回之前这条必挂。不要为此做 C 端投稿页。

3. **上传 API 只给管理员**  
   产品已定：C 端不投稿。当前 `/api/uploads` 是 `requireAuth`，任意登录用户都能传。改为 `requireAdmin`，并加大小 / MIME / 配额。PC/移动不要加投稿入口。

4. **生产最小闭环**  
   Dockerfile、api/worker/web compose、反代。启动时拒绝 `dev_*` 默认密钥。

5. **CI**  
   typecheck + 不依赖数据库的单测。存储补回后 typecheck 才有意义。

6. **播放鉴权别打爆缓存**  
   不要每个分片都验签；改目录级短时票。

7. **发布闸门（管理端）**  
   转码完成 → 敏感词 / 规则 → 自动过或进人工 → 再公开。这是后台内容审核，不是 C 端 UGC 投稿。

## P1 体验差距会立刻被看出来

- 发现页可降级：最新 / 7 日热门 / 分类精选必须在推荐失败时还能用
- 管理端上传字幕 VTT/SRT；Whisper 放后面
- 大文件直传对象存储（S3 SDK 已引入，默认仍打穿 Express）
- 秒传不要跨 `accessLevel` 复用加密态；改 vip 要重转码才会加密

## P2 可以后做

合集 / 播单 / 下一集、关注动态页增强、章节、QoE 看板（播放器已有 `onFirstFrame`）、Whisper、4K/HEVC。

## 明确不做

- **C 端创作者上传**：投稿入口、创作者中心「我的稿件 / 投稿」、用户侧 UGC 上传
- **弹幕**（含弹幕 MVP、热力图、高级弹幕）
- 直播、再加码大模型推荐、中贴广告、创作者分成、Content ID、Widevine/FairPlay、AV1 多编码、DASH+CMAF 双协议、P2P、ActivityPub、原生 iOS/Android、SSR 全站、从零再写 HLS 引擎

## README 与代码不一致

| 说法 | 代码 |
| --- | --- |
| setup/dev 后即可播放上传转码 | `modules/storage/` 未进 git，主链路编译不过 |
| 种子视频可验证播放 | 只有元数据 + SVG 占位，无 HLS |
| 输出 fMP4/CMAF | 免费档 fMP4；VIP 加密档是 MPEG-TS `.ts` |
| 数据流图画前台也能传 | 上传 UI 仅 `apps/admin`（产品也要求保持如此） |
| 后台 S3 测试连接即时生效 | 路由写了，storage 实现文件不存在 |
| 移动端仿 APP | 仅 Vite PWA，无 RN / 原生工程 |
| SEO 提 SSR | 三端都是 SPA |
| 后续接入支付 | 只有卡密 |

## 本周顺序

| 日 | 事项 | 完成标准 |
| --- | --- | --- |
| D1 8/19 | 补 storage + 清单/CI 入库 | `modules/storage/` 在树上；typecheck 绿 |
| D2 | 跑通管理端上传→转码→播放 | 短片出 360p；种子不再假装可播 |
| D3 | 上传 API 改 requireAdmin + 拒绝默认密钥 | 普通用户不能传；漏配 `.env` 不能带着 `dev_*` 启动 |
| D4 | playToken 改目录级短时票 | 热分片可缓存；切网不掉流 |
| D5 | 发现页可降级（最新/热门/分类） | 推荐挂了首页仍能浏览 |
