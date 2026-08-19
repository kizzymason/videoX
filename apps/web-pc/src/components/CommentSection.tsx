import * as React from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Heart, MessageSquare, Pin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCount, formatRelativeTime, type Comment } from '@videox/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Textarea,
  cn,
} from '@videox/ui';
import { socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { InfiniteFooter } from './InfiniteFooter';

const SORTS = [
  { value: 'hottest', label: '最热' },
  { value: 'latest', label: '最新' },
] as const;

export function CommentSection({ videoId, commentCount }: { videoId: string; commentCount: number }) {
  const [sort, setSort] = React.useState<(typeof SORTS)[number]['value']>('hottest');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const query = useInfiniteQuery({
    queryKey: ['comments', videoId, sort],
    queryFn: ({ pageParam }) => socialApi.comments({ videoId, page: pageParam, pageSize: 20, sort }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });

  const comments = flatten(query.data?.pages);

  const createMutation = useMutation({
    mutationFn: (input: { content: string; parentId?: string }) => socialApi.createComment({ videoId, ...input }),
    onSuccess: () => {
      toast.success('评论已发布');
      void queryClient.invalidateQueries({ queryKey: ['comments', videoId] });
    },
    onError: () => toast.error('评论发布失败'),
  });

  return (
    <section className="space-y-5 pt-2">
      <div className="flex items-center gap-4">
        <h2 className="text-base font-semibold">
          评论 <span className="text-muted-foreground tabular-nums">{formatCount(commentCount)}</span>
        </h2>
        <div className="flex items-center gap-1">
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSort(option.value)}
              className={cn(
                'rounded-md px-2 py-1 text-xs transition-colors',
                sort === option.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <CommentComposer
        onSubmit={(content) => createMutation.mutateAsync({ content })}
        pending={createMutation.isPending}
      />

      {query.isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <EmptyState icon={<MessageSquare />} title="还没有评论" description="来发表第一条评论吧" />
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              videoId={videoId}
              currentUserId={user?.id ?? null}
              onReply={(content, parentId) => createMutation.mutateAsync({ content, parentId })}
            />
          ))}
        </div>
      )}

      <InfiniteFooter
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        empty={comments.length === 0}
      />
    </section>
  );
}

function CommentComposer({
  onSubmit,
  pending,
  placeholder = '友善地表达你的观点…',
  autoFocus,
  onCancel,
}: {
  onSubmit: (content: string) => Promise<unknown>;
  pending?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [content, setContent] = React.useState('');
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthModalStore((s) => s.openAuth);

  if (!user) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
        登录后参与评论
        <Button size="sm" onClick={() => openAuth('login', location.pathname)}>
          登录
        </Button>
      </div>
    );
  }

  const submit = async () => {
    const value = content.trim();
    if (!value) return;
    await onSubmit(value);
    setContent('');
    onCancel?.();
  };

  return (
    <div className="flex gap-3">
      <Avatar className="size-9 shrink-0">
        <AvatarImage src={user.avatarUrl ?? undefined} alt={user.displayName} />
        <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-2">
        <Textarea
          value={content}
          autoFocus={autoFocus}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter 提交，跟大多数编辑器的肌肉记忆一致。
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
          }}
          placeholder={placeholder}
          maxLength={2000}
          className="min-h-16 resize-none"
        />
        <div className="flex items-center justify-end gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              取消
            </Button>
          ) : null}
          <Button size="sm" disabled={!content.trim() || pending} onClick={() => void submit()}>
            发布
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  videoId,
  currentUserId,
  onReply,
  nested = false,
}: {
  comment: Comment;
  videoId: string;
  currentUserId: string | null;
  onReply: (content: string, parentId: string) => Promise<unknown>;
  nested?: boolean;
}) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = React.useState(false);
  const [showAllReplies, setShowAllReplies] = React.useState(false);

  const likeMutation = useMutation({
    mutationFn: () => socialApi.likeComment(comment.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['comments', videoId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => socialApi.deleteComment(comment.id),
    onSuccess: () => {
      toast.success('评论已删除');
      void queryClient.invalidateQueries({ queryKey: ['comments', videoId] });
    },
  });

  const repliesQuery = useQuery({
    queryKey: ['comment-replies', comment.id],
    queryFn: () => socialApi.replies(comment.id, 1, 50),
    enabled: showAllReplies,
  });

  const replies = showAllReplies ? (repliesQuery.data?.items ?? comment.replies ?? []) : (comment.replies ?? []);
  const hiddenReplies = comment.replyCount - replies.length;

  return (
    <div className={cn('flex gap-3', nested && 'gap-2.5')}>
      <Link to={`/channel/${comment.author.username}`} className="shrink-0">
        <Avatar className={nested ? 'size-7' : 'size-9'}>
          <AvatarImage src={comment.author.avatarUrl ?? undefined} alt={comment.author.displayName} />
          <AvatarFallback>{comment.author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link to={`/channel/${comment.author.username}`} className="font-medium text-foreground hover:underline">
            {comment.author.displayName}
          </Link>
          {comment.pinned ? (
            <Badge variant="muted">
              <Pin />
              置顶
            </Badge>
          ) : null}
          <span className="text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
        </div>

        <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {comment.replyToUser ? (
            <span className="mr-1 text-muted-foreground">回复 @{comment.replyToUser.displayName}：</span>
          ) : null}
          {comment.content}
        </p>

        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => likeMutation.mutate()}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:text-foreground',
              comment.liked && 'text-foreground',
            )}
          >
            <Heart className={cn('size-3.5', comment.liked && 'fill-current')} />
            {comment.likeCount > 0 ? <span className="tabular-nums">{formatCount(comment.likeCount)}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="rounded px-1.5 py-1 transition-colors hover:text-foreground"
          >
            回复
          </button>
          {currentUserId === comment.author.id ? (
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              删除
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void socialApi.reportComment(comment.id);
                toast.success('已举报，感谢反馈');
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:text-foreground"
            >
              <Flag className="size-3.5" />
              举报
            </button>
          )}
        </div>

        {replying ? (
          <div className="mt-3">
            <CommentComposer
              autoFocus
              placeholder={`回复 @${comment.author.displayName}`}
              onSubmit={(content) => onReply(content, comment.id)}
              onCancel={() => setReplying(false)}
            />
          </div>
        ) : null}

        {replies.length > 0 ? (
          <div className="mt-3 space-y-4 border-l border-border pl-4">
            {replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                videoId={videoId}
                currentUserId={currentUserId}
                onReply={onReply}
                nested
              />
            ))}
          </div>
        ) : null}

        {!showAllReplies && hiddenReplies > 0 ? (
          <button
            type="button"
            onClick={() => setShowAllReplies(true)}
            className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            展开其余 {hiddenReplies} 条回复
          </button>
        ) : null}
      </div>
    </div>
  );
}
