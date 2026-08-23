import * as React from 'react';
import { Handshake, LoaderCircle } from 'lucide-react';
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
    <div className="partner-shell grid min-h-dvh place-items-center px-5">
      <div className="w-full">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Handshake className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">合伙人控制台</h1>
          <p className="mt-1 text-sm text-muted-foreground">使用合伙人账号登录</p>
        </div>
        <form onSubmit={submit} className="space-y-3.5 rounded-3xl border border-border bg-card p-5">
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
            {pending ? '登录中…' : '进入控制台'}
          </Button>
        </form>
      </div>
    </div>
  );
}
