import * as React from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { cn, TooltipProvider } from '@videox/ui';
import { useUiStore } from '../../stores/ui';
import { track } from '../../lib/analytics';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { SiteFooter } from './SiteFooter';
import { disableNativeScrollRestoration, useScrollRestoration } from '../../lib/scroll-restore';

export function AppShell() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const location = useLocation();
  const navigationType = useNavigationType();
  const fullBleed = location.pathname.startsWith('/shorts');

  // 返回（POP）时不要跳顶，交给 scroll-restore 还原到离开时的位置。
  React.useEffect(() => {
    disableNativeScrollRestoration();
  }, []);
  useScrollRestoration();

  React.useEffect(() => {
    track('pageview');
    if (!fullBleed && navigationType !== 'POP') window.scrollTo({ top: 0 });
  }, [fullBleed, location.pathname, location.search, navigationType]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'pl-16' : 'pl-60')}>
          <Topbar />
          <main className={cn('flex-1', fullBleed && 'min-h-0 overflow-hidden')}>
            {fullBleed ? (
              <Outlet />
            ) : (
              <div key={location.pathname} className="vx-page-enter">
                <Outlet />
              </div>
            )}
          </main>
          {fullBleed ? null : <SiteFooter />}
        </div>
      </div>
    </TooltipProvider>
  );
}

