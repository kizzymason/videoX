import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createPool } from './client.js';
import { loadDbEnv } from './env.js';
import * as t from './schema.js';

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

function randomCode(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 16; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i % 4 === 3 && i !== 15) body += '-';
  }
  return prefix ? `${prefix}-${body}` : body;
}

const CATEGORIES = [
  { slug: 'featured', name: '精选推荐', icon: 'Sparkles', description: '编辑部精挑细选的高质量内容' },
  { slug: 'tech', name: '科技数码', icon: 'Cpu', description: '硬件评测、软件教程与前沿科技' },
  { slug: 'film', name: '影视剪辑', icon: 'Clapperboard', description: '影视混剪、解说与幕后花絫' },
  { slug: 'music', name: '音乐现场', icon: 'Music', description: 'Live 演出、翻唱与原创音乐' },
  { slug: 'game', name: '游戏竞技', icon: 'Gamepad2', description: '实况、攻略与赛事集锦' },
  { slug: 'life', name: '生活方式', icon: 'Coffee', description: '美食、旅行与日常 Vlog' },
  { slug: 'knowledge', name: '知识科普', icon: 'GraduationCap', description: '硬核科普与技能教学' },
  { slug: 'anime', name: '动画番剧', icon: 'Tv', description: '动画、番剧与二次元创作' },
  { slug: 'sports', name: '运动健身', icon: 'Dumbbell', description: '训练计划、赛事与户外运动' },
  { slug: 'documentary', name: '纪录影像', icon: 'Film', description: '自然、人文与社会纪录片' },
];

const TAGS = [
  '4K', 'HDR', '慢直播', '教程', '评测', '开箱', '混剪', '解说', '沉浸式', 'ASMR',
  '独立音乐', '现场', '电竞', '速通', '搞笑', '治愈', '旅行', '美食', '摄影', '剪辑',
  '人工智能', '编程', '设计', '健身', '自然', '历史', '宇宙', '汽车', '手办', 'Vlog',
];

const PLANS = [
  {
    code: 'monthly',
    name: '月度会员',
    description: '按月体验全部会员权益，随时可续。',
    durationDays: 30,
    priceCents: 1900,
    originalPriceCents: 2900,
    perks: ['全站会员视频无限观看', '1080P 高码率画质', '无广告纯净播放', '专属会员标识'],
    badge: null,
    isRecommended: false,
    sortOrder: 1,
  },
  {
    code: 'quarterly',
    name: '季度会员',
    description: '三个月畅享，折合每月更划算。',
    durationDays: 90,
    priceCents: 4900,
    originalPriceCents: 8700,
    perks: ['月度会员全部权益', '4K 超清画质解锁', '离线缓存', '新片抢先看'],
    badge: '热销',
    isRecommended: true,
    sortOrder: 2,
  },
  {
    code: 'yearly',
    name: '年度会员',
    description: '一次开通，全年无忧，单价最低。',
    durationDays: 365,
    priceCents: 16900,
    originalPriceCents: 34800,
    perks: ['季度会员全部权益', '同时 5 台设备在线', '专属客服通道', '年度限定周边'],
    badge: '超值',
    isRecommended: false,
    sortOrder: 3,
  },
  {
    code: 'lifetime',
    name: '永久会员',
    description: '买断制，永不过期。',
    durationDays: 36500,
    priceCents: 49900,
    originalPriceCents: 99900,
    perks: ['年度会员全部权益', '永久有效不过期', '全部新功能优先体验', '创作者扶持计划'],
    badge: '尊享',
    isRecommended: false,
    sortOrder: 4,
  },
];

