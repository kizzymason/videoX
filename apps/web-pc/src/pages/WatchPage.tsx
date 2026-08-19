import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Crown, Heart, Share2, UserPlus, UserCheck } from 'lucide-react';
import { DesktopPlayer } from '@videox/player/desktop';
import type { PlayerSource } from '@videox/player';
import { formatCount, formatDate, type VideoDetail } from '@videox/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Skeleton,
  Switch,
  cn,
} from '@videox/ui';
import { toast } from 'sonner';
import { contentApi, socialApi } from '../lib/api';
import { track } from '../lib/analytics';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { useUiStore } from '../stores/ui';
import { VideoCard, VideoCardSkeleton } from '../components/video/VideoCard';
import { CommentSection } from '../components/CommentSection';
import { useSeo } from '../hooks/use-seo';

export function WatchPage() {
  const { idOrSlug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthModalStore((s) => s.openAuth);
  const autoplayNext = useUiStore((s) => s.autoplayNext);
  const setAutoplayNext = useUiStore((s) => s.setAutoplayNext);

  const videoQuery = useQuery({
    queryKey: ['video', idOrSlug],
    queryFn: () => contentApi.video(idOrSlug),
  });
  const video = videoQuery.data;

  const relatedQuery = useQuery({
    queryKey: ['related', video?.id],
    queryFn: () => contentApi.related(video!.id, 16),
    enabled: Boolean(video?.id),
  });

  // 票据单独查：视频详情可以缓存，播放凭证不能。
  const ticketQuery = useQuery({
    queryKey: ['play-ticket', video?.id],
    queryFn: () => contentApi.playTicket(video!.id),
    enabled: Boolean(video?.id) && Boolean(video?.viewer.canPlay || video?.viewer.gateReason === 'vip_required'),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  useSeo(
    video
      ? {
          title: video.title,
          description: video.description ?? undefined,
          image: video.posterUrl ?? undefined,
          jsonLd: buildVideoJsonLd(video),
        }
      : undefined,
  );

  const source: PlayerSource | null = React.useMemo(() => {
    if (!video || !ticketQuery.data) return null;
    const ticket = ticketQuery.data;
    return {
      videoId: video.id,
      masterUrl: ticket.masterUrl,
      token: ticket.token,
      ttlSeconds: ticket.ttlSeconds,
      previewSeconds: ticket.previewSeconds,
      resumeSeconds: ticket.resumeSeconds,
      spriteVttUrl: ticket.spriteVttUrl,
      // 字幕跟票据无关，挂在详情上以免续签时丢掉
      captions: video.captions,
      poster: video.posterUrl,
      title: video.title,
      durationSeconds: video.durationSeconds,
    };
  }, [video, ticketQuery.data]);

  const likeMutation = useMutation({
    mutationFn: () => socialApi.like(video!.id),
    // 乐观更新：点赞是高频轻量操作，等一个 round trip 会显得很迟钝。
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['video', idOrSlug] });
      const previous = queryClient.getQueryData<VideoDetail>(['video', idOrSlug]);
      queryClient.setQueryData<VideoDetail>(['video', idOrSlug], (old) =>
        old
          ? {
              ...old,
              likeCount: old.likeCount + (old.viewer.liked ? -1 : 1),
              viewer: { ...old.viewer, liked: !old.viewer.liked },
            }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['video', idOrSlug], context.previous);
      toast.error('操作失败，请稍后再试');
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: () => socialApi.favorite(video!.id),
    onMutate: async () => {
      const previous = queryClient.getQueryData<VideoDetail>(['video', idOrSlug]);
      queryClient.setQueryData<VideoDetail>(['video', idOrSlug], (old) =>
        old
          ? {
              ...old,
              favoriteCount: old.favoriteCount + (old.viewer.favorited ? -1 : 1),
              viewer: { ...old.viewer, favorited: !old.viewer.favorited },
            }
          : old,
      );
      return { previous };
    },
    onSuccess: (data) => {
      toast.success(data.favorited ? '已加入收藏' : '已取消收藏');
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['video', idOrSlug], context.previous);
    },
  });

  const followMutation = useMutation({
    mutationFn: () => socialApi.follow(video!.author!.id),
    onMutate: async () => {
      const previous = queryClient.getQueryData<VideoDetail>(['video', idOrSlug]);
      queryClient.setQueryData<VideoDetail>(['video', idOrSlug], (old) =>
        old ? { ...old, viewer: { ...old.viewer, following: !old.viewer.following } } : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['video', idOrSlug], context.previous);
    },
  });

  const requireLogin = (action: () => void) => {
    if (!user) {
      openAuth('login', location.pathname);
      return;
    }
    action();
  };

  const related = relatedQuery.data ?? [];

  const handleEnded = React.useCallback(() => {
    if (!autoplayNext) return;
    const next = related[0];
    if (next) navigate(`/watch/${next.slug || next.id}`);
  }, [autoplayNext, related, navigate]);

  if (videoQuery.isLoading) return <WatchSkeleton />;
  if (videoQuery.isError || !video) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div className="space-y-2">
          <p className="text-base font-medium">视频不存在或已下架</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  const blockedReason = !video.viewer.canPlay ? video.viewer.gateReason : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
      <div className="flex flex-col gap-8 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="overflow-hidden rounded-2xl bg-black">
            {source ? (
              <DesktopPlayer
                source={source}
                poster={video.posterUrl}
                title={video.title}
                autoplay
                loggedIn={Boolean(user)}
                renewTicket={async (id) => {
                  const renewed = await contentApi.renewTicket(id);
                  return {
                    token: renewed.token,
                    ttlSeconds: renewed.ttlSeconds,
                    previewSeconds: renewed.previewSeconds,
                    scope: renewed.scope,
                  };
                }}
                onProgress={(position, duration) => {
                  if (!user) return;
                  void socialApi
                    .saveProgress({ videoId: video.id, positionSeconds: position, durationSeconds: duration })
                    .catch(() => undefined);
                  track('video_progress', { videoId: video.id, position, duration });
                }}
                onFirstFrame={() => track('video_play', { videoId: video.id })}
                onGate={() => track('vip_gate', { videoId: video.id })}
                onEnded={handleEnded}
                onNext={related[0] ? () => navigate(`/watch/${related[0]!.slug || related[0]!.id}`) : undefined}
                onUnlock={() => navigate('/membership')}
                onLogin={() => openAuth('login', location.pathname)}
              />
            ) : (
              <PlayerPlaceholder
                poster={video.posterUrl}
                reason={blockedReason}
                loading={ticketQuery.isLoading}
                onLogin={() => openAuth('login', location.pathname)}
                onUnlock={() => navigate('/membership')}
              />
            )}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-2">
              <h1 className="flex-1 text-xl font-semibold tracking-tight">{video.title}</h1>
              {video.accessLevel === 'vip' ? (
                <Badge variant="vip">
                  <Crown />
                  会员专享
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span className="tabular-nums">{formatCount(video.viewCount)} 次播放</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{formatDate(video.publishedAt ?? video.createdAt)}</span>
              {video.category ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Link to={`/category/${video.category.slug}`} className="hover:text-foreground">
                    {video.category.name}
                  </Link>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
              {video.author ? (
                <Link to={`/channel/${video.author.username}`} className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarImage src={video.author.avatarUrl ?? undefined} alt={video.author.displayName} />
                    <AvatarFallback>{video.author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{video.author.displayName}</p>
                    <p className="text-xs text-muted-foreground">@{video.author.username}</p>
                  </div>
                </Link>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {video.author ? (
                  <Button
                    variant={video.viewer.following ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => requireLogin(() => followMutation.mutate())}
                  >
                    {video.viewer.following ? <UserCheck /> : <UserPlus />}
                    {video.viewer.following ? '已关注' : '关注'}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requireLogin(() => likeMutation.mutate())}
                  className={cn(video.viewer.liked && 'border-foreground/25')}
                >
                  <Heart className={cn(video.viewer.liked && 'fill-current')} />
                  {formatCount(video.likeCount)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requireLogin(() => favoriteMutation.mutate())}
                  className={cn(video.viewer.favorited && 'border-foreground/25')}
                >
                  <Bookmark className={cn(video.viewer.favorited && 'fill-current')} />
                  {formatCount(video.favoriteCount)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(location.href);
                    toast.success('链接已复制');
                    track('share', { videoId: video.id });
                  }}
                >
                  <Share2 />
                  分享
                </Button>
              </div>
            </div>

            {video.description ? (
              <Description text={video.description} />
            ) : null}

            {video.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {video.tags.map((tag) => (
                  <Link key={tag.id} to={`/search?q=${encodeURIComponent(tag.name)}`}>
                    <Badge variant="secondary">#{tag.name}</Badge>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <CommentSection videoId={video.id} commentCount={video.commentCount} />
        </div>

        <aside className="w-full shrink-0 space-y-4 xl:w-[380px]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">相关推荐</h2>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              连播
              <Switch checked={autoplayNext} onCheckedChange={setAutoplayNext} />
            </label>
          </div>
          <div className="space-y-4">
            {relatedQuery.isLoading
              ? Array.from({ length: 8 }, (_, i) => <VideoCardSkeleton key={i} layout="row" />)
              : related.map((item) => <VideoCard key={item.id} video={item} layout="row" />)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = text.length > 160;
  return (
    <div className="rounded-xl bg-muted/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
      <p className={cn(!expanded && isLong && 'line-clamp-3')}>{text}</p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? '收起' : '展开全部'}
        </button>
      ) : null}
    </div>
  );
}

function PlayerPlaceholder({
  poster,
  reason,
  loading,
  onLogin,
  onUnlock,
}: {
  poster: string | null;
  reason: 'login_required' | 'vip_required' | 'unavailable' | null;
  loading: boolean;
  onLogin: () => void;
  onUnlock: () => void;
}) {
  return (
    <div className="relative aspect-video w-full bg-black">
      {poster ? <img src={poster} alt="" className="size-full object-contain opacity-45" /> : null}
      <div className="absolute inset-0 grid place-items-center px-6 text-center">
        {loading ? (
          <div className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        ) : reason === 'login_required' ? (
          <div className="space-y-3">
            <p className="text-sm text-white">登录后即可观看</p>
            <Button size="sm" onClick={onLogin}>
              去登录
            </Button>
          </div>
        ) : reason === 'vip_required' ? (
          <div className="space-y-3">
            <p className="text-sm text-white">该内容为会员专享</p>
            <Button size="sm" variant="vip" onClick={onUnlock}>
              开通会员
            </Button>
          </div>
        ) : (
          <p className="text-sm text-white/80">视频暂时无法播放，可能正在转码中</p>
        )}
      </div>
    </div>
  );
}

function WatchSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
      <div className="flex flex-col gap-8 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-5">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <div className="w-full shrink-0 space-y-4 xl:w-[380px]">
          {Array.from({ length: 6 }, (_, i) => (
            <VideoCardSkeleton key={i} layout="row" />
          ))}
        </div>
      </div>
    </div>
  );
}

function buildVideoJsonLd(video: VideoDetail): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description ?? '',
    thumbnailUrl: video.posterUrl ? [video.posterUrl] : [],
    uploadDate: video.publishedAt ?? video.createdAt,
    duration: `PT${Math.floor(video.durationSeconds / 60)}M${video.durationSeconds % 60}S`,
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'WatchAction' },
      userInteractionCount: video.viewCount,
    },
  };
}
