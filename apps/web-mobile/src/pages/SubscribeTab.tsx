import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Flame, ShieldCheck, ShoppingCart, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  CARD_PURCHASE_STATUS_LABELS,
  daysUntil,
  formatDate,
  formatPrice,
  type CardPurchaseRecord,
} from '@videox/shared';
import { Button, Input, Skeleton, cn, useAntiPeek, useCopy } from '@videox/ui';
import { ApiError, cardShopApi, membershipApi } from '../lib/api';
import { CardShopSheet } from '../components/CardShopSheet';
import { useAuthStore } from '../stores/auth';
import { track } from '../lib/analytics';
import { AppHeader } from '../components/AppHeader';
import { LoggedOutGate } from '../components/LoggedOutGate';

const HIGHLIGHTS = [
  { icon: Flame, title: '全站会员内容', desc: '解锁所有视频与 Shorts' },
  { icon: Zap, title: '最高画质', desc: '1080p 及以上码率不限速' },
  { icon: ShieldCheck, title: '无限制观看', desc: '视频与 Shorts 全部解锁，不再受 3 条试看限制' },
];

/** 「订阅」Tab = 权益 + 订阅码。本站只走订阅码，不接支付。 */
export function SubscribeTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [code, setCode] = React.useState('');

  const [cardShopOpen, setCardShopOpen] = React.useState(false);

  // 整页防窥：拦右键与调试快捷键。卡密本身直接明文给买家，方便复制保存。
  useAntiPeek();

  const { data: plans, isLoading } = useQuery({ queryKey: ['plans'], queryFn: membershipApi.plans });
  const { data: membership } = useQuery({
    queryKey: ['membership-me'],
    queryFn: membershipApi.me,
    enabled: Boolean(user),
  });
  const { data: cardShop } = useQuery({ queryKey: ['card-shop-status'], queryFn: cardShopApi.status });
  const { data: purchases } = useQuery({
    queryKey: ['card-purchases'],
    queryFn: cardShopApi.purchases,
    enabled: Boolean(user) && Boolean(cardShop?.enabled),
  });

  const afterRedeem = async () => {
    await refreshUser();
    void queryClient.invalidateQueries({ queryKey: ['membership-me'] });
    void queryClient.invalidateQueries({ queryKey: ['card-purchases'] });
  };

  const redeemMutation = useMutation({
    mutationFn: (value: string) => membershipApi.redeem(value),
    onSuccess: async (result) => {
      track('redeem');
      toast.success(
        result.extended ? `已顺延 ${result.durationDays} 天` : `已开通「${result.planName}」`,
      );
      setCode('');
      await refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['membership-me'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '兑换失败'),
  });

  const submit = () => {
    const value = code.trim();
    if (!value) return;
    if (!user) {
      navigate('/login?redirect=/subscribe');
      return;
    }
    redeemMutation.mutate(value);
  };

  const remaining = membership?.vipExpiresAt ? daysUntil(membership.vipExpiresAt) : null;

  if (initializing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="订阅" />
        <div className="flex-1 space-y-3 px-4 pt-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AppHeader title="订阅" />
        <LoggedOutGate subtitle="登录后即可订阅" redirect="/subscribe" />
      </div>
    );
  }

  return (
    <>
      <AppHeader title="订阅" />
      <div className="tab-scroll flex-1 space-y-6 px-4 pt-2 pb-6">
        {/* 会员状态卡 */}
        <div className="relative overflow-hidden rounded-2xl bg-foreground p-5 text-background">
          <div className="relative space-y-1">
            <div className="flex items-center gap-2">
              <Flame className="size-5" />
              <span className="text-base font-semibold">PandaGV-PRO</span>
              {membership?.isVip ? (
                <span className="rounded-full border border-background/25 px-2 py-0.5 text-[10px] font-medium">
                  生效中
                </span>
              ) : null}
            </div>
            {user ? (
              membership?.isVip ? (
                <p className="text-sm text-background/70">
                  有效期至 {formatDate(membership.vipExpiresAt)}
                  {remaining !== null ? `（剩余 ${remaining} 天）` : ''}
                </p>
              ) : (
                <p className="text-sm text-background/70">访问所有媒体与Shorts</p>
              )
            ) : (
              <p className="text-sm text-background/70">登录后即可订阅</p>
            )}
          </div>
        </div>

        {/* 订阅 */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">订阅</h2>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="请输入订阅码"
            className="h-12"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button size="lg" className="h-12 w-full" onClick={submit} disabled={redeemMutation.isPending || !code.trim()}>
            {redeemMutation.isPending ? '订阅中…' : '立即订阅'}
          </Button>
          {cardShop?.enabled ? (
            <>
              <Button
                size="lg"
                className="h-12 w-full border-0 bg-[#1e3a8a] text-white hover:bg-[#1e40af]"
                onClick={() => setCardShopOpen(true)}
              >
                <ShoppingCart />
                购买卡密
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                没有订阅码？点「购买卡密」自助购买，付款后立即到账。
              </p>
            </>
          ) : (
            <p className="text-center text-xs text-muted-foreground">已是订阅会员时自动叠加时间。</p>
          )}
        </section>

        {purchases && purchases.length > 0 ? <MyCards purchases={purchases} /> : null}

        {/* 权益 */}
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold">权益</h2>
          <div className="space-y-2">
            {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 计划 */}
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold">计划</h2>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {(plans ?? []).map((plan) => (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col gap-1 rounded-xl border p-3.5',
                    plan.isRecommended ? 'border-foreground/40 bg-muted/40' : 'border-border',
                  )}
                >
                  {plan.badge ? (
                    <span className="absolute -top-2 right-2 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background">
                      {plan.badge}
                    </span>
                  ) : null}
                  <p className="text-sm font-medium">{plan.name}</p>
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">
                    {formatPrice(plan.priceCents)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{plan.durationDays} 天</p>
                  {plan.perks.slice(0, 2).map((perk) => (
                    <p key={perk} className="flex items-start gap-1 text-[11px] text-muted-foreground">
                      <Check className="mt-0.5 size-3 shrink-0" />
                      <span className="line-clamp-1">{perk}</span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <CardShopSheet open={cardShopOpen} onOpenChange={setCardShopOpen} onRedeemed={afterRedeem} />
    </>
  );
}

/** 买过的卡密留在订阅 Tab 里，关掉面板也能回来复制。 */
function MyCards({ purchases }: { purchases: CardPurchaseRecord[] }) {
  const { copy } = useCopy();

  return (
    <section className="space-y-2.5">
      <h2 className="text-sm font-semibold">我的卡密</h2>
      <div className="space-y-2">
        {purchases.map((purchase) => (
          <div key={purchase.id} className="space-y-2 rounded-xl border border-border p-3.5 select-none">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{purchase.productName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                ¥{purchase.amount} · {CARD_PURCHASE_STATUS_LABELS[purchase.status]}
              </span>
            </div>
            {purchase.codes.length > 0 ? (
              purchase.codes.map((code) => (
                <div key={code} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                  <code className="flex-1 font-mono text-sm tracking-[0.08em] break-all select-all">{code}</code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="复制卡密"
                    onClick={() => {
                      void copy(code);
                      toast.success('卡密已复制');
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {purchase.status === 'pending' ? '等待付款，付款后卡密会出现在这里' : '该订单没有可用卡密'}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground tabular-nums">{formatDate(purchase.createdAt, true)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
