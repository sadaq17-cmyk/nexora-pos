import { Suspense, lazy } from "react";
import { BrowserRouter, HashRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import Layout from "./components/Layout";
import PublicLayout from "./components/public/PublicLayout";
import { ThemeProvider } from "./context/ThemeContext";
import { EnterpriseSettingsProvider } from "./context/EnterpriseSettingsContext";
import { useHashRouter } from "./lib/desktopRuntime";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const POS = lazy(() => import("./pages/POS"));
const Products = lazy(() => import("./pages/Products"));
const Categories = lazy(() => import("./pages/Categories"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Barcode = lazy(() => import("./pages/Barcode"));
const Customers = lazy(() => import("./pages/Customers"));
const SalesHistory = lazy(() => import("./pages/SalesHistory"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Purchases = lazy(() => import("./pages/Purchases"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Payroll = lazy(() => import("./pages/Payroll"));
const PayrollSelfService = lazy(() => import("./pages/PayrollSelfService"));
const Reports = lazy(() => import("./pages/Reports"));
const Users = lazy(() => import("./pages/Users"));
const Branches = lazy(() => import("./pages/Branches"));
const UserForm = lazy(() => import("./pages/UserForm"));
const UserStatus = lazy(() => import("./pages/UserStatus"));
const UserSalesReport = lazy(() => import("./pages/UserSalesReport"));
const RolesPermissions = lazy(() => import("./pages/RolesPermissions"));
const Settings = lazy(() => import("./pages/Settings"));
const Subscription = lazy(() => import("./pages/Subscription"));
const Notifications = lazy(() => import("./pages/Notifications"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const OwnerManagement = lazy(() => import("./pages/OwnerManagement"));
const Approvals = lazy(() => import("./pages/Approvals"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const SubscriptionRenew = lazy(() => import("./pages/SubscriptionRenew"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Home = lazy(() => import("./pages/public/Home"));
const Features = lazy(() => import("./pages/public/Features"));
const Pricing = lazy(() => import("./pages/public/Pricing"));
const Download = lazy(() => import("./pages/public/Download"));
const Contact = lazy(() => import("./pages/public/Contact"));
const Faq = lazy(() => import("./pages/public/Faq"));
const Help = lazy(() => import("./pages/public/Help"));
const Support = lazy(() => import("./pages/public/Support"));
const Signup = lazy(() => import("./pages/public/Signup"));
const ForgotPassword = lazy(() => import("./pages/public/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/public/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/public/VerifyEmail"));
const VerifyEmailChange = lazy(() => import("./pages/public/VerifyEmailChange"));
const InvoiceVerify = lazy(() => import("./pages/public/InvoiceVerify"));

function Guarded({ module, children }) {
  return <ProtectedRoute module={module}>{children}</ProtectedRoute>;
}

function RouteFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6" role="status" aria-live="polite">
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-40 rounded-md bg-app-panel-muted" />
        <div className="h-24 w-full rounded-xl bg-app-panel-muted" />
        <div className="space-y-2 rounded-xl border border-app-border p-3">
          <div className="h-10 w-full rounded-md bg-app-panel-muted" />
          <div className="h-10 w-full rounded-md bg-app-panel-muted" />
          <div className="h-10 w-full rounded-md bg-app-panel-muted" />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  // Electron loadFile (file://) cannot use path-based BrowserRouter — pathname is the
  // filesystem path and hits the catch-all NotFound ("That page doesn't exist.").
  // Web / Vercel keep BrowserRouter. Packaged desktop prefers the production https origin.
  const Router = useHashRouter() ? HashRouter : BrowserRouter;

  return (
    <ThemeProvider>
      <AuthProvider>
        <EnterpriseSettingsProvider>
          <ToastProvider>
            <Router>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route element={<PublicLayout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/features" element={<Features />} />
                    <Route path="/pricing" element={<Pricing />} />
                    <Route path="/download" element={<Download />} />
                    <Route path="/contact" element={<Contact />} />
                    <Route path="/faq" element={<Faq />} />
                    <Route path="/help" element={<Help />} />
                    <Route path="/support" element={<Support />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/verify-email-change" element={<VerifyEmailChange />} />
                    <Route path="/invoice/:invoiceId" element={<InvoiceVerify />} />
                  </Route>

                  <Route
                    element={
                      <RouteErrorBoundary>
                        <ProtectedRoute>
                          <Layout />
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  >
                    <Route path="/dashboard" element={<Guarded module="dashboard"><Dashboard /></Guarded>} />
                    <Route path="/pos" element={<Guarded module="pos"><POS /></Guarded>} />
                    <Route path="/products" element={<Guarded module="products"><Products /></Guarded>} />
                    <Route path="/categories" element={<Guarded module="categories"><Categories /></Guarded>} />
                    <Route path="/inventory" element={<Guarded module="inventory"><Inventory /></Guarded>} />
                    <Route path="/barcode" element={<Guarded module="barcode"><Barcode /></Guarded>} />
                    <Route path="/sales" element={<Guarded module="sales"><SalesHistory /></Guarded>} />
                    <Route path="/customers" element={<Guarded module="customers"><Customers /></Guarded>} />
                    <Route path="/suppliers" element={<Guarded module="suppliers"><Suppliers /></Guarded>} />
                    <Route path="/purchases" element={<Guarded module="purchases"><Purchases /></Guarded>} />
                    <Route path="/reports" element={<Guarded module="reports"><Reports /></Guarded>} />
                    <Route path="/reports/users" element={<Guarded module="reports"><UserSalesReport /></Guarded>} />
                    <Route path="/expenses" element={<Guarded module="expenses"><Expenses /></Guarded>} />
                    <Route path="/payroll" element={<Guarded module="payroll"><Payroll /></Guarded>} />
                    <Route path="/payroll/self" element={<Guarded module="payroll"><PayrollSelfService /></Guarded>} />
                    <Route path="/users" element={<Guarded module="users"><Users /></Guarded>} />
                    <Route path="/branches" element={<Guarded module="branches"><Branches /></Guarded>} />
                    <Route path="/users/new" element={<ProtectedRoute module="users" action="create" allowedRoles={["owner", "super_admin", "admin", "platform_owner"]}><UserForm /></ProtectedRoute>} />
                    <Route path="/users/:id/edit" element={<ProtectedRoute module="users" action="edit" allowedRoles={["owner", "super_admin", "admin", "platform_owner"]}><UserForm /></ProtectedRoute>} />
                    <Route path="/user-status" element={<Guarded module="users"><UserStatus /></Guarded>} />
                    <Route path="/approvals" element={<Guarded module="platform_approvals"><Approvals /></Guarded>} />
                    <Route path="/platform/approvals" element={<ProtectedRoute module="platform_approvals" allowedRoles={["platform_owner"]}><Approvals /></ProtectedRoute>} />
                    <Route path="/roles" element={<Guarded module="roles"><RolesPermissions /></Guarded>} />
                    <Route path="/settings" element={<Guarded module="settings"><Settings /></Guarded>} />
                    <Route path="/settings/login-security" element={<Guarded module="settings"><Settings /></Guarded>} />
                    <Route path="/subscription" element={<ProtectedRoute module="subscription" allowedRoles={["owner", "platform_owner"]}><Subscription /></ProtectedRoute>} />
                    <Route path="/notifications" element={<Guarded module="dashboard"><Notifications /></Guarded>} />
                    <Route path="/audit" element={<Guarded module="audit_logs"><AuditLog /></Guarded>} />
                    <Route path="/owner-management" element={<Navigate to="/platform" replace />} />
                    <Route path="/platform" element={<ProtectedRoute module="owner_management" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/companies" element={<ProtectedRoute module="company_accounts" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/subscriptions" element={<ProtectedRoute module="subscriptions" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/pricing" element={<ProtectedRoute module="plans" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/users" element={<Navigate to="/platform/companies" replace />} />
                    <Route path="/platform/branches" element={<Navigate to="/platform/companies" replace />} />
                    <Route path="/platform/roles" element={<Navigate to="/platform/settings" replace />} />
                    <Route path="/platform/backup" element={<Navigate to="/platform/settings" replace />} />
                    <Route path="/platform/search" element={<Navigate to="/platform/companies" replace />} />
                    <Route path="/platform/payments" element={<ProtectedRoute module="billing" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/analytics" element={<ProtectedRoute module="platform_analytics" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/domains" element={<Navigate to="/platform/settings" replace />} />
                    <Route path="/platform/support" element={<ProtectedRoute module="owner_management" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/ai-guardian" element={<ProtectedRoute module="owner_management" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/settings" element={<ProtectedRoute module="platform_settings" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/platform/audit" element={<ProtectedRoute module="platform_audit" allowedRoles={["platform_owner"]}><OwnerManagement /></ProtectedRoute>} />
                    <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
                  </Route>

                  {/* Standalone renewal portal — must NOT nest under Layout (sidebar/AI/settings
                      fetches can blank the page when subscription APIs fail). */}
                  <Route
                    path="/subscription/renew"
                    element={
                      <RouteErrorBoundary>
                        <ProtectedRoute>
                          <SubscriptionRenew />
                        </ProtectedRoute>
                      </RouteErrorBoundary>
                    }
                  />
                  <Route path="/subscription/payment" element={<Navigate to="/subscription/renew" replace />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Router>
          </ToastProvider>
        </EnterpriseSettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
