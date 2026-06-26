import { defineConfig } from "vite";

// dist/ is a static bundle (host anywhere — Cloudflare Pages, GitHub Pages).
// If served under a project subpath, set the build base accordingly; dev/preview
// stay at root for convenience.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/petriarch/" : "/",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
  },
}));
