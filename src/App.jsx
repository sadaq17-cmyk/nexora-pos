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
import Suppliers from "./pages/Suppliers";
import Purchases from "./pages/Purchases";
import Expenses from "./pages/Expenses";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import AuditLog from "./pages/AuditLog";
import NotFound from "./pages/NotFound";

function Guarded({ module, children }) {
  return <ProtectedRoute module={module}>{children}</ProtectedRoute>;
}

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
              <Route path="/dashboard" element={<Guarded module="dashboard"><Dashboard /></Guarded>} />
              <Route path="/pos" element={<Guarded module="pos"><POS /></Guarded>} />
              <Route path="/products" element={<Guarded module="products"><Products /></Guarded>} />
              <Route path="/inventory" element={<Guarded module="inventory"><Inventory /></Guarded>} />
              <Route path="/sales" element={<Guarded module="sales"><SalesHistory /></Guarded>} />
              <Route path="/customers" element={<Guarded module="customers"><Customers /></Guarded>} />
              <Route path="/suppliers" element={<Guarded module="suppliers"><Suppliers /></Guarded>} />
              <Route path="/purchases" element={<Guarded module="purchases"><Purchases /></Guarded>} />
              <Route path="/reports" element={<Guarded module="reports"><Reports /></Guarded>} />
              <Route path="/expenses" element={<Guarded module="expenses"><Expenses /></Guarded>} />
              <Route path="/audit" element={<Guarded module="audit"><AuditLog /></Guarded>} />
              <Route path="/settings" element={<Guarded module="settings"><Settings /></Guarded>} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
