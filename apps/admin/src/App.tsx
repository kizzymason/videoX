import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner, useTheme } from '@videox/ui';
import { useAuthStore } from './stores/auth';
import { useUiStore } from './stores/ui';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { VideosPage } from './pages/VideosPage';
import { ShortsPage } from './pages/ShortsPage';
import { TranscodePage } from './pages/TranscodePage';
import { CommentsPage } from './pages/CommentsPage';
import { CategoriesPage, TagsPage } from './pages/CategoriesPage';
import { BannersPage } from './pages/BannersPage';
import { PlansPage } from './pages/PlansPage';
import { RedeemCodesPage } from './pages/RedeemCodesPage';
import { OrdersPage } from './pages/OrdersPage';
import { UsersPage } from './pages/UsersPage';
import { StoragePage } from './pages/StoragePage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { CollectionPoolPage } from './pages/CollectionPoolPage';
import { CollectionDashboardPage } from './pages/CollectionDashboardPage';
import { CollectionVideosPage } from './pages/CollectionVideosPage';
import { CollectionTasksPage } from './pages/CollectionTasksPage';
import { CollectionSettingsPage } from './pages/CollectionSettingsPage';

// recharts 与 hash-wasm 都是重依赖，拆出去让登录页和常规列表页不必为它们买单。
const lazyPage = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, key: K) =>
  React.lazy(() => loader().then((m) => ({ default: m[key] })));

const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const InsightsPage = lazyPage(() => import('./pages/InsightsPage'), 'InsightsPage');
const RecommendPage = lazyPage(() => import('./pages/RecommendPage'), 'RecommendPage');
const UploadPage = lazyPage(() => import('./pages/UploadPage'), 'UploadPage');

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const theme = useUiStore((s) => s.theme);
  const { setMode } = useTheme(theme);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  React.useEffect(() => {
    setMode(theme);
  }, [theme, setMode]);

  if (initializing) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return <LoginPage />;

  return (
    <React.Suspense
      fallback={
        <div className="grid min-h-screen place-items-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      }
    >
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="videos" element={<VideosPage />} />
          <Route path="shorts" element={<ShortsPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="transcode" element={<TranscodePage />} />
          <Route path="comments" element={<CommentsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="banners" element={<BannersPage />} />
          <Route path="recommend" element={<RecommendPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="redeem-codes" element={<RedeemCodesPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="collection/dashboard" element={<CollectionDashboardPage />} />
          <Route path="collection/pools" element={<CollectionPoolPage />} />
          <Route path="collection/videos" element={<CollectionVideosPage />} />
          <Route path="collection/tasks" element={<CollectionTasksPage />} />
          <Route path="collection/settings" element={<CollectionSettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </React.Suspense>
  );
}
