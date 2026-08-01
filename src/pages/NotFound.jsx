import { Link, Navigate } from "react-router-dom";
import { isFileProtocol } from "../lib/desktopRuntime";

export default function NotFound() {
  // Safety net: file:// + wrong router/path must never strand desktop users on 404.
  if (isFileProtocol()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-app-panel-muted text-center p-6">
      <div className="text-5xl font-bold text-brand mb-2">404</div>
      <p className="text-sm text-app-muted mb-4">That page doesn't exist.</p>
      <Link to="/login" className="btn btn-primary">
        Back to Login
      </Link>
    </div>
  );
}
