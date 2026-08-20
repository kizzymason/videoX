import * as React from 'react';
import { Bookmark, Heart, Maximize, Volume2, VolumeX } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { usePlayer, type PlayerEngine, type PlayerSource } from '@videox/player';
import { formatCount, parseShortsTrialDetails, type ShortsTrialQuota, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';
import { ApiError, contentApi, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { track } from '../lib/analytics';
import { useSeo } from '../hooks/use-seo';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { Link } from 'react-router-dom';

function enterFullscreen(container: HTMLElement | null) {
  if (!container) return;
  if (container.requestFullscreen) {
    void container.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    return;
  }
  const video = container.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  video?.webkitEnterFullscreen?.();
}

/**
 * PC Shorts 保留移动端的竖滑体验，但铺满宽屏舞台。
 * Shorts 里横屏、竖屏都可能出现，所以画面统一 object-contain 居中，
 * 多出来的区域留黑：竖片左右加黑边，横片上下加黑边，都不裁切。
 */
export function ShortsPage() {
  useSeo({ title: 'Shorts' });
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['pc-shorts'],
    queryFn: ({ pageParam }) => contentApi.shorts({ page: pageParam, pageSize: 10 }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
  const videos = flatten(query.data?.pages);
  const feedRef = React.useRef<HTMLDivElement | null>(null);

  const onScroll = React.useCallback(() => {
    const feed = feedRef.current;
    if (!feed || query.isFetchingNextPage || !query.hasNextPage) return;
    if (feed.scrollTop + feed.clientHeight * 2 >= feed.scrollHeight) void query.fetchNextPage();
  }, [query]);

  const onActiveChange = React.useCallback((id: string, active: boolean) => {
    setActiveId((current) => (active ? id : current === id ? null : current));
  }, []);

  return (
    <div className="h-[calc(100dvh-4rem)] w-full bg-black text-white">
      <div
        ref={feedRef}
        onScroll={onScroll}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {videos.map((video) => (
          <ShortsSlide key={video.id} video={video} active={activeId === video.id} onActiveChange={onActiveChange} />
        ))}
        {query.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-white/60">加载中…</div>
        ) : null}
        {!query.isLoading && videos.length === 0 ? (
          <div className="grid h-full place-items-center px-8 text-center text-sm text-white/60">暂时没有 Shorts</div>
        ) : null}
      </div>
    </div>
  );
}

function ShortsSlide({
  video,
  active,
  onActiveChange,
}: {
  video: VideoSummary;
  active: boolean;
  onActiveChange: (id: string, active: boolean) => void;
}) {
  const poster = video.verticalPosterUrl ?? video.posterUrl;
  const slideRef = React.useRef<HTMLDivElement | null>(null);
  const user = useAuthStore((state) => state.user);
  const openAuth = useAuthModalStore((state) => state.openAuth);
  const requireLogin = React.useCallback(
    (action: () => void) => {
      if (!user) {
        openAuth('login', '/shorts');
        return;
      }
      action();
    },
    [openAuth, user],
  );

  React.useEffect(() => {
    const slide = slideRef.current;
    if (!slide) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = Boolean(entry && entry.intersectionRatio > 0.8);
        onActiveChange(video.id, inView);
        if (inView) track('video_impression', { videoId: video.id });
      },
      { threshold: [0.8] },
    );
    observer.observe(slide);
    return () => observer.disconnect();
  }, [onActiveChange, video.id]);

  return (
    <article ref={slideRef} className="relative h-full w-full snap-start snap-always bg-black">
      {poster ? <img src={poster} alt="" className="absolute inset-0 size-full object-contain" /> : null}
      {active ? <InPlacePlayer video={video} poster={poster} /> : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[1200px] items-end gap-8 px-8 pb-8">
        <div className="min-w-0 flex-1 space-y-1.5 pb-1">
          <p className="line-clamp-2 text-lg font-semibold">{video.title}</p>
          {video.author ? (
            <p className="text-sm text-white/70">
              @{video.author.username}
              <span className="mx-1 text-white/35">·</span>
              {formatCount(video.viewCount)} 播放
            </p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-4">
          <Action
            icon={Heart}
            label={formatCount(video.likeCount)}
            onClick={() => requireLogin(() => void socialApi.like(video.id).catch(() => undefined))}
          />
          <Action
            icon={Bookmark}
            label="收藏"
            onClick={() => requireLogin(() => void socialApi.favorite(video.id).catch(() => undefined))}
          />
          <Action
            icon={Maximize}
            label="全屏"
            onClick={() => enterFullscreen(slideRef.current)}
          />
        </div>
      </div>
    </article>
  );
}

function ticketGate(error: unknown): { message: string; subscribe: boolean; trial: ShortsTrialQuota | null } {
  if (error instanceof ApiError) {
    const trial = parseShortsTrialDetails(error.details);
    if (error.needsVip) {
      return {
        message: trial ? `已看完 ${trial.limit} 条免费 Shorts` : '免费试看已用完',
        subscribe: true,
        trial,
      };
    }
    if (error.isAuthError) return { message: '登录后观看', subscribe: false, trial: null };
    if (error.message) return { message: error.message, subscribe: error.isForbidden, trial: null };
  }
  return { message: '暂无法播放', subscribe: false, trial: null };
}

function InPlacePlayer({ video, poster }: { video: VideoSummary; poster: string | null }) {
  const [source, setSource] = React.useState<PlayerSource | null>(null);
  const [gate, setGate] = React.useState<{ message: string; subscribe: boolean; trial: ShortsTrialQuota | null } | null>(
    null,
  );
  const engineRef = React.useRef<PlayerEngine | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setSource(null);
    setGate(null);
    void contentApi
      .playTicket(video.id)
      .then((ticket) => {
        if (cancelled) return;
        setSource({
          videoId: video.id,
          masterUrl: ticket.masterUrl,
          token: ticket.token,
          ttlSeconds: ticket.ttlSeconds,
          previewSeconds: ticket.previewSeconds,
          resumeSeconds: ticket.resumeSeconds,
          spriteVttUrl: ticket.spriteVttUrl,
          poster,
          title: video.title,
          durationSeconds: video.durationSeconds,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setGate(ticketGate(error));
      });
    return () => {
      cancelled = true;
    };
  }, [poster, video.durationSeconds, video.id, video.title]);

  const { engine, snapshot, videoRef, containerRef } = usePlayer({
    source,
    hotkeys: false,
    autoplay: true,
    muted: false,
    renewTicket: async (id) => {
      const ticket = await contentApi.renewTicket(id);
      return {
        token: ticket.token,
        ttlSeconds: ticket.ttlSeconds,
        previewSeconds: ticket.previewSeconds,
        scope: ticket.scope,
      };
    },
    onEnded: () => {
      engineRef.current?.seek(0);
      void engineRef.current?.play();
    },
    onFirstFrame: () => track('video_play', { videoId: video.id }),
  });
  engineRef.current = engine;

  const overlayMessage =
    gate?.message ?? (snapshot.gate.blocked ? '订阅后即可继续观看' : null) ?? (snapshot.error ? snapshot.error.message : null);
  const showSubscribe = Boolean(gate?.subscribe || snapshot.gate.blocked);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onClick={() => {
        if (source && !overlayMessage) engine.togglePlay();
      }}
    >
      <video ref={videoRef} className="absolute inset-0 size-full object-contain" playsInline poster={poster ?? undefined} />
      {overlayMessage ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 px-8 text-center backdrop-blur-[2px]">
          <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-3">
            <p className="text-base font-semibold text-white">{overlayMessage}</p>
            <p className="text-sm text-white/70">订阅后即可继续观看 Shorts</p>
            {showSubscribe ? (
              <Link
                to="/membership"
                className="rounded-full bg-[#1e3a8a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1e40af]"
              >
                去订阅
              </Link>
            ) : null}
          </div>
        </div>
      ) : !source ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      ) : null}
      <button
        type="button"
        aria-label={snapshot.muted ? '取消静音' : '静音'}
        className="absolute top-5 right-6 z-10 grid size-10 place-items-center rounded-full bg-white/12 backdrop-blur-sm transition-colors hover:bg-white/20"
        onClick={(event) => {
          event.stopPropagation();
          engine.toggleMute();
        }}
      >
        {snapshot.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
      <input
        type="range"
        aria-label="播放进度"
        min={0}
        max={Math.max(snapshot.duration, video.durationSeconds ?? 0, 1)}
        step={0.1}
        value={Math.min(snapshot.currentTime, Math.max(snapshot.duration, video.durationSeconds ?? 0, 1))}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => engine.seek(Number(event.target.value))}
        className="absolute inset-x-6 bottom-2 z-20 h-1 cursor-pointer accent-white"
      />
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-0.5">
      <span className={cn('grid size-10 place-items-center rounded-full bg-black/25 backdrop-blur-sm')}>
        <Icon className="size-5" />
      </span>
      <span className="text-[11px] tabular-nums">{label}</span>
    </button>
  );
}
