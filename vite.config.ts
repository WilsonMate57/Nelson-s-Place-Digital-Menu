import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiTarget = process.env.VITE_DEV_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the same build works at the domain root or under a sub-path (e.g. /menu/).
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/uploads": { target: apiTarget, changeOrigin: false },
    },
  },
});
