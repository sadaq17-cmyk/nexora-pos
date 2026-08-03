import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute base on Vercel so nested SPA routes (/platform/users) load /assets correctly.
// Electron / desktop builds MUST use "./" so file:// dist/index.html resolves assets.
const isDesktopBuild = process.env.VITE_DESKTOP === "true" || process.env.ELECTRON_BUILD === "1";
const base = isDesktopBuild ? "./" : process.env.VERCEL ? "/" : "./";

export default defineConfig(({ mode }) => {
  // Ensure .env / .env.local / .env.[mode]* are available for VITE_* inlining.
  const fileEnv = loadEnv(mode, __dirname, "");
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }

  return {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base,
  envPrefix: ["VITE_"],
  define: {
    "import.meta.env.VITE_DESKTOP": JSON.stringify(isDesktopBuild ? "true" : "false"),
  },
  server: {
    port: 5173,
    strictPort: true,
    // Optional: local UI against production /api (set VITE_PROXY_API=1).
    proxy: process.env.VITE_PROXY_API === "1"
      ? {
          "/api": {
            target: process.env.VITE_PROXY_API_TARGET || "https://www.nexorapospro.com",
            changeOrigin: true,
            secure: true,
          },
        }
      : undefined,
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
};
});
