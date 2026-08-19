import * as React from 'react';
import { captionSrc } from '../../lib/srt-to-vtt.js';
import { prefs } from '../../core/storage.js';
import type { PlayerCaptionTrack } from '../../types.js';

export type CaptionSelection = string | 'off';

export interface UseCaptionsResult {
  selected: CaptionSelection;
  setSelected: (lang: CaptionSelection) => void;
  tracksReady: boolean;
  labelFor: (lang: string) => string;
  /** 已转成 <track src> 能吃的地址（vtt 原样，srt 为 blob） */
  tracks: { lang: string; src: string }[];
}

/** 白字 + 薄黑影，不要 karaoke 底框。原生 cue 只能靠 ::cue，没法挪出 video。 */
const CUE_STYLE_ID = 'videox-caption-cue-style';
const CUE_CSS = `video::cue{color:#fff;background:transparent;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.4)}`;

function ensureCueStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CUE_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = CUE_STYLE_ID;
  el.textContent = CUE_CSS;
  document.head.appendChild(el);
}

export function labelForLang(lang: string): string {
  const key = lang.toLowerCase();
  if (key.startsWith('zh')) return '中文';
  if (key.startsWith('en')) return 'English';
  return lang;
}

function pickDefault(tracks: PlayerCaptionTrack[]): CaptionSelection {
  if (tracks.length === 0) return 'off';
  const pref = prefs.getCaptionLang();
  // 显式关过就别强开；语言对得上才沿用，对不上再回落到中文轨。
  if (pref === 'off') return 'off';
  if (pref && tracks.some((t) => t.lang === pref)) return pref;
  const zh = tracks.find((t) => t.lang.toLowerCase().startsWith('zh'));
  return zh ? zh.lang : 'off';
}

function applyTrackMode(video: HTMLVideoElement, selected: CaptionSelection): void {
  const list = video.textTracks;
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
    track.mode = selected !== 'off' && track.language === selected ? 'showing' : 'disabled';
  }
}

/**
 * 两套皮肤共用：拉 SRT、挂轨、切 mode、读写偏好。
 * 不碰 PlayerEngine——字幕换了不该重载 HLS。
 */
export function useCaptions(
  captions: PlayerCaptionTrack[] | undefined,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): UseCaptionsResult {
  const list = captions ?? [];
  const captionKey = list.map((c) => `${c.lang}:${c.format}:${c.url}`).join('|');

  const [selected, setSelectedState] = React.useState<CaptionSelection>(() => pickDefault(list));
  const [tracks, setTracks] = React.useState<{ lang: string; src: string }[]>([]);
  const [tracksReady, setTracksReady] = React.useState(false);

  React.useEffect(() => {
    ensureCueStyle();
  }, []);

  React.useEffect(() => {
    setSelectedState(pickDefault(list));
    if (list.length === 0) {
      setTracks([]);
      setTracksReady(false);
      return undefined;
    }

    let cancelled = false;
    const blobs: string[] = [];
    setTracksReady(false);

    void Promise.all(
      list.map(async (track) => {
        try {
          const src = await captionSrc(track);
          if (src.startsWith('blob:')) blobs.push(src);
          return { lang: track.lang, src };
        } catch {
          // 单轨失败不影响其它语言
          return null;
        }
      }),
    ).then((rows) => {
      if (cancelled) {
        for (const url of blobs) URL.revokeObjectURL(url);
        return;
      }
      setTracks(rows.filter((row): row is { lang: string; src: string } => row !== null));
      setTracksReady(true);
    });

    return () => {
      cancelled = true;
      for (const url of blobs) URL.revokeObjectURL(url);
    };
    // list 随渲染重建，认签名就够了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionKey]);

  const setSelected = React.useCallback((lang: CaptionSelection) => {
    setSelectedState(lang);
    prefs.setCaptionLang(lang);
  }, []);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !tracksReady) return undefined;
    const apply = () => applyTrackMode(video, selected);
    apply();
    video.textTracks.addEventListener('addtrack', apply);
    // 部分浏览器要等 cue 载入才肯切 showing
    video.addEventListener('loadeddata', apply);
    return () => {
      video.textTracks.removeEventListener('addtrack', apply);
      video.removeEventListener('loadeddata', apply);
    };
  }, [videoRef, selected, tracksReady, tracks]);

  const labelFor = React.useCallback((lang: string) => labelForLang(lang), []);

  return { selected, setSelected, tracksReady, labelFor, tracks };
}
