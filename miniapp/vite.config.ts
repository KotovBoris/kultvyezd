import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' — чтобы собранные ассеты корректно грузились при любом пути размещения.
// В dev-режиме API и вебхук проксируются на backend (localhost:8000).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/webhook": "http://localhost:8000",
      "/healthz": "http://localhost:8000",
    },
  },
});
