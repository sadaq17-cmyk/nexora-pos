import { Link, Navigate, useLocation } from "react-router-dom";
import { isDesktopBuild, isDesktopShell, isOfflineDesktopShell, useHashRouter } from "../lib/desktopRuntime";

export default function NotFound() {
  const location = useLocation();

  // Desktop / Electron: never show a 404 page — go to Login.
  if (useHashRouter() || isDesktopBuild() || isDesktopShell() || isOfflineDesktopShell()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-app-panel-muted text-center p-6">
      <div className="text-5xl font-bold text-brand mb-2">404</div>
      <p className="text-sm text-app-muted mb-2">That page does not exist.</p>
      <p className="text-xs text-app-muted mb-4 font-mono break-all">{location.pathname}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link to="/dashboard" className="btn btn-primary">
          Dashboard
        </Link>
        <Link to="/login" className="btn btn-secondary">
          Login
        </Link>
        <Link to="/" className="btn btn-secondary">
          Home
        </Link>
      </div>
    </div>
  );
}
