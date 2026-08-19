import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { cn } from '@videox/ui';

export interface AppHeaderProps {
  title?: React.ReactNode;
  /** 显示返回箭头 */
  back?: boolean;
  showSearch?: boolean;
  right?: React.ReactNode;
  /** 透明模式用于叠在封面之上 */
  transparent?: boolean;
  className?: string;
}

export function AppHeader({ title, back, showSearch, right, transparent, className }: AppHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        'pt-safe sticky top-0 z-30',
        transparent ? 'bg-transparent' : 'border-b border-border bg-background',
        className,
      )}
    >
      <div className="flex h-12 items-center gap-1 px-2">
        {back ? (
          <button
            type="button"
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="vx-press no-tap-highlight grid size-9 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}

        {typeof title === 'string' ? (
          <h1 className={cn('truncate text-base font-semibold', back ? 'flex-1' : 'flex-1 px-2')}>{title}</h1>
        ) : (
          title
        )}

        {showSearch ? (
          <Link
            to="/search"
            aria-label="搜索"
            className="vx-press no-tap-highlight grid size-9 place-items-center rounded-full transition-colors duration-200 active:bg-accent"
          >
            <Search className="size-5" />
          </Link>
        ) : null}
        {right}
      </div>
    </header>
  );
}
