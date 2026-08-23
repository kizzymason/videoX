import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LayoutGrid, UserRound, Users } from 'lucide-react';
import { partnerLevelLabel } from '@videox/shared';
import { Skeleton, cn } from '@videox/ui';
import { partnerApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { timeGreeting } from '../lib/greeting';
import { todayLabel } from '../lib/format';
import { InitialAvatar } from './primitives';

const TABS = [
  { to: '/', label: '总览', icon: LayoutGrid, end: true },
  { to: '/customers', label: '客户', icon: Users },
  { to: '/codes', label: '订阅', icon: KeyRound },
  { to: '/me', label: '我的', icon: UserRound },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [scrolled, setScrolled] = React.useState(false);
  const me = useQuery({ queryKey: ['partner-me'], queryFn: partnerApi.me });
  const greeting = React.useMemo(() => timeGreeting(), []);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 切页时回到顶部，否则从长列表跳到总览会停在半空。
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="pt-shell">
      <header className="pt-topbar" data-scrolled={scrolled}>
        <div className="flex items-center gap-3">
          <InitialAvatar name={user?.displayName ?? '合'} src={user?.avatarUrl} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight">
              {greeting.hello}，{user?.displayName ?? '合伙人'}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{todayLabel()}</p>
          </div>
          <span className="pt-chip shrink-0 border-primary/15 bg-primary text-primary-foreground">
            {me.data ? partnerLevelLabel(me.data.level) : '合伙人'}
          </span>
        </div>
      </header>

      <main className="pt-main">
        {/* 页面按路由懒加载，占位放在外壳内部，切页时顶栏和底栏保持不动。 */}
        <React.Suspense fallback={<PagePlaceholder />}>
          <div key={location.pathname} className="pt-enter">
            <Outlet />
          </div>
        </React.Suspense>
      </main>

      <nav className="pt-nav">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'no-tap-highlight flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid h-7 w-12 place-items-center rounded-full transition-colors duration-200',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-transparent',
                  )}
                >
                  <tab.icon className="size-[18px]" />
                </span>
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function PagePlaceholder() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-44 w-full rounded-[calc(var(--radius)+4px)]" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-[calc(var(--radius)+4px)]" />
        <Skeleton className="h-24 rounded-[calc(var(--radius)+4px)]" />
      </div>
      <Skeleton className="h-56 w-full rounded-[calc(var(--radius)+4px)]" />
    </div>
  );
}
