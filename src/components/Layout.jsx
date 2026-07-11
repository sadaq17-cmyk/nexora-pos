import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Users, Truck,
  ShoppingBag, BarChart3, Receipt, Settings, Search, Bell,
  ChevronDown, LogOut, Store, History, Wifi, WifiOff,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { isMockMode } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/pos", label: "POS Sales", icon: ShoppingCart },
  { to: "/products", label: "Products", icon: Package },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/sales", label: "Sales History", icon: History },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/purchases", label: "Purchases", icon: ShoppingBag },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/settings", label: "Settings", icon: Settings },
];

function initials(name = "") {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();

  return (
    <div className="min-h-screen flex bg-[#F3F6FB]">
      {isMockMode && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-xs text-center py-1">
          Mock data mode — run <code>npm run electron:dev</code> for the real database
        </div>
      )}

      <aside className="w-60 shrink-0 flex flex-col bg-[#0B1C3D]">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#2563EB]">
            <Store size={16} className="text-white" />
          </div>
          <span className="text-white font-bold tracking-wide text-[15px]">NEXORA POS</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                  isActive ? "bg-[#2563EB] text-white font-semibold" : "text-[#AEB9D4] hover:bg-white/5 font-medium"
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold bg-[#3B5AA6]">
              {initials(user?.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{user?.name}</div>
              <div className="text-[#8B96B8] text-[11px] capitalize">{user?.role}</div>
            </div>
            <button onClick={logout} className="text-[#8B96B8] hover:text-white" title="Log out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-[#E4E9F2] flex items-center justify-between px-6">
          <div>
            <div className="text-xs text-[#6B7690]">Nexora Supermarket — Westlands</div>
            <div className="text-sm font-semibold text-[#1B2439]">
              {NAV_ITEMS.find((n) => location.pathname === n.to)?.label || "NEXORA POS"}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ color: online ? "#12A150" : "#DC2626", backgroundColor: online ? "#E8FAEF" : "#FDECEC" }}
              title={online ? "Online — Firebase sync can run" : "Offline — all sales are still saved locally"}
            >
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? "Online" : "Offline"}
            </div>
            <div className="relative hidden md:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7690]" />
              <input placeholder="Quick search…" className="pl-9 pr-3 py-1.5 rounded-lg border border-[#E4E9F2] text-sm w-56" />
            </div>
            <button className="relative text-[#4B5675]">
              <Bell size={18} />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#DC2626]" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold bg-[#2563EB]">
                {initials(user?.name)}
              </div>
              <ChevronDown size={14} className="text-[#6B7690]" />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
