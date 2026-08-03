/**
 * Desktop / Electron runtime helpers.
 * Production EXE: local dist/index.html#/... with HashRouter (never BrowserRouter).
 */

export const PRODUCTION_WEB_ORIGIN = "https://www.nexorapospro.com";

export function isFileProtocol() {
  return typeof window !== "undefined" && window.location?.protocol === "file:";
}

export function isNexoraAppProtocol() {
  return typeof window !== "undefined" && window.location?.protocol === "nexora:";
}

export function isOfflineDesktopShell() {
  return isFileProtocol() || isNexoraAppProtocol();
}

export function isDesktopShell() {
  return typeof window !== "undefined" && Boolean(window.nexoraDesktop);
}

export function isDesktopBuild() {
  return (
    import.meta.env.VITE_DESKTOP === "true" ||
    (typeof window !== "undefined" && window.__NEXORA_DESKTOP_BUILD__ === true)
  );
}

/**
 * Desktop builds ALWAYS use HashRouter (compile-time + runtime guards).
 * Web/Vercel keep BrowserRouter.
 * Named without a `use` prefix so non-React modules can call it safely.
 */
export function prefersHashRouter() {
  if (typeof window === "undefined") {
    return import.meta.env.VITE_DESKTOP === "true";
  }
  if (import.meta.env.VITE_DESKTOP === "true") return true;
  if (window.__NEXORA_DESKTOP_BUILD__ === true) return true;
  if (window.__NEXORA_FORCE_HASH__ === true) return true;
  if (window.nexoraDesktop?.forceHashRouter === true) return true;
  if (isDesktopShell()) return true;
  if (isOfflineDesktopShell()) return true;
  return false;
}

/** @deprecated Prefer prefersHashRouter — kept for existing React call sites. */
export function useHashRouter() {
  return prefersHashRouter();
}

export function resolveApiUrl(path) {
  if (!path || typeof path !== "string") return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const desktopOrigin =
    (typeof window !== "undefined" && window.nexoraDesktop?.apiOrigin) ||
    (isDesktopShell() || isOfflineDesktopShell() || isDesktopBuild()
      ? PRODUCTION_WEB_ORIGIN
      : "");
  if (!desktopOrigin) return normalized;
  return `${String(desktopOrigin).replace(/\/$/, "")}${normalized}`;
}

/** Must match api/_authHelpers.js NEXORA_DESKTOP_ATTESTATION + electron/preload.cjs */
export const NEXORA_DESKTOP_ATTESTATION = "nexora-desktop-v1";

/**
 * Headers required for Electron file:// → production /api (CORS + CSRF).
 * Safe to send on web too (ignored unless Origin is null).
 */
export function desktopApiHeaders(extra = {}) {
  const headers = { ...extra };
  if (isDesktopShell() || isOfflineDesktopShell() || isDesktopBuild()) {
    const token =
      (typeof window !== "undefined" && window.nexoraDesktop?.desktopAttestation) ||
      NEXORA_DESKTOP_ATTESTATION;
    headers["X-Nexora-Desktop"] = token;
  }
  return headers;
}
