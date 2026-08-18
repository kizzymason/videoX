import * as React from 'react';
import { Gauge, LoaderCircle } from 'lucide-react';
import { Button, Field, Input } from '@videox/ui';
import { useAuthStore } from '../stores/auth';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(identifier.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-88">
        <div className="mb-7 flex flex-col items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-foreground text-background">
            <Gauge className="size-5" />
          </span>
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight">videoX 管理后台</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">使用管理员账号登录</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3.5 rounded-2xl border border-border bg-card p-5">
          <Field label="账号">
            <Input
              autoFocus
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="邮箱或用户名"
            />
          </Field>
          <Field label="密码" error={error ?? undefined}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending || !identifier.trim() || !password}>
            {pending ? <LoaderCircle className="animate-spin" /> : null}
            {pending ? '登录中…' : '登录'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          仅 admin 角色可进入。普通用户请访问{' '}
          <a href="http://localhost:5173" className="underline underline-offset-2 hover:text-foreground">
            前台站点
          </a>
          。
        </p>
      </div>
    </div>
  );
}
