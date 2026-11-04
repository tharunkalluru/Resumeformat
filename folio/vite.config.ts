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
  // One file at a time by default (PDF-heavy suites are memory hungry); set
  // VITEST_MAX_WORKERS to run files in parallel on machines with spare cores.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 20000, maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 1), fileParallelism: Number(process.env.VITEST_MAX_WORKERS ?? 1) > 1 },
});
