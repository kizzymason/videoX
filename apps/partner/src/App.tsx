import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@videox/ui';
import { useAuthStore } from './stores/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { CustomersPage } from './pages/CustomersPage';
import { CodesPage } from './pages/CodesPage';
import { MinePage } from './pages/MinePage';

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (initializing) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

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
