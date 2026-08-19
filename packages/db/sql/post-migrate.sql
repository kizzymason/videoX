-- ---------------------------------------------------------------------------
-- 在 drizzle 生成的结构迁移之后执行的补充语句。
-- 全部写成幂等形式，每次启动都可以安全重跑。
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- --- 全文检索 --------------------------------------------------------------
-- 'simple' 配置不做词干还原，对中英文混排的标题更稳；中文的模糊匹配交给下面的
-- trigram 索引兜底。两者在查询层做 UNION，兼顾精确与模糊。
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS videos_search_vector_idx ON videos USING GIN (search_vector);

-- trigram：支撑中文子串匹配与拼写容错的 ILIKE / similarity 查询
CREATE INDEX IF NOT EXISTS videos_title_trgm_idx ON videos USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS videos_desc_trgm_idx ON videos USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tags_name_trgm_idx ON tags USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_username_trgm_idx ON users USING GIN (username gin_trgm_ops);

-- --- 列表页高频组合索引 ----------------------------------------------------
-- 首页/分类页几乎都是「可播 + 公开 + 按时间倒序」，这条覆盖索引省掉一次排序。
CREATE INDEX IF NOT EXISTS videos_feed_idx
  ON videos (published_at DESC NULLS LAST)
  WHERE status IN ('ready', 'partially_ready') AND visibility = 'public';

CREATE INDEX IF NOT EXISTS videos_feed_hot_idx
  ON videos (view_count DESC)
  WHERE status IN ('ready', 'partially_ready') AND visibility = 'public';

CREATE INDEX IF NOT EXISTS videos_category_feed_idx
  ON videos (category_id, published_at DESC NULLS LAST)
  WHERE status IN ('ready', 'partially_ready') AND visibility = 'public';

-- --- 评论树 ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS comments_visible_video_idx
  ON comments (video_id, pinned DESC, like_count DESC, created_at DESC)
  WHERE status = 'visible';

-- --- 统计查询 --------------------------------------------------------------
CREATE INDEX IF NOT EXISTS an_events_play_idx
  ON analytics_events (created_at DESC)
  WHERE event = 'video_play';

CREATE INDEX IF NOT EXISTS an_events_pageview_idx
  ON analytics_events (created_at DESC)
  WHERE event = 'pageview';

-- --- 兑换码：只允许一个「未使用」态被并发抢占 ------------------------------
-- 兑换走的是 SELECT ... FOR UPDATE 行锁，这里的索引让锁定单行的查找是 O(1)。
CREATE INDEX IF NOT EXISTS redeem_codes_unused_idx
  ON redeem_codes (code)
  WHERE status = 'unused';

-- --- 会员有效性 ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS subscriptions_active_idx
  ON subscriptions (user_id, expires_at DESC)
  WHERE status = 'active';

-- --- 注册：邮箱改为可选 ----------------------------------------------------
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email_normalized DROP NOT NULL;
