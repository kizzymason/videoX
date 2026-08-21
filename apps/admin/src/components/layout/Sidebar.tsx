import type * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  Clapperboard,
  CreditCard,
  Film,
  Gauge,
  Image,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  ListTree,
  MessageSquare,
  ReceiptText,
  RectangleVertical,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Upload,
  Users,
  Video,
  type LucideProps,
} from 'lucide-react';
import { cn } from '@videox/ui';

type Item = { to: string; label: string; icon: React.ComponentType<LucideProps>; end?: boolean };
type Group = { title: string; items: Item[] };

export const NAV_GROUPS: Group[] = [
  {
    title: '概览',
    items: [
      { to: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
      { to: '/insights', label: '访客洞察', icon: BarChart3 },
    ],
  },
  {
    title: '内容',
    items: [
      { to: '/videos', label: '视频管理', icon: Film },
      { to: '/shorts', label: 'Shorts', icon: RectangleVertical },
      { to: '/upload', label: '视频上传', icon: Upload },
      { to: '/transcode', label: '转码队列', icon: Clapperboard },
      { to: '/comments', label: '评论审核', icon: MessageSquare },
    ],
  },
  {
    title: '运营',
    items: [
      { to: '/categories', label: '频道分类', icon: ListTree },
      { to: '/tags', label: '标签', icon: Tags },
      { to: '/banners', label: '轮播管理', icon: Image },
      { to: '/recommend', label: '推荐引擎', icon: Sparkles },
    ],
  },
  {
    title: '会员',
    items: [
      { to: '/plans', label: '套餐管理', icon: CreditCard },
      { to: '/redeem-codes', label: '卡密管理', icon: KeyRound },
      { to: '/orders', label: '订单流水', icon: ReceiptText },
    ],
  },
  {
    title: '采集系统',
    items: [
      { to: '/collection/dashboard', label: '采集总览', icon: Activity },
      { to: '/collection/pools', label: '账号管理', icon: Users },
      { to: '/collection/videos', label: '采集视频', icon: Video },
      { to: '/collection/tasks', label: '采集任务', icon: ListTodo },
      { to: '/collection/ai', label: 'AI 维护', icon: Bot },
      { to: '/collection/settings', label: '采集设置', icon: SlidersHorizontal },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/users', label: '用户管理', icon: Users },
      { to: '/storage', label: '存储配置', icon: Boxes },
      { to: '/settings', label: '站点设置', icon: Settings },
      { to: '/audit-logs', label: '操作审计', icon: ScrollText },
    ],
  },
];

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <Gauge className="size-4" />
          </span>
          {!collapsed ? (
            <span className="truncate text-sm font-semibold tracking-tight">
              PandaGV <span className="font-normal text-muted-foreground">Console</span>
            </span>
          ) : null}
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
                {group.title}
              </p>
            ) : (
              <div className="mx-2 mb-2 border-t border-sidebar-border first:border-0" />
            )}
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 items-center gap-2.5 rounded-lg text-[13px] transition-colors',
                      collapsed ? 'justify-center px-0' : 'px-2.5',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.9} />
                  {!collapsed ? <span className="truncate">{label}</span> : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
