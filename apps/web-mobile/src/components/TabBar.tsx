import type * as React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Clapperboard, Crown, House, User, type LucideProps } from 'lucide-react';
import { cn } from '@videox/ui';

type Tab = { to: string; label: string; icon: React.ComponentType<LucideProps>; end?: boolean };

const TABS: Tab[] = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/shorts', label: 'Shorts', icon: Clapperboard },
  { to: '/subscribe', label: '订阅', icon: Crown },
  { to: '/mine', label: '我的', icon: User },
];

/** 实色底栏。Shorts 暗、离开回亮，铺满底部安全区。 */
export function TabBar() {
  const { pathname } = useLocation();
  const dark = pathname.startsWith('/shorts');

  return (
    <nav
      className={cn(
        'pb-safe fixed inset-x-0 bottom-0 z-40 border-t',
        dark ? 'border-white/10 bg-black' : 'border-border bg-background',
      )}
    >
      <div className="flex h-14 items-stretch">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'no-tap-highlight flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-150',
                dark
                  ? isActive
                    ? 'text-white'
                    : 'text-white/45'
                  : isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground',
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
