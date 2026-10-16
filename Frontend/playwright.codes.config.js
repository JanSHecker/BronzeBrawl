import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Code/UI regressions use a mocked API and can run without PostgreSQL.
export default defineConfig({
  ...config,
  testMatch: "game-codes.spec.js",
  webServer: config.webServer[1],
});
