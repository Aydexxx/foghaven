import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [
    react(),
    // Pre-compresses build output to .gz/.br at build time — a guaranteed
    // best-effort compression regardless of what the eventual host does
    // (Caddy/Netlify already compress on the fly, but shipping a
    // pre-compressed artifact costs the server nothing to serve and can't be
    // worse). Gzip first for universal support, then Brotli (smaller, and
    // preferred by browsers that support it) as a second pass.
    viteCompression({ algorithm: "gzip", ext: ".gz" }),
    viteCompression({ algorithm: "brotliCompress", ext: ".br" }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Phaser rarely changes between deploys and is the single
          // dominant contributor to bundle size — splitting it into its own
          // chunk means a routine app deploy only invalidates the (much
          // smaller) app chunk in returning players' browser caches.
          phaser: ["phaser"],
        },
      },
    },
  },
});
