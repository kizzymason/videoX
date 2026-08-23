import { NavLink, Outlet } from 'react-router-dom';
import { KeyRound, LayoutDashboard, UserRound, Users } from 'lucide-react';
import { cn } from '@videox/ui';

const TABS = [
  { to: '/', label: '总览', icon: LayoutDashboard, end: true },
  { to: '/customers', label: '客户', icon: Users },
  { to: '/codes', label: '订阅', icon: KeyRound },
  { to: '/me', label: '我的', icon: UserRound },
];

export function AppShell() {
  return (
    <div className="partner-shell">
      <main className="partner-main">
        <Outlet />
      </main>
      <nav className="partner-nav grid grid-cols-4">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            <tab.icon className="size-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
