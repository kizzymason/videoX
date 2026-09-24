import { Infinity, Rows3 } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { useBrowseMode, type BrowseMode } from '../hooks.js';

export function BrowseModeToggle({
  siteDefault = 'paged',
  className,
}: {
  siteDefault?: BrowseMode;
  className?: string;
}) {
  const { mode, toggle } = useBrowseMode(siteDefault);
  const next = mode === 'paged' ? '无限流' : '分页';
  const Icon = mode === 'paged' ? Rows3 : Infinity;

  return (
    <button
      type="button"
      aria-label={`浏览模式：${mode === 'paged' ? '分页' : '无限流'}，点击切换为${next}`}
      title={mode === 'paged' ? '分页 · 点击切换无限流' : '无限流 · 点击切换分页'}
      onClick={toggle}
      className={cn(
        'vx-press no-tap-highlight grid size-9 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
