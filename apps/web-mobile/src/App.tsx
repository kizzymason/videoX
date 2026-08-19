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
import { ShortsTab } from './pages/ShortsTab';
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

const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

function applyChrome(dark: boolean) {
  const color = dark ? '#000000' : '#ffffff';
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  const root = document.getElementById('root');
  if (root) root.style.backgroundColor = color;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
  let apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (!apple) {
    apple = document.createElement('meta');
    apple.setAttribute('name', 'apple-mobile-web-app-status-bar-style');
    document.head.appendChild(apple);
  }
  apple.setAttribute('content', dark ? 'black-translucent' : 'default');
}

function TabLayout() {
  const { pathname } = useLocation();
  const shorts = pathname.startsWith('/shorts');
  return (
    <div
      className={
        shorts
          ? 'flex min-h-0 flex-1 flex-col bg-black'
          : 'flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]'
      }
    >
      <Outlet />
      <TabBar />
    </div>
  );
}

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

  React.useEffect(() => {
    const shorts = location.pathname.startsWith('/shorts');
    const dark =
      shorts ||
      document.documentElement.classList.contains('dark') ||
      themeMode === 'dark' ||
      (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyChrome(dark);
  }, [location.pathname, themeMode]);

  const { data: site } = useQuery({ queryKey: ['site'], queryFn: contentApi.site, staleTime: 10 * 60_000 });
  React.useEffect(() => {
    if (site && !localStorage.getItem('videox:theme')) setTheme(site.defaultTheme);
  }, [site, setTheme]);

  return (
    <Routes>
      <Route element={<TabLayout />}>
        <Route index element={<HomeTab />} />
        <Route path="shorts" element={<ShortsTab />} />
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
