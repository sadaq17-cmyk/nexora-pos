import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { normalizeRole, roleLabel } from "../lib/rbac";

const SUBSCRIPTION_LOCK_PATHS = new Set([
  "/subscription/renew",
  "/subscription/payment",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/change-password",
]);

export default function ProtectedRoute({ children, allowedRoles, module, action = "view" }) {
  const { user, loading, can, mustChangePassword, subscriptionLocked } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-10 text-sm text-[#6B7690]">
        Checking your session…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (
    subscriptionLocked
    && !mustChangePassword
    && !SUBSCRIPTION_LOCK_PATHS.has(location.pathname)
  ) {
    return <Navigate to="/subscription/renew" replace />;
  }

  const normalizedRole = normalizeRole(user.role);
  const normalizedAllowed = allowedRoles?.map(normalizeRole);
  const roleBlocked = normalizedAllowed && !normalizedAllowed.includes(normalizedRole);
  const platformOwnerOnly = Boolean(
    normalizedAllowed?.length
    && normalizedAllowed.every((role) => role === "platform_owner")
  );
  const invalidPlatformIdentity = platformOwnerOnly && normalizedRole !== "platform_owner";
  const permissionBlocked = module && !can(module, action);

  if (roleBlocked || invalidPlatformIdentity || permissionBlocked) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-lg font-semibold text-[#1B2439] mb-1">Access restricted</h2>
        <p className="text-sm text-[#6B7690]">
          Your role ({roleLabel(user.role)}) doesn&apos;t have permission to view this page.
        </p>
      </div>
    );
  }
  return children;
}
