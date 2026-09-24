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
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      '/static': { target: API_TARGET, changeOrigin: true },
      // sitemap 索引 + 子 sitemap（/sitemap-videos-1.xml 等）
      '^/sitemap[a-z0-9-]*\\.xml$': { target: API_TARGET, changeOrigin: true },
      '/robots.txt': { target: API_TARGET, changeOrigin: true },
      // 爬虫动态渲染入口，本地可直接访问 /__seo/render/watch/xxx 排查
      '/__seo': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // 这里的压缩器不能改成默认的 oxc：它会把 `debugger` 语句当调试残留删掉，
    // 而 @videox/ui 的 useConsoleShield 正是靠这条语句来判定控制台有没有真的
    // 挂起脚本 —— 被删掉后那条判据会静默失效，只剩尺寸差硬扛，手机上全是误伤。
    // esbuild 压缩保留 `debugger`，代价是产物略大几个百分点。
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // 播放器内核和动画库都不小，拆出去让首页不必为播放页买单。
        manualChunks(id) {
          if (id.includes('node_modules/hls.js')) return 'hls';
          if (id.includes('node_modules/framer-motion')) return 'motion';
          if (/node_modules\/(react|react-dom|react-router)/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
