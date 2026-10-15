import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
  },
});
