import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  cacheDir: '.cache/vite',
  server: {
    host: '127.0.0.1', port: 4594, strictPort: true,
    fs: { deny: ['**/.env*', '**/server/**', '**/.git/**', '**/private-user-cases/**'] },
    proxy: { '/api/ai/': { target: 'http://127.0.0.1:4596', changeOrigin: false } },
  },
  preview: {
    host: '127.0.0.1', port: 4594, strictPort: true,
    proxy: { '/api/ai/': { target: 'http://127.0.0.1:4596', changeOrigin: false } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 20000, maxWorkers: 1, fileParallelism: false },
});
