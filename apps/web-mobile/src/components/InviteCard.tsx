import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Share2, Sparkles } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Button, Skeleton, cn, useCopy } from '@videox/ui';
import { invitesApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';

/**
 * 订阅页的邀请卡片：二维码 + 邀请码 + 链接，双方各得 N 天会员。
 * 放在充值板块下方 —— 用户刚看完价格，做「拉朋友一起省」的决策最自然。
 */
export function InviteCard() {
  const user = useAuthStore((s) => s.user);
  const { copied, copy } = useCopy();
  const { data, isLoading } = useQuery({
    queryKey: ['invite-me'],
    queryFn: invitesApi.me,
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const link = React.useMemo(() => {
    if (!data?.code) return '';
    const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, '/');
    return `${base}?invite=${data.code}`;
  }, [data?.code]);

  const share = async () => {
    if (!data) return;
    const text = `来 ${window.location.hostname} 看片，用我的邀请码 ${data.code} 注册，我们各得 ${data.rewardDays} 天会员`;
    if (navigator.share) {
      try {
        await navigator.share({ title: '邀请你加入', text, url: link });
        return;
      } catch {
        /* 用户取消，退回复制 */
      }
    }
    await copy(`${text}\n${link}`);
  };

  if (!user) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4" />
          邀请好友
        </h2>
        {data && data.rewardDays > 0 ? (
          <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background">
            双方各得 {data.rewardDays} 天
          </span>
        ) : null}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !data.enabled ? (
        <p className="rounded-xl border border-border p-4 text-xs text-muted-foreground">
          邀请活动暂未开放，敬请期待。
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            把二维码或链接发给朋友，对方注册成功后，你和好友各得 {data.rewardDays} 天会员。
          </p>

          <div className="flex items-center gap-4">
            <div className="shrink-0 rounded-lg bg-white p-2 shadow-sm">
              <QRCodeSVG value={link} size={92} level="M" marginSize={0} />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="text-[11px] text-muted-foreground">我的邀请码</p>
                <p className="font-mono text-xl font-semibold tracking-[0.18em]">{data.code}</p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                已邀请 <span className="font-semibold text-foreground">{data.invited}</span> 人 · 已获得{' '}
                <span className="font-semibold text-foreground">{data.daysEarned}</span> 天
              </p>
            </div>
          </div>

          {copied ? (
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <Check className="size-3.5" />
              链接已复制，发给好友即可
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className={cn(
                'h-10 flex-1',
                copied && 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600 hover:text-white',
              )}
              onClick={async () => {
                await copy(link);
                toast.success('链接已复制');
              }}
            >
              {copied ? '已复制' : '复制链接'}
            </Button>
            <Button className="h-10 flex-1" onClick={() => void share()}>
              <Share2 className="size-4" />
              分享给好友
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            同一设备或同一网络只能领取一次邀请奖励，多开账号无效。
          </p>
        </div>
      )}
    </section>
  );
}