const DEFAULT_SITE_SETTINGS = {
  siteName: 'videoX',
  siteTagline: '简约高级的视频平台',
  siteDescription: 'videoX 是一个自建的现代视频平台，支持多码率 HLS 播放、会员订阅与智能推荐。',
  siteKeywords: '视频,在线观看,HLS,会员,videoX',
  logoUrl: null,
  faviconUrl: null,
  defaultTheme: 'light',
  icpBeian: null,
  footerText: '© videoX. 内容仅供演示。',
  contactEmail: 'hello@videox.local',
  allowRegistration: true,
  commentsRequireApproval: false,
  previewSeconds: 60,
  maxConcurrentStreams: 3,
  seo: {
    videoTitleTemplate: '{title} - {siteName}',
    categoryTitleTemplate: '{category} - {siteName}',
    sitemapEnabled: true,
    sitemapPageSize: 5000,
    robotsExtra: '',
  },
};

const DEFAULT_ALGO_WEIGHTS = {
  affinity: 1.0,
  quality: 0.8,
  freshness: 0.6,
  completion: 0.9,
  popularity: 0.5,
  aiScore: 0.7,
  affinityHalfLifeDays: 14,
  freshnessHalfLifeDays: 7,
  diversityLambda: 0.25,
  maxPerAuthor: 3,
  maxPerCategory: 6,
  explorationRatio: 0.15,
};

const DEMO_TITLES = [
  '深夜城市漫游｜4K HDR 街头影像',
  '从零构建一个视频平台：架构全解析',
  '一支麦克风的独白｜Live Session',
  '雪山之上：无人机航拍纪录',
  '30 分钟搞懂现代前端渲染管线',
  '老城区的早餐地图｜城市美食漫记',
  '深海之下的光｜自然纪录片',
  '独立游戏开发日志 第 12 期',
  '把旧笔记本改造成家用服务器',
  '钢琴改编｜那些年被反复循环的旋律',
  '沙漠公路 2000 公里自驾实录',
  '拆解一台十年前的旗舰手机',
  '雨天的窗｜三小时白噪音',
  '一个人的登山日记：海拔 5000 米',
  '电影调色到底在调什么',
  '街头篮球高光集锦｜2026 夏季赛',
  '手冲咖啡的十种失败',
  '宇宙尺度：从地球到可观测边界',
  '用代码画一朵会呼吸的花',
  '凌晨四点的渔港',
  '重返胶片：一卷 135 的完整流程',
  '机械键盘手感玄学实测',
  '城市天际线延时摄影合集',
  '给设计师的排版基本功',
  '在山里住了一整个秋天',
  '短视频算法是怎么决定你看什么的',
  '复古游戏机维修实录',
  '一碗面的三十年',
  '如何拍出电影感的运镜',
  '午夜电台：给失眠的人',
  '从零学会视频剪辑：第一课',
  '极光追逐者的北欧之旅',
  '解剖一台电动车的三电系统',
  '古籍修复师的一天',
  '雨林深处的声音采集',
  '为什么你的照片总是不好看',
];

const DEMO_USERS = [
  { username: 'lumen', displayName: '光影研究所', bio: '专注影像与色彩，每周更新。' },
  { username: 'devdiary', displayName: '开发者日志', bio: '把复杂的技术讲简单。' },
  { username: 'nightowl', displayName: '夜行动物', bio: '记录城市入夜后的样子。' },
  { username: 'fieldnote', displayName: '田野笔记', bio: '自然、旅行与一切在路上的事。' },
  { username: 'soundlab', displayName: '声音实验室', bio: '现场、编曲与耳朵的冒险。' },
];

function pick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i += 1) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]!);
  }
  return out;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function executeAffected(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    const r = result as { rowCount?: number | null; rows?: unknown[] };
    if (typeof r.rowCount === 'number') return r.rowCount;
    if (Array.isArray(r.rows)) return r.rows.length;
  }
  return 0;
}

