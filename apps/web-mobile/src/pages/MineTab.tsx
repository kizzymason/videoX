import * as React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Clock,
  Flame,
  Heart,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatCount, formatDate, watchPercent } from '@videox/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Field,
  Input,
  Skeleton,
  cn,
} from '@videox/ui';
import { ApiError, socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { AppHeader } from '../components/AppHeader';
import { PullToRefresh } from '../components/PullToRefresh';
import { MasonryFeed } from '../components/MasonryFeed';
import { MobileVideoCard } from '../components/MobileVideoCard';
import { LoggedOutGate } from '../components/LoggedOutGate';
import { SiteFooter } from '../components/SiteFooter';

const ENTRIES = [
  { to: '/history', label: '观看历史', icon: Clock },
  { to: '/favorites', label: '我的收藏', icon: Heart },
  { to: '/following', label: '我的关注', icon: Users },
] as const;

export function MineTab() {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const logout = useAuthStore((s) => s.logout);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const { data: continueWatching } = useQuery({
    queryKey: ['continue-watching'],
    queryFn: () => socialApi.continueWatching(6),
    enabled: Boolean(user),
  });

  if (initializing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="我的" />
        <div className="flex-1 space-y-3 px-4 pt-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="我的" />
        <LoggedOutGate subtitle="同步历史、收藏与会员" redirect="/mine" />
      </div>
    );
  }

  return (
    <>
      <AppHeader title="我的" />
      <div className="tab-scroll flex-1 space-y-5 px-4 pt-2 pb-6">
        <Link to="/profile" className="vx-press flex items-center gap-3 rounded-2xl border border-border p-4 transition-colors duration-200 active:bg-accent">
          <Avatar className="size-14">
            <AvatarImage src={user.avatarUrl ?? undefined} alt={user.displayName} />
            <AvatarFallback className="text-lg">{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{user.displayName}</p>
              {user.isVip ? <Badge>会员</Badge> : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>

        {user ? (
          <Link
            to="/subscribe"
            className="vx-press flex items-center gap-3 rounded-2xl bg-foreground p-4 text-background"
          >
            <Flame className="size-5" />
            <div className="flex-1">
              <p className="text-sm font-medium">{user.isVip ? '会员生效中' : '开通会员'}</p>
              <p className="text-xs text-background/70">
                {user.isVip && user.vipExpiresAt ? `有效期至 ${formatDate(user.vipExpiresAt)}` : '使用订阅码订阅'}
              </p>
            </div>
            <ChevronRight className="size-4 text-background/60" />
          </Link>
        ) : null}

        {continueWatching && continueWatching.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="text-sm font-semibold">继续观看</h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 scrollbar-none">
              {continueWatching.map((item) => (
                <div key={item.id} className="w-36 shrink-0">
                  <MobileVideoCard
                    video={item.video}
                    progressPercent={watchPercent(item.positionSeconds, item.durationSeconds)}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-border">
          {ENTRIES.map(({ to, label, icon: Icon }, index) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'vx-press flex items-center gap-3 px-4 py-3.5 transition-colors duration-200 active:bg-accent',
                index > 0 && 'border-t border-border',
              )}
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm text-foreground">{label}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </section>

        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold">外观</h2>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: 'light', icon: Sun, label: '浅色' },
                { value: 'dark', icon: Moon, label: '深色' },
                { value: 'system', icon: Monitor, label: '跟随系统' },
              ] as const
            ).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs transition-colors',
                  theme === value ? 'border-foreground/30 bg-accent font-medium' : 'border-border text-muted-foreground',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {user ? (
          <Button variant="outline" className="w-full" onClick={() => void logout()}>
            <LogOut />
            退出登录
          </Button>
        ) : null}

        <SiteFooter />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 二级页面
// ---------------------------------------------------------------------------

export function HistoryPage() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => socialApi.history(pageParam, 20),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const clearMutation = useMutation({
    mutationFn: () => socialApi.clearHistory(),
    onSuccess: () => {
      toast.success('已清空');
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });

  const items = flatten(query.data?.pages);

  return (
    <>
      <AppHeader
        back
        title="观看历史"
        right={
          items.length > 0 ? (
            <button
              type="button"
              aria-label="清空历史"
              onClick={() => clearMutation.mutate()}
              className="vx-press grid size-9 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null
        }
      />
      <PullToRefresh onRefresh={() => query.refetch()}>
        <MasonryFeed
          videos={items.map((item) => item.video)}
          loading={query.isLoading}
          loadingMore={query.isFetchingNextPage}
          hasMore={query.hasNextPage}
          onEndReached={() => void query.fetchNextPage()}
          className="pt-3"
        />
      </PullToRefresh>
    </>
  );
}

export function FavoritesPage() {
  const query = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) => socialApi.favorites(pageParam, 20),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const items = flatten(query.data?.pages);

  return (
    <>
      <AppHeader back title="我的收藏" />
      <PullToRefresh onRefresh={() => query.refetch()}>
        <MasonryFeed
          videos={items.map((item) => item.video)}
          loading={query.isLoading}
          loadingMore={query.isFetchingNextPage}
          hasMore={query.hasNextPage}
          onEndReached={() => void query.fetchNextPage()}
          className="pt-3"
        />
      </PullToRefresh>
    </>
  );
}

export function FollowingPage() {
  const [tab, setTab] = React.useState<'feed' | 'authors'>('feed');

  const feedQuery = useInfiniteQuery({
    queryKey: ['following-feed'],
    queryFn: ({ pageParam }) => socialApi.followingFeed(pageParam, 20),
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
    <>
      <AppHeader back title="我的关注" />
      <div className="flex gap-1 border-b border-border px-4 py-2">
        {(
          [
            { key: 'feed', label: '最新动态' },
            { key: 'authors', label: '关注的人' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors',
              tab === item.key ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'feed' ? (
        <PullToRefresh onRefresh={() => feedQuery.refetch()}>
          <MasonryFeed
            videos={videos}
            loading={feedQuery.isLoading}
            loadingMore={feedQuery.isFetchingNextPage}
            hasMore={feedQuery.hasNextPage}
            onEndReached={() => void feedQuery.fetchNextPage()}
            className="pt-3"
          />
        </PullToRefresh>
      ) : (
        <div className="tab-scroll flex-1 divide-y divide-border">
          {authors.map((author) => (
            <Link key={author.id} to={`/channel/${author.username}`} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="size-11">
                <AvatarImage src={author.avatarUrl ?? undefined} alt={author.displayName} />
                <AvatarFallback>{author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{author.displayName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatCount(author.followerCount)} 粉丝
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
          {authors.length === 0 && !authorsQuery.isLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">还没有关注任何人</p>
          ) : null}
        </div>
      )}
    </>
  );
}

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const initializing = useAuthStore((s) => s.initializing);
  const [form, setForm] = React.useState({ displayName: '', bio: '', avatarUrl: '' });

  React.useEffect(() => {
    if (user) setForm({ displayName: user.displayName, bio: user.bio ?? '', avatarUrl: user.avatarUrl ?? '' });
  }, [user?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { authApi } = await import('../lib/api');
      return authApi.updateProfile({
        displayName: form.displayName,
        bio: form.bio || null,
        avatarUrl: form.avatarUrl || null,
      });
    },
    onSuccess: (updated) => {
      setUser(updated);
      toast.success('已保存');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '保存失败'),
  });

  if (initializing) {
    return (
      <>
        <AppHeader back title="编辑资料" />
        <div className="flex-1 space-y-4 px-4 py-4">
          <Skeleton className="mx-auto size-20 rounded-full" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </>
    );
  }
  if (!user) return <Navigate to="/login?redirect=/profile" replace />;

  return (
    <>
      <AppHeader back title="编辑资料" />
      <div className="tab-scroll flex-1 space-y-5 px-4 py-4">
        <div className="flex justify-center">
          <Avatar className="size-20">
            <AvatarImage src={form.avatarUrl || undefined} alt={user.displayName} />
            <AvatarFallback className="text-2xl">{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>
        <Field label="昵称">
          <Input
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            className="h-11"
          />
        </Field>
        <Field label="头像地址">
          <Input
            value={form.avatarUrl}
            onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
            placeholder="https://"
            className="h-11"
          />
        </Field>
        <Field label="个人简介">
          <Input
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            maxLength={300}
            className="h-11"
          />
        </Field>
        <Button size="lg" className="h-12 w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          保存
        </Button>
      </div>
    </>
  );
}
