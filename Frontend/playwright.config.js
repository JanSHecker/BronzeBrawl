import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5178",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: [
    { command: "node ../Backend/dist/src/main.js", url: "http://127.0.0.1:3107/health", env: { PORT: "3107", NODE_ENV: "test" }, reuseExistingServer: false },
    { command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort", url: "http://127.0.0.1:5178", env: { VITE_DEV_API_TARGET: "http://127.0.0.1:3107" }, reuseExistingServer: false },
  ],
});