/** 已入库却无 HLS / 无 rendition 的假 ready 行必须降级，否则首页会按可播展示。 */
async function demoteUnplayableSeedVideos(db: ReturnType<typeof drizzle>) {
  const demoteResult = await db.execute(sql`
    UPDATE videos
    SET status = 'draft', published_at = NULL, updated_at = now()
    WHERE status IN ('ready', 'partially_ready')
      AND (hls_dir IS NULL OR btrim(hls_dir) = '')
      AND coalesce(jsonb_array_length(renditions), 0) = 0
    RETURNING id
  `);
  const demoted = executeAffected(demoteResult);
  console.log(`  已将 ${demoted} 条无 HLS 的假 ready 视频降为 draft。`);

  const bannerResult = await db.execute(sql`
    UPDATE banners
    SET is_active = false
    WHERE video_id IN (
      SELECT id FROM videos
      WHERE status = 'draft'
        AND (hls_dir IS NULL OR btrim(hls_dir) = '')
        AND coalesce(jsonb_array_length(renditions), 0) = 0
    )
  `);
  console.log(`  已停用 ${executeAffected(bannerResult)} 条指向不可播草稿的轮播。`);

  await db.execute(sql`
    UPDATE categories SET video_count = (
      SELECT count(*)::int FROM videos
      WHERE videos.category_id = categories.id
        AND videos.status IN ('ready', 'partially_ready')
        AND videos.visibility = 'public'
    )
  `);
  await db.execute(sql`
    UPDATE users SET video_count = (
      SELECT count(*)::int FROM videos
      WHERE videos.author_id = users.id
        AND videos.status IN ('ready', 'partially_ready')
        AND videos.visibility = 'public'
    )
  `);
}

