import { defineConfig } from "vite";

// dist/ is a static bundle (host anywhere — Vercel, Cloudflare Pages, GitHub Pages).
// A RELATIVE base ("./") makes the emitted asset URLs work whether the bundle is
// served at a domain root (petriarch.brac.dev) OR under a project subpath
// (brac.dev/petriarch) — the browser resolves them against index.html either way.
// (An absolute "/petriarch/" base 404s the JS when served at a subdomain root →
// blank screen; that was the Vercel deploy bug.) The app loads no URL-addressed
// assets — Pixi generates its textures at runtime — so relative paths are safe.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
  },
}));
