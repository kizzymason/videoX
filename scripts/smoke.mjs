/**
 * 后端冒烟测试：按真实使用顺序打一遍关键接口，任何一个非预期状态码都会打印出来。
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
const base = process.argv[2] ?? 'http://localhost:4000';

let pass = 0;
let fail = 0;
const jar = new Map();

const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method, path, { body, token, expect = 200, raw = false, quiet = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (jar.size) headers.Cookie = cookieHeader();

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }

  const expected = Array.isArray(expect) ? expect : [expect];
  const label = `${method} ${path}`;
  if (expected.includes(res.status)) {
    pass += 1;
    if (!quiet) console.log(`  ok   ${label} -> ${res.status}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} -> ${res.status} (期望 ${expected.join('/')})`);
    console.log(`       ${(await res.clone().text()).slice(0, 500)}`);
  }
  return raw ? res.text() : res.json().catch(() => null);
}

const section = (name) => console.log(`\n== ${name}`);

const run = async () => {
  section('基础');
  await call('GET', '/health');
  await call('GET', '/');
  await call('GET', '/api/nope', { expect: 404 });

  section('目录与内容');
  const cats = await call('GET', '/api/categories');
  const list = await call('GET', '/api/videos?page=1&pageSize=4');
  await call('GET', '/api/tags');
  await call('GET', '/api/banners');
  await call('GET', '/api/site');
  await call('GET', '/api/search?q=%E7%BA%AA%E5%BD%95');
  await call('GET', '/api/search/suggest?q=a');
  await call('GET', '/api/search/hot');
  await call('GET', '/api/recommend/feed');

  const first = list?.data?.items?.[0];
  if (!first) throw new Error('种子数据缺少视频，无法继续');
  await call('GET', `/api/videos/${first.slug}`);
  await call('GET', `/api/videos/${first.id}/related`);
  await call('GET', `/api/videos/${first.id}/more-from-author`);
  await call('GET', `/api/comments?videoId=${first.id}`);
  await call('GET', `/api/categories/${cats.data[0].slug}`);

  section('鉴权');
  const email = `smoke_${Date.now()}@videox.local`;
  const username = `smoke${Date.now() % 1000000}`;
  const reg = await call('POST', '/api/auth/register', {
    body: { email, password: 'Smoke@123456', username },
    expect: [200, 201],
  });
  let token = reg?.data?.accessToken;
  await call('GET', '/api/auth/me', { token });
  const login = await call('POST', '/api/auth/login', { body: { identifier: email, password: 'Smoke@123456' } });
  token = login?.data?.accessToken ?? token;
  const refreshed = await call('POST', '/api/auth/refresh');
  token = refreshed?.data?.accessToken ?? token;
  await call('GET', '/api/auth/sessions', { token });
  await call('PATCH', '/api/auth/me', { token, body: { displayName: '冒烟用户' } });
  await call('GET', `/api/users/${username}`);
  await call('GET', `/api/users/${username}/videos`);
  await call('GET', '/api/auth/me', { expect: 401 });
  await call('POST', '/api/auth/login', { body: { identifier: email, password: 'wrong' }, expect: 401 });

  section('互动');
  await call('POST', `/api/videos/${first.id}/like`, { token });
  await call('POST', `/api/videos/${first.id}/favorite`, { token });
  await call('POST', '/api/progress', {
    token,
    body: { videoId: first.id, positionSeconds: 42, durationSeconds: 300, deltaSeconds: 42 },
  });
  await call('GET', '/api/history', { token });
  await call('GET', '/api/favorites', { token });
  await call('GET', '/api/following', { token });
  await call('GET', '/api/following/feed', { token });
  await call('GET', '/api/continue-watching', { token });
  await call('GET', '/api/my-videos', { token });
  await call('GET', '/api/history', { expect: 401 });

  const comment = await call('POST', '/api/comments', {
    token,
    body: { videoId: first.id, content: '冒烟测试评论' },
    expect: [200, 201],
  });
  const commentId = comment?.data?.id;
  if (commentId) {
    await call('POST', '/api/comments', {
      token,
      body: { videoId: first.id, content: '冒烟测试回复', parentId: commentId },
      expect: [200, 201],
    });
    await call('GET', `/api/comments/${commentId}/replies`);
    await call('POST', `/api/comments/${commentId}/like`, { token });
    await call('DELETE', `/api/comments/${commentId}`, { token });
  }

  section('播放鉴权');
  const ticket = await call('POST', `/api/videos/${first.id}/play-ticket`, { token, expect: [200, 402, 403] });
  const playToken = ticket?.data?.token;
  if (playToken) {
    await call('POST', `/api/videos/${first.id}/renew-ticket`, { token, body: { token: playToken }, expect: [200, 400] });
    // 演示数据没有真实转码产物，取不到 master.m3u8 是预期内的；这里验的是鉴权层放行。
    await call('GET', `/media/hls/${first.id}/master.m3u8?tk=${encodeURIComponent(playToken)}`, {
      raw: true,
      expect: [200, 404],
    });
  }
  await call('GET', `/media/hls/${first.id}/master.m3u8`, { expect: 403 });
  await call('GET', `/media/hls/${first.id}/master.m3u8?tk=v1.Zm9v.YmFy`, { expect: 403 });

  section('埋点与 SEO');
  const beacon = { sessionId: 'smoke-session-0001', visitorId: 'smoke-visitor-0001', client: 'pc', ts: Date.now() };
  await call('POST', '/api/collect', {
    body: {
      events: [
        { ...beacon, event: 'pageview', path: '/', referrer: 'https://www.google.com/' },
        { ...beacon, event: 'video_impression', videoId: first.id },
        { ...beacon, event: 'video_play', videoId: first.id },
        { ...beacon, event: 'search', keyword: '纪录片' },
      ],
    },
    expect: [200, 201, 204],
  });
  await call('GET', '/sitemap.xml', { raw: true });
  await call('GET', '/sitemap-pages.xml', { raw: true });
  await call('GET', '/sitemap-categories.xml', { raw: true });
  await call('GET', '/sitemap-videos-1.xml', { raw: true });
  await call('GET', '/robots.txt', { raw: true });
  await call('GET', `/api/seo/video/${first.slug}`);
  await call('GET', '/static/placeholder/cover?h=200&t=demo', { raw: true });

  section('管理后台');
  const admin = await call('POST', '/api/auth/login', {
    body: { identifier: 'admin@videox.local', password: 'Admin@123456' },
  });
  const adminToken = admin?.data?.accessToken;
  const adminGets = [
    '/api/admin/dashboard/overview',
    '/api/admin/dashboard/insights',
    '/api/admin/dashboard/top-videos',
    `/api/admin/dashboard/retention/${first.id}`,
    '/api/admin/videos',
    '/api/admin/transcode/jobs',
    '/api/admin/users',
    '/api/admin/comments',
    '/api/admin/categories',
    '/api/admin/tags',
    '/api/admin/banners',
    '/api/admin/plans',
    '/api/admin/redeem-codes',
    '/api/admin/orders',
    '/api/admin/storage',
    '/api/admin/settings/site',
    '/api/admin/settings/algo',
    '/api/admin/ai/profiles',
    '/api/admin/ai/runs',
    '/api/admin/audit-logs',
  ];
  for (const path of adminGets) await call('GET', path, { token: adminToken });
  await call('GET', '/api/admin/users', { token, expect: 403 });
  await call('GET', '/api/admin/users', { expect: 401 });

  section('卡密全链路');
  const plans = await call('GET', '/api/membership/plans', { quiet: true });
  const planId = plans?.data?.[0]?.id;
  const gen = await call('POST', '/api/admin/redeem-codes/generate', {
    token: adminToken,
    body: { planId, count: 2, prefix: 'SMOKE' },
    expect: [200, 201],
  });
  const code = gen?.data?.codes?.[0];
  if (code) {
    await call('POST', '/api/membership/redeem', { token, body: { code } });
    await call('POST', '/api/membership/redeem', { token, body: { code }, expect: 409 });
    const me = await call('GET', '/api/membership/me', { token });
    console.log(`       会员到期：${me?.data?.subscription?.expiresAt ?? me?.data?.vipExpiresAt ?? '未知'}`);
    // 开通会员后应能拿到会员视频的播放票据。
    await call('POST', `/api/videos/${first.id}/play-ticket`, { token, expect: 200 });
  } else {
    fail += 1;
    console.log('  FAIL 未拿到卡密');
  }
  await call('POST', '/api/membership/redeem', { token, body: { code: 'NOPE-NOPE-NOPE' }, expect: 404 });

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
