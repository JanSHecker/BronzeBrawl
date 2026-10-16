import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// The /log browser smoke uses a labelled synthetic API; no database required.
export default defineConfig({
  ...config,
  testMatch: "activity-log.spec.js",
  webServer: config.webServer[1],
});
