import * as React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@videox/ui';
import { contentApi } from './lib/api';
import { track } from './lib/analytics';
import { useAuthStore } from './stores/auth';
import { useUiStore } from './stores/ui';
import { TabBar } from './components/TabBar';
import { HomeTab } from './pages/HomeTab';
import { CategoriesTab, CategoryPage, ChannelPage } from './pages/CategoriesTab';
import { SubscribeTab } from './pages/SubscribeTab';
import {
  FavoritesPage,
  FollowingPage,
  HistoryPage,
  LoginPage,
  MineTab,
  ProfilePage,
} from './pages/MineTab';
import { SearchPage } from './pages/SearchPage';

// 播放页独占 hls.js，懒加载让四个 Tab 的首屏不用等它。
const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

/** 带底部 Tab 的四个主页面。 */
function TabLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <Outlet />
      <TabBar />
    </div>
  );
}

/** 二级页面：无 Tab，占满全屏。 */
function StackLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  if (initializing) return null;
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function App() {
  const location = useLocation();
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const themeMode = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { setMode } = useTheme(themeMode);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  React.useEffect(() => {
    setMode(themeMode);
  }, [themeMode, setMode]);

  React.useEffect(() => {
    track('pageview');
  }, [location.pathname]);

  const { data: site } = useQuery({ queryKey: ['site'], queryFn: contentApi.site, staleTime: 10 * 60_000 });
  React.useEffect(() => {
    if (site && !localStorage.getItem('videox:theme')) setTheme(site.defaultTheme);
  }, [site, setTheme]);

  return (
    <Routes>
      <Route element={<TabLayout />}>
        <Route index element={<HomeTab />} />
        <Route path="categories" element={<CategoriesTab />} />
        <Route path="subscribe" element={<SubscribeTab />} />
        <Route path="mine" element={<MineTab />} />
      </Route>

      <Route element={<StackLayout />}>
        <Route path="search" element={<SearchPage />} />
        <Route path="category/:slug" element={<CategoryPage />} />
        <Route path="channel/:username" element={<ChannelPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="watch/:idOrSlug"
          element={
            <React.Suspense fallback={<div className="flex-1 bg-black" />}>
              <WatchPage />
            </React.Suspense>
          }
        />
        <Route
          path="history"
          element={
            <RequireAuth>
              <HistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="favorites"
          element={
            <RequireAuth>
              <FavoritesPage />
            </RequireAuth>
          }
        />
        <Route
          path="following"
          element={
            <RequireAuth>
              <FollowingPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
