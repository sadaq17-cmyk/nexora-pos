import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-app-panel-muted text-center p-6">
      <div className="text-5xl font-bold text-brand mb-2">404</div>
      <p className="text-sm text-app-muted mb-4">That page doesn't exist.</p>
      <Link to="/dashboard" className="btn btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
