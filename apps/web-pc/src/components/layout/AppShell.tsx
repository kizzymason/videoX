import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn, TooltipProvider } from '@videox/ui';
import { useUiStore } from '../../stores/ui';
import { track } from '../../lib/analytics';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const location = useLocation();

  React.useEffect(() => {
    track('pageview');
    // 路由切换后滚回顶部，SPA 里不这么做会保留上一页的滚动位置。
    window.scrollTo({ top: 0 });
  }, [location.pathname, location.search]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'pl-16' : 'pl-60')}>
          <Topbar />
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
    </TooltipProvider>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-6 py-8 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2">
        <span>© {new Date().getFullYear()} videoX</span>
        <span className="text-muted-foreground/60">简约高级的视频平台</span>
      </div>
    </footer>
  );
}
