import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Layers3,
  Boxes,
  Barcode,
  ShoppingBag,
  ReceiptText,
  Users,
  Truck,
  Receipt,
  BarChart3,
  ShieldCheck,
  Settings,
  CreditCard,
  LogOut,
  Store,
  Menu,
  Moon,
  Sun,
  Building2,
  CircleDollarSign,
  ScrollText,
  SlidersHorizontal,
  Search,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  ChevronDown,
  Home,
  Wallet,
  LifeBuoy,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { useTheme } from "../context/ThemeContext";
import { api } from "../lib/api";
import { isOwner, isPlatformOwner, roleLabel } from "../lib/rbac";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const AiBundle = lazy(() => import("./ai/NexoraAiAssistant"));
const AiNavButton = lazy(() =>
  import("./ai/NexoraAiAssistant").then((m) => ({ default: m.NexoraAiNavButton }))
);

const SIDEBAR_KEY = "nexora_sidebar_collapsed";

/**
 * Primary company sidebar — single clean list (permission-filtered).
 * Sales → POS register; Branches → platform branches page when available.
 */
const PRIMARY_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
  { to: "/pos", label: "Sales", icon: ShoppingCart, module: "pos" },
  { to: "/products", label: "Products", icon: Package, module: "products" },
  { to: "/categories", label: "Categories", icon: Layers3, module: "categories" },
  { to: "/barcode", label: "Barcode", icon: Barcode, module: "barcode" },
  { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
  { to: "/purchases", label: "Purchases", icon: ShoppingBag, module: "purchases" },
  { to: "/suppliers", label: "Suppliers", icon: Truck, module: "suppliers" },
  { to: "/customers", label: "Customers", icon: Users, module: "customers" },
  { to: "/receivables", label: "Receivables", icon: CircleDollarSign, module: "customers" },
  { to: "/inventory", label: "Inventory", icon: Boxes, module: "inventory" },
  { to: "/branches", label: "Branches", icon: Building2, module: "branches" },
  { to: "/users", label: "Users", icon: Users, module: "users" },
  { to: "/settings", label: "Settings", icon: Settings, module: "settings" },
];

/** Light secondary links kept out of the primary wireframe list */
const SECONDARY_NAV = [
  { to: "/sales", label: "Sale history", icon: ReceiptText, module: "sales" },
  { to: "/expenses", label: "Expenses", icon: Receipt, module: "expenses" },
  { to: "/payroll", label: "Payroll", icon: Wallet, module: "payroll" },
  { to: "/payroll/self", label: "My HR", icon: Users, module: "payroll" },
  { to: "/reports/users", label: "User sales", icon: BarChart3, module: "reports" },
  { to: "/user-status", label: "User status", icon: Users, module: "users" },
  { to: "/roles", label: "Roles", icon: ShieldCheck, module: "roles" },
  { to: "/audit", label: "Audit", icon: ScrollText, module: "audit_logs" },
  { to: "/subscription", label: "Plan", icon: CreditCard, module: "subscription", ownerOnly: true },
  { to: "/notifications", label: "Notifications", icon: Bell, module: "dashboard" },
];

const NAV_SECTIONS = [
  { id: "main", label: "Menu", items: PRIMARY_NAV },
  { id: "more", label: "More", items: SECONDARY_NAV },
];

const PLATFORM_SECTIONS = [
  {
    id: "platform",
    label: "Menu",
    items: [
      { to: "/platform", label: "Dashboard", icon: LayoutDashboard, module: "owner_management" },
      { to: "/platform/companies", label: "Company Management", icon: Building2, module: "company_accounts" },
      { to: "/platform/subscriptions", label: "Subscriptions", icon: CreditCard, module: "subscriptions" },
      { to: "/platform/payments", label: "Payments", icon: CircleDollarSign, module: "billing" },
      { to: "/platform/pricing", label: "Plans", icon: SlidersHorizontal, module: "plans" },
      { to: "/platform/analytics", label: "Reports", icon: BarChart3, module: "platform_analytics" },
      { to: "/platform/support", label: "Support", icon: LifeBuoy, module: "owner_management" },
      { to: "/platform/ai-guardian", label: "AI Guardian", icon: Sparkles, module: "owner_management" },
      { to: "/platform/approvals", label: "Approvals", icon: ShieldCheck, module: "platform_approvals" },
      { to: "/platform/audit", label: "Audit Logs", icon: ScrollText, module: "platform_audit" },
      { to: "/platform/settings", label: "Settings", icon: Settings, module: "platform_settings" },
    ],
  },
];

