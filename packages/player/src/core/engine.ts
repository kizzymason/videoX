import Hls, {
  Events,
  ErrorTypes,
  ErrorDetails,
  type ErrorData,
  type HlsConfig,
  type Level,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
} from 'hls.js';
import { PLAY_TOKEN_PARAM } from '@videox/shared';
import type {
  PlayerEngineOptions,
  PlayerError,
  PlayerSnapshot,
  PlayerSource,
  QualityLevel,
} from '../types.js';
import { bandwidth, localProgress, prefs } from './storage.js';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

const MAX_AUTO_RETRIES = 4;

function emptySnapshot(): PlayerSnapshot {
  return {
    status: 'idle',
    hasFirstFrame: false,
    currentTime: 0,
    duration: 0,
    bufferedTo: 0,
    seeking: false,
    paused: true,
    ended: false,
    volume: prefs.getVolume(),
    muted: prefs.getMuted(),
    playbackRate: prefs.getRate(),
    levels: [],
    currentLevel: -1,
    selectedLevel: -1,
    autoQuality: true,
    bandwidth: bandwidth.get() ?? 0,
    isFullscreen: false,
    isPip: false,
    usingNativeHls: false,
    error: null,
    gate: { blocked: false, previewSeconds: null },
    pipSupported: typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled),
  };
}

/**
 * 只改已经带 tk 的 playlist / 密钥 URL。
 * 分片 URL 不再带票（稳定可缓存）；分片鉴权走 x-play-token 或目录 cookie。
 */
function applyToken(url: string, token: string): string {
  if (!token) return url;
  try {
    const parsed = new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.href);
    if (!parsed.searchParams.has(PLAY_TOKEN_PARAM)) return url;
    parsed.searchParams.set(PLAY_TOKEN_PARAM, token);
    return parsed.toString();
  } catch {
    return url;
  }
}

function resolveUrl(url: string): URL | null {
  try {
    return new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.href);
  } catch {
    return null;
  }
}

function levelLabel(level: Level): string {
  if (level.height) return `${level.height}p`;
  return `${Math.round((level.bitrate ?? 0) / 1000)}k`;
}

/**
 * 自研播放器内核（无 UI）。
 *
 * 两条渲染路径：能用 MSE 就走 hls.js（可控性最强），iOS Safari 之类只支持原生 HLS
 * 的环境退回 `video.src`。对外暴露的状态与命令在两条路径下是一致的，皮肤层不需要分支。
 */
export class PlayerEngine {
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private source: PlayerSource | null = null;
  private options: PlayerEngineOptions;

  private token = '';
  /** master.m3u8 所在的 API origin；热链视频的分片会落在源站 CDN，不能加自定义头。 */
  private apiOrigin = '';
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private renewing: Promise<void> | null = null;

  private snapshot: PlayerSnapshot = emptySnapshot();
  private listeners = new Set<() => void>();

  private retries = 0;
  private mediaRecoveries = 0;
  private loadStartedAt = 0;
  private lastProgressPush = 0;
  private resumeTarget = 0;
  private destroyed = false;
  private detachFns: Array<() => void> = [];
  private suppressMutePersist = false;

  constructor(options: PlayerEngineOptions = {}) {
    this.options = options;
  }

