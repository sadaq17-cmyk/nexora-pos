/**
 * Desktop / Electron runtime helpers.
 *
 * Packaged installs load https://www.nexorapospro.com/login (BrowserRouter).
 * Local file:// loads must use HashRouter — BrowserRouter treats the filesystem
 * path as the route and hits NotFound ("That page doesn't exist.").
 */

export const PRODUCTION_WEB_ORIGIN = "https://www.nexorapospro.com";

export function isFileProtocol() {
  return typeof window !== "undefined" && window.location?.protocol === "file:";
}

export function isDesktopShell() {
  return typeof window !== "undefined" && Boolean(window.nexoraDesktop);
}

/** Hash routing required for any file:// SPA shell. */
export function useHashRouter() {
  return isFileProtocol();
}

/**
 * Resolve API paths for fetch(). Relative `/api/...` works on the web host;
 * on file:// they must target the production API origin.
 */
export function resolveApiUrl(path) {
  if (!path || typeof path !== "string") return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const desktopOrigin =
    (typeof window !== "undefined" && window.nexoraDesktop?.apiOrigin) ||
    (isFileProtocol() ? PRODUCTION_WEB_ORIGIN : "");
  if (!desktopOrigin) return normalized;
  return `${String(desktopOrigin).replace(/\/$/, "")}${normalized}`;
}
