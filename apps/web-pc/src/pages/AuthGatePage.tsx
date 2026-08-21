import * as React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@videox/ui';
import { useAuthStore } from '../stores/auth';
import { useAuthModalStore } from '../stores/auth-modal';
import { useSiteName } from '../hooks/use-site';

/** 保留 PC 顶栏和侧栏的内嵌登录门禁。 */
export function AuthGatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const initializing = useAuthStore((state) => state.initializing);
  const openAuth = useAuthModalStore((state) => state.openAuth);
  const siteName = useSiteName();
  const requested = params.get('redirect');
  const redirect = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  React.useEffect(() => {
    if (!initializing && user) navigate(redirect, { replace: true });
  }, [initializing, navigate, redirect, user]);

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] place-items-center px-8 py-16">
      <div className="flex max-w-xl flex-col items-center text-center">
        <div className="grid size-24 place-items-center rounded-3xl bg-muted">
          <LockKeyhole className="size-11 text-foreground" strokeWidth={1.7} />
        </div>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">登录后继续</h1>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
          登录或注册 {siteName}，即可开通会员、收藏喜欢的内容并同步观看记录。
        </p>
        <Button
          size="lg"
          className="mt-9 min-w-48 rounded-full text-base"
          onClick={() => openAuth('login', redirect)}
        >
          登录 / 注册
        </Button>
      </div>
    </div>
  );
}
