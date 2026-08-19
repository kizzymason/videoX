import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  cn,
} from '@videox/ui';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { SlideCaptcha } from './SlideCaptcha';

export function AuthModal() {
  const navigate = useNavigate();
  const open = useAuthModalStore((s) => s.open);
  const mode = useAuthModalStore((s) => s.mode);
  const redirect = useAuthModalStore((s) => s.redirect);
  const closeAuth = useAuthModalStore((s) => s.closeAuth);
  const setMode = useAuthModalStore((s) => s.setMode);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [identifier, setIdentifier] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [captchaKey, setCaptchaKey] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setPassword('');
    setShowPassword(false);
    setPending(false);
    setCaptchaKey((k) => k + 1);
  }, [open, mode]);

  React.useEffect(() => {
    if (open && user) closeAuth();
  }, [open, user, closeAuth]);

  const finish = () => {
    closeAuth();
    const target = redirect || '/';
    if (target !== `${location.pathname}${location.search}` && target !== location.pathname) {
      navigate(target, { replace: true });
    }
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(identifier.trim(), password, remember);
      toast.success('欢迎回来');
      finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setPending(false);
    }
  };

  const submitRegister = async () => {
    setError('');
    if (!username.trim() || password.length < 8) {
      setError('请填写用户名和至少 8 位密码');
      setCaptchaKey((k) => k + 1);
      throw new Error('invalid');
    }
    try {
      await register({ username: username.trim(), password });
      toast.success('注册成功');
      finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
      setCaptchaKey((k) => k + 1);
      throw err;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeAuth()}>
      <DialogContent className="w-full gap-5 bg-background p-8 sm:max-w-[400px]" showClose>
        <DialogTitle className="sr-only">{mode === 'login' ? '登录' : '注册'}</DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'login' ? '使用用户名登录 videoX' : '使用用户名注册 videoX'}
        </DialogDescription>

        <p className="text-center text-2xl font-semibold tracking-tight">videoX</p>

        <div className="flex justify-center gap-8 border-b border-border">
          {(
            [
              { key: 'login', label: '登录' },
              { key: 'register', label: '注册' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                'relative -mb-px px-1 pb-2.5 text-sm transition-colors',
                mode === tab.key ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {mode === tab.key ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />
              ) : null}
            </button>
          ))}
        </div>

        {mode === 'login' ? (
          <form onSubmit={submitLogin} className="space-y-4">
            <Field label="用户名" htmlFor="vx-login-user">
              <Input
                id="vx-login-user"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                required
                className="h-10"
              />
            </Field>
            <Field label="密码" htmlFor="vx-login-pass" error={error}>
              <PasswordInput
                id="vx-login-pass"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                show={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
              记住我 30 天
            </label>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? '登录中…' : '登录'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              还没有账号？
              <button type="button" onClick={() => setMode('register')} className="ml-1 text-foreground hover:underline">
                切换到注册
              </button>
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <Field label="用户名" htmlFor="vx-reg-user" hint="3-24 个字符，仅支持字母、数字与下划线">
              <Input
                id="vx-reg-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                required
                className="h-10"
              />
            </Field>
            <Field label="密码" htmlFor="vx-reg-pass" hint="至少 8 位" error={error}>
              <PasswordInput
                id="vx-reg-pass"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                show={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </Field>
            <SlideCaptcha key={captchaKey} onComplete={submitRegister} disabled={pending} />
            <p className="text-center text-sm text-muted-foreground">
              已有账号？
              <button type="button" onClick={() => setMode('login')} className="ml-1 text-foreground hover:underline">
                切换到登录
              </button>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  show,
  onToggle,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="请输入密码"
        autoComplete={autoComplete}
        required
        className="h-10 pr-10"
      />
      <button
        type="button"
        aria-label={show ? '隐藏密码' : '显示密码'}
        onClick={onToggle}
        className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
