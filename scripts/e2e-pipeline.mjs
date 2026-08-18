/**
 * 端到端验收：登录 → 生成样片 → 分片上传 → 等待转码 → 卡密开会员 → 加密播放。
 *
 * 会真的跑 ffmpeg 转码，耗时取决于机器；样片默认 20 秒 720p。
 * 用法：node scripts/e2e-pipeline.mjs [baseUrl]
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const base = process.argv[2] ?? 'http://localhost:4000';
const CHUNK_SIZE = 1024 * 1024;

const step = (msg) => console.log(`\n▸ ${msg}`);
const info = (msg) => console.log(`  ${msg}`);

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function api(method, endpoint, { body, token, expect = [200, 201], binary } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (binary) headers['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers: { ...headers, ...(binary?.headers ?? {}) },
    body: binary ? binary.data : body === undefined ? undefined : JSON.stringify(body),
  });

  const expected = Array.isArray(expect) ? expect : [expect];
  if (!expected.includes(res.status)) {
    fail(`${method} ${endpoint} 返回 ${res.status}：${(await res.text()).slice(0, 400)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (c) => {
      err += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  step('登录管理员');
  const login = await api('POST', '/api/auth/login', {
    body: { identifier: 'admin@videox.local', password: 'Admin@123456' },
  });
  const adminToken = login.data.accessToken;
  info(`admin = ${login.data.user.username}`);

  // 时长带随机小数，保证每次跑出来的字节流都不同，否则会被秒传去重拦掉。
  const duration = (18 + Math.random() * 4).toFixed(2);
  step(`用 ffmpeg 生成 ${duration} 秒样片（720p + 正弦音轨）`);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'videox-e2e-'));
  const samplePath = path.join(tmpDir, 'sample.mp4');
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1280x720:rate=30:duration=${duration}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${duration}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    samplePath,
  ]);
  const fileBuffer = await fsp.readFile(samplePath);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
  info(`样片 ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB, sha256=${fileHash.slice(0, 12)}…`);

  step('分片上传');
  const init = await api('POST', '/api/uploads/init', {
    token: adminToken,
    body: {
      filename: 'e2e-sample.mp4',
      fileSize: fileBuffer.length,
      chunkSize: CHUNK_SIZE,
      fileHash,
      mimeType: 'video/mp4',
    },
  });
  const uploadId = init.data.id ?? init.data.uploadId;
  const totalChunks = init.data.totalChunks;
  if (init.data.existingVideoId) fail('样片被判定为秒传命中，说明随机时长没生效');
  info(`uploadId=${uploadId} 共 ${totalChunks} 片`);

  for (let i = 0; i < totalChunks; i += 1) {
    const chunk = fileBuffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await api('PUT', `/api/uploads/${uploadId}/part/${i}`, {
      token: adminToken,
      binary: {
        data: chunk,
        headers: { 'x-chunk-sha256': createHash('sha256').update(chunk).digest('hex') },
      },
    });
  }
  info('全部分片已上传');

  step('提交转码（会员专享 → 触发 AES-128 加密）');
  const cats = await api('GET', '/api/categories');
  const complete = await api('POST', `/api/uploads/${uploadId}/complete`, {
    token: adminToken,
    body: {
      title: `端到端验收样片 ${new Date().toLocaleString('zh-CN')}`,
      description: 'scripts/e2e-pipeline.mjs 自动生成，可安全删除。',
      categoryId: cats.data[0]?.id ?? null,
      tags: ['自动化测试', '样片'],
      accessLevel: 'vip',
      visibility: 'public',
    },
  });
  const videoId = complete.data.videoId;
  info(`videoId=${videoId} jobId=${complete.data.jobId}`);

  step('等待转码完成');
  const deadline = Date.now() + 8 * 60_000;
  let status = null;
  let lastLine = '';
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/videos/${videoId}/transcode-status`, { token: adminToken });
    const d = res.data;
    status = d.videoStatus;
    const line = `状态=${status} 进度=${Math.round(d.job?.progress ?? 0)}% 阶段=${d.job?.stage ?? '-'}`;
    if (line !== lastLine) {
      info(line);
      lastLine = line;
    }
    if (status === 'ready' || status === 'failed') break;
    await sleep(2000);
  }
  if (status !== 'ready') fail(`转码未在时限内完成，最终状态 ${status}`);

  step('校验视频元数据与产物');
  const detail = await api('GET', `/api/videos/${videoId}`, { token: adminToken });
  const video = detail.data.video ?? detail.data;
  info(`时长=${video.durationSeconds}s 分辨率=${video.width}x${video.height} 档位=${(video.renditions ?? []).map((r) => r.name).join(', ')}`);
  if (!video.posterUrl) fail('封面缺失');
  if (!(video.renditions ?? []).length) fail('没有产出任何清晰度');

  step('未开通会员：只应拿到试看票，且超出试看范围的分片要被拒');
  const guestEmail = `e2e_${Date.now()}@videox.local`;
  const guest = await api('POST', '/api/auth/register', {
    body: { email: guestEmail, password: 'E2e@123456', username: `e2e${Date.now() % 1000000}` },
  });
  const guestToken = guest.data.accessToken;

  // 样片只有 20 秒，默认 60 秒试看会覆盖全片，临时把边界压到 8 秒才测得出来。
  const originalSettings = (await api('GET', '/api/admin/settings/site', { token: adminToken })).data;
  await api('PUT', '/api/admin/settings/site', {
    token: adminToken,
    body: { ...originalSettings, previewSeconds: 8 },
  });

  const previewTicket = await api('POST', `/api/videos/${videoId}/play-ticket`, { token: guestToken });
  if (!previewTicket.data.previewSeconds) fail('非会员没有拿到试看票');
  info(`试看 ${previewTicket.data.previewSeconds} 秒`);

  const previewTk = previewTicket.data.token;
  const previewVariant = await (
    await fetch(`${base}/media/hls/${videoId}/360p/index.m3u8?tk=${encodeURIComponent(previewTk)}`)
  ).text();
  const previewSegs = previewVariant.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const firstSeg = previewSegs[0].split('?')[0];
  const lastSeg = previewSegs[previewSegs.length - 1].split('?')[0];

  const okSeg = await fetch(`${base}/media/hls/${videoId}/360p/${firstSeg}?tk=${encodeURIComponent(previewTk)}`);
  if (!okSeg.ok) fail(`试看票取首片失败 ${okSeg.status}`);
  info(`试看票可取首片 ${firstSeg} ✔`);

  const blockedSeg = await fetch(`${base}/media/hls/${videoId}/360p/${lastSeg}?tk=${encodeURIComponent(previewTk)}`);
  if (blockedSeg.status !== 402) fail(`试看票竟然能取到末片 ${lastSeg}（${blockedSeg.status}）`);
  info(`试看票取末片 ${lastSeg} 被拒 402 ✔`);

  await api('PUT', '/api/admin/settings/site', { token: adminToken, body: originalSettings });

  step('卡密开通会员');
  const plans = await api('GET', '/api/membership/plans');
  const gen = await api('POST', '/api/admin/redeem-codes/generate', {
    token: adminToken,
    body: { planId: plans.data[0].id, count: 1, prefix: 'E2E' },
  });
  const code = gen.data.codes[0];
  info(`卡密 ${code}`);
  await api('POST', '/api/membership/redeem', { token: guestToken, body: { code } });
  await api('POST', '/api/membership/redeem', { token: guestToken, body: { code }, expect: 409 });
  info('重复兑换被行锁挡住 ✔');

  step('会员播放：取票 → master.m3u8 → 分档列表 → 分片 → 密钥');
  const ticket = await api('POST', `/api/videos/${videoId}/play-ticket`, { token: guestToken });
  const tk = ticket.data.token;
  if (ticket.data.previewSeconds !== null) fail('开通会员后仍然只拿到试看票');

  const masterRes = await fetch(`${base}/media/hls/${videoId}/master.m3u8?tk=${encodeURIComponent(tk)}`);
  if (!masterRes.ok) fail(`master.m3u8 取回失败 ${masterRes.status}`);
  const master = await masterRes.text();
  const variantLine = master.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!variantLine) fail('master.m3u8 里没有任何清晰度');
  info(`master 含 ${master.split('#EXT-X-STREAM-INF').length - 1} 档，首档 ${variantLine.split('?')[0]}`);

  const variantRes = await fetch(`${base}/media/hls/${videoId}/${variantLine.trim()}`);
  if (!variantRes.ok) fail(`分档播放列表取回失败 ${variantRes.status}`);
  const variant = await variantRes.text();
  if (!variant.includes('#EXT-X-KEY')) fail('会员视频的播放列表里没有 EXT-X-KEY，加密未生效');
  info('播放列表含 #EXT-X-KEY，AES-128 已生效 ✔');

  const segLines = variant.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const renditionName = variantLine.split('/')[0];
  for (const segLine of [segLines[0], segLines[segLines.length - 1]]) {
    const segRes = await fetch(`${base}/media/hls/${videoId}/${renditionName}/${segLine.trim()}`);
    if (!segRes.ok) fail(`分片取回失败 ${segRes.status}`);
    info(`分片 ${segLine.split('?')[0]} 大小 ${(Number(segRes.headers.get('content-length')) / 1024).toFixed(0)} KB ✔`);
  }

  const keyRes = await fetch(`${base}/media/hls/${videoId}/key?tk=${encodeURIComponent(tk)}`);
  if (!keyRes.ok) fail(`密钥取回失败 ${keyRes.status}`);
  const keyBytes = Buffer.from(await keyRes.arrayBuffer());
  if (keyBytes.length !== 16) fail(`密钥长度异常：${keyBytes.length}`);
  info('16 字节内容密钥取回成功 ✔');

  step('无票据取密钥必须被拒');
  const noTokenKey = await fetch(`${base}/media/hls/${videoId}/key`);
  if (noTokenKey.status !== 403) fail(`无票据取密钥竟返回 ${noTokenKey.status}`);
  info('无票据取密钥 403 ✔');

  step('封面与雪碧图');
  for (const asset of ['poster.jpg', 'poster-vertical.jpg', 'sprite.jpg', 'thumbnails.vtt']) {
    const res = await fetch(`${base}/media/assets/${videoId}/${asset}`);
    info(`${asset} -> ${res.status}`);
    if (!res.ok) fail(`${asset} 缺失`);
  }

  step('秒传去重：同一个文件再传一次应直接命中');
  const reinit = await api('POST', '/api/uploads/init', {
    token: adminToken,
    body: {
      filename: 'e2e-sample-again.mp4',
      fileSize: fileBuffer.length,
      chunkSize: CHUNK_SIZE,
      fileHash,
      mimeType: 'video/mp4',
    },
  });
  if (!reinit.data.existingVideoId) fail('相同 sha256 没有命中秒传');
  const cloned = await api('POST', `/api/uploads/${reinit.data.id ?? reinit.data.uploadId}/complete`, {
    token: adminToken,
    body: {
      title: '端到端验收样片（秒传副本）',
      categoryId: cats.data[0]?.id ?? null,
      accessLevel: 'free',
      visibility: 'unlisted',
    },
  });
  if (!cloned.data.instant) fail('秒传路径没有返回 instant=true');
  info(`秒传生成 videoId=${cloned.data.videoId}，未重复转码 ✔`);

  step('秒传副本必须能独立播放（共用产物 + 密钥地址改写）');
  const cloneTicket = await api('POST', `/api/videos/${cloned.data.videoId}/play-ticket`, { token: guestToken });
  const cloneTk = cloneTicket.data.token;
  const cloneMaster = await (
    await fetch(`${base}/media/hls/${cloned.data.videoId}/master.m3u8?tk=${encodeURIComponent(cloneTk)}`)
  ).text();
  const cloneVariantPath = cloneMaster.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!cloneVariantPath) fail('秒传副本的 master 为空');
  const cloneVariantRes = await fetch(`${base}/media/hls/${cloned.data.videoId}/${cloneVariantPath.trim()}`);
  if (!cloneVariantRes.ok) fail(`秒传副本分档列表取回失败 ${cloneVariantRes.status}`);
  const cloneVariant = await cloneVariantRes.text();
  const keyUri = /URI="([^"]+)"/.exec(cloneVariant)?.[1];
  if (keyUri && !keyUri.includes(cloned.data.videoId)) {
    fail(`秒传副本的密钥地址没有被改写：${keyUri}`);
  }
  const cloneSeg = cloneVariant.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  const cloneSegRes = await fetch(
    `${base}/media/hls/${cloned.data.videoId}/${cloneVariantPath.split('/')[0]}/${cloneSeg.trim()}`,
  );
  if (!cloneSegRes.ok) fail(`秒传副本分片取回失败 ${cloneSegRes.status}`);
  info('秒传副本可独立取流 ✔');

  step('清理本次产生的测试数据');
  for (const id of [cloned.data.videoId, videoId]) {
    await api('DELETE', `/api/admin/videos/${id}`, { token: adminToken, expect: [200, 204, 404] });
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
  info('测试视频与转码产物已删除');

  console.log('\n✓ 全链路验收通过');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
