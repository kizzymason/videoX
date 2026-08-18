import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Heart, MessageCircle, Play, Share2, X } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatCount, type VideoSummary } from '@videox/shared';
import { cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { track } from '../lib/analytics';

/**
 * 沉浸式竖屏流。整屏一页，用原生 scroll-snap 做翻页——JS 模拟的翻页在低端
 * 安卓上跟手性很差，snap 交给浏览器合成线程处理才顺。
 *
 * 这里刻意只做「封面 + 信息 + 点进播放」，不在流里直接起播：
 * 每页都挂一个 hls 实例会瞬间打爆移动端内存。
 */
export function ImmersiveFeed({ onExit }: { onExit: () => void }) {
  const query = useInfiniteQuery({
    queryKey: ['immersive'],
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
    <div className="fixed inset-0 z-50 bg-black">
      <button
        type="button"
        aria-label="退出沉浸模式"
        onClick={onExit}
        className="pt-safe absolute top-2 left-2 z-10 grid size-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm"
      >
        <X className="size-5" />
      </button>

      <div
        ref={containerRef}
        onScroll={onScroll}
        className="snap-feed tab-scroll h-full w-full"
      >
        {videos.map((video) => (
          <ImmersivePage key={video.id} video={video} />
        ))}
        {query.isLoading ? <div className="grid h-full place-items-center text-sm text-white/60">加载中…</div> : null}
      </div>
    </div>
  );
}

function ImmersivePage({ video }: { video: VideoSummary }) {
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
    <div ref={ref} className="snap-page relative h-full w-full">
      {poster ? <img src={poster} alt="" className="size-full object-cover" /> : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/25" />

      <Link
        to={`/watch/${video.slug || video.id}`}
        className="absolute inset-0 grid place-items-center"
        aria-label={`播放 ${video.title}`}
      >
        <span className="grid size-16 place-items-center rounded-full bg-white/15 backdrop-blur-sm">
          <Play className="size-7 translate-x-0.5 fill-white text-white" />
        </span>
      </Link>

      <div className="pb-safe absolute inset-x-0 bottom-0 flex items-end gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-1.5 pb-16">
          {video.author ? (
            <p className="text-sm font-medium text-white">@{video.author.username}</p>
          ) : null}
          <p className="line-clamp-2-cjk text-sm text-white/90">{video.title}</p>
          {video.recommendReason ? (
            <span className="inline-block rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/80">
              {video.recommendReason}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4 pb-16 text-white">
          <ActionIcon icon={Heart} value={formatCount(video.likeCount)} />
          <ActionIcon icon={Bookmark} value={formatCount(video.favoriteCount)} />
          <ActionIcon icon={MessageCircle} value={formatCount(video.commentCount)} />
          <ActionIcon icon={Share2} value="分享" />
        </div>
      </div>
    </div>
  );
}

function ActionIcon({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn('grid size-10 place-items-center rounded-full bg-white/12 backdrop-blur-sm')}>
        <Icon className="size-5" />
      </span>
      <span className="text-[11px] tabular-nums">{value}</span>
    </div>
  );
}
