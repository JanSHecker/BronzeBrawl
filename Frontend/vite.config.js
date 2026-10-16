import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react({ fastRefresh: false })],
  root: "src",
  server: {
    proxy: {
      "^/api(?:/|$)": {
        target: process.env.VITE_DEV_API_TARGET || "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        preview: fileURLToPath(new URL("./src/ui-preview.html", import.meta.url)),
      },
    },
  },
});
