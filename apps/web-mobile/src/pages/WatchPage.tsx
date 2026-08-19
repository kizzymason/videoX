import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Heart, MessageCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { MobilePlayer } from '@videox/player/mobile';
import type { PlayerSource } from '@videox/player';
import { formatCount, formatRelativeTime, type VideoDetail } from '@videox/shared';
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Skeleton, cn } from '@videox/ui';
import { contentApi, socialApi, ApiError } from '../lib/api';
import { track } from '../lib/analytics';
import { useAuthStore } from '../stores/auth';
import { useSeo } from '../hooks/use-seo';
import { MobileVideoCard } from '../components/MobileVideoCard';
import { CommentSheet } from '../components/CommentSheet';

export function WatchPage() {
  const { idOrSlug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [commentsOpen, setCommentsOpen] = React.useState(false);

  const videoQuery = useQuery({ queryKey: ['video', idOrSlug], queryFn: () => contentApi.video(idOrSlug) });
  const video = videoQuery.data;

  const relatedQuery = useQuery({
    queryKey: ['related', video?.id],
    queryFn: () => contentApi.related(video!.id, 12),
    enabled: Boolean(video?.id),
  });

  const ticketQuery = useQuery({
    queryKey: ['play-ticket', video?.id],
    queryFn: () => contentApi.playTicket(video!.id),
    enabled: Boolean(video?.id) && Boolean(video?.viewer.canPlay),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  useSeo(video ? { title: video.title, description: video.description ?? undefined } : undefined);

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

  const patchViewer = (patch: Partial<VideoDetail['viewer']>, counts?: Partial<VideoDetail>) => {
    queryClient.setQueryData<VideoDetail>(['video', idOrSlug], (old) =>
      old ? { ...old, ...counts, viewer: { ...old.viewer, ...patch } } : old,
    );
  };

  const likeMutation = useMutation({
    mutationFn: () => socialApi.like(video!.id),
    onMutate: () => {
      if (!video) return;
      patchViewer({ liked: !video.viewer.liked }, { likeCount: video.likeCount + (video.viewer.liked ? -1 : 1) });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: () => socialApi.favorite(video!.id),
    onMutate: () => {
      if (!video) return;
      patchViewer(
        { favorited: !video.viewer.favorited },
        { favoriteCount: video.favoriteCount + (video.viewer.favorited ? -1 : 1) },
      );
    },
  });

  const followMutation = useMutation({
    mutationFn: () => socialApi.follow(video!.author!.id),
    onMutate: () => {
      if (!video) return;
      patchViewer({ following: !video.viewer.following });
    },
  });

  const requireLogin = (action: () => void) => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`);
      return;
    }
    action();
  };

  if (videoQuery.isLoading) {
    return (
      <div className="flex-1">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">视频不存在或已下架</p>
          <Button size="sm" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  const related = relatedQuery.data ?? [];
  const ticketVip = ticketQuery.error instanceof ApiError && ticketQuery.error.needsVip;
  const showVipGate = video.viewer.gateReason === 'vip_required' || ticketVip;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="pt-safe sticky top-0 z-20 bg-black">
        {source ? (
          <MobilePlayer
            source={source}
            poster={video.posterUrl}
            title={video.title}
            autoplay
            loggedIn={Boolean(user)}
            onBack={() => navigate(-1)}
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
            onUnlock={() => navigate('/subscribe')}
            onLogin={() => navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)}
          />
        ) : (
          <div className="relative aspect-video w-full">
            {video.posterUrl ? (
              <img src={video.posterUrl} alt="" className="size-full object-contain opacity-40" />
            ) : null}
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              {ticketQuery.isLoading ? (
                <div className="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
              ) : video.viewer.gateReason === 'login_required' ? (
                <Button size="sm" onClick={() => navigate(`/login?redirect=${location.pathname}`)}>
                  登录后观看
                </Button>
              ) : showVipGate ? (
                <div className="space-y-3">
                  <p className="text-sm text-white">订阅后即可播放</p>
                  <Button
                    size="sm"
                    className="bg-black text-white ring-1 ring-white/25 hover:bg-black/80"
                    onClick={() => navigate('/subscribe')}
                  >
                    开通会员观看
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-white/80">视频正在转码，稍后再来</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="tab-scroll flex-1">
        <div className="space-y-3 px-4 py-3">
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-[15px] leading-snug font-medium">{video.title}</h1>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatCount(video.viewCount)} 次播放
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {formatRelativeTime(video.publishedAt ?? video.createdAt)}
          </p>

          {/* 四个高频操作横排，指头够得着 */}
          <div className="grid grid-cols-4 gap-1 border-y border-border py-2">
            <ActionButton
              icon={Heart}
              label={formatCount(video.likeCount)}
              active={video.viewer.liked}
              onClick={() => requireLogin(() => likeMutation.mutate())}
            />
            <ActionButton
              icon={Bookmark}
              label={formatCount(video.favoriteCount)}
              active={video.viewer.favorited}
              onClick={() => requireLogin(() => favoriteMutation.mutate())}
            />
            <ActionButton
              icon={MessageCircle}
              label={formatCount(video.commentCount)}
              onClick={() => setCommentsOpen(true)}
            />
            <ActionButton
              icon={Share2}
              label="分享"
              onClick={() => {
                void navigator.clipboard.writeText(location.href);
                toast.success('链接已复制');
                track('share', { videoId: video.id });
              }}
            />
          </div>

          {video.author ? (
            <div className="flex items-center gap-3 py-1">
              <Link to={`/channel/${video.author.username}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                <Avatar className="size-9">
                  <AvatarImage src={video.author.avatarUrl ?? undefined} alt={video.author.displayName} />
                  <AvatarFallback>{video.author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{video.author.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{video.author.username}</p>
                </div>
              </Link>
              <Button
                size="sm"
                variant={video.viewer.following ? 'outline' : 'default'}
                onClick={() => requireLogin(() => followMutation.mutate())}
              >
                {video.viewer.following ? '已关注' : '关注'}
              </Button>
            </div>
          ) : null}

          {video.description ? (
            <p className="line-clamp-3 rounded-xl bg-muted/50 p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
              {video.description}
            </p>
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

        <section className="px-3 pb-8">
          <h2 className="px-1 pb-2.5 text-sm font-semibold">相关推荐</h2>
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-4">
            {related.map((item) => (
              <MobileVideoCard key={item.id} video={item} />
            ))}
          </div>
        </section>
      </div>

      <CommentSheet
        videoId={video.id}
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        commentCount={video.commentCount}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="no-tap-highlight flex flex-col items-center gap-1 rounded-lg py-1.5 active:bg-accent"
    >
      <Icon className={cn('size-5', active ? 'fill-current text-foreground' : 'text-muted-foreground')} />
      <span className="text-[11px] text-muted-foreground tabular-nums">{label}</span>
    </button>
  );
}
