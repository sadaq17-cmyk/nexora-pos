import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import POS from "./pages/POS";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Customers from "./pages/Customers";
import SalesHistory from "./pages/SalesHistory";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound";

// HashRouter is used (not BrowserRouter) because the production build is
// loaded from a local file:// URL inside Electron, where history-API
// routing can't resolve paths the way it can on a real web server.
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/sales" element={<SalesHistory />} />
              <Route path="/customers" element={<Customers />} />
              <Route
                path="/suppliers"
                element={<ComingSoon title="Suppliers" description="Manage the vendors that stock your shelves." />}
              />
              <Route
                path="/purchases"
                element={<ComingSoon title="Purchases" description="Track purchase orders placed with your suppliers." />}
              />
              <Route
                path="/reports"
                element={<ComingSoon title="Reports" description="Analyze sales performance and profitability." />}
              />
              <Route
                path="/expenses"
                element={<ComingSoon title="Expenses" description="Track operating costs for your store." />}
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute allowedRoles={["admin"]}>
                    <ComingSoon title="Settings" description="Configure your store, tax rules, and team access." />
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
