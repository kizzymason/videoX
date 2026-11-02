import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Share2, Sparkles } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Button, Card, CardContent, Input, Skeleton, cn, useCopy } from '@videox/ui';
import { invitesApi } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useAuthModalStore } from '../../stores/auth-modal';

/**
 * 会员中心底部的邀请卡片：二维码 + 邀请码 + 链接，双方各得 N 天。
 * 位置紧跟充值区，顺承「想更便宜」的心理。
 */
export function InviteCard() {
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthModalStore((s) => s.openAuth);
  const { copied, copy } = useCopy();
  const { data, isLoading } = useQuery({
    queryKey: ['invite-me'],
    queryFn: invitesApi.me,
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const link = React.useMemo(() => {
    if (!data?.code) return '';
    return `${window.location.origin}/?invite=${data.code}`;
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

  if (!user) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4" />
              邀请好友，双方各得会员
            </p>
            <p className="text-xs text-muted-foreground">登录后生成你的专属邀请码和二维码。</p>
          </div>
          <Button size="lg" onClick={() => openAuth('login')}>
            登录 / 注册
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4" />
            邀请好友
          </p>
          {data && data.enabled && data.rewardDays > 0 ? (
            <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-semibold text-background">
              双方各得 {data.rewardDays} 天
            </span>
          ) : null}
        </div>

        {isLoading || !data ? (
          <Skeleton className="h-36 rounded-xl" />
        ) : !data.enabled ? (
          <p className="text-xs text-muted-foreground">邀请活动暂未开放，敬请期待。</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <div className="shrink-0 rounded-xl bg-white p-3 shadow-sm">
                <QRCodeSVG value={link} size={116} level="M" marginSize={0} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">我的邀请码</p>
                  <p className="font-mono text-2xl font-semibold tracking-[0.18em]">{data.code}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  已邀请 <span className="font-semibold text-foreground">{data.invited}</span> 人 · 已获得{' '}
                  <span className="font-semibold text-foreground">{data.daysEarned}</span> 天会员
                </p>
                <div className="flex flex-wrap gap-2">
                  <Input readOnly value={link} className="h-9 max-w-md flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    variant="outline"
                    className={cn(
                      copied && 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600 hover:text-white',
                    )}
                    onClick={async () => {
                      await copy(link);
                      toast.success('链接已复制');
                    }}
                  >
                    {copied ? (
                      <>
                        <Check className="size-4" />
                        已复制
                      </>
                    ) : (
                      '复制链接'
                    )}
                  </Button>
                  <Button onClick={() => void share()}>
                    <Share2 className="size-4" />
                    分享
                  </Button>
                </div>
              </div>
            </div>
            {copied ? (
              <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <Check className="size-3.5" />
                链接已复制，发给好友即可
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              好友通过你的链接注册成功后，你和好友各得 {data.rewardDays} 天会员。同一设备或同一网络只能领取一次，多开账号无效。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
