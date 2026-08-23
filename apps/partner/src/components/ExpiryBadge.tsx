import { cn } from '@videox/ui';

/**
 * 到期状态在客户列表里是最需要一眼看到的信息，所以用实心底色的胶囊，
 * 而不是灰底描边——亮色主题下低对比的标签很容易被整屏白色吃掉。
 */
export function ExpiryBadge({
  isExpired,
  daysRemaining,
  className,
}: {
  isExpired: boolean;
  daysRemaining: number;
  className?: string;
}) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums';

  if (isExpired) {
    return <span className={cn(base, 'bg-up/10 text-up', className)}>已到期</span>;
  }
  if (daysRemaining <= 7) {
    return (
      <span className={cn(base, 'bg-vip/20 text-vip-foreground', className)}>
        <span className="size-1.5 rounded-full bg-vip" />
        {daysRemaining} 天后到期
      </span>
    );
  }
  if (daysRemaining <= 30) {
    return <span className={cn(base, 'bg-muted text-foreground/70', className)}>剩 {daysRemaining} 天</span>;
  }
  return (
    <span className={cn(base, 'bg-down/10 text-down', className)}>
      <span className="size-1.5 rounded-full bg-down" />剩 {daysRemaining} 天
    </span>
  );
}
