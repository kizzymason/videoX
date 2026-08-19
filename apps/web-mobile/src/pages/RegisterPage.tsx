import * as React from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Field, Input } from '@videox/ui';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { AppHeader } from '../components/AppHeader';
import { SlideCaptcha } from '../components/SlideCaptcha';
import { useSeo } from '../hooks/use-seo';

export function RegisterPage() {
  useSeo({ title: '注册' });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/mine';
  const user = useAuthStore((s) => s.user);
  const register = useAuthStore((s) => s.register);

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [captchaKey, setCaptchaKey] = React.useState(0);

  if (user) return <Navigate to={redirect} replace />;

  const submit = async () => {
    setError('');
    if (!username.trim() || password.length < 8) {
      setError('请填写用户名和至少 8 位密码');
      setCaptchaKey((k) => k + 1);
      throw new Error('invalid');
    }
    try {
      await register({ username: username.trim(), password });
      toast.success('注册成功');
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
      setCaptchaKey((k) => k + 1);
      throw err;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AppHeader back />
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">videoX</h1>
            <p className="text-sm text-muted-foreground">用户名即昵称，无需邮箱</p>
          </div>
          <div className="space-y-4">
            <Field label="用户名" htmlFor="vx-m-reg-user">
              <Input
                id="vx-m-reg-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                required
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label="密码" htmlFor="vx-m-reg-pass" hint="至少 8 位" error={error}>
              <div className="relative">
                <Input
                  id="vx-m-reg-pass"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="h-12 rounded-xl pr-11"
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <SlideCaptcha key={captchaKey} onComplete={submit} />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            已有账号？
            <Link to={`/login?redirect=${encodeURIComponent(redirect)}`} className="ml-1 text-foreground hover:underline">
              登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
