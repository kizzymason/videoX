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
  return (
    <div className="flex items-center gap-6">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'relative pb-2 text-sm transition-colors duration-150',
            value === option
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LABELS[option] ?? option}
          {value === option ? (
            <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
