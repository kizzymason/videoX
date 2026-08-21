import * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ExternalLink, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  cn,
} from '@videox/ui';
import { NAV_GROUPS, Sidebar } from './Sidebar';
import { useAuthStore } from '../../stores/auth';
import { useUiStore } from '../../stores/ui';

function useCurrentTitle(): string {
  const { pathname } = useLocation();
  return React.useMemo(() => {
    const all = NAV_GROUPS.flatMap((g) => g.items);
    // 最长前缀优先，/videos/xxx 也能落到「视频管理」。
    const hit = all
      .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return hit?.label ?? '管理后台';
  }, [pathname]);
}

export function AppShell() {
  const { pathname } = useLocation();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const title = useCurrentTitle();

  React.useEffect(() => {
    document.title = `${title} · PandaGV 管理后台`;
  }, [title]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border transition-[width] duration-200 lg:block',
          collapsed ? 'w-[3.75rem]' : 'w-56',
        )}
      >
        <Sidebar collapsed={collapsed} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="sr-only">导航</SheetTitle>
          <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn('flex min-w-0 flex-1 flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[3.75rem]' : 'lg:pl-56')}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-lg sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="菜单">
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleSidebar}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>

          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>

          <Button variant="ghost" size="icon" asChild aria-label="打开前台">
            <a href="http://localhost:5173" target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="切换主题"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ml-0.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8">
                  <AvatarFallback>{(user?.displayName ?? 'A').slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{user?.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">站点设置</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
