import { useNavigate } from 'react-router-dom';
import { Crown, LogOut, Monitor, Moon, Sun, User as UserIcon } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@videox/ui';
import { useAuthStore } from '../../stores/auth';
import { useAuthModalStore } from '../../stores/auth-modal';
import { useUiStore } from '../../stores/ui';
import { SearchBox } from './SearchBox';

export function Topbar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const logout = useAuthStore((s) => s.logout);
  const openAuth = useAuthModalStore((s) => s.openAuth);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background/85 px-6 backdrop-blur-md">
      <SearchBox className="max-w-xl flex-1" />

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border p-0.5">
          {(
            [
              { value: 'light', icon: Sun, label: '浅色' },
              { value: 'dark', icon: Moon, label: '深色' },
              { value: 'system', icon: Monitor, label: '跟随系统' },
            ] as const
          ).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => setTheme(value)}
              className={cn(
                'grid size-7 place-items-center rounded-md transition-colors',
                theme === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        {initializing ? (
          <div className="size-8 animate-pulse rounded-full bg-muted" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-2 rounded-full outline-none">
                <Avatar>
                  <AvatarImage src={user.avatarUrl ?? undefined} alt={user.displayName} />
                  <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{user.displayName}</span>
                  {user.isVip ? <Badge variant="vip">VIP</Badge> : null}
                </div>
                <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/profile')}>
                <UserIcon />
                个人中心
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/membership')}>
                <Crown />
                {user.isVip ? '续费会员' : '开通会员'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => openAuth('login', location.pathname)}>
              登录
            </Button>
            <Button size="sm" onClick={() => openAuth('register', location.pathname)}>
              注册
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
