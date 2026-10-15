import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ fastRefresh: false })],
  root: "src",
  test: { environment: "jsdom", globals: true, setupFiles: ["./test/setup.js"] },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
