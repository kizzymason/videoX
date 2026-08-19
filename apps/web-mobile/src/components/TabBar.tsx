import type * as React from 'react';
import { NavLink } from 'react-router-dom';
import { Clapperboard, Crown, House, User, type LucideProps } from 'lucide-react';
import { cn } from '@videox/ui';

type Tab = { to: string; label: string; icon: React.ComponentType<LucideProps>; end?: boolean };

const TABS: Tab[] = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/shorts', label: 'Shorts', icon: Clapperboard },
  { to: '/subscribe', label: '订阅', icon: Crown },
  { to: '/mine', label: '我的', icon: User },
];

/** 全站统一亮色底栏，Shorts 也一样，铺满底部安全区。 */
export function TabBar() {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg">
      <div className="flex h-14 items-stretch">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'no-tap-highlight flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-150',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('size-[22px] transition-transform', isActive && 'scale-105')}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={cn('text-[10px]', isActive && 'font-medium')}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
