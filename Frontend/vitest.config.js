import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/test/setup.js", include: ["src/test/**/*.test.{js,jsx}"] },
});
