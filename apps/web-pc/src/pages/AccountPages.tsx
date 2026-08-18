import * as React from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@videox/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Switch,
  Textarea,
  cn,
} from '@videox/ui';
import { ApiError, authApi } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { useSeo } from '../hooks/use-seo';
import { PageContainer, PageHeader } from '../components/Page';

// ---------------------------------------------------------------------------
// 登录 / 注册
// ---------------------------------------------------------------------------

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </span>
          <h1 className="pt-2 text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  useSeo({ title: '登录' });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);

  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);

  if (user) return <Navigate to={redirect} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(identifier.trim(), password, remember);
      toast.success('欢迎回来');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title="登录 videoX" subtitle="使用邮箱或用户名登录">
      <form onSubmit={submit} className="space-y-4">
        <Field label="邮箱或用户名" htmlFor="identifier">
          <Input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
            className="h-10"
          />
        </Field>
        <Field label="密码" htmlFor="password" error={error}>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="h-10"
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={remember} onCheckedChange={setRemember} />
          记住我 30 天
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? '登录中…' : '登录'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        还没有账号？
        <Link to={`/register?redirect=${encodeURIComponent(redirect)}`} className="ml-1 text-foreground hover:underline">
          注册
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  useSeo({ title: '注册' });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const user = useAuthStore((s) => s.user);
  const register = useAuthStore((s) => s.register);

  const [form, setForm] = React.useState({ email: '', username: '', password: '', displayName: '' });
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);

  if (user) return <Navigate to={redirect} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await register({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim() || undefined,
      });
      toast.success('注册成功');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout title="创建账号" subtitle="注册后即可评论、收藏与同步进度">
      <form onSubmit={submit} className="space-y-4">
        <Field label="邮箱" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            autoComplete="email"
            required
            className="h-10"
          />
        </Field>
        <Field label="用户名" htmlFor="username" required hint="3-24 个字符，仅支持字母、数字与下划线">
          <Input
            id="username"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            autoComplete="username"
            required
            className="h-10"
          />
        </Field>
        <Field label="昵称" htmlFor="displayName">
          <Input
            id="displayName"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="留空则使用用户名"
            className="h-10"
          />
        </Field>
        <Field label="密码" htmlFor="new-password" required hint="至少 8 位" error={error}>
          <Input
            id="new-password"
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
            required
            minLength={8}
            className="h-10"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? '注册中…' : '注册'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        已有账号？
        <Link to={`/login?redirect=${encodeURIComponent(redirect)}`} className="ml-1 text-foreground hover:underline">
          登录
        </Link>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// 个人中心
// ---------------------------------------------------------------------------

export function ProfilePage() {
  useSeo({ title: '个人中心' });
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const initializing = useAuthStore((s) => s.initializing);

  const [profile, setProfile] = React.useState({ displayName: '', bio: '', avatarUrl: '' });
  const [passwords, setPasswords] = React.useState({ currentPassword: '', newPassword: '' });

  React.useEffect(() => {
    if (user) {
      setProfile({ displayName: user.displayName, bio: user.bio ?? '', avatarUrl: user.avatarUrl ?? '' });
    }
  }, [user?.id]);

  const { data: sessions } = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: authApi.sessions,
    enabled: Boolean(user),
  });

  const profileMutation = useMutation({
    mutationFn: () =>
      authApi.updateProfile({
        displayName: profile.displayName,
        bio: profile.bio || null,
        avatarUrl: profile.avatarUrl || null,
      }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success('资料已更新');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '更新失败'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => authApi.changePassword(passwords),
    onSuccess: () => {
      toast.success('密码已修改，请重新登录');
      setPasswords({ currentPassword: '', newPassword: '' });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '修改失败'),
  });

  if (initializing) return null;
  if (!user) return <Navigate to="/login?redirect=/profile" replace />;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="个人中心" />

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={profile.avatarUrl || undefined} alt={user.displayName} />
              <AvatarFallback className="text-xl">{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{user.displayName}</p>
                {user.isVip ? <Badge variant="vip">VIP</Badge> : null}
                {user.role === 'admin' ? <Badge variant="secondary">管理员</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {user.email} · 注册于 {formatDate(user.createdAt)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="昵称" htmlFor="p-name">
              <Input
                id="p-name"
                value={profile.displayName}
                onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
              />
            </Field>
            <Field label="头像地址" htmlFor="p-avatar">
              <Input
                id="p-avatar"
                value={profile.avatarUrl}
                onChange={(e) => setProfile((p) => ({ ...p, avatarUrl: e.target.value }))}
                placeholder="https://"
              />
            </Field>
          </div>
          <Field label="个人简介" htmlFor="p-bio">
            <Textarea
              id="p-bio"
              value={profile.bio}
              onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
              maxLength={300}
              placeholder="介绍一下自己"
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending}>
              保存修改
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">修改密码</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="当前密码" htmlFor="cur-pass">
              <Input
                id="cur-pass"
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
              />
            </Field>
            <Field label="新密码" htmlFor="next-pass" hint="至少 8 位">
              <Input
                id="next-pass"
                type="password"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => passwordMutation.mutate()}
              disabled={passwordMutation.isPending || !passwords.currentPassword || passwords.newPassword.length < 8}
            >
              修改密码
            </Button>
          </div>
        </CardContent>
      </Card>

      {sessions && sessions.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">登录设备</h2>
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.userAgent || '未知设备'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDate(session.createdAt, true)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export function SettingsPage() {
  useSeo({ title: '设置' });
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const autoplayNext = useUiStore((s) => s.autoplayNext);
  const setAutoplayNext = useUiStore((s) => s.setAutoplayNext);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="设置" />

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">外观</h2>
          <div className="grid grid-cols-3 gap-3">
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
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors',
                  theme === value
                    ? 'border-foreground/30 bg-accent font-medium'
                    : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">播放</h2>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <div>
              <p className="text-sm">自动连播</p>
              <p className="text-xs text-muted-foreground">播放结束后自动跳到相关推荐的第一个视频</p>
            </div>
            <Switch checked={autoplayNext} onCheckedChange={setAutoplayNext} />
          </label>
        </CardContent>
      </Card>

      {user ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-semibold">退出登录</p>
              <p className="text-xs text-muted-foreground">当前账号：{user.email}</p>
            </div>
            <Button variant="outline" onClick={() => void logout()}>
              退出
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="space-y-3">
        <p className="text-5xl font-semibold tracking-tight text-muted-foreground/40">404</p>
        <p className="text-sm text-muted-foreground">页面不存在或已被移除</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/">返回首页</Link>
        </Button>
      </div>
    </div>
  );
}
