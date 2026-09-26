/**
 * Stand-alone dev server for the diagram benchmark.
 *
 * Kept apart from the app's config on purpose: the app runs TanStack Start with
 * SSR and Nitro, none of which a timing harness needs, and a separate root means
 * the benchmark never shows up in the app's routes or build.
 *
 *   npx vite --config bench/vite.config.ts
 */
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname),
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  server: { port: 5199, strictPort: true, fs: { allow: [path.resolve(__dirname, "..")] } },
  optimizeDeps: { include: ["mermaid", "dagre-d3-es"] },
});
