import type * as React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  Clock,
  Compass,
  Flame,
  Heart,
  Home,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@videox/ui';
import { contentApi } from '../../lib/api';
import { useUiStore } from '../../stores/ui';
import { useAuthStore } from '../../stores/auth';

const PRIMARY_NAV = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/explore', label: '发现', icon: Compass },
  { to: '/categories', label: '分类', icon: LayoutGrid },
];

const PERSONAL_NAV = [
  { to: '/following', label: '关注', icon: Users },
  { to: '/history', label: '历史', icon: Clock },
  { to: '/favorites', label: '收藏', icon: Heart },
];

/**
 * 左侧边栏。折叠后图标在 64px 宽里水平居中，跟顶栏折叠按钮对齐。
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: contentApi.categories,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <aside
      className={cn(
        'vx-chrome-sidebar fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out-quint',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-0' : 'gap-2 px-4')}>
        {!collapsed ? (
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            videoX
          </Link>
        ) : null}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className={cn(
            'grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            !collapsed && 'ml-auto',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className={cn('scrollbar-thin flex-1 overflow-y-auto pb-4', collapsed ? 'px-0' : 'px-2')}>
        <Section collapsed={collapsed}>
          {PRIMARY_NAV.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
        </Section>

        {user ? (
          <Section title="我的" collapsed={collapsed}>
            {PERSONAL_NAV.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
          </Section>
        ) : null}

        {!collapsed && categories && categories.length > 0 ? (
          <Section title="频道" collapsed={collapsed}>
            {categories.slice(0, 12).map((category) => (
              <NavLink
                key={category.id}
                to={`/category/${category.slug}`}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                    isActive
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-foreground transition-opacity duration-200',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{category.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{category.videoCount}</span>
                  </>
                )}
              </NavLink>
            ))}
          </Section>
        ) : null}
      </nav>

      <div className={cn('border-t border-sidebar-border', collapsed ? 'p-0 py-2' : 'p-2')}>
        <NavItem to="/membership" label="开通会员" icon={Flame} collapsed={collapsed} />
        <NavItem to="/settings" label="设置" icon={Settings} collapsed={collapsed} />
      </div>
    </aside>
  );
}

function Section({
  title,
  collapsed,
  children,
}: {
  title?: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      {title && !collapsed ? (
        <p className="px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          {title}
        </p>
      ) : null}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  end,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  end?: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'relative flex w-full items-center rounded-lg text-sm transition-colors duration-200',
          collapsed ? 'h-10 justify-center px-0' : 'gap-3 px-3 py-2',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-foreground transition-opacity duration-200',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Icon className="size-[18px] shrink-0" />
          {!collapsed ? <span className="truncate">{label}</span> : null}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
