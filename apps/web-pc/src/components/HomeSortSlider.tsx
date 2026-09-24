import * as React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HOME_SORTS, parseHomeSort, type HomeSort } from '@videox/shared';
import { cn } from '@videox/ui';

const LABELS: Record<HomeSort, string> = {
  recommended: '推荐',
  latest: '最新',
  popular: '热门',
  most_liked: '好评',
};

export function HomeSortSlider() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const sort = location.pathname === '/' ? parseHomeSort(params.get('sort')) : null;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = React.useState({ left: 2, width: 0 });

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) {
      setBar({ left: 2, width: 0 });
      return;
    }
    setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [sort]);

  const select = (value: HomeSort) => {
    if (sort === value) return;
    const next = new URLSearchParams(location.pathname === '/' ? params : undefined);
    if (value === 'recommended') next.delete('sort');
    else next.set('sort', value);
    next.delete('page');
    const search = next.toString();
    navigate({ pathname: '/', search: search ? `?${search}` : '' }, { replace: location.pathname === '/' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      ref={rootRef}
      className="relative flex shrink-0 items-center rounded-lg border border-border bg-muted/50 p-0.5"
    >
      {HOME_SORTS.map((option) => (
        <button
          key={option}
          type="button"
          data-active={sort === option}
          onClick={() => select(option)}
          className={cn(
            'vx-press relative z-10 h-8 rounded-md px-3 text-sm transition-colors duration-200',
            sort === option ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LABELS[option]}
        </button>
      ))}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-md bg-background shadow-sm transition-[left,width] duration-200 ease-out-quint"
        style={{ left: bar.left, width: bar.width }}
      />
    </div>
  );
}