const ALL_NAV_ITEMS = [...NAV_SECTIONS, ...PLATFORM_SECTIONS].flatMap((section) => section.items);

const EXTRA_TITLES = {
  "/change-password": "Change Password",
  "/settings/login-security": "Login & Security",
  "/notifications": "Notifications",
};

function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function resolvePageMeta(pathname, search, platformMode, user) {
  const withQuery = `${pathname}${search || ""}`;
  if (pathname === "/settings" && search.includes("tab=backup")) {
    return { title: "Backup & Restore", subtitle: null, crumbs: ["Governance", "Backup"] };
  }
  if (pathname === "/dashboard") {
    return {
      title: "Dashboard",
      subtitle: null,
      crumbs: ["Menu", "Dashboard"],
    };
  }
  const exact = ALL_NAV_ITEMS.find((item) => item.to === withQuery || item.to === pathname);
  if (exact) {
    const section = (platformMode ? PLATFORM_SECTIONS : NAV_SECTIONS).find((s) =>
      s.items.some((item) => item.to === exact.to)
    );
    return {
      title: exact.label,
      subtitle: null,
      crumbs: [section?.label || (platformMode ? "Platform" : "Workspace"), exact.label],
    };
  }
  const nested = ALL_NAV_ITEMS
    .filter((item) => item.to !== "/" && pathname.startsWith(item.to.split("?")[0]))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (nested) {
    return { title: nested.label, subtitle: null, crumbs: [platformMode ? "Platform" : "Workspace", nested.label] };
  }
  if (EXTRA_TITLES[pathname]) {
    return { title: EXTRA_TITLES[pathname], subtitle: null, crumbs: ["Account", EXTRA_TITLES[pathname]] };
  }
  const segment = pathname.split("/").filter(Boolean).pop() || "Home";
  const title = segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { title, subtitle: null, crumbs: [platformMode ? "Platform" : "Workspace", title] };
}

function NavSections({ sections, collapsed, navIsActive, onNavigate }) {
  return sections.map((section) => (
    <div key={section.id} className="nx-nav-section">
      <div className="nx-nav-section-label">{section.label}</div>
      {section.items.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={`${to}-${label}`}
          to={to}
          end={to === "/reports" || to === "/platform"}
          title={collapsed ? label : undefined}
          className={() => cn("nx-nav-link", navIsActive(to) && "is-active")}
          onClick={onNavigate}
        >
          <Icon size={17} strokeWidth={2} aria-hidden />
          <span className="nx-nav-label truncate flex-1">{label}</span>
          {badge && !collapsed && (
            <Badge variant="default" className="nx-nav-badge h-5 px-1.5 text-[10px]">
              {badge}
            </Badge>
          )}
        </NavLink>
      ))}
    </div>
  ));
}

function AiNavButtonLazy({ onClick }) {
  return (
    <Suspense fallback={null}>
      <AiNavButton onClick={onClick} />
    </Suspense>
  );
}

