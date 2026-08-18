import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  SPRITE_COLUMNS,
  SPRITE_INTERVAL_SECONDS,
  SPRITE_MAX_TILES,
  SPRITE_TILE_WIDTH,
} from '@videox/shared';
import { runFfmpeg, type ProbeResult } from './ffmpeg.js';

function timecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export interface PosterResult {
  posterPath: string;
  verticalPosterPath: string;
}

/**
 * 抽封面。取 10% 处而不是第一帧：很多片子开头是黑场或台标。
 * 同时产出一张 9:16 竖版，移动端瀑布流用。
 */
export async function generatePosters(params: {
  input: string;
  outDir: string;
  probe: ProbeResult;
}): Promise<PosterResult> {
  const seekAt = Math.min(Math.max(params.probe.durationSeconds * 0.1, 1), Math.max(1, params.probe.durationSeconds - 1));
  const framePath = path.join(params.outDir, 'frame.png');

  await runFfmpeg({
    args: ['-ss', seekAt.toFixed(3), '-i', params.input, '-frames:v', '1', '-q:v', '2', framePath],
  });

  const posterPath = path.join(params.outDir, 'poster.jpg');
  const verticalPosterPath = path.join(params.outDir, 'poster-vertical.jpg');

  const frame = sharp(framePath);
  await frame
    .clone()
    .resize(1280, 720, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(posterPath);

  await sharp(framePath)
    .resize(720, 1280, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(verticalPosterPath);

  await fs.unlink(framePath).catch(() => undefined);
  return { posterPath, verticalPosterPath };
}

export interface SpriteResult {
  spritePath: string;
  vttPath: string;
  tileCount: number;
}

/**
 * 雪碧图 + WebVTT，供进度条悬停预览。
 *
 * 做成一张大图而不是 N 张小图，是为了让播放器只发一个请求；
 * VTT 里用 `#xywh=` 媒体片段语法标出每个缩略图在大图中的位置。
 */
export async function generateSprite(params: {
  input: string;
  outDir: string;
  probe: ProbeResult;
  /** 生成 VTT 时写入的图片地址 */
  spriteUrl: string;
}): Promise<SpriteResult | null> {
  const duration = params.probe.durationSeconds;
  if (duration < 5) return null;

  const rawInterval = Math.max(SPRITE_INTERVAL_SECONDS, duration / SPRITE_MAX_TILES);
  const tileCount = Math.max(1, Math.min(SPRITE_MAX_TILES, Math.floor(duration / rawInterval)));
  const interval = duration / tileCount;

  const aspect = params.probe.width > 0 ? params.probe.height / params.probe.width : 9 / 16;
  const tileWidth = SPRITE_TILE_WIDTH;
  const tileHeight = Math.max(2, Math.round((tileWidth * aspect) / 2) * 2);

  const framesDir = path.join(params.outDir, 'sprite-frames');
  await fs.mkdir(framesDir, { recursive: true });

  await runFfmpeg({
    args: [
      '-i',
      params.input,
      '-vf',
      `fps=1/${interval.toFixed(4)},scale=${tileWidth}:${tileHeight}`,
      '-frames:v',
      String(tileCount),
      '-q:v',
      '5',
      path.join(framesDir, 'tile-%04d.jpg'),
    ],
    totalSeconds: duration,
  });

  const files = (await fs.readdir(framesDir)).filter((f) => f.endsWith('.jpg')).sort();
  if (files.length === 0) {
    await fs.rm(framesDir, { recursive: true, force: true });
    return null;
  }

  const columns = Math.min(SPRITE_COLUMNS, files.length);
  const rows = Math.ceil(files.length / columns);
  const spritePath = path.join(params.outDir, 'sprite.jpg');

  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight,
      channels: 3,
      background: { r: 12, g: 12, b: 14 },
    },
  })
    .composite(
      files.map((file, index) => ({
        input: path.join(framesDir, file),
        left: (index % columns) * tileWidth,
        top: Math.floor(index / columns) * tileHeight,
      })),
    )
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(spritePath);

  const lines = ['WEBVTT', ''];
  files.forEach((_file, index) => {
    const start = index * interval;
    const end = Math.min(duration, (index + 1) * interval);
    const x = (index % columns) * tileWidth;
    const y = Math.floor(index / columns) * tileHeight;
    lines.push(`${timecode(start)} --> ${timecode(end)}`);
    lines.push(`${params.spriteUrl}#xywh=${x},${y},${tileWidth},${tileHeight}`);
    lines.push('');
  });

  const vttPath = path.join(params.outDir, 'thumbnails.vtt');
  await fs.writeFile(vttPath, lines.join('\n'), 'utf8');
  await fs.rm(framesDir, { recursive: true, force: true });

  return { spritePath, vttPath, tileCount: files.length };
}

/** 6 秒无声预览片，PC 端卡片悬停时播放。 */
export async function generatePreview(params: {
  input: string;
  outDir: string;
  probe: ProbeResult;
}): Promise<string | null> {
  if (params.probe.durationSeconds < 12) return null;
  const start = params.probe.durationSeconds * 0.15;
  const previewPath = path.join(params.outDir, 'preview.mp4');

  await runFfmpeg({
    args: [
      '-ss',
      start.toFixed(2),
      '-i',
      params.input,
      '-t',
      '6',
      '-an',
      '-vf',
      'scale=480:-2,fps=24',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-movflags',
      '+faststart',
      previewPath,
    ],
  });

  return previewPath;
}