  // ------------------------------------------------------------------ state

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(partial: Partial<PlayerSnapshot>): void {
    let changed = false;
    for (const key of Object.keys(partial) as (keyof PlayerSnapshot)[]) {
      if (!Object.is(this.snapshot[key], partial[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  private fail(error: PlayerError): void {
    this.patch({ status: 'error', error });
    this.options.onError?.(error);
  }

  // ------------------------------------------------------------------ setup

  attach(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.detachMedia();
    this.video = video;

    video.volume = this.snapshot.volume;
    video.muted = this.options.muted ?? this.snapshot.muted;
    video.playbackRate = this.snapshot.playbackRate;
    video.preload = 'auto';
    // 移动端必须内联播放，否则 iOS Safari 会强制拉起系统全屏播放器。
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    // attach 时改 muted 发生在监听器挂上之前，立刻写回 snapshot，避免按钮显示「有声」但片是静音。
    this.patch({ volume: video.volume, muted: video.muted });
    if (this.options.muted !== undefined) prefs.setMuted(video.muted);

    const on = <K extends keyof HTMLVideoElementEventMap>(
      type: K,
      handler: (event: HTMLVideoElementEventMap[K]) => void,
    ) => {
      video.addEventListener(type, handler as EventListener);
      this.detachFns.push(() => video.removeEventListener(type, handler as EventListener));
    };

    on('loadedmetadata', () => {
      this.patch({ duration: video.duration || this.source?.durationSeconds || 0 });
      if (this.resumeTarget > 0) {
        this.applyResume();
      }
    });
    on('loadeddata', () => this.patch({ status: 'ready' }));
    on('playing', () => {
      this.retries = 0;
      this.patch({ status: 'playing', paused: false, ended: false });
      this.markFirstFrame();
    });
    on('play', () => this.patch({ paused: false, ended: false }));
    on('pause', () => {
      if (!this.snapshot.ended) this.patch({ status: 'paused', paused: true });
      this.pushProgress(true);
    });
    on('waiting', () => this.patch({ status: 'buffering' }));
    on('seeking', () => this.patch({ seeking: true, status: 'seeking' }));
    on('seeked', () => this.patch({ seeking: false, status: video.paused ? 'paused' : 'playing' }));
    on('ratechange', () => this.patch({ playbackRate: video.playbackRate }));
    on('volumechange', () => {
      prefs.setVolume(video.volume);
      if (!this.suppressMutePersist) prefs.setMuted(video.muted);
      this.patch({ volume: video.volume, muted: video.muted });
    });
    on('progress', () => this.patch({ bufferedTo: this.bufferedEnd() }));
    on('timeupdate', () => this.onTimeUpdate());
    on('ended', () => {
      this.patch({ status: 'ended', ended: true, paused: true });
      if (this.source) localProgress.clear(this.source.videoId);
      this.options.onEnded?.();
    });
    on('error', () => {
      // 原生路径下的错误没有 hls.js 的细分信息，统一按媒体错误处理。
      if (!this.hls) {
        this.fail({ kind: 'media', message: '视频解码失败', fatal: true, retries: this.retries });
      }
    });
    on('enterpictureinpicture', () => this.patch({ isPip: true }));
    on('leavepictureinpicture', () => this.patch({ isPip: false }));

    const onFullscreenChange = () =>
      this.patch({ isFullscreen: Boolean(document.fullscreenElement) });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    this.detachFns.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));
  }

  private markFirstFrame(): void {
    if (this.snapshot.hasFirstFrame) return;
    this.patch({ hasFirstFrame: true });
    if (this.loadStartedAt) this.options.onFirstFrame?.(Math.round(performance.now() - this.loadStartedAt));
  }

  private detachMedia(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }

  // ------------------------------------------------------------------- load

  load(source: PlayerSource): void {
    if (!this.video) throw new Error('PlayerEngine.attach() 必须先于 load() 调用');

    this.teardownHls();
    this.source = source;
    this.token = source.token;
    // master 所在的 API origin：xhrSetup 只对自家 API 的裸分片 URL 加鉴权头。
    this.apiOrigin = resolveUrl(source.masterUrl)?.origin ?? '';
    this.retries = 0;
    this.mediaRecoveries = 0;
    this.loadStartedAt = performance.now();

    // 服务端记的进度和本地记的取较大值：本地那份更新，服务端那份跨设备。
    this.resumeTarget = Math.max(source.resumeSeconds ?? 0, localProgress.get(source.videoId));

    this.snapshot = {
      ...emptySnapshot(),
      volume: this.snapshot.volume,
      muted: this.snapshot.muted,
      playbackRate: this.snapshot.playbackRate,
      status: 'loading',
      duration: source.durationSeconds ?? 0,
      gate: { blocked: false, previewSeconds: source.previewSeconds ?? null },
    };
    for (const listener of this.listeners) listener();

    this.scheduleRenew(source.ttlSeconds);

    if (Hls.isSupported()) {
      this.loadWithHls(source);
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.loadNative(source);
    } else {
      this.fail({ kind: 'unsupported', message: '当前浏览器不支持 HLS 播放', fatal: true, retries: 0 });
    }
  }

  private buildConfig(): Partial<HlsConfig> {
    const seeded = bandwidth.get();
    const getToken = () => this.token;
    const apiOrigin = this.apiOrigin;
    const BaseLoader = Hls.DefaultConfig.loader as unknown as {
      new (config: HlsConfig): {
        load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void;
      };
    };

    /**
     * playlist URL 上的 tk 续签后要换新票；分片 URL 不带 tk，靠请求头带同一张目录票。
     */
    class TokenLoader extends BaseLoader {
      override load(
        context: LoaderContext,
        config: LoaderConfiguration,
        callbacks: LoaderCallbacks<LoaderContext>,
      ): void {
        context.url = applyToken(context.url, getToken());
        super.load(context, config, callbacks);
      }
    }

    return {
      xhrSetup(xhr, url) {
        const token = getToken();
        if (!token) return;
        const parsed = resolveUrl(url);
        if (!parsed) return;
        // URL 已带票 query（master / index / key）：query 鉴权已足够，不再设头。
        // 热链采集视频的 master 会被 302 到源站，自定义头随重定向带到源站会
        // 触发 CORS 预检，而源站 Allow-Headers 只白名单它自己的头。
        if (parsed.searchParams.has(PLAY_TOKEN_PARAM)) return;
        // 只对自家 API 的请求（本地转码视频的裸分片 URL）加头；
        // 直连源站 CDN 的请求（热链分片 / key）绝不能带自定义头。
        if (!apiOrigin || parsed.origin !== apiOrigin) return;
        xhr.setRequestHeader('x-play-token', token);
      },
      // 解封装与解密放到 worker 线程，主线程只做渲染，滚动时不掉帧。
      enableWorker: true,
      // 播放列表解析完立刻预取首片，不等 play() 调用。
      startFragPrefetch: true,
      // iOS 17+ 的 ManagedMediaSource 让 hls.js 在移动 Safari 上也能接管播放。
      preferManagedMediaSource: true,
      lowLatencyMode: false,
      progressive: false,

      abrEwmaDefaultEstimate: seeded ?? 1_500_000,
      // 起播时跳过带宽探测，直接用播种值决定首档。
      testBandwidth: seeded === null,
      abrBandWidthFactor: 0.9,
      abrBandWidthUpFactor: 0.75,
      capLevelOnFPSDrop: true,

      maxBufferLength: 30,
      maxMaxBufferLength: 120,
      backBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,

      // 分片失败重试交给 hls.js，我们只兜底致命错误。
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 9000,
          maxLoadTimeMs: 60_000,
          timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
          errorRetry: { maxNumRetry: 4, retryDelayMs: 800, maxRetryDelayMs: 6000 },
        },
      },
      loader: TokenLoader as unknown as HlsConfig['loader'],
    };
  }

  private loadWithHls(source: PlayerSource): void {
    const video = this.video!;
    const hls = new Hls(this.buildConfig());
    this.hls = hls;

    hls.on(Events.MANIFEST_PARSED, (_e, data) => {
      const levels: QualityLevel[] = data.levels.map((level, index) => ({
        index,
        height: level.height ?? 0,
        width: level.width ?? 0,
        bitrate: level.bitrate ?? 0,
        label: levelLabel(level),
      }));
      this.patch({ levels, usingNativeHls: false });
      this.applyStartLevel(levels);
      this.restorePreferredQuality(levels);
      if (this.options.autoplay) void this.play();
    });

    hls.on(Events.LEVEL_SWITCHED, (_e, data) => {
      this.patch({ currentLevel: data.level });
    });

    hls.on(Events.FRAG_BUFFERED, () => {
      // 首片落地后解除起播限档，后续正常按带宽自适应。
      if (hls.autoLevelCapping !== -1 && this.snapshot.hasFirstFrame) hls.autoLevelCapping = -1;
      const bw = hls.bandwidthEstimate;
      if (bw > 0) {
        bandwidth.set(bw);
        this.patch({ bandwidth: Math.round(bw) });
      }
    });

    hls.on(Events.ERROR, (_e, data) => void this.handleHlsError(data));

    hls.attachMedia(video);
    hls.loadSource(applyToken(source.masterUrl, this.token));
  }

  private loadNative(source: PlayerSource): void {
    const video = this.video!;
    this.patch({ usingNativeHls: true, levels: [] });
    video.src = applyToken(source.masterUrl, this.token);
    video.load();
    if (this.options.autoplay) void this.play();
  }

  /** 首帧限档：先出画面再谈清晰度，避免起播时拉一个大分片干等。 */
  private applyStartLevel(levels: QualityLevel[]): void {
    const hls = this.hls;
    if (!hls || levels.length === 0) return;
    const cap = this.options.startLevelMaxHeight ?? 720;
    let best = -1;
    for (const level of levels) {
      if (level.height <= cap && (best === -1 || level.height > levels[best]!.height)) best = level.index;
    }
    if (best >= 0) {
      hls.startLevel = best;
      hls.autoLevelCapping = best;
    }
  }

  private restorePreferredQuality(levels: QualityLevel[]): void {
    const height = prefs.getQualityHeight();
    if (height === null) return;
    const match = levels.find((l) => l.height === height);
    if (match) this.setLevel(match.index);
  }

  private async handleHlsError(data: ErrorData): Promise<void> {
    const hls = this.hls;
    if (!hls) return;

    const status = data.response?.code;
    // 401/402/403 基本都是令牌过期或权益变化，先续签再说，续不到才算真失败。
    if (status === 401 || status === 402 || status === 403) {
      const renewed = await this.renewNow();
      if (renewed) {
        hls.startLoad();
        return;
      }
      this.fail({
        kind: 'token',
        message: status === 402 ? '需要会员才能继续观看' : '播放凭证已失效，请刷新页面',
        fatal: true,
        retries: this.retries,
      });
      return;
    }

    if (!data.fatal) return;

    switch (data.type) {
      case ErrorTypes.NETWORK_ERROR: {
        if (data.details === ErrorDetails.MANIFEST_LOAD_ERROR && this.retries >= 1) {
          this.fail({ kind: 'manifest', message: '播放列表加载失败', fatal: true, retries: this.retries });
          return;
        }
        if (this.retries >= MAX_AUTO_RETRIES) {
          this.fail({ kind: 'network', message: '网络异常，播放中断', fatal: true, retries: this.retries });
          return;
        }
        this.retries += 1;
        this.patch({ status: 'buffering', error: null });
        // 指数退避，网络抖动时别把服务端打穿。
        setTimeout(() => this.hls?.startLoad(), Math.min(8000, 500 * 2 ** this.retries));
        return;
      }
      case ErrorTypes.MEDIA_ERROR: {
        this.mediaRecoveries += 1;
        if (this.mediaRecoveries === 1) {
          hls.recoverMediaError();
          return;
        }
        if (this.mediaRecoveries === 2) {
          // 音频编码切换是 hls.js 官方推荐的二次自愈手段。
          hls.swapAudioCodec();
          hls.recoverMediaError();
          return;
        }
        this.fail({ kind: 'media', message: '解码失败，请尝试切换清晰度', fatal: true, retries: this.retries });
        return;
      }
      default: {
        if (this.retries < 1 && this.source) {
          this.retries += 1;
          const source = this.source;
          this.teardownHls();
          this.loadWithHls(source);
          return;
        }
        this.fail({ kind: 'unknown', message: data.details || '播放失败', fatal: true, retries: this.retries });
      }
    }
  }

  // ---------------------------------------------------------------- renewal

  /** 在剩余寿命 25% 时续签：既不会太频繁，也留足了失败重试的余量。 */
  private scheduleRenew(ttlSeconds: number): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (!this.options.renewTicket || ttlSeconds <= 0) return;
    const delay = Math.max(15_000, ttlSeconds * 0.75 * 1000);
    this.renewTimer = setTimeout(() => void this.renewNow(), delay);
  }

