import * as React from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Input } from '@videox/ui';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { AppHeader } from '../components/AppHeader';
import { SiteFooter } from '../components/SiteFooter';
import { useSeo } from '../hooks/use-seo';
import { useSite, useSiteName } from '../hooks/use-site';

export function LoginPage() {
  useSeo({ title: '登录' });
  const siteName = useSiteName();
  const { data: site } = useSite();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/mine';
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);

  if (user) return <Navigate to={redirect} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(username.trim(), password, true);
      toast.success('欢迎回来');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AppHeader back />
      <form onSubmit={submit} className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">{siteName}</h1>
            <p className="text-sm text-muted-foreground">{site?.siteTagline || '登录后同步观看记录'}</p>
          </div>
          <div className="space-y-3">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              required
              className="h-12 rounded-xl"
            />
            <div className="space-y-2">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                autoComplete="current-password"
                required
                className="h-12 rounded-xl"
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
          </div>
          <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={pending}>
            {pending ? '登录中…' : '登录'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            还没有账号？
            <Link to={`/register?redirect=${encodeURIComponent(redirect)}`} className="ml-1 text-foreground hover:underline">
              注册
            </Link>
          </p>
        </div>
      </form>
      <SiteFooter />
    </div>
  );
}
