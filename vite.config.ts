import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Independent production Vite config for Automotive Brands.
 * Replaces @lovable.dev/vite-tanstack-config with the official TanStack Start
 * + Nitro Node server stack (Coolify/Docker), without changing app routes/UI.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  server: {
    host: true,
    port: 43127,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 43127,
  },
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    // Must come before react()
    tanstackStart({
      // Keep using src/server.ts as the SSR entry (error-page wrapper).
      server: { entry: "server" },
    }),
    // Node preset for Docker / Coolify — not Cloudflare Workers.
    nitro({
      preset: "node-server",
    }),
    viteReact(),
  ],
  ssr: {
    external: ["@prisma/client", ".prisma/client"],
  },
});
