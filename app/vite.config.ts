import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static app, no backend — data comes from the committed JSON in /data.
export default defineConfig({
  plugins: [react()],
});
