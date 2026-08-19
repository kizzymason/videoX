import type * as React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Clapperboard, Flame, House, User, type LucideProps } from 'lucide-react';
import { cn } from '@videox/ui';

type Tab = { to: string; label: string; icon: React.ComponentType<LucideProps>; end?: boolean };

const TABS: Tab[] = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/shorts', label: 'Shorts', icon: Clapperboard },
  { to: '/subscribe', label: '订阅', icon: Flame },
  { to: '/mine', label: '我的', icon: User },
];

/** 实色底栏。Shorts 暗、离开回亮，铺满底部安全区。始终挂载，栈页只滑出不卸载。 */
export function TabBar({ tucked = false }: { tucked?: boolean }) {
  const { pathname } = useLocation();
  const dark = pathname === '/shorts' || pathname.startsWith('/shorts/');

  return (
    <nav
      className={cn(
        'pb-safe fixed inset-x-0 bottom-0 z-40 border-t transition-transform duration-200 ease-out-quint',
        dark ? 'border-white/10 bg-black' : 'border-border bg-background',
        tucked && 'pointer-events-none translate-y-full',
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
                'vx-press no-tap-highlight flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-200 ease-out-quint',
                dark
                  ? isActive
                    ? 'bg-white/5 text-white'
                    : 'text-white/45 active:bg-white/10'
                  : isActive
                    ? 'bg-accent/80 text-foreground'
                    : 'text-muted-foreground active:bg-accent',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('size-[22px] transition-transform duration-200 ease-out-quint', isActive && 'scale-105')}
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
