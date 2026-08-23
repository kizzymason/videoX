import * as React from 'react';
import { Handshake, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button, Field, Input } from '@videox/ui';
import { useAuthStore } from '../stores/auth';
import { timeGreeting } from '../lib/greeting';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const greeting = React.useMemo(() => timeGreeting(), []);

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
    <div className="pt-shell flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="pt-enter">
        <div className="mb-8">
          <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-card)]">
            <Handshake className="size-6" />
          </span>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">合伙人控制台</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {greeting.hello}，{greeting.line}
          </p>
        </div>

        <form onSubmit={submit} className="pt-card space-y-3.5 p-5">
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

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          仅限合伙人账号登录，普通账号请前往主站
        </p>
      </div>
    </div>
  );
}
