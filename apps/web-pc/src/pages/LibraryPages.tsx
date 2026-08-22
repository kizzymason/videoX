import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Heart, Trash2, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatCount, watchPercent } from '@videox/shared';
import { Avatar, AvatarFallback, AvatarImage, Button, EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from '@videox/ui';
import { contentApi, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useSeo } from '../hooks/use-seo';
import { PageContainer, PageHeader } from '../components/Page';
import { VideoGrid } from '../components/video/VideoGrid';
import { VideoCard } from '../components/video/VideoCard';
import { InfiniteFooter } from '../components/InfiniteFooter';
import * as React from 'react';

// ---------------------------------------------------------------------------
// 观看历史
// ---------------------------------------------------------------------------

export function HistoryPage() {
  useSeo({ title: '观看历史' });
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => socialApi.history(pageParam, 24),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const clearMutation = useMutation({
    mutationFn: () => socialApi.clearHistory(),
    onSuccess: () => {
      toast.success('历史记录已清空');
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (videoId: string) => socialApi.removeHistory(videoId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['history'] }),
  });

  const items = flatten(query.data?.pages);

  return (
    <PageContainer>
      <PageHeader
        title="观看历史"
        description={items.length > 0 ? `共 ${query.data?.pages[0]?.meta.total ?? 0} 条记录` : undefined}
        action={
          items.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => clearMutation.mutate()}>
              <Trash2 />
              清空历史
            </Button>
          ) : null
        }
      />

      {query.isLoading ? (
        <VideoGrid videos={[]} loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title="还没有观看记录"
          description="看过的视频会出现在这里"
          action={
            <Button size="sm" asChild>
              <Link to="/">去逛逛</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((item) => (
            <div key={item.id} className="group/history relative">
              <VideoCard
                video={item.video}
                progressPercent={watchPercent(item.positionSeconds, item.durationSeconds)}
              />
              <button
                type="button"
                aria-label="从历史中移除"
                onClick={() => removeMutation.mutate(item.video.id)}
                className="absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover/history:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={items.length === 0}
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 收藏
// ---------------------------------------------------------------------------

export function FavoritesPage() {
  useSeo({ title: '我的收藏' });

  const query = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) => socialApi.favorites(pageParam, 24),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const items = flatten(query.data?.pages);

  return (
    <PageContainer>
      <PageHeader title="我的收藏" />
      {query.isLoading ? (
        <VideoGrid videos={[]} loading />
      ) : items.length === 0 ? (
        <EmptyState icon={<Heart />} title="收藏夹是空的" description="点击视频页的收藏按钮就能存到这里" />
      ) : (
        <VideoGrid videos={items.map((item) => item.video)} />
      )}
      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={items.length === 0}
      />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 关注
// ---------------------------------------------------------------------------

export function FollowingPage() {
  useSeo({ title: '我的关注' });
  const [tab, setTab] = React.useState<'feed' | 'authors'>('feed');

  const feedQuery = useInfiniteQuery({
    queryKey: ['following-feed'],
    queryFn: ({ pageParam }) => socialApi.followingFeed(pageParam, 24),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: tab === 'feed',
  });

  const authorsQuery = useInfiniteQuery({
    queryKey: ['following-authors'],
    queryFn: ({ pageParam }) => socialApi.following(pageParam, 30),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: tab === 'authors',
  });

  const videos = flatten(feedQuery.data?.pages);
  const authors = flatten(authorsQuery.data?.pages);

  return (
    <PageContainer>
      <PageHeader
        title="我的关注"
        action={
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'feed' | 'authors')}>
            <TabsList>
              <TabsTrigger value="feed">最新动态</TabsTrigger>
              <TabsTrigger value="authors">关注的人</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {tab === 'feed' ? (
        <>
          <VideoGrid
            videos={videos}
            loading={feedQuery.isLoading}
            loadingMore={feedQuery.isFetchingNextPage}
            emptyTitle="关注的创作者还没有新作品"
          />
          <InfiniteFooter
            hasNextPage={feedQuery.hasNextPage}
            isFetchingNextPage={feedQuery.isFetchingNextPage}
            fetchNextPage={() => void feedQuery.fetchNextPage()}
            empty={videos.length === 0 && !feedQuery.isLoading}
          />
        </>
      ) : (
        <>
          {authorsQuery.isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : authors.length === 0 ? (
            <EmptyState icon={<Users />} title="还没有关注任何人" />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {authors.map((author) => (
                <Link
                  key={author.id}
                  to={`/channel/${author.username}`}
                  className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:border-foreground/25"
                >
                  <Avatar className="size-12">
                    <AvatarImage src={author.avatarUrl ?? undefined} alt={author.displayName} />
                    <AvatarFallback>{author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{author.displayName}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCount(author.followerCount)} 粉丝 · {author.videoCount} 视频
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <InfiniteFooter
            hasNextPage={authorsQuery.hasNextPage}
            isFetchingNextPage={authorsQuery.isFetchingNextPage}
            fetchNextPage={() => void authorsQuery.fetchNextPage()}
            empty={authors.length === 0}
          />
        </>
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 创作者频道页
// ---------------------------------------------------------------------------

export function ChannelPage() {
  const { username = '' } = useParams();
  const queryClient = useQueryClient();

  const { data: channel, isLoading } = useQuery({
    queryKey: ['channel', username],
    queryFn: () => contentApi.channel(username),
  });

  useSeo(channel ? { title: channel.displayName, description: channel.bio ?? undefined } : undefined);

  const videosQuery = useInfiniteQuery({
    queryKey: ['channel-videos', username],
    queryFn: ({ pageParam }) => contentApi.channelVideos(username, pageParam, 24),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const followMutation = useMutation({
    mutationFn: () => socialApi.follow(channel!.id),
    onSuccess: (data) => {
      toast.success(data.following ? '已关注' : '已取消关注');
      void queryClient.invalidateQueries({ queryKey: ['channel', username] });
    },
  });

  const videos = flatten(videosQuery.data?.pages);

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-28 w-full rounded-2xl" />
        <VideoGrid videos={[]} loading />
      </PageContainer>
    );
  }

  if (!channel) {
    return (
      <PageContainer>
        <EmptyState icon={<Users />} title="创作者不存在" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-border p-6">
        <Avatar className="size-20">
          <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.displayName} />
          <AvatarFallback className="text-2xl">{channel.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{channel.displayName}</h1>
          <p className="text-sm text-muted-foreground">@{channel.username}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatCount(channel.followerCount)} 粉丝 · {channel.videoCount} 个视频 ·{' '}
            {formatCount(channel.totalViews)} 次播放
          </p>
          {channel.bio ? <p className="pt-1 text-sm">{channel.bio}</p> : null}
        </div>
        <Button
          variant={channel.following ? 'outline' : 'default'}
          onClick={() => followMutation.mutate()}
          disabled={followMutation.isPending}
        >
          {channel.following ? <UserCheck /> : null}
          {channel.following ? '已关注' : '关注'}
        </Button>
      </div>

      <VideoGrid videos={videos} loading={videosQuery.isLoading} loadingMore={videosQuery.isFetchingNextPage} />
      <InfiniteFooter
        hasNextPage={videosQuery.hasNextPage}
        isFetchingNextPage={videosQuery.isFetchingNextPage}
        fetchNextPage={() => void videosQuery.fetchNextPage()}
        empty={videos.length === 0 && !videosQuery.isLoading}
      />
    </PageContainer>
  );
}
