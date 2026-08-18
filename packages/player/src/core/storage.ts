/** 播放器的本地记忆：音量、倍速、清晰度偏好、带宽播种、观看进度。 */

const NS = 'videox:player';

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(`${NS}:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
  } catch {
    /* 无痕模式写入失败，静默忽略 */
  }
}

export const prefs = {
  getVolume: () => Math.min(1, Math.max(0, read('volume', 1))),
  setVolume: (v: number) => write('volume', Math.min(1, Math.max(0, v))),
  getMuted: () => read('muted', false),
  setMuted: (v: boolean) => write('muted', v),
  getRate: () => read('rate', 1),
  setRate: (v: number) => write('rate', v),
  /** 记住用户手选的分辨率高度（不是 level 索引——换个视频索引就对不上了）。 */
  getQualityHeight: () => read<number | null>('qualityHeight', null),
  setQualityHeight: (v: number | null) => write('qualityHeight', v),
};

/**
 * 带宽播种。hls.js 冷启动时默认估计值偏保守，会先拉一档最低清晰度再逐步爬升，
 * 观感上就是「先糊一下再变清楚」。把上次实测带宽存下来当初值可以直接跳过爬升过程。
 */
export const bandwidth = {
  get(): number | null {
    const v = read<number | null>('bw', null);
    return typeof v === 'number' && v > 0 ? v : null;
  },
  set(bps: number): void {
    if (!Number.isFinite(bps) || bps <= 0) return;
    const prev = bandwidth.get();
    // 指数平滑，避免某一次网络抖动把播种值带偏。
    write('bw', prev ? Math.round(prev * 0.6 + bps * 0.4) : Math.round(bps));
  },
};

/** 观看进度本地缓存。服务端同步是节流的，本地这份保证刷新页面立刻能续播。 */
export const localProgress = {
  key: (videoId: string) => `progress:${videoId}`,
  get(videoId: string): number {
    const v = read<number>(localProgress.key(videoId), 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  },
  set(videoId: string, seconds: number): void {
    write(localProgress.key(videoId), Math.max(0, Math.floor(seconds)));
  },
  clear(videoId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(`${NS}:${localProgress.key(videoId)}`);
    } catch {
      /* ignore */
    }
  },
};
