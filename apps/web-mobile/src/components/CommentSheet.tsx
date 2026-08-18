import * as React from 'react';
import { Drawer } from 'vaul';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatCount, formatRelativeTime } from '@videox/shared';
import { Avatar, AvatarFallback, AvatarImage, Button, Spinner, cn } from '@videox/ui';
import { socialApi } from '../lib/api';
import { flatten, nextPageParam } from '../lib/query';
import { useAuthStore } from '../stores/auth';

export function CommentSheet({
  videoId,
  open,
  onOpenChange,
  commentCount,
}: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentCount: number;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [content, setContent] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<{ id: string; name: string } | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['comments', videoId],
    queryFn: ({ pageParam }) => socialApi.comments({ videoId, page: pageParam, pageSize: 20, sort: 'hottest' }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () => socialApi.createComment({ videoId, content: content.trim(), parentId: replyTo?.id }),
    onSuccess: () => {
      setContent('');
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: ['comments', videoId] });
    },
    onError: () => toast.error('发送失败'),
  });

  const likeMutation = useMutation({
    mutationFn: (id: string) => socialApi.likeComment(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['comments', videoId] }),
  });

  const comments = flatten(query.data?.pages);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[78dvh] flex-col rounded-t-2xl border-t border-border bg-background outline-none">
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />

          <div className="flex h-12 shrink-0 items-center justify-between px-4">
            <Drawer.Title className="text-sm font-semibold">
              评论 <span className="text-muted-foreground tabular-nums">{formatCount(commentCount)}</span>
            </Drawer.Title>
            <Drawer.Close aria-label="关闭" className="grid size-8 place-items-center rounded-full active:bg-accent">
              <X className="size-4" />
            </Drawer.Close>
          </div>

          <div
            className="tab-scroll flex-1 px-4"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (
                query.hasNextPage &&
                !query.isFetchingNextPage &&
                el.scrollTop + el.clientHeight * 1.5 >= el.scrollHeight
              ) {
                void query.fetchNextPage();
              }
            }}
          >
            {query.isLoading ? (
              <div className="grid place-items-center py-10">
                <Spinner />
              </div>
            ) : comments.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">还没有评论，来抢沙发</p>
            ) : (
              <div className="space-y-5 py-2">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-2.5">
                    <Avatar className="size-8 shrink-0">
                      <AvatarImage src={comment.author.avatarUrl ?? undefined} alt={comment.author.displayName} />
                      <AvatarFallback>{comment.author.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {comment.author.displayName}
                        <span className="mx-1.5 text-muted-foreground/40">·</span>
                        {formatRelativeTime(comment.createdAt)}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed break-words">{comment.content}</p>
                      <button
                        type="button"
                        onClick={() => setReplyTo({ id: comment.id, name: comment.author.displayName })}
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        回复
                      </button>

                      {comment.replies && comment.replies.length > 0 ? (
                        <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2.5">
                          {comment.replies.map((reply) => (
                            <p key={reply.id} className="text-xs leading-relaxed">
                              <span className="font-medium">{reply.author.displayName}</span>
                              <span className="text-muted-foreground">：</span>
                              {reply.content}
                            </p>
                          ))}
                          {comment.replyCount > comment.replies.length ? (
                            <p className="text-xs text-muted-foreground">
                              共 {comment.replyCount} 条回复
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => likeMutation.mutate(comment.id)}
                      className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-muted-foreground"
                    >
                      <Heart className={cn('size-4', comment.liked && 'fill-current text-foreground')} />
                      <span className="text-[10px] tabular-nums">{comment.likeCount || ''}</span>
                    </button>
                  </div>
                ))}
                {query.isFetchingNextPage ? (
                  <div className="grid place-items-center py-4">
                    <Spinner />
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="pb-safe shrink-0 border-t border-border p-3">
            {replyTo ? (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                回复 @{replyTo.name}
                <button type="button" onClick={() => setReplyTo(null)} className="text-foreground">
                  取消
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={user ? '说点什么…' : '登录后参与评论'}
                disabled={!user}
                maxLength={2000}
                className="h-10 flex-1 rounded-full border border-input bg-muted/60 px-4 text-sm outline-none focus:border-ring disabled:opacity-60"
              />
              <Button
                size="icon"
                className="size-10 rounded-full"
                disabled={!user || !content.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
                aria-label="发送"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
