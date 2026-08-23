import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Skeleton, cn } from '@videox/ui';
import type { Delta } from '../lib/format';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function DeltaChip({ delta, invert }: { delta: Delta | null; invert?: boolean }) {
  if (!delta) return null;
  const Icon = delta.up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        invert
          ? 'bg-white/12 text-white'
          : delta.up
            ? 'bg-up/10 text-up'
            : 'bg-down/10 text-down',
      )}
    >
      <Icon className="size-3" />
      {delta.text}
    </span>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  chart,
  loading,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  delta?: Delta | null;
  chart?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="pt-card overflow-hidden p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      )}
      <div className="mt-1 flex items-center gap-1.5">
        {delta ? <DeltaChip delta={delta} /> : null}
        {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {chart ? <div className="-mx-1 mt-2">{chart}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('pt-scroll-x', className)}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className="pt-chip no-tap-highlight vx-press"
          data-active={value === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyHint({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="pt-card grid place-items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[74px] w-full rounded-[calc(var(--radius)+4px)]" />
      ))}
    </div>
  );
}

/** 没有头像时用首字母占位，跟总站后台的处理一致。 */
export function InitialAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  if (src) {
    return <img src={src} alt={name} className={cn('size-9 shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[13px] font-medium text-secondary-foreground',
        className,
      )}
    >
      {initial}
    </span>
  );
}
