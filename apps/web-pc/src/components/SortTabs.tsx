import { SORT_OPTIONS, type SortOption } from '@videox/shared';
import { cn } from '@videox/ui';

const LABELS: Record<SortOption, string> = {
  recommended: '推荐',
  latest: '最新',
  popular: '最热',
  trending: '飙升',
  most_liked: '最多点赞',
  longest: '时长最长',
  shortest: '时长最短',
};

export function SortTabs({ value, onChange }: { value: string; onChange: (value: SortOption) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {SORT_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm transition-colors',
            value === option
              ? 'bg-primary font-medium text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
