import { Outlet, useLocation } from "react-router-dom";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

const AUTH_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/verify-email-change",
]);

export default function PublicLayout() {
  const { pathname } = useLocation();
  const isAuthSurface = AUTH_PATHS.has(pathname);

  if (isAuthSurface) {
    return <Outlet />;
  }

  return (
    <div className="saas-public min-h-screen flex flex-col">
      <PublicHeader />
      <main className="flex-1"><Outlet /></main>
      <PublicFooter />
    </div>
  );
}
