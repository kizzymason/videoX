import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@videox/ui';
import { Toaster } from 'sonner';
import { App } from './App';
import { queryClient } from './lib/query';
import './styles.css';

/**
 * 后台挂载在哪个路径由站点设置决定（nginx 按设置放行入口），构建时并不知道，
 * 所以 basename 只能在运行时从当前地址的第一段取。资源前缀仍是构建时的 BASE_URL。
 * 开发服务器把后台挂在根路径，直接沿用 BASE_URL。
 */
function resolveBasename(): string | undefined {
  if (import.meta.env.DEV) return import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;
  const segment = window.location.pathname.split('/')[1] ?? '';
  return segment ? `/${segment}` : undefined;
}

const routerBasename = resolveBasename();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter basename={routerBasename}>
          <App />
          <Toaster position="bottom-right" richColors closeButton />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
