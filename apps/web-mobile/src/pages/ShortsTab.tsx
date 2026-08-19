import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Heart, Share2, Volume2, VolumeX } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { usePlayer, type PlayerEngine, type PlayerSource } from '@videox/player';
import { formatCount, parseShortsTrialDetails, type ShortsTrialQuota, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';
import { ApiError, contentApi, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { track } from '../lib/analytics';

/**
 * Shorts：全屏竖滑，点击不进 /watch。数据走 GET /api/videos/shorts。
 * 进入视口（~80%）才取 play-ticket + usePlayer 起播；离开即卸载引擎，全 feed 只活一个。
 * 顶/底安全区都铺黑，离开由 App.applyChrome 卸回亮色。封面满屏，播放中不挂中间播放按钮。
 */
export function ShortsTab() {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['shorts'],
    queryFn: ({ pageParam }) => contentApi.shorts({ page: pageParam, pageSize: 10 }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const videos = flatten(query.data?.pages);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el || query.isFetchingNextPage || !query.hasNextPage) return;
    if (el.scrollTop + el.clientHeight * 2 >= el.scrollHeight) void query.fetchNextPage();
  }, [query]);

  const onActiveChange = React.useCallback((id: string, inView: boolean) => {
    setActiveId((current) => {
      if (inView) return id;
      return current === id ? null : current;
    });
  }, []);

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      {/* 顶部安全区实色，跟底栏同进同出 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-black" />
      <div className="pt-safe pointer-events-none absolute inset-x-0 top-0 z-10 px-3 py-2">
        <p className="text-sm font-medium text-white">Shorts</p>
      </div>
      <div ref={containerRef} onScroll={onScroll} className="snap-feed tab-scroll h-full w-full">
        {videos.map((video) => (
          <ShortsPage
            key={video.id}
            video={video}
            active={activeId === video.id}
            onActiveChange={onActiveChange}
          />
        ))}
        {query.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-white/60">加载中…</div>
        ) : null}
      </div>
    </div>
  );
}

function ShortsPage({
  video,
  active,
  onActiveChange,
}: {
  video: VideoSummary;
  active: boolean;
  onActiveChange: (id: string, inView: boolean) => void;
}) {
  const poster = video.verticalPosterUrl ?? video.posterUrl;
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = Boolean(entry && entry.intersectionRatio > 0.8);
        onActiveChange(video.id, inView);
        if (inView) track('video_impression', { videoId: video.id });
      },
      { threshold: [0.8] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onActiveChange, video.id]);

  return (
    <div ref={ref} className="snap-page relative h-full w-full bg-black">
      {poster ? <img src={poster} alt="" className="size-full object-cover" /> : null}
      {active ? <ShortsInPlacePlayer video={video} poster={poster} /> : null}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] flex items-end gap-3 px-4 pb-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[15px] font-semibold text-white">{video.title}</p>
          {video.author ? (
            <p className="text-xs text-white/70">
              @{video.author.username}
              <span className="mx-1 text-white/30">·</span>
              {formatCount(video.viewCount)} 播放
            </p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-4 text-white">
          <ShortsAction
            icon={Heart}
            label={formatCount(video.likeCount)}
            onClick={() => void socialApi.like(video.id).catch(() => undefined)}
          />
          <ShortsAction
            icon={Bookmark}
            label="收藏"
            onClick={() => void socialApi.favorite(video.id).catch(() => undefined)}
          />
          <ShortsAction
            icon={Share2}
            label="分享"
            onClick={() => {
              const url = `${window.location.origin}/shorts`;
              void (navigator.share?.({ title: video.title, url }) ?? navigator.clipboard.writeText(url));
            }}
          />
        </div>
      </div>
    </div>
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

/**
 * 只在当前页挂载。离开视口由父级卸载，usePlayer 析构时 destroy 引擎。
 * 不用 MobilePlayer：那套是 16:9 详情页皮肤。
 */
function ShortsInPlacePlayer({ video, poster }: { video: VideoSummary; poster: string | null }) {
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
        if (cancelled) return;
        setGate(ticketGate(error));
      });
    return () => {
      cancelled = true;
    };
  }, [poster, video.durationSeconds, video.id, video.title]);

  const { engine, snapshot, videoRef, containerRef } = usePlayer({
    source,
    hotkeys: false,
    autoplay: true,
    muted: true,
    renewTicket: async (id) => {
      const renewed = await contentApi.renewTicket(id);
      return {
        token: renewed.token,
        ttlSeconds: renewed.ttlSeconds,
        previewSeconds: renewed.previewSeconds,
        scope: renewed.scope,
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
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        playsInline
        poster={poster ?? undefined}
      />
      {overlayMessage ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 px-8 text-center backdrop-blur-[2px]">
          <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-3">
            <p className="text-base font-semibold text-white">{overlayMessage}</p>
            <p className="text-sm text-white/70">订阅后即可继续观看 Shorts</p>
            {showSubscribe ? (
              <Link
                to="/subscribe"
                className="rounded-full bg-[oklch(0.79_0.14_78)] px-5 py-2 text-sm font-semibold text-[oklch(0.22_0.06_78)]"
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
        className="absolute top-[calc(env(safe-area-inset-top)+2.5rem)] right-3 z-20 grid size-8 place-items-center rounded-full bg-black/40 text-white"
        aria-label={snapshot.muted ? '取消静音' : '静音'}
        onClick={(event) => {
          event.stopPropagation();
          engine.toggleMute();
        }}
      >
        {snapshot.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </div>
  );
}

function ShortsAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="no-tap-highlight flex flex-col items-center gap-0.5">
      <span className={cn('grid size-10 place-items-center')}>
        <Icon className="size-6" />
      </span>
      <span className="text-[11px] tabular-nums">{label}</span>
    </button>
  );
}