  private async renewNow(): Promise<boolean> {
    if (!this.options.renewTicket || !this.source) return false;
    // 并发的失败请求可能同时触发续签，共用同一个 in-flight promise。
    if (this.renewing) {
      await this.renewing;
      return !this.snapshot.error;
    }

    const videoId = this.source.videoId;
    let succeeded = false;
    this.renewing = (async () => {
      try {
        const ticket = await this.options.renewTicket!(videoId);
        if (this.destroyed || this.source?.videoId !== videoId) return;
        this.token = ticket.token;
        if (ticket.previewSeconds !== undefined) {
          this.patch({
            gate: { blocked: this.snapshot.gate.blocked, previewSeconds: ticket.previewSeconds },
          });
        }
        this.scheduleRenew(ticket.ttlSeconds);
        succeeded = true;
      } catch {
        succeeded = false;
      }
    })().finally(() => {
      this.renewing = null;
    });

    await this.renewing;
    return succeeded;
  }

  // ---------------------------------------------------------------- ticking

  private bufferedEnd(): number {
    const video = this.video;
    if (!video) return 0;
    const { buffered, currentTime } = video;
    for (let i = 0; i < buffered.length; i += 1) {
      if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) return buffered.end(i);
    }
    return 0;
  }

  private onTimeUpdate(): void {
    const video = this.video;
    if (!video) return;
    const time = video.currentTime;
    this.patch({ currentTime: time, bufferedTo: this.bufferedEnd() });

    const preview = this.snapshot.gate.previewSeconds;
    if (preview !== null && preview > 0 && time >= preview) {
      this.enforceGate(preview);
      return;
    }

    this.pushProgress(false);
  }

  private enforceGate(preview: number): void {
    const video = this.video;
    if (!video) return;
    video.pause();
    if (video.currentTime > preview) video.currentTime = preview;
    if (!this.snapshot.gate.blocked) {
      this.patch({ gate: { blocked: true, previewSeconds: preview }, paused: true, status: 'paused' });
      this.options.onGate?.();
    }
  }

  private pushProgress(force: boolean): void {
    const video = this.video;
    const source = this.source;
    if (!video || !source || !video.duration) return;

    const now = Date.now();
    const interval = this.options.progressIntervalMs ?? 5000;
    if (!force && now - this.lastProgressPush < interval) return;
    this.lastProgressPush = now;

    // 本地立即写，服务端节流写：刷新页面永远能续上，同时不至于每秒一个请求。
    localProgress.set(source.videoId, video.currentTime);
    this.options.onProgress?.(video.currentTime, video.duration);
  }

  private applyResume(): void {
    const video = this.video;
    if (!video) return;
    const target = this.resumeTarget;
    this.resumeTarget = 0;
    if (target <= 0) return;
    // 片尾附近就不要续播了，直接从头开始体验更好。
    if (video.duration && target > video.duration - 10) return;
    video.currentTime = target;
  }

  // ---------------------------------------------------------------- command

  async play(): Promise<void> {
    const video = this.video;
    if (!video) return;
    const preview = this.snapshot.gate.previewSeconds;
    if (preview !== null && preview > 0 && video.currentTime >= preview) {
      this.enforceGate(preview);
      return;
    }
    try {
      await video.play();
    } catch (err) {
      // 自动播放被策略拦截时，静音重试一次是浏览器普遍认可的兜底。
      if ((err as Error)?.name === 'NotAllowedError' && !video.muted) {
        this.suppressMutePersist = true;
        video.muted = true;
        try {
          await video.play();
        } catch {
          this.patch({ paused: true });
        } finally {
          this.suppressMutePersist = false;
        }
      }
    }
  }

  pause(): void {
    this.video?.pause();
  }

  togglePlay(): void {
    if (!this.video) return;
    if (this.video.paused) void this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    const video = this.video;
    if (!video) return;
    const preview = this.snapshot.gate.previewSeconds;
    const max = preview !== null && preview > 0 ? Math.min(preview, video.duration || preview) : video.duration || 0;
    video.currentTime = Math.max(0, Math.min(seconds, max || seconds));
  }

  seekBy(delta: number): void {
    if (!this.video) return;
    this.seek(this.video.currentTime + delta);
  }

  setVolume(volume: number): void {
    const video = this.video;
    if (!video) return;
    const next = Math.max(0, Math.min(1, volume));
    video.volume = next;
    if (next > 0 && video.muted) video.muted = false;
  }

  toggleMute(): void {
    const video = this.video;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  }

  setRate(rate: number): void {
    if (!this.video) return;
    const next = Math.max(0.25, Math.min(4, rate));
    this.video.playbackRate = next;
    prefs.setRate(next);
  }

  /** index = -1 表示自动。 */
  setLevel(index: number): void {
    const hls = this.hls;
    if (!hls) return;
    hls.autoLevelCapping = -1;
    hls.currentLevel = index;
    const height = index === -1 ? null : (this.snapshot.levels.find((l) => l.index === index)?.height ?? null);
    prefs.setQualityHeight(height);
    this.patch({ selectedLevel: index, autoQuality: index === -1 });
  }

  async toggleFullscreen(container: HTMLElement | null): Promise<void> {
    const target = container ?? this.video;
    if (!target) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      return;
    }
    // iOS Safari 只给 video 元素开了私有的全屏接口。
    const legacy = this.video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    legacy?.webkitEnterFullscreen?.();
  }

  async togglePip(): Promise<void> {
    const video = this.video;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* 用户拒绝或元素未就绪，忽略 */
    }
  }

  /** 会员开通成功后调用：换新票据并从卡点继续播。 */
  resumeAfterUnlock(source: PlayerSource): void {
    const position = this.video?.currentTime ?? 0;
    this.load({ ...source, resumeSeconds: position });
    void this.play();
  }

  retry(): void {
    if (!this.source) return;
    this.retries = 0;
    this.mediaRecoveries = 0;
    const position = this.video?.currentTime ?? 0;
    this.load({ ...this.source, resumeSeconds: position });
    void this.play();
  }

  // ---------------------------------------------------------------- cleanup

  private teardownHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    // 原生回退路径下 src 挂在 video 上，不清掉会继续下载已经废弃的流。
    if (this.video?.src) {
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.pushProgress(true);
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.teardownHls();
    this.detachMedia();
    this.listeners.clear();
    this.video = null;
    this.source = null;
  }
}
