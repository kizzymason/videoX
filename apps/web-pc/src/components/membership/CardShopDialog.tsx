import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2, Minus, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { CARD_SHOP_POLL_INTERVAL_MS, type CardCheckout, type CardProduct } from '@videox/shared';
import {
  AlipayIcon,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  cn,
  useCopy,
} from '@videox/ui';
import { ApiError, cardShopApi, membershipApi } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';

interface CardShopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 兑换成功后由订阅页刷新会员状态。 */
  onRedeemed: () => void | Promise<void>;
}

export function CardShopDialog({ open, onOpenChange, onRedeemed }: CardShopDialogProps) {
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

  const checkoutMutation = useMutation({
    mutationFn: () => cardShopApi.checkout({ productId, quantity, email: email.trim() }),
    onSuccess: (order) => setOrderNo(order.orderNo),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '下单失败，请稍后再试'),
  });

  const order = checkoutMutation.data ?? null;

  // 拿到卡密就停轮询，别再白耗上游额度。
  // 单次失败不能让轮询断掉：买家可能正在支付宝里，回来必须看到结果，
  // 所以切到后台也继续轮，出错也一直重试。
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
      // 多张时逐张兑换：后端按行锁串行，批量并发只会互相阻塞。
      for (const code of codes) await membershipApi.redeem(code);
    },
    onSuccess: async () => {
      toast.success('已兑换，会员时长已到账');
      await onRedeemed();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '兑换失败，请手动复制卡密兑换'),
  });

  const reset = () => {
    setOrderNo('');
    setPaid(null);
    setQuantity(1);
    checkoutMutation.reset();
    redeemMutation.reset();
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const status = paid?.status ?? polled?.status ?? order?.status ?? null;
  const expired = status === 'expired';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="w-full gap-5 bg-background p-7 select-none sm:max-w-[460px]"
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogTitle className="text-lg font-semibold tracking-tight">购买卡密</DialogTitle>
        <DialogDescription className="sr-only">选择规格并使用 Alipay 付款，付款成功后立即获得卡密</DialogDescription>

        {paid ? (
          <CodesPanel
            codes={paid.codes}
            redeeming={redeemMutation.isPending}
            redeemed={redeemMutation.isSuccess}
            onRedeem={() => redeemMutation.mutate(paid.codes)}
            onBuyMore={reset}
          />
        ) : orderNo && order ? (
          <PayPanel order={order} expired={expired} onRetry={reset} />
        ) : (
          <div className="space-y-5">
            {isLoading ? (
              <div className="space-y-2.5">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : (
              <div className="grid gap-2.5">
                {(products ?? []).map((product) => (
                  <ProductCard
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

            <Field label="数量" htmlFor="vx-card-qty" hint={`单次最多 ${maxQuantity} 张`}>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="减少"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  <Minus className="size-4" />
                </Button>
                <Input
                  id="vx-card-qty"
                  value={quantity}
                  inputMode="numeric"
                  onChange={(e) => {
                    const next = Number(e.target.value.replace(/\D/g, '')) || 1;
                    setQuantity(Math.min(maxQuantity, Math.max(1, next)));
                  }}
                  className="h-10 w-16 text-center tabular-nums"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="增加"
                  disabled={quantity >= maxQuantity}
                  onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </Field>

            <Field label="收卡邮箱" htmlFor="vx-card-email" hint="仅用于卡密自助找回，不会用于营销">
              <Input
                id="vx-card-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-10"
              />
            </Field>

            <Button
              size="lg"
              className="w-full"
              disabled={!selected?.inStock || checkoutMutation.isPending || !email.trim()}
              onClick={() => checkoutMutation.mutate()}
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
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              全程加密，卡密仅你本人可见
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({
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
        'flex items-center justify-between rounded-xl border p-4 text-left transition-colors',
        active ? 'border-foreground/50 bg-muted/50' : 'border-border hover:border-foreground/25',
        !product.inStock && 'cursor-not-allowed opacity-50',
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

function PayPanel({
  order,
  expired,
  onRetry,
}: {
  order: CardCheckout;
  expired: boolean;
  onRetry: () => void;
}) {
  const [qrSrc, setQrSrc] = React.useState('');

  React.useEffect(() => {
    if (!order.qrUrl) return undefined;
    let objectUrl = '';
    let alive = true;
    void cardShopApi
      .qrBlobUrl(order.qrUrl)
      .then((url) => {
        objectUrl = url;
        if (alive) setQrSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [order.qrUrl]);

  if (expired) {
    return (
      <div className="space-y-4 py-4 text-center">
        <p className="text-sm font-medium">订单已超时</p>
        <p className="text-xs text-muted-foreground">未在有效期内完成付款，请重新下单。</p>
        <Button className="w-full" onClick={onRetry}>
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

      <div className="mx-auto grid size-[200px] place-items-center rounded-xl border border-border bg-white p-2">
        {qrSrc ? (
          <img src={qrSrc} alt="Alipay 付款二维码" className="size-full object-contain" draggable={false} />
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        )}
      </div>

      <p className="flex items-center justify-center gap-1.5 text-sm font-medium">
        <AlipayIcon className="size-4 text-[#1677FF]" />
        请用 Alipay 扫码支付
      </p>
      <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        付款后自动出卡
      </p>
      <p className="text-xs text-muted-foreground">付款过程中请保持本窗口打开，最长可等待 30 分钟。</p>

      <button type="button" onClick={onRetry} className="text-xs text-muted-foreground hover:text-foreground">
        取消并重新选择
      </button>
    </div>
  );
}

function CodesPanel({
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
      <div className="rounded-xl bg-foreground p-4 text-background">
        <p className="text-sm font-semibold">支付成功，卡密已到账</p>
        <p className="mt-0.5 text-xs text-background/70">请立即复制保存，或直接点下方按钮兑换。</p>
      </div>

      <div className="space-y-2">
        {codes.map((code, index) => (
          <div key={code} className="flex items-center gap-2 rounded-xl border border-border p-3">
            <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <code className="flex-1 font-mono text-base tracking-[0.12em] break-all select-all">{code}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
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

      <Button className="w-full" size="lg" disabled={redeeming || redeemed} onClick={onRedeem}>
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

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => {
            void copy(codes.join('\n'));
            toast.success('已复制全部卡密');
          }}
          className="hover:text-foreground"
        >
          复制全部
        </button>
        <button type="button" onClick={onBuyMore} className="hover:text-foreground">
          再买一张
        </button>
      </div>
    </div>
  );
}
