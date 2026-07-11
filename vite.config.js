import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Electron loads the built files from disk, so base must be relative.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
