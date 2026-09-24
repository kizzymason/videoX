import * as React from 'react';
import { Drawer } from 'vaul';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { CARD_SHOP_POLL_INTERVAL_MS, type CardCheckout, type CardProduct } from '@videox/shared';
import { AlipayIcon, Button, Input, Skeleton, cn, useCopy } from '@videox/ui';
import { ApiError, cardShopApi, membershipApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';

/**
 * 移动端卡密购买面板。和 PC 版共用后端与类型，交互按手机重做。
 * 付款一律在本站页面内扫码完成，不给任何跳去收银台的入口。
 */
export function CardShopSheet({
  open,
  onOpenChange,
  onRedeemed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRedeemed: () => void | Promise<void>;
}) {
  const user = useAuthStore((s) => s.user);
  const [productId, setProductId] = React.useState('');
  const [quantity, setQuantity] = React.useState(1);
  const [email, setEmail] = React.useState('');
  const [orderNo, setOrderNo] = React.useState('');
  const [paid, setPaid] = React.useState<CardCheckout | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ['card-products'],
    queryFn: cardShopApi.products,
    enabled: open,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (!open) return;
    setEmail((prev) => prev || user?.email || '');
  }, [open, user?.email]);

  React.useEffect(() => {
    if (!products?.length || productId) return;
    setProductId(products.find((p) => p.inStock)?.id ?? products[0]!.id);
  }, [products, productId]);

  const selected = products?.find((p) => p.id === productId) ?? null;
  const maxQuantity = selected?.perOrderLimit ?? 1;

  /**
   * 收银台标签页要在点击的同一个事件里开出来，等接口回来再 open 会被当弹窗拦掉。
   * 所以先开一个空白页占位，拿到地址后再把它导航过去；下单失败就把它关掉。
   */
  const payWindow = React.useRef<Window | null>(null);

  const checkoutMutation = useMutation({
    mutationFn: () => cardShopApi.checkout({ productId, quantity, email: email.trim() }),
    onSuccess: (order) => {
      setOrderNo(order.orderNo);
      const held = payWindow.current;
      payWindow.current = null;
      if (!order.payUrl) {
        held?.close();
        return;
      }
      if (held && !held.closed) held.location.href = order.payUrl;
      else window.open(order.payUrl, '_blank', 'noopener');
    },
    onError: (error) => {
      payWindow.current?.close();
      payWindow.current = null;
      toast.error(error instanceof ApiError ? error.message : '下单失败，请稍后再试');
    },
  });

  const startPay = () => {
    payWindow.current = window.open('', '_blank');
    checkoutMutation.mutate();
  };

  const order = checkoutMutation.data ?? null;

  // 手机上买家很可能切去支付宝再回来，所以进后台也要继续轮，失败也一直重试。
  const { data: polled } = useQuery({
    queryKey: ['card-order', orderNo],
    queryFn: () => cardShopApi.order(orderNo),
    enabled: open && Boolean(orderNo) && !paid,
    refetchInterval: CARD_SHOP_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: true,
    retryDelay: CARD_SHOP_POLL_INTERVAL_MS,
  });

  React.useEffect(() => {
    if (polled?.status === 'paid' && polled.codes.length > 0) setPaid(polled);
  }, [polled]);

  const redeemMutation = useMutation({
    mutationFn: async (codes: string[]) => {
      for (const code of codes) await membershipApi.redeem(code);
    },
    onSuccess: async () => {
      toast.success('已兑换，会员时长已到账');
      await onRedeemed();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '兑换失败，请复制卡密手动兑换'),
  });

  const reset = () => {
    setOrderNo('');
    setPaid(null);
    setQuantity(1);
    checkoutMutation.reset();
    redeemMutation.reset();
  };

  const status = paid?.status ?? polled?.status ?? order?.status ?? null;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border-t border-border bg-background outline-none select-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
          <div className="flex h-12 shrink-0 items-center justify-between px-4">
            <Drawer.Title className="text-sm font-semibold">购买卡密</Drawer.Title>
            <Drawer.Close aria-label="关闭" className="grid size-8 place-items-center rounded-full active:bg-accent">
              <X className="size-4" />
            </Drawer.Close>
          </div>

          <div className="tab-scroll flex-1 space-y-5 px-4 pt-1 pb-8">
            {paid ? (
              <MobileCodes
                codes={paid.codes}
                redeeming={redeemMutation.isPending}
                redeemed={redeemMutation.isSuccess}
                onRedeem={() => redeemMutation.mutate(paid.codes)}
                onBuyMore={reset}
              />
            ) : orderNo && order ? (
              <MobilePay order={order} expired={status === 'expired'} onRetry={reset} />
            ) : (
              <>
                {isLoading ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-[74px] rounded-xl" />
                    <Skeleton className="h-[74px] rounded-xl" />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {(products ?? []).map((product) => (
                      <MobileProduct
                        key={product.id}
                        product={product}
                        active={product.id === productId}
                        onSelect={() => {
                          setProductId(product.id);
                          setQuantity(1);
                        }}
                      />
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">数量（单次最多 {maxQuantity} 张）</p>
                  <div className="flex gap-2">
                    {Array.from({ length: Math.min(5, maxQuantity) }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuantity(n)}
                        className={cn(
                          'h-11 flex-1 rounded-xl border text-sm font-medium tabular-nums',
                          quantity === n ? 'border-foreground bg-foreground text-background' : 'border-border',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">收卡邮箱（仅用于卡密自助找回）</p>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="h-12"
                  />
                </div>

                <Button
                  size="lg"
                  className="h-12 w-full"
                  disabled={!selected?.inStock || checkoutMutation.isPending || !email.trim()}
                  onClick={startPay}
                >
                  {checkoutMutation.isPending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      正在创建订单…
                    </>
                  ) : (
                    <>
                      <AlipayIcon className="size-5 text-[#1677FF]" />
                      Alipay支付 ¥{selected ? (Number(selected.price) * quantity).toFixed(2) : '0.00'}
                    </>
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">全程加密，卡密仅你本人可见</p>
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function MobileProduct({
  product,
  active,
  onSelect,
}: {
  product: CardProduct;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!product.inStock}
      className={cn(
        'flex w-full items-center justify-between rounded-xl border p-4 text-left',
        active ? 'border-foreground/50 bg-muted/40' : 'border-border',
        !product.inStock && 'opacity-50',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{product.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {product.inStock ? product.description || '即时到账' : '暂时售罄'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-semibold tabular-nums">¥{product.price}</span>
        {active ? <Check className="size-4" /> : null}
      </div>
    </button>
  );
}

function MobilePay({
  order,
  expired,
  onRetry,
}: {
  order: CardCheckout;
  expired: boolean;
  onRetry: () => void;
}) {
  if (expired) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-sm font-medium">订单已超时</p>
        <p className="text-xs text-muted-foreground">未在有效期内完成付款，请重新下单。</p>
        <Button className="h-12 w-full" onClick={onRetry}>
          重新下单
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <div>
        <p className="text-sm">
          {order.productName} × {order.quantity}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">¥{order.amount}</p>
      </div>

      {/* 下单时已自动跳转，这个按钮兜住被浏览器拦掉或用户误关的情况。 */}
      {order.payUrl ? (
        <Button size="lg" className="h-12 w-full" asChild>
          <a href={order.payUrl} target="_blank" rel="noopener noreferrer">
            <AlipayIcon className="size-5 text-[#1677FF]" />
            打开 Alipay 付款
          </a>
        </Button>
      ) : null}

      <div className="space-y-1">
        <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          付款完成后回到本页，卡密自动出现
        </p>
        <p className="text-xs text-muted-foreground">付款期间请保持本页不要关闭，最长可等待 30 分钟。</p>
      </div>

      <button type="button" onClick={onRetry} className="text-xs text-muted-foreground">
        取消并重新选择
      </button>
    </div>
  );
}

function MobileCodes({
  codes,
  redeeming,
  redeemed,
  onRedeem,
  onBuyMore,
}: {
  codes: string[];
  redeeming: boolean;
  redeemed: boolean;
  onRedeem: () => void;
  onBuyMore: () => void;
}) {
  const { copy } = useCopy();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-foreground p-4 text-background">
        <p className="text-sm font-semibold">支付成功，卡密已到账</p>
        <p className="mt-0.5 text-xs text-background/70">请复制保存，或直接点下方按钮兑换。</p>
      </div>

      <div className="space-y-2">
        {codes.map((code, index) => (
          <div key={code} className="flex items-center gap-2 rounded-xl border border-border p-3">
            <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <code className="flex-1 font-mono text-[15px] tracking-[0.1em] break-all select-all">{code}</code>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="复制卡密"
              onClick={() => {
                void copy(code);
                toast.success('卡密已复制');
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button className="h-12 w-full" disabled={redeeming || redeemed} onClick={onRedeem}>
        {redeeming ? (
          <>
            <Loader2 className="animate-spin" />
            兑换中…
          </>
        ) : redeemed ? (
          <>
            <Check />
            已兑换
          </>
        ) : (
          '立即兑换并开通'
        )}
      </Button>

      <div className="flex items-center justify-center gap-5 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => {
            void copy(codes.join('\n'));
            toast.success('已复制全部卡密');
          }}
        >
          复制全部
        </button>
        <button type="button" onClick={onBuyMore}>
          再买一张
        </button>
      </div>
    </div>
  );
}
