import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Heart, Share2 } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatCount, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';
import { contentApi, socialApi } from '../lib/api';
import { track } from '../lib/analytics';

/**
 * Shorts：全屏竖滑。数据走现有 recommend immersive。
 * 流里不挂多个 HLS，封面满屏 + 点进播放，避免打爆移动内存。
 */
export function ShortsTab() {
  const query = useInfiniteQuery({
    queryKey: ['shorts'],
    queryFn: ({ pageParam }) => contentApi.recommend({ limit: 10, immersive: true, exclude: pageParam }),
    initialPageParam: '',
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 0
        ? undefined
        : allPages
            .flat()
            .map((v) => v.id)
            .slice(-60)
            .join(','),
  });

  const videos = query.data?.pages.flat() ?? [];
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el || query.isFetchingNextPage || !query.hasNextPage) return;
    if (el.scrollTop + el.clientHeight * 2 >= el.scrollHeight) void query.fetchNextPage();
  }, [query]);

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      <div className="pt-safe pointer-events-none absolute inset-x-0 top-0 z-10 px-3 py-2">
        <p className="text-sm font-medium text-white">Shorts</p>
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="snap-feed tab-scroll h-full w-full"
      >
        {videos.map((video) => (
          <ShortsPage key={video.id} video={video} />
        ))}
        {query.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-white/60">加载中…</div>
        ) : null}
      </div>
    </div>
  );
}

function ShortsPage({ video }: { video: VideoSummary }) {
  const poster = video.verticalPosterUrl ?? video.posterUrl;
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.intersectionRatio > 0.8) track('video_impression', { videoId: video.id });
      },
      { threshold: [0.8] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [video.id]);

  return (
    <div ref={ref} className="snap-page relative h-full w-full bg-black">
      {poster ? <img src={poster} alt="" className="size-full object-cover" /> : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

      <Link to={`/watch/${video.slug || video.id}`} className="absolute inset-0" aria-label={`播放 ${video.title}`} />

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
              const url = `${window.location.origin}/watch/${video.slug || video.id}`;
              void (navigator.share?.({ title: video.title, url }) ?? navigator.clipboard.writeText(url));
            }}
          />
        </div>
      </div>
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
