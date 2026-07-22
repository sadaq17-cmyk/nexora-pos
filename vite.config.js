import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute base on Vercel so nested SPA routes (/platform/users) load /assets correctly.
// Relative base kept for local/Electron disk loads.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: process.env.VERCEL ? "/" : "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("canvg")) return "pdf";
          if (id.includes("xlsx")) return "xlsx";
          if (id.includes("jsbarcode") || id.includes("qrcode")) return "barcode";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("react-dom") || id.includes("react-router") || id.includes("/react/")) return "react-vendor";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
