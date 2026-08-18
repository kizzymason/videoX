import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@videox/ui';
import { contentApi } from './lib/api';
import { useAuthStore } from './stores/auth';
import { useUiStore } from './stores/ui';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { CategoriesPage, CategoryPage, ExplorePage, SearchPage } from './pages/BrowsePages';
import { ChannelPage, FavoritesPage, FollowingPage, HistoryPage } from './pages/LibraryPages';
import { MembershipPage } from './pages/MembershipPage';
import { LoginPage, NotFoundPage, ProfilePage, RegisterPage, SettingsPage } from './pages/AccountPages';

// 播放页会把 hls.js（约 570KB）拖进依赖图，单独切出去，首页不必为它买单。
const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

/** 需要登录的页面统一在这里挡一道，未登录时带 redirect 跳登录页。 */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  if (initializing) return null;
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

export function App() {
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

  // 站点设置里的默认主题只在用户没自己选过时生效。
  const { data: site } = useQuery({ queryKey: ['site'], queryFn: contentApi.site, staleTime: 10 * 60_000 });
  React.useEffect(() => {
    if (!site) return;
    if (localStorage.getItem('videox:theme')) return;
    setTheme(site.defaultTheme);
  }, [site, setTheme]);

  React.useEffect(() => {
    if (site?.siteName) document.title = site.siteName;
  }, [site?.siteName]);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="category/:slug" element={<CategoryPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route
          path="watch/:idOrSlug"
          element={
            <React.Suspense fallback={<div className="min-h-[60vh]" />}>
              <WatchPage />
            </React.Suspense>
          }
        />
        <Route path="channel/:username" element={<ChannelPage />} />
        <Route path="membership" element={<MembershipPage />} />
        <Route path="settings" element={<SettingsPage />} />
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
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
  );
}
