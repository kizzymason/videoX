# videoX 开发清单

- 日期：2026-08-19
- 仓库：https://github.com/kizzymason/videoX
- HEAD（对照时）：`e331274`（仅一次 Initial commit）
- 原则：以代码为准，不以 README 宣传为准。

对照来源：Mux / Cloudflare Stream 的上传-转码-HLS-鉴权契约；YouTube / Bilibili 的产品形态；Netflix 的播放手感；MediaCMS / PeerTube 的自建站完整度。

## 已经对齐、先别再加码

代码里已经有，继续堆只会变重：

- 分片上传 API（init / part / complete，断点续传、秒传）和管理后台上传页
- BullMQ + ffmpeg 多码率 HLS：360p 先可播（`partially_ready`），封面 / 雪碧图 / `thumbnails.vtt`
- 自研播放器：hls.js ABR、手选清晰度、续播、倍速、PiP、试看门禁、票据续签、桌面热键、移动手势、进度条预览
- HMAC playToken + 会员档 HLS AES-128；卡密兑换行锁防双花
- 评论楼中楼、点赞 / 收藏 / 关注、观看历史 / 继续观看、分类标签搜索（pg_trgm）
- 算法召回 + AI 打分双轨推荐（一期已经超配，不要再加码大模型）
- PC / 移动 PWA / 管理后台三端

## P0 没有就不稳

1. **真跑通全链路**  
   有 Vitest 和 `scripts/e2e-pipeline.mjs`，没有 CI。先确认 `setup → 上传 → 转码 → 播放` 在干净环境能绿。

2. **上传权限与配额**  
   上传 UI 只在 admin；API 任意登录用户都能传，路由层未见大小 / MIME / 每用户配额。要么前台加创作者投稿，要么 API 改为管理员，并加上限。

3. **生产最小闭环**  
   无 Dockerfile、无 api/worker/web 的 compose、无反代。`.env.example` 密钥可 fallback。启动时拒绝 `dev_*` 默认密钥；CORS 不要在非本机全开。

4. **CI**  
   GitHub Actions 跑 typecheck + 不依赖数据库的单测。`redeem-lock` 需要真 PG，不要假装在空跑环境里过。

5. **播放鉴权别打爆缓存**  
   每个 manifest / 分片 / 密钥都硬校验 token。业界签目录或短时 JWT，切片长缓存。移动切网还会误伤 IP 绑定。

6. **UGC 发布闸门**  
   转码完成 → 敏感词 / 规则 → 自动过或进人工 → 再公开。现在没有这条闸。

## P1 中文站一对比就会输

- 弹幕（`video_id + time`，限频、敏感词、管理端清空）
- PC / 移动创作者中心：我的稿件、状态、失败重试、改标题封面、投稿入口
- 发现页可降级：最新 / 7 日热门 / 分类精选必须在推荐失败时还能用
- 用户上传 VTT/SRT；Whisper 放后面
- 大文件直传对象存储（S3 SDK 已引入，默认仍打穿 Express）

## P2 可以后做

合集 / 播单 / 下一集、关注动态页增强、章节、QoE 看板（播放器已有 `onFirstFrame`）、Whisper、4K/HEVC。

## 明确不做

直播、再加码大模型推荐、中贴广告、创作者分成、Content ID、Widevine/FairPlay、AV1 多编码、DASH+CMAF 双协议、P2P、ActivityPub、原生 iOS/Android、SSR 全站、从零再写 HLS 引擎。

## README 与代码不一致

| 说法 | 代码 |
| --- | --- |
| 输出 fMP4/CMAF | 免费档 fMP4；VIP 加密档是 MPEG-TS `.ts` |
| 数据流图画前台也能传 | 上传 UI 仅 `apps/admin` |
| 移动端仿 APP | 仅 Vite PWA，无 RN / 原生工程 |
| SEO 提 SSR | 三端都是 SPA |
| 后续接入支付 | 只有卡密，无微信/支付宝/Stripe |

## 本周顺序

| 日 | 事项 | 完成标准 |
| --- | --- | --- |
| D1 8/19 | 清单入库 + 最小 CI | 本文档合入；typecheck 与纯逻辑测试在 PR 上跑 |
| D2 | 跑通 setup 和一条真实转码播放 | 种子账号能播；短片能出 360p |
| D3 | 上传权限 + 拒绝默认密钥 | 非创作者不能传；漏配 `.env` 不能带着 `dev_*` 启动 |
| D4 | playToken 改目录级短时票 | 热分片可缓存；切网不掉流 |
| D5 | 弹幕 MVP 或前台「我的稿件」二选一 | 用户侧能感知到 |
