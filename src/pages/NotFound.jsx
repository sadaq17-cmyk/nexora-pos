import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F3F6FB] text-center p-6">
      <div className="text-5xl font-bold text-[#2563EB] mb-2">404</div>
      <p className="text-sm text-[#6B7690] mb-4">That page doesn't exist.</p>
      <Link to="/dashboard" className="text-sm font-medium text-white bg-[#2563EB] px-4 py-2 rounded-lg">
        Back to Dashboard
      </Link>
    </div>
  );
}
