import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import { queryClient } from './lib/query';
import { initAnalytics } from './lib/analytics';
import './styles.css';

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={routerBasename}>
        <App />
        <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 2600 }} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
