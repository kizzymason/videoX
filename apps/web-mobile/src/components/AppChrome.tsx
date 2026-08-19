import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@videox/ui';
import { TabBar } from './TabBar';
import { HomeTab } from '../pages/HomeTab';
import { ShortsTab } from '../pages/ShortsTab';
import { CategoriesTab } from '../pages/CategoriesTab';
import { SubscribeTab } from '../pages/SubscribeTab';
import { MineTab } from '../pages/MineTab';

const TAB_PATHS = new Set(['/', '/shorts', '/categories', '/subscribe', '/mine']);

type TabId = 'home' | 'shorts' | 'categories' | 'subscribe' | 'mine';

function isTabPath(pathname: string) {
  return TAB_PATHS.has(pathname);
}

function tabFromPath(pathname: string): TabId {
  if (pathname === '/shorts') return 'shorts';
  if (pathname === '/categories') return 'categories';
  if (pathname === '/subscribe') return 'subscribe';
  if (pathname === '/mine') return 'mine';
  return 'home';
}

/**
 * 单一壳层：四个主 Tab + 分类页隐藏不卸载，栈页从右侧叠入。
 * TabBar 始终挂着，进播放/搜索等栈页时滑出而不是卸掉。
 */
export function AppChrome() {
  const { pathname } = useLocation();
  const onTab = isTabPath(pathname);
  const [lastTab, setLastTab] = React.useState<TabId>(() => (onTab ? tabFromPath(pathname) : 'home'));
  const currentTab = onTab ? tabFromPath(pathname) : lastTab;
  if (onTab && lastTab !== currentTab) setLastTab(currentTab);

  const onShorts = pathname === '/shorts';
  const isStack = !onTab;

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        onShorts ? 'bg-black' : 'bg-background',
        !isStack && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div
        aria-hidden
        className={
          onShorts
            ? 'pointer-events-none fixed inset-x-0 top-0 z-50'
            : 'pointer-events-none fixed inset-x-0 top-0 z-40 bg-background'
        }
        style={{
          height: 'env(safe-area-inset-top, 0px)',
          backgroundColor: onShorts ? '#000000' : undefined,
        }}
      />

      <div className="relative min-h-0 flex-1">
        <KeepAlivePane active={currentTab === 'home'}>
          <HomeTab />
        </KeepAlivePane>
        <KeepAlivePane active={onShorts} mode="hidden">
          <ShortsTab active={onShorts} />
        </KeepAlivePane>
        <KeepAlivePane active={currentTab === 'categories'}>
          <CategoriesTab />
        </KeepAlivePane>
        <KeepAlivePane active={currentTab === 'subscribe'}>
          <SubscribeTab />
        </KeepAlivePane>
        <KeepAlivePane active={currentTab === 'mine'}>
          <MineTab />
        </KeepAlivePane>

        <div
          key={isStack ? pathname : 'tab-outlet'}
          className={cn(
            isStack
              ? 'fixed inset-0 z-[35] flex flex-col overflow-hidden bg-background animate-in fade-in-0 slide-in-from-right duration-200'
              : 'hidden',
          )}
          style={isStack ? { animationTimingFunction: 'var(--ease-out-quint)' } : undefined}
        >
          <Outlet />
        </div>
      </div>

      <TabBar tucked={isStack} />
    </div>
  );
}

function KeepAlivePane({
  active,
  mode = 'visibility',
  children,
}: {
  active: boolean;
  mode?: 'visibility' | 'hidden';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        mode === 'hidden' ? (active ? undefined : 'hidden') : !active && 'invisible pointer-events-none',
      )}
      aria-hidden={!active}
      {...(!active ? { inert: true } : {})}
    >
      {children}
    </div>
  );
}
