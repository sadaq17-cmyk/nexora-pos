import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles, module, action = "view" }) {
  const { user, loading, can } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const roleBlocked = allowedRoles && !allowedRoles.includes(user.role);
  const permissionBlocked = module && !can(module, action);

  if (roleBlocked || permissionBlocked) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-lg font-semibold text-[#1B2439] mb-1">Access restricted</h2>
        <p className="text-sm text-[#6B7690]">
          Your role ({user.role}) doesn't have permission to view this page.
        </p>
      </div>
    );
  }
  return children;
}
