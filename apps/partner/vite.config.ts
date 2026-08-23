import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      '/static': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // 手机上首屏字节数敏感：图表库单独成块，登录页就不必下载它。
        manualChunks(id: string) {
          if (/node_modules\/(recharts|d3-|victory-)/.test(id)) return 'charts';
          if (/node_modules\/(react|react-dom|react-router)/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
