import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Flame, Gift, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { daysUntil, formatDate, formatPrice } from '@videox/shared';
import { Badge, Button, Card, CardContent, Input, Skeleton, cn } from '@videox/ui';
import { ApiError, membershipApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { useSeo } from '../hooks/use-seo';
import { PageContainer, PageHeader } from '../components/Page';

export function MembershipPage() {
  useSeo({ title: '会员中心', description: '开通会员，解锁全站会员专享内容' });
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthModalStore((s) => s.openAuth);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [code, setCode] = React.useState('');

  const { data: plans, isLoading } = useQuery({ queryKey: ['plans'], queryFn: membershipApi.plans });
  const { data: membership } = useQuery({
    queryKey: ['membership-me'],
    queryFn: membershipApi.me,
    enabled: Boolean(user),
  });
  const { data: orders } = useQuery({
    queryKey: ['membership-orders'],
    queryFn: membershipApi.orders,
    enabled: Boolean(user),
  });

  const redeemMutation = useMutation({
    mutationFn: (value: string) => membershipApi.redeem(value),
    onSuccess: async (result) => {
      toast.success(
        result.extended
          ? `已顺延「${result.planName}」${result.durationDays} 天`
          : `已开通「${result.planName}」，有效期至 ${formatDate(result.vipExpiresAt)}`,
      );
      setCode('');
      await refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['membership-me'] });
      void queryClient.invalidateQueries({ queryKey: ['membership-orders'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : '兑换失败，请检查卡密');
    },
  });

  const submitRedeem = () => {
    const value = code.trim();
    if (!value) return;
    if (!user) {
      openAuth('login', '/membership');
      return;
    }
    redeemMutation.mutate(value);
  };

  const remaining = membership?.vipExpiresAt ? daysUntil(membership.vipExpiresAt) : null;

  return (
    <PageContainer>
      <PageHeader title="会员中心" description="卡密即时到账，支持叠加续期" />

      <div className="overflow-hidden rounded-xl bg-foreground p-5 text-background">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-11 place-items-center rounded-full bg-background/10">
            <Flame className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">videoX 会员</p>
              {user && membership?.isVip ? (
                <span className="rounded-full border border-background/25 px-2 py-0.5 text-[10px] font-medium">
                  生效中
                </span>
              ) : null}
            </div>
            <p className="text-sm text-background/70">
              {user && membership?.isVip
                ? `有效期至 ${formatDate(membership.vipExpiresAt)}${remaining !== null ? `（剩余 ${remaining} 天）` : ''}`
                : '尚未开通，使用卡密即可立即生效'}
            </p>
          </div>
        </div>
      </div>

      {/* 卡密兑换放在最上面：这是本站唯一的开通路径，不该藏在套餐后面 */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Gift className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">卡密兑换</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submitRedeem()}
              placeholder="输入卡密，例如 VIP-XXXX-XXXX-XXXX"
              className="h-10 max-w-md flex-1 font-mono tracking-wider"
            />
            <Button size="lg" onClick={submitRedeem} disabled={redeemMutation.isPending || !code.trim()}>
              {redeemMutation.isPending ? '兑换中…' : '立即兑换'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">已是会员时兑换会自动顺延到期时间，不会覆盖剩余天数。</p>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">套餐</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(plans ?? []).map((plan) => (
              <Card
                key={plan.id}
                className={cn(
                  'relative flex flex-col transition-colors',
                  plan.isRecommended ? 'border-foreground/30' : 'hover:border-foreground/20',
                )}
              >
                {plan.badge ? (
                  <Badge
                    variant={plan.isRecommended ? 'default' : 'secondary'}
                    className="absolute -top-2.5 left-5"
                  >
                    {plan.badge}
                  </Badge>
                ) : null}
                <CardContent className="flex flex-1 flex-col gap-4 p-5 pt-6">
                  <div>
                    <p className="text-sm font-medium">{plan.name}</p>
                    {plan.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tracking-tight tabular-nums">
                      {formatPrice(plan.priceCents)}
                    </span>
                    {plan.originalPriceCents ? (
                      <span className="text-sm text-muted-foreground line-through tabular-nums">
                        {formatPrice(plan.originalPriceCents)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">{plan.durationDays} 天有效期</p>
                  <ul className="flex-1 space-y-1.5">
                    {plan.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                  <Button variant={plan.isRecommended ? 'default' : 'outline'} className="w-full" asChild>
                    <a href="#redeem" onClick={(e) => e.preventDefault()}>
                      <Sparkles />
                      使用卡密开通
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {orders && orders.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">开通记录</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">订单号</th>
                  <th className="px-4 py-2.5 text-left font-medium">套餐</th>
                  <th className="px-4 py-2.5 text-left font-medium">来源</th>
                  <th className="px-4 py-2.5 text-right font-medium">金额</th>
                  <th className="px-4 py-2.5 text-right font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-xs">{order.orderNo}</td>
                    <td className="px-4 py-2.5">{order.planName ?? '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {order.source === 'redeem_code' ? '卡密兑换' : order.source === 'manual_grant' ? '后台赠送' : '支付'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatPrice(order.amountCents)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                      {formatDate(order.createdAt, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}
