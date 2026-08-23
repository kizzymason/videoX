import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@videox/ui';
import { useAuthStore } from './stores/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';

// 四个页面都要用图表库，登录态未确认前不该为它买单，统一按路由懒加载。
const OverviewPage = React.lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const CustomersPage = React.lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const CodesPage = React.lazy(() => import('./pages/CodesPage').then((m) => ({ default: m.CodesPage })));
const MinePage = React.lazy(() => import('./pages/MinePage').then((m) => ({ default: m.MinePage })));

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (initializing) return <FullscreenSpinner />;
  if (!user || user.role !== 'partner') return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="codes" element={<CodesPage />} />
        <Route path="me" element={<MinePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function FullscreenSpinner() {
  return (
    <div className="pt-shell grid min-h-dvh place-items-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}
