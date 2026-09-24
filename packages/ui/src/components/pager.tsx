import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { useMediaQuery } from '../hooks.js';

export interface ListPagerMeta {
  page: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

function pageWindow(current: number, total: number, span: number): number[] {
  if (total <= span) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(span / 2);
  const start = Math.max(1, Math.min(current - half, total - span + 1));
  return Array.from({ length: span }, (_, i) => start + i);
}

/** 翻页后回到列表顶部：优先滚最近的可滚动祖先（移动端是 .tab-scroll），否则滚窗口。 */
function scrollListToTop(from: HTMLElement | null) {
  let node = from?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) {
      node.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 列表分页条。整体居中、按钮做到手指能点的尺寸，不显示总条数与页码统计。
 * 当前页用一枚滑动的药丸标记，切页时平移过去；窄屏少显示两个页码，免得挤成两行。
 */
export function ListPager({
  meta,
  page,
  onChange,
  busy,
  className,
}: {
  meta: ListPagerMeta | undefined;
  page: number;
  onChange: (page: number) => void;
  busy?: boolean;
  className?: string;
}) {
  const wide = useMediaQuery('(min-width: 640px)');
  // 手机屏 5 个页码刚好一行（44+40×5+44 ≈ 328），再窄就降到 3 个，免得换行。
  const roomy = useMediaQuery('(min-width: 360px)');
  const navRef = React.useRef<HTMLElement | null>(null);
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = React.useState({ left: 0, width: 0, visible: false });

  const totalPages = Math.max(1, meta?.totalPages ?? 1);
  const span = roomy ? 5 : 3;
  const pages = pageWindow(page, totalPages, span);
  const showEdges = wide && totalPages > span;

  React.useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const active = group.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setPill((prev) => ({ ...prev, visible: false }));
      return;
    }
    setPill({ left: active.offsetLeft, width: active.offsetWidth, visible: true });
  }, [page, totalPages, span, showEdges]);

  if (!meta || meta.total === 0) return null;
  if (totalPages <= 1 && !meta.hasMore) return null;

  const go = (next: number) => {
    const safe = Math.min(Math.max(1, next), totalPages);
    if (safe === page) return;
    onChange(safe);
    scrollListToTop(navRef.current);
  };

  return (
    <nav
      ref={navRef}
      aria-label="分页"
      aria-busy={busy || undefined}
      className={cn('flex items-center justify-center gap-2 py-7 select-none', className)}
    >
      <PagerArrow disabled={page <= 1} onClick={() => go(page - 1)} label="上一页">
        <ChevronLeft className="size-5" />
      </PagerArrow>

      <div
        ref={groupRef}
        className="relative flex items-center gap-1 rounded-2xl border border-border bg-card/70 p-1"
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1 bottom-1 rounded-xl bg-foreground shadow-sm transition-[left,width,opacity] duration-300 ease-out-quint',
            pill.visible ? 'opacity-100' : 'opacity-0',
            busy && 'animate-pulse',
          )}
          style={{ left: pill.left, width: pill.width }}
        />
        {showEdges && pages[0]! > 1 ? (
          <>
            <PagerNumber active={page === 1} onClick={() => go(1)}>
              1
            </PagerNumber>
            {pages[0]! > 2 ? <PagerGap /> : null}
          </>
        ) : null}

        {pages.map((n) => (
          <PagerNumber key={n} active={n === page} onClick={() => go(n)}>
            {n}
          </PagerNumber>
        ))}

        {showEdges && pages[pages.length - 1]! < totalPages ? (
          <>
            {pages[pages.length - 1]! < totalPages - 1 ? <PagerGap /> : null}
            <PagerNumber active={page === totalPages} onClick={() => go(totalPages)}>
              {totalPages}
            </PagerNumber>
          </>
        ) : null}
      </div>

      <PagerArrow
        disabled={page >= totalPages && !meta.hasMore}
        onClick={() => go(page + 1)}
        label="下一页"
      >
        <ChevronRight className="size-5" />
      </PagerArrow>
    </nav>
  );
}

function PagerArrow({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'vx-press no-tap-highlight grid size-11 shrink-0 place-items-center rounded-2xl border border-border bg-card/70 text-foreground transition-colors duration-200',
        'hover:bg-accent disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function PagerNumber({
  active,
  className,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-active={active}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'vx-press no-tap-highlight relative z-10 grid h-9 min-w-10 place-items-center rounded-xl px-2 text-[15px] tabular-nums transition-colors duration-200 sm:min-w-11',
        active ? 'font-semibold text-background' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function PagerGap() {
  return (
    <span aria-hidden className="grid h-9 w-5 place-items-center text-muted-foreground/60">
      ···
    </span>
  );
}
