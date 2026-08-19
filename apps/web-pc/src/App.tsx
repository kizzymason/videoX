import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTheme, Skeleton } from '@videox/ui';
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
import { prefetchWatchPage } from './lib/prefetch-watch';
import { AuthGatePage } from './pages/AuthGatePage';

const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const ShortsPage = React.lazy(() => import('./pages/ShortsPage').then((m) => ({ default: m.ShortsPage })));

function WatchRouteFallback() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
      <div className="aspect-video w-full animate-pulse rounded-2xl bg-muted" />
      <div className="mt-5 h-6 w-2/3 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

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

  if (initializing) {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-4 px-6 py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return children;
}

function RequireMembershipAuth({ children }: { children: React.ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  if (initializing) return null;
  if (!user) return <Navigate to="/auth-required?redirect=/membership" replace />;
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
    const run = () => prefetchWatchPage();
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 400);
    return () => clearTimeout(id);
  }, []);

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
        <Route path="auth-required" element={<AuthGatePage />} />
        <Route
          path="shorts"
          element={
            <React.Suspense fallback={<div className="min-h-[60vh] bg-black" />}>
              <ShortsPage />
            </React.Suspense>
          }
        />
        <Route
          path="watch/:idOrSlug"
          element={
            <React.Suspense fallback={<WatchRouteFallback />}>
              <WatchPage />
            </React.Suspense>
          }
        />
        <Route path="channel/:username" element={<ChannelPage />} />
        <Route
          path="membership"
          element={
            <RequireMembershipAuth>
              <MembershipPage />
            </RequireMembershipAuth>
          }
        />
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
