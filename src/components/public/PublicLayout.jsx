import { Outlet, useLocation } from "react-router-dom";
import { useLayoutEffect } from "react";
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

// CSS scoping: the marketing/public site must never inherit the authenticated
// app's global h1/h2/h3/p/button/form styles from enterprise.css — see the
// `body:not(.nx-public-route) ...` guards in enterprise.css. Auth surfaces
// (login, signup, password reset, email verify) intentionally keep the app
// design system for visual continuity with the post-login product, so this
// class is never applied for them.
function usePublicRouteBodyClass(isPublicSite) {
  useLayoutEffect(() => {
    if (!isPublicSite) return undefined;
    document.body.classList.add("nx-public-route");
    return () => document.body.classList.remove("nx-public-route");
  }, [isPublicSite]);
}

export default function PublicLayout() {
  const { pathname } = useLocation();
  const isAuthSurface = AUTH_PATHS.has(pathname);
  const isProHome = pathname === "/";

  usePublicRouteBodyClass(!isAuthSurface);

  if (isAuthSurface) {
    return <Outlet />;
  }

  // Pro homepage ships its own nav + footer chrome.
  if (isProHome) {
    return (
      <div className="saas-public min-h-screen flex flex-col">
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="saas-public min-h-screen flex flex-col">
      <PublicHeader />
      <main className="flex-1"><Outlet /></main>
      <PublicFooter />
    </div>
  );
}
