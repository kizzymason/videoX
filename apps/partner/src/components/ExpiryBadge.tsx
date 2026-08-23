import { cn } from '@videox/ui';

export function ExpiryBadge({
  vipExpiresAt,
  isExpired,
  daysRemaining,
}: {
  vipExpiresAt: string | null;
  isExpired: boolean;
  daysRemaining: number;
}) {
  if (!vipExpiresAt || isExpired) {
    return <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">已到期</span>;
  }
  if (daysRemaining <= 7) {
    return (
      <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
        {daysRemaining} 天后到期
      </span>
    );
  }
  return (
    <span className={cn('rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-medium text-emerald-300')}>
      剩 {daysRemaining} 天
    </span>
  );
}
