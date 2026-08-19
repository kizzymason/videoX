import type { PlayerCaptionTrack } from '../types.js';

/**
 * HTML <track> 只吃 VTT。VTT 原样返回；SRT 拉下来转成 blob URL。
 * 调用方负责在卸载时 revoke 掉 blob。
 */
export async function captionSrc(track: PlayerCaptionTrack): Promise<string> {
  if (track.format === 'vtt') return track.url;
  const res = await fetch(track.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`字幕下载失败 ${res.status}`);
  const vtt = srtToVtt(await res.text());
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

/** 补 WEBVTT 头，时间戳逗号改点。已经是 VTT 的只改时间戳。 */
export function srtToVtt(input: string): string {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 只动时间轴上的逗号，免得把台词里的逗号也换成点。
  const body = text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/(\d{1,2}:\d{2}),(\d{3})/g, '$1.$2');
  if (/^\s*WEBVTT\b/i.test(body)) return body.replace(/^\s+/, '');
  return `WEBVTT\n\n${body.replace(/^\s+/, '')}`;
}
