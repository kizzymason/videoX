import { NavLink, Link } from 'react-router-dom';
import {
  Clock,
  Compass,
  Crown,
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
 * 左侧边栏。参考 ChatGPT / Claude 的处理：固定宽度、无阴影、只用 1px 分隔线，
 * 折叠后只留图标并靠 tooltip 补齐语义。
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
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out-quint',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2', collapsed ? 'justify-center px-2' : 'px-4')}>
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

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
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
                    'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )
                }
              >
                <span className="truncate">{category.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{category.videoCount}</span>
              </NavLink>
            ))}
          </Section>
        ) : null}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <NavItem to="/membership" label="开通会员" icon={Crown} collapsed={collapsed} accent />
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
  accent,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  end?: boolean;
  accent?: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          accent && 'text-vip hover:text-vip',
        )
      }
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
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
