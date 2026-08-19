export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'seeking'
  | 'ended'
  | 'error';

export interface QualityLevel {
  /** hls.js 的 level 索引；原生 HLS 回退时为 -1 */
  index: number;
  height: number;
  width: number;
  bitrate: number;
  label: string;
}

export type PlayerErrorKind = 'network' | 'media' | 'manifest' | 'token' | 'unsupported' | 'unknown';

export interface PlayerError {
  kind: PlayerErrorKind;
  message: string;
  fatal: boolean;
  /** 已经自动重试的次数 */
  retries: number;
}

/** 会员门禁：试看到点后由 core 抛出，皮肤层负责展示开通遮罩。 */
export interface GateState {
  /** 是否已经撞上试看边界 */
  blocked: boolean;
  previewSeconds: number | null;
}

export interface PlayerSnapshot {
  status: PlayerStatus;
  /** 首帧是否已经解码出来，用于隐藏封面图 */
  hasFirstFrame: boolean;
  currentTime: number;
  duration: number;
  /** 已缓冲到的时间点（当前播放位置所在的 buffer range 末尾） */
  bufferedTo: number;
  seeking: boolean;
  paused: boolean;
  ended: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  levels: QualityLevel[];
  /** 当前实际播放的档位索引 */
  currentLevel: number;
  /** -1 = 自动 */
  selectedLevel: number;
  autoQuality: boolean;
  /** hls.js 的实时带宽估计（bps） */
  bandwidth: number;
  isFullscreen: boolean;
  isPip: boolean;
  /** 原生 HLS（iOS Safari）而非 MSE */
  usingNativeHls: boolean;
  error: PlayerError | null;
  gate: GateState;
  /** 是否可以画中画 */
  pipSupported: boolean;
}

export interface RenewedTicket {
  token: string;
  ttlSeconds: number;
  /** 会员到期被降级成试看时返回秒数，否则为 null */
  previewSeconds?: number | null;
  scope?: 'full' | 'preview';
}

/** 点播字幕轨。HTML <track> 只认 VTT，srt 由皮肤先转成 blob 再挂。 */
export interface PlayerCaptionTrack {
  lang: string;
  format: 'vtt' | 'srt';
  url: string;
}

export interface PlayerSource {
  videoId: string;
  /** 带签名参数的 master.m3u8 */
  masterUrl: string;
  token: string;
  /** 票据总寿命，用于计算续签时机 */
  ttlSeconds: number;
  /** 非会员试看秒数；null = 无限制 */
  previewSeconds?: number | null;
  /** 上次观看位置 */
  resumeSeconds?: number;
  /** 进度条缩略图 VTT */
  spriteVttUrl?: string | null;
  /** 字幕轨。跟 spriteVttUrl 无关——那条是缩略图，不能当字幕挂。 */
  captions?: PlayerCaptionTrack[];
  poster?: string | null;
  title?: string;
  durationSeconds?: number;
}

export interface PlayerEngineOptions {
  /** token 剩余寿命不足时调用，返回新票据；抛错则视为续签失败 */
  renewTicket?: (videoId: string) => Promise<RenewedTicket>;
  /** 播放进度上报（已节流），position 单位秒 */
  onProgress?: (position: number, duration: number) => void;
  /** 撞上试看边界 */
  onGate?: () => void;
  onEnded?: () => void;
  onError?: (error: PlayerError) => void;
  /** 首帧渲染耗时（ms），用于性能观测 */
  onFirstFrame?: (elapsedMs: number) => void;
  /** 进度记忆写盘间隔，默认 5s */
  progressIntervalMs?: number;
  /** 起播限档：首个分片强制不超过该高度，拿到带宽后再放开 */
  startLevelMaxHeight?: number;
  autoplay?: boolean;
  muted?: boolean;
}

export interface SpriteCue {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
