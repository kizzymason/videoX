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
  MineTab,
  ProfilePage,
} from './pages/MineTab';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SearchPage } from './pages/SearchPage';
import { prefetchWatchPage } from './lib/prefetch-watch';

const WatchPage = React.lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));

/** 详情 chunk 未到时不要整页铺黑，否则第一次点进会像 Shorts 全屏播放器。 */
function WatchRouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="pt-safe bg-black">
        <div className="aspect-video w-full bg-black" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/**
 * 顶/底安全区跟底栏同色。Shorts 进则暗、离则亮。
 * color-scheme 必须写进 stylesheet !important：useTheme 稍后会改 html 的 inline
 * color-scheme，浅色主题下 iOS/Chrome 会把状态栏画成白底。
 */
function applyChrome(dark: boolean, shorts: boolean) {
  const color = dark ? '#000000' : '#ffffff';
  const scheme = dark ? 'dark' : 'light';
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.style.backgroundColor = color;
  root.style.colorScheme = scheme;
  document.body.style.backgroundColor = color;
  const app = document.getElementById('root');
  if (app) app.style.backgroundColor = color;

  let paint = document.getElementById('vx-chrome-paint');
  if (!paint) {
    paint = document.createElement('style');
    paint.id = 'vx-chrome-paint';
    document.head.appendChild(paint);
  }
  paint.textContent = [
    `html,body,#root{background-color:${color}!important;color-scheme:${scheme}!important}`,
    '#vx-chrome-safe-top{position:fixed;top:0;left:0;right:0;z-index:9999;pointer-events:none;background:#000;height:constant(safe-area-inset-top);height:env(safe-area-inset-top,0px)}',
  ].join('');

  let safeTop = document.getElementById('vx-chrome-safe-top');
  if (!safeTop) {
    safeTop = document.createElement('div');
    safeTop.id = 'vx-chrome-safe-top';
    safeTop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(safeTop);
  }
  safeTop.style.display = shorts ? 'block' : 'none';

  document.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.remove());
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', color);
  document.head.appendChild(meta);

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
          ? 'flex min-h-0 flex-1 flex-col bg-black pb-[calc(3.5rem+env(safe-area-inset-bottom))]'
          : 'flex min-h-0 flex-1 flex-col bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))]'
      }
    >
      <div
        aria-hidden
        className={shorts ? 'pointer-events-none fixed inset-x-0 top-0 z-50' : 'pointer-events-none fixed inset-x-0 top-0 z-40 bg-background'}
        style={{
          height: 'env(safe-area-inset-top, 0px)',
          backgroundColor: shorts ? '#000000' : undefined,
        }}
      />
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

  React.useEffect(() => {
    track('pageview');
  }, [location.pathname]);

  const syncChrome = React.useCallback(() => {
    const shorts = location.pathname.startsWith('/shorts');
    const dark =
      shorts ||
      themeMode === 'dark' ||
      (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyChrome(dark, shorts);
  }, [location.pathname, themeMode]);

  React.useLayoutEffect(() => {
    syncChrome();
  }, [syncChrome]);

  // useTheme 在自己的 useEffect 里会把 color-scheme 改回用户主题，必须再盖一次。
  React.useEffect(() => {
    syncChrome();
  }, [syncChrome]);

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
        <Route path="register" element={<RegisterPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="watch/:idOrSlug"
          element={
            <React.Suspense fallback={<WatchRouteFallback />}>
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
