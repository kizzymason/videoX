import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, TrendingUp, X } from 'lucide-react';
import { cn, Skeleton, useDebouncedValue } from '@videox/ui';
import { formatCount } from '@videox/shared';
import { contentApi } from '../../lib/api';
import { track } from '../../lib/analytics';

export function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const debounced = useDebouncedValue(value.trim(), 220);

  const { data: suggestions, isFetching: suggesting } = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: () => contentApi.suggest(debounced),
    enabled: open && debounced.length > 0,
    staleTime: 60_000,
  });

  const { data: hot, isFetching: hotFetching } = useQuery({
    queryKey: ['hot-keywords'],
    queryFn: contentApi.hotKeywords,
    enabled: open && debounced.length === 0,
    staleTime: 5 * 60 * 1000,
  });

  const flatOptions = React.useMemo(() => {
    if (debounced.length === 0) return (hot ?? []).map((keyword) => ({ kind: 'keyword' as const, keyword }));
    return [
      ...(suggestions?.videos ?? []).map((v) => ({ kind: 'video' as const, video: v })),
      ...(suggestions?.tags ?? []).map((t) => ({ kind: 'tag' as const, tag: t })),
    ];
  }, [debounced, hot, suggestions]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const submit = (keyword: string) => {
    const q = keyword.trim();
    if (!q) return;
    track('search', { keyword: q });
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const choose = (index: number) => {
    const option = flatOptions[index];
    if (!option) {
      submit(value);
      return;
    }
    if (option.kind === 'keyword') submit(option.keyword);
    else if (option.kind === 'tag') submit(option.tag.name);
    else {
      setOpen(false);
      navigate(`/watch/${option.video.id}`);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(flatOptions.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索视频、标签、创作者"
          aria-label="搜索"
          className="h-10 w-full rounded-full border border-input bg-muted/60 pr-9 pl-9 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:bg-background focus:ring-[3px] focus:ring-ring/15"
        />
        {value ? (
          <button
            type="button"
            aria-label="清空"
            onClick={() => {
              setValue('');
              setActiveIndex(-1);
            }}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {open && (flatOptions.length > 0 || (debounced.length > 0 && suggesting && !suggestions) || (debounced.length === 0 && hotFetching && !hot)) ? (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-pop duration-200 animate-in fade-in-0 zoom-in-95">
          {debounced.length > 0 && suggesting && !suggestions ? (
            <div className="space-y-2 px-3 py-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <>
              {debounced.length === 0 ? (
                <p className="px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                  热门搜索
                </p>
              ) : null}
              {flatOptions.map((option, index) => (
                <button
                  key={
                    option.kind === 'keyword'
                      ? `k-${option.keyword}`
                      : option.kind === 'tag'
                        ? `t-${option.tag.slug}`
                        : `v-${option.video.id}`
                  }
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-200',
                    index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  {option.kind === 'keyword' ? (
                    <>
                      <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{option.keyword}</span>
                    </>
                  ) : option.kind === 'tag' ? (
                    <>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        标签
                      </span>
                      <span className="truncate">{option.tag.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatCount(option.tag.videoCount)}
                      </span>
                    </>
                  ) : (
                    <>
                      {option.video.posterUrl ? (
                        <img
                          src={option.video.posterUrl}
                          alt=""
                          className="h-8 w-14 shrink-0 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="h-8 w-14 shrink-0 rounded bg-muted" />
                      )}
                      <span className="truncate">{option.video.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatCount(option.video.viewCount)} 播放
                      </span>
                    </>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
