import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static app, no backend — the /data JSON is imported at build time and the
// engine's TypeScript source is bundled directly via the alias.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gw1/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
      "@data": fileURLToPath(new URL("../data", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
