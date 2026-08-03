import { Navigate } from "react-router-dom";
import { useHashRouter } from "../lib/desktopRuntime";
import NotFound from "../pages/NotFound";

/** Desktop: unknown routes → /login. Web: NotFound page. */
export default function DesktopCatchAll() {
  if (useHashRouter()) {
    return <Navigate to="/login" replace />;
  }
  return <NotFound />;
}