export default function Layout() {
  const { user, logout, can, impersonation, stopImpersonation } = useAuth();
  const { settings } = useEnterpriseSettings();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [branches, setBranches] = useState([]);
  const [headerSearch, setHeaderSearch] = useState("");
  const [notifications, setNotifications] = useState({ items: [], unread: 0 });
  const [aiOpen, setAiOpen] = useState(false);

  const platformMode = isPlatformOwner(user?.role) && !impersonation;
  const companyOwner = isOwner(user?.role);
  const isPosRoute = location.pathname === "/pos";
  const pageMeta = useMemo(
    () => resolvePageMeta(location.pathname, location.search, platformMode, user),
    [location.pathname, location.search, platformMode, user]
  );

  const visibleSections = useMemo(() => {
    const source = platformMode ? PLATFORM_SECTIONS : NAV_SECTIONS;
    return source
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (item.ownerOnly && !companyOwner) return false;
          if (item.platformOnly && !platformMode) return false;
          return can(item.module, "view");
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [can, platformMode, companyOwner]);

  useEffect(() => {
    if (platformMode) return undefined;
    let cancelled = false;
    // Settings come from EnterpriseSettingsContext — do not duplicate settings.getAll().
    Promise.all([
      api.branches?.getAll?.() ?? Promise.resolve([]),
      api.notifications?.list?.() ?? Promise.resolve({ items: [], unread: 0 }),
    ]).then(([branchRows, notifResult]) => {
      if (cancelled) return;
      if (Array.isArray(branchRows)) setBranches(branchRows);
      if (notifResult?.items) {
        setNotifications({ items: notifResult.items, unread: notifResult.unread || notifResult.items.length });
      } else if (Array.isArray(notifResult)) {
        setNotifications({ items: notifResult, unread: notifResult.length });
      }
    }).catch(() => null);
    return () => { cancelled = true; };
  }, [platformMode, user?.company_id]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const branchName =
    branches.find((branch) => branch.id === Number(user?.branch_id || settings.default_branch_id))?.name ||
    "Main Branch";

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navIsActive = (to) => {
    const [path, query = ""] = to.split("?");
    if (path === "/settings/login-security") {
      return location.pathname.startsWith("/settings/login-security");
    }
    if (path === "/settings" && query.includes("tab=backup")) {
      return location.pathname === "/settings" && location.search.includes("tab=backup");
    }
    if (path === "/settings") {
      return (
        location.pathname === "/settings" &&
        !location.search.includes("tab=backup") &&
        !location.pathname.includes("login-security")
      );
    }
    if (path === "/reports" || path === "/platform") {
      return location.pathname === path;
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const runHeaderSearch = (event) => {
    event.preventDefault();
    const query = headerSearch.trim();
    if (!query) {
      if (can("products", "view")) navigate("/products");
      return;
    }
    const match = ALL_NAV_ITEMS.find((item) => item.label.toLowerCase().includes(query.toLowerCase()));
    if (match && can(match.module, "view")) {
      navigate(match.to);
      setHeaderSearch("");
      return;
    }
    if (can("products", "view")) {
      navigate("/products");
    }
  };

  const sidebarBody = (
    <>
      <div className="nx-brand-bar">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="nx-brand-mark" aria-hidden>
            <Store size={18} />
          </div>
          <div className="nx-brand-copy min-w-0">
            <div className="nx-brand-name truncate">Nexora</div>
            <div className="nx-brand-sub">POS Pro</div>
          </div>
        </div>
      </div>

      <div className="nx-aside-extra border-b border-app px-3.5 py-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-app-muted">
          <Building2 size={13} aria-hidden />
          {platformMode ? "Platform" : user?.company?.code || "Company"}
        </div>
        <div className="mt-1 truncate text-[13px] font-semibold">
          {platformMode ? "All accounts" : branchName}
        </div>
      </div>

      <nav className="nx-aside-nav flex-1 overflow-y-auto px-1.5 py-2" aria-label="Modules">
        <NavSections
          sections={visibleSections}
          collapsed={collapsed}
          navIsActive={navIsActive}
          onNavigate={() => setMobileOpen(false)}
        />
      </nav>

      <div className="nx-aside-footer border-t border-app p-2.5">
        <button
          type="button"
          className="nx-nav-link mb-1 w-full"
          onClick={() => setCollapsed((value) => !value)}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className="nx-nav-label">{collapsed ? "Expand" : "Collapse"}</span>
        </button>

        <button type="button" onClick={handleLogout} className="nx-nav-link nx-logout-link w-full">
          <LogOut size={17} aria-hidden />
          <span className="nx-nav-label">Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className={cn("nx-shell bg-app text-app-text", collapsed && "is-sidebar-collapsed")}>
      <a href="#main-content" className="nx-skip-link">
        Skip to main content
      </a>

      <aside
        className={cn("nx-shell-aside hidden lg:flex", collapsed && "is-collapsed")}
        aria-label="Primary navigation"
      >
        {sidebarBody}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[248px] p-0 lg:hidden [&>button]:text-[var(--sidebar-muted)]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="nx-shell-nav flex h-full flex-col">{sidebarBody}</div>
        </SheetContent>
      </Sheet>

      <div className="nx-shell-main">
        {impersonation && (
          <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
            <span>Impersonating {user?.name}</span>
            <button
              type="button"
              onClick={async () => {
                const result = await stopImpersonation();
                if (result.success) navigate("/platform", { replace: true });
              }}
              className="rounded-lg bg-amber-950 px-3 py-1 text-xs text-white"
            >
              Stop Impersonation
            </button>
          </div>
        )}

        <header className="nx-topbar">
          <div className="nx-topbar-inner">
            <div className="nx-topbar-brand">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="nx-icon-btn lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={18} />
              </Button>
              <div className="nx-topbar-logo hidden sm:flex" title="Nexora POS Pro" aria-hidden>
                <Store size={15} />
              </div>
              <span className="nx-topbar-brand-label hidden md:inline">Nexora</span>
            </div>

            <form className="nx-topbar-search" onSubmit={runHeaderSearch} role="search">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" aria-hidden />
              <Input
                ref={searchRef}
                value={headerSearch}
                onChange={(event) => setHeaderSearch(event.target.value)}
                placeholder="Search products, customers, invoices…"
                aria-label="Search products, customers, invoices"
                className="h-9 border-[var(--app-border)] bg-[var(--app-panel-muted)] pl-10 shadow-none focus-visible:bg-[var(--app-panel)]"
              />
            </form>

            <div className="nx-topbar-actions">
              {!platformMode && (
                <div
                  className="nx-branch-select flex items-center gap-2"
                  title="Current branch"
                  aria-label={`Current branch: ${branchName}`}
                >
                  <Building2 size={15} className="text-app-muted" aria-hidden />
                  <span className="truncate">{branchName}</span>
                </div>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon" className="nx-icon-btn relative" aria-label="Notifications">
                    <Bell size={17} aria-hidden />
                    {notifications.unread > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                        {notifications.unread > 9 ? "9+" : notifications.unread}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.items.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      You are all caught up. Operational alerts appear here when stock is low.
                    </div>
                  ) : (
                    notifications.items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        className="flex flex-col items-start gap-0.5 py-2"
                        onClick={() => item.href && navigate(item.href)}
                      >
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.body}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                  {can("audit_logs", "view") && (
                    <DropdownMenuItem onClick={() => navigate("/audit")}>
                      <ScrollText size={15} aria-hidden />
                      Open audit trail
                    </DropdownMenuItem>
                  )}
                  {can("inventory", "view") && (
                    <DropdownMenuItem onClick={() => navigate("/inventory")}>
                      <Boxes size={15} aria-hidden />
                      Inventory alerts
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                type="button"
                variant="outline"
                size="icon"
                className="nx-icon-btn"
                onClick={toggleTheme}
                aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                title={theme === "light" ? "Dark mode" : "Light mode"}
              >
                {theme === "light" ? <Moon size={17} aria-hidden /> : <Sun size={17} aria-hidden />}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="nx-user-chip" aria-label="User profile menu">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-brand/15 text-brand">{initials(user?.name)}</AvatarFallback>
                    </Avatar>
                    <span className="hidden min-w-0 text-left md:block">
                      <span className="block truncate text-sm font-semibold leading-tight">{user?.name}</span>
                      <span className="block truncate text-[12px] leading-tight text-app-muted">{roleLabel(user?.role)}</span>
                    </span>
                    <ChevronDown size={14} className="text-app-muted" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-semibold">{user?.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user?.email || roleLabel(user?.role)}</div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => navigate(companyOwner ? "/settings/login-security" : "/change-password")}
                  >
                    <KeyRound size={16} aria-hidden />
                    {companyOwner ? "Login & Security" : "Change password"}
                  </DropdownMenuItem>
                  {can("settings", "view") && (
                    <DropdownMenuItem onClick={() => navigate("/settings")}>
                      <Settings size={16} aria-hidden />
                      Workspace
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-danger focus:text-danger" onClick={handleLogout}>
                    <LogOut size={16} aria-hidden />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {!platformMode && <AiNavButtonLazy onClick={() => setAiOpen(true)} />}
            </div>
          </div>
        </header>

        {!isPosRoute && (
          <div className="nx-page-chrome" aria-label="Page header">
            <div className="nx-page-chrome-inner">
              <div className="nx-page-chrome-copy min-w-0">
                <nav className="nx-breadcrumb" aria-label="Breadcrumb">
                  <Home size={13} className="nx-breadcrumb-home" aria-hidden />
                  {pageMeta.crumbs.map((crumb, index) => (
                    <span key={`${crumb}-${index}`} className="nx-breadcrumb-item">
                      {index > 0 && <span className="nx-breadcrumb-sep" aria-hidden>/</span>}
                      <span className={index === pageMeta.crumbs.length - 1 ? "is-current" : ""}>{crumb}</span>
                    </span>
                  ))}
                </nav>
                <h1 className="nx-page-chrome-title">{pageMeta.title}</h1>
                {pageMeta.subtitle && <p className="nx-page-chrome-sub">{pageMeta.subtitle}</p>}
              </div>
            </div>
          </div>
        )}

        <main id="main-content" className={cn("nx-main-content", isPosRoute && "is-pos")} tabIndex={-1}>
          <Outlet />
        </main>

        {!platformMode && aiOpen && (
          <Suspense fallback={null}>
            <AiBundle open={aiOpen} onOpenChange={setAiOpen} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
