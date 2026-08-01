import { supabaseApi } from "./supabaseApi";

const hasElectronApi = typeof window !== "undefined" && window.api;

/**
 * Production web builds always use the Supabase-backed data plane.
 * Browser localStorage mockApi is DEV-only and requires an explicit flag.
 * Vite eliminates the DEV branch from production bundles.
 */
let resolvedApi = hasElectronApi ? window.api : supabaseApi;

if (
  !hasElectronApi &&
  import.meta.env.DEV &&
  String(import.meta.env.VITE_USE_MOCK_API || "").toLowerCase() === "true"
) {
  const { mockApi } = await import("./mockApi");
  resolvedApi = mockApi;
  console.info("[NEXORA POS] DEV mockApi (localStorage) enabled via VITE_USE_MOCK_API=true");
} else if (!hasElectronApi && import.meta.env.DEV) {
  console.info("[NEXORA POS] Using Supabase production data plane (/api/pos).");
}

export const api = resolvedApi;
export const isMockMode = Boolean(resolvedApi?.__isMock);
export const isProductionDataPlane = !hasElectronApi && !isMockMode;
