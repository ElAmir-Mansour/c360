import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    pool: 'threads',
    maxWorkers: 2,
    testTimeout: 60000,
    hookTimeout: 60000,
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:8080',
      },
    },
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