async function main() {
  const { repoRoot } = loadDbEnv();
  console.log(`使用仓库根目录：${repoRoot}`);

  const pool = createPool({ max: 4 });
  const db = drizzle(pool, { schema: t });

  console.log('写入分类…');
  const categoryRows = await db
    .insert(t.categories)
    .values(
      CATEGORIES.map((c, i) => ({
        slug: c.slug,
        name: c.name,
        icon: c.icon,
        description: c.description,
        sortOrder: i,
      })),
    )
    .onConflictDoUpdate({
      target: t.categories.slug,
      set: { name: sql`excluded.name`, icon: sql`excluded.icon`, description: sql`excluded.description` },
    })
    .returning();
  console.log(`  ${categoryRows.length} 个分类`);

  console.log('写入标签…');
  const tagRows = await db
    .insert(t.tags)
    .values(TAGS.map((name) => ({ slug: name.toLowerCase().replace(/\s+/g, '-'), name })))
    .onConflictDoUpdate({ target: t.tags.slug, set: { name: sql`excluded.name` } })
    .returning();
  console.log(`  ${tagRows.length} 个标签`);

  console.log('写入会员套餐…');
  const planRows = await db
    .insert(t.plans)
    .values(PLANS)
    .onConflictDoUpdate({
      target: t.plans.code,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        durationDays: sql`excluded.duration_days`,
        priceCents: sql`excluded.price_cents`,
        originalPriceCents: sql`excluded.original_price_cents`,
        perks: sql`excluded.perks`,
        badge: sql`excluded.badge`,
        isRecommended: sql`excluded.is_recommended`,
        sortOrder: sql`excluded.sort_order`,
      },
    })
    .returning();
  console.log(`  ${planRows.length} 个套餐`);

  console.log('写入站点设置与算法权重…');
  await db
    .insert(t.settings)
    .values([
      { key: 'site', value: DEFAULT_SITE_SETTINGS },
      { key: 'algo_weights', value: DEFAULT_ALGO_WEIGHTS },
    ])
    .onConflictDoNothing();

  console.log('写入默认存储配置…');
  await db
    .insert(t.storageProfiles)
    .values([
      { name: '本地磁盘', driver: 'local' as const, isActive: true, config: { root: './storage' } },
      {
        name: 'S3 兼容对象存储',
        driver: 's3' as const,
        isActive: false,
        config: {
          endpoint: '',
          region: 'auto',
          bucket: '',
          accessKeyId: '',
          secretAccessKey: '',
          forcePathStyle: true,
          publicBaseUrl: '',
        },
      },
    ])
    .onConflictDoNothing();

  console.log('写入默认 AI 推荐配置…');
  await db
    .insert(t.aiProfiles)
    .values({
      name: '默认 AI 重排',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: '',
      systemPrompt:
        '你是一个视频内容运营专家。你会收到一批视频的标题、简介、分类、标签与基础互动数据，请为每个视频评估它作为首页推荐位的价值。',
      userPromptTemplate:
        '请对下面的视频列表打分。评分范围 0-100，综合考虑：标题吸引力、内容稀缺度、与分类的匹配度、互动数据的健康度。\n\n严格只返回 JSON 数组，每项形如 {"id":"<视频ID>","score":<0-100 的数字>,"reason":"<不超过 30 字的中文理由>"}，不要输出任何额外文字。\n\n视频列表：\n{{videos}}',
      temperature: 0.2,
      batchSize: 10,
      isActive: true,
    })
    .onConflictDoNothing();

  console.log('写入用户…');
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@videox.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456';
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';

  const adminHash = await hash(adminPassword, ARGON2_OPTIONS);
  const demoHash = await hash('Demo@123456', ARGON2_OPTIONS);

  const userValues = [
    {
      email: adminEmail,
      emailNormalized: adminEmail.toLowerCase(),
      username: adminUsername,
      usernameNormalized: adminUsername.toLowerCase(),
      passwordHash: adminHash,
      displayName: '站点管理员',
      role: 'admin' as const,
      bio: '负责 videoX 的日常运营。',
      vipExpiresAt: new Date(Date.now() + 3650 * 86_400_000),
    },
    {
      email: 'vip@videox.local',
      emailNormalized: 'vip@videox.local',
      username: 'vipuser',
      usernameNormalized: 'vipuser',
      passwordHash: demoHash,
      displayName: '会员体验号',
      role: 'user' as const,
      bio: '用来验证会员门禁的演示账号。',
      vipExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    {
      email: 'user@videox.local',
      emailNormalized: 'user@videox.local',
      username: 'normaluser',
      usernameNormalized: 'normaluser',
      passwordHash: demoHash,
      displayName: '普通用户',
      role: 'user' as const,
      bio: '未开通会员的演示账号。',
      vipExpiresAt: null,
    },
    ...DEMO_USERS.map((u) => ({
      email: `${u.username}@videox.local`,
      emailNormalized: `${u.username}@videox.local`,
      username: u.username,
      usernameNormalized: u.username,
      passwordHash: demoHash,
      displayName: u.displayName,
      role: 'user' as const,
      bio: u.bio,
      vipExpiresAt: null,
    })),
  ];

  const userRows = await db
    .insert(t.users)
    .values(userValues)
    .onConflictDoUpdate({
      target: t.users.emailNormalized,
      set: { displayName: sql`excluded.display_name`, bio: sql`excluded.bio` },
    })
    .returning();
  console.log(`  ${userRows.length} 个用户（管理员：${adminEmail} / ${adminPassword}）`);

  const creators = userRows.filter((u) => DEMO_USERS.some((d) => d.username === u.username));
  const authorPool = creators.length > 0 ? creators : userRows;

  console.log('写入演示视频…');
  const existingVideos = await db.select({ id: t.videos.id }).from(t.videos).limit(1);
  if (existingVideos.length > 0) {
    console.log('  已存在视频数据，跳过演示视频生成。');
  } else {
    const videoValues = DEMO_TITLES.map((title, i) => {
      const category = categoryRows[i % categoryRows.length]!;
      const author = authorPool[i % authorPool.length]!;
      const duration = randInt(90, 3600);
      const views = randInt(120, 480_000);
      const likes = Math.floor(views * (0.02 + Math.random() * 0.08));
      // 每 5 个里放 1 个会员视频，方便验证门禁与加密链路。
      const accessLevel = i % 5 === 4 ? ('vip' as const) : ('free' as const);
      const hue = (i * 37) % 360;
      return {
        slug: `demo-${String(i + 1).padStart(3, '0')}`,
        title,
        description: `${title}。这是一条用于演示的示例内容，包含完整的元数据、分类与标签，仅用于验证列表、搜索与推荐，不包含可播放片源。`,
        authorId: author.id,
        categoryId: category.id,
        // 无片源、无 HLS，不能标 ready，否则首页会按 PLAYABLE_VIDEO_STATUSES 假装可播。
        status: 'draft' as const,
        visibility: 'public' as const,
        accessLevel,
        posterUrl: `/static/placeholder/cover?h=${hue}&t=${encodeURIComponent(title.slice(0, 12))}`,
        verticalPosterUrl: `/static/placeholder/cover?h=${hue}&r=3x4&t=${encodeURIComponent(title.slice(0, 12))}`,
        durationSeconds: duration,
        width: 1920,
        height: 1080,
        fps: 30,
        renditions: [],
        isEncrypted: accessLevel === 'vip',
        viewCount: views,
        likeCount: likes,
        favoriteCount: Math.floor(likes * 0.4),
        commentCount: randInt(0, 120),
        totalWatchSeconds: views * Math.floor(duration * (0.3 + Math.random() * 0.5)),
        completionRate: 0.3 + Math.random() * 0.5,
        qualityScore: 0.4 + Math.random() * 0.6,
        publishedAt: null,
      };
    });

    const videoRows = await db.insert(t.videos).values(videoValues).returning();
    console.log(`  ${videoRows.length} 条视频`);

    const videoTagValues = videoRows.flatMap((v) =>
      pick(tagRows, randInt(2, 5)).map((tag) => ({ videoId: v.id, tagId: tag.id })),
    );
    await db.insert(t.videoTags).values(videoTagValues).onConflictDoNothing();

    await db.execute(sql`
      UPDATE tags SET video_count = sub.c
      FROM (SELECT tag_id, count(*)::int AS c FROM video_tags GROUP BY tag_id) sub
      WHERE tags.id = sub.tag_id
    `);
    await db.execute(sql`
      UPDATE categories SET video_count = sub.c
      FROM (
        SELECT category_id, count(*)::int AS c
        FROM videos
        WHERE category_id IS NOT NULL
          AND status IN ('ready', 'partially_ready')
          AND visibility = 'public'
        GROUP BY category_id
      ) sub
      WHERE categories.id = sub.category_id
    `);
    await db.execute(sql`
      UPDATE users SET video_count = sub.c
      FROM (
        SELECT author_id, count(*)::int AS c
        FROM videos
        WHERE author_id IS NOT NULL
          AND status IN ('ready', 'partially_ready')
          AND visibility = 'public'
        GROUP BY author_id
      ) sub
      WHERE users.id = sub.author_id
    `);

    console.log('写入轮播图…');
    console.log('  演示视频无片源、无 HLS，跳过「点击立即观看」轮播写入。');
  }

  await demoteUnplayableSeedVideos(db);

  console.log('写入演示兑换码…');
  const existingCodes = await db.select({ id: t.redeemCodes.id }).from(t.redeemCodes).limit(1);
  if (existingCodes.length > 0) {
    console.log('  已存在兑换码，跳过。');
  } else {
    const admin = userRows.find((u) => u.role === 'admin');
    const batchId = `SEED-${Date.now().toString(36).toUpperCase()}`;
    const codeValues = planRows.flatMap((plan) =>
      Array.from({ length: 5 }, () => ({
        code: randomCode(plan.code.slice(0, 3).toUpperCase()),
        planId: plan.id,
        batchId,
        status: 'unused' as const,
        note: '种子数据生成',
        createdBy: admin?.id ?? null,
      })),
    );
    const codes = await db.insert(t.redeemCodes).values(codeValues).returning();
    console.log(`  ${codes.length} 个兑换码，示例：`);
    for (const plan of planRows) {
      const sample = codes.find((c) => c.planId === plan.id);
      if (sample) console.log(`    ${plan.name.padEnd(6)} ${sample.code}`);
    }
  }

  await pool.end();
  console.log('\n种子数据写入完成。');
}

main().catch((error) => {
  console.error('种子数据写入失败：', error);
  process.exit(1);
});
