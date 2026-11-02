/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { precacheServiceWorker } from "./build/precache-sw.ts";

export default defineConfig({
  // Relative base: the same build works at a domain root or under /pdf-optimizer/ (GitHub Pages).
  base: "./",
  plugins: [react(), precacheServiceWorker()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mupdf"] },
  build: {
    target: ["es2022", "safari16"],
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: "forks",
  },
});
