import { Navigate, useLocation } from "react-router-dom";
import { isFileProtocol } from "../lib/desktopRuntime";

/**
 * Strip trailing slashes so /dashboard/ matches /dashboard (avoids catch-all 404).
 * Keeps root "/" unchanged. No-op when the raw filesystem path leaked into the
 * location (file:// + BrowserRouter mistake) — NotFound / HashRouter handle that.
 */
export default function PathNormalizer({ children }) {
  const location = useLocation();
  const { pathname, search, hash } = location;
  if (isFileProtocol() && /:[\\/]|index\.html/i.test(pathname)) {
    return children;
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return <Navigate to={`${pathname.replace(/\/+$/, "")}${search}${hash}`} replace />;
  }
  return children;
}
