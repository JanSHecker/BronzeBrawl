import { defineConfig } from '@playwright/test';

// Isolated browser checks with synthetic HTTP fixtures; no database required.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'status-layout.spec.js',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
  },
});
