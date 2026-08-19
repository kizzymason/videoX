import { Navigate, useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { LoggedOutGate } from '../components/LoggedOutGate';
import { useAuthStore } from '../stores/auth';

/** 移动端独立登录门禁；登录完成后回到触发操作的页面。 */
export function AuthGatePage() {
  const [params] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const requested = params.get('redirect');
  const redirect = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (user) return <Navigate to={redirect} replace />;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AppHeader back title="" />
      <LoggedOutGate subtitle="登录后即可点赞、收藏，并同步你的观看记录" redirect={redirect} />
    </div>
  );
}
