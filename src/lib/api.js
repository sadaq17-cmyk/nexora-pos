import { mockApi } from "./mockApi";

const hasElectronApi = typeof window !== "undefined" && window.api;

if (!hasElectronApi) {
  // Expected when running `npm run dev` directly in a browser tab.
  // Use `npm run electron:dev` to get the real SQLite-backed API.
  console.warn(
    "[NEXORA POS] window.api not found — running in mock mode with in-memory data. " +
      "Use `npm run electron:dev` for the real, persisted app."
  );
}

export const api = hasElectronApi ? window.api : mockApi;
export const isMockMode = !hasElectronApi;
