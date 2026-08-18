import type { SpriteCue } from '../types.js';

function parseTimestamp(input: string): number {
  const parts = input.trim().split(':');
  if (parts.length < 2) return Number(input) || 0;
  const seconds = Number(parts.pop() ?? 0);
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * 解析 thumbnails.vtt。每条 cue 的 URL 形如 `sprite.jpg#xywh=0,0,160,90`，
 * 预览时直接把整张雪碧图当 background-image 再按 xywh 偏移，避免几百个小图请求。
 */
export function parseSpriteVtt(text: string, baseUrl: string): SpriteCue[] {
  const cues: SpriteCue[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.includes('-->')) continue;
    const [rawStart, rawEnd] = line.split('-->');
    const start = parseTimestamp(rawStart ?? '');
    const end = parseTimestamp((rawEnd ?? '').split(/\s+/)[0] ?? '');

    const payload = (lines[i + 1] ?? '').trim();
    if (!payload) continue;

    const [file, hash] = payload.split('#');
    const match = /xywh=(\d+),(\d+),(\d+),(\d+)/.exec(hash ?? '');
    if (!match) continue;

    cues.push({
      start,
      end,
      url: new URL(file ?? '', baseUrl).toString(),
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
    });
    i += 1;
  }

  return cues;
}

export async function loadSpriteCues(vttUrl: string, signal?: AbortSignal): Promise<SpriteCue[]> {
  const res = await fetch(vttUrl, { credentials: 'include', signal });
  if (!res.ok) return [];
  return parseSpriteVtt(await res.text(), vttUrl);
}

/** 二分查到给定时间点对应的缩略图。 */
export function findSpriteCue(cues: SpriteCue[], time: number): SpriteCue | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let found: SpriteCue | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid]!;
    if (time < cue.start) {
      hi = mid - 1;
    } else if (time >= cue.end) {
      found = cue;
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return found ?? cues[cues.length - 1] ?? null;
}
