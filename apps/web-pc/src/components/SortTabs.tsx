import * as React from 'react';
import { SORT_OPTIONS, type SortOption } from '@videox/shared';
import { cn } from '@videox/ui';

const LABELS: Record<string, string> = {
  recommended: '推荐',
  latest: '最新',
  popular: '热门',
  most_liked: '好评',
  trending: '飙升',
  longest: '时长最长',
  shortest: '时长最短',
};

export function SortTabs({
  value,
  onChange,
  options = SORT_OPTIONS,
}: {
  value: string;
  onChange: (value: SortOption) => void;
  options?: readonly SortOption[] | SortOption[];
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = React.useState({ left: 0, width: 0 });

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) return;
    setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-6">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          data-active={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'relative pb-2 text-sm transition-colors duration-200',
            value === option ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LABELS[option] ?? option}
        </button>
      ))}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-foreground transition-[left,width] duration-200 ease-out-quint"
        style={{ left: bar.left, width: bar.width }}
      />
    </div>
  );
}
