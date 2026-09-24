import { cn } from '../lib/cn.js';

/**
 * 列表刷新进度条。切页签、翻页、下拉刷新时给一条会跑的细线，
 * 比只在角上转一个小圈更容易被注意到，也不会把已有卡片顶掉。
 * 占位高度常驻，出现与消失只动透明度，列表不会因此跳动。
 */
export function ListLoadingBar({ active, className }: { active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none block h-0.5 w-full overflow-hidden rounded-full transition-opacity duration-200',
        active ? 'vx-loading-bar bg-primary/15 opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}
