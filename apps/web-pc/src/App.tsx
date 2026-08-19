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
import { AuthModal } from './components/AuthModal';
import { useAuthModalStore } from './stores/auth-modal';

const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

/** 需要登录的页面统一在这里挡一道，未登录时打开登录弹窗。 */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const openAuth = useAuthModalStore((s) => s.openAuth);

  React.useLayoutEffect(() => {
    if (!initializing && !user) {
      openAuth('login', `${location.pathname}${location.search}`);
    }
  }, [initializing, user, openAuth]);

  if (initializing) return null;
  if (!user) return <Navigate to="/" replace />;
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
    <>
      <AuthModal />
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
        <Route path="history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
        <Route path="favorites" element={<RequireAuth><FavoritesPage /></RequireAuth>} />
        <Route path="following" element={<RequireAuth><FollowingPage /></RequireAuth>} />
        <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
    </>
  );
}
