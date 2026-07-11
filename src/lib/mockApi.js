// In-memory fallback so `npm run dev` (plain Vite, no Electron) still renders
// something useful during UI work. Real persistence only happens through
// electron/preload.js + better-sqlite3 when running inside Electron.
let products = [
  { id: 1, name: "Sugar 2kg", barcode: "8901030001", category: "Groceries", price: 280, cost: 220, stock: 45, reorder_level: 20, unit: "bag" },
  { id: 2, name: "Rice 5kg", barcode: "8901030002", category: "Groceries", price: 650, cost: 520, stock: 30, reorder_level: 15, unit: "bag" },
  { id: 3, name: "Cooking Oil 2L", barcode: "8901030003", category: "Groceries", price: 480, cost: 400, stock: 18, reorder_level: 20, unit: "bottle" },
  { id: 4, name: "Milk 500ml", barcode: "8901030004", category: "Dairy", price: 65, cost: 50, stock: 8, reorder_level: 25, unit: "packet" },
  { id: 5, name: "Bread 400g", barcode: "8901030005", category: "Bakery", price: 60, cost: 42, stock: 22, reorder_level: 15, unit: "loaf" },
  { id: 6, name: "Soft Drinks 500ml", barcode: "8901030006", category: "Beverages", price: 70, cost: 50, stock: 60, reorder_level: 20, unit: "bottle" },
];
let customers = [
  { id: 1, name: "Ahmed Ali", phone: "+254 712 345 678", email: "ahmed.ali@email.com", points: 245, visits: 18, spent: 24500, credit_limit: 50000, balance: 0 },
  { id: 2, name: "Fatima Hassan", phone: "+254 723 456 789", email: "fatima.h@email.com", points: 182, visits: 12, spent: 18200, credit_limit: 20000, balance: 0 },
  { id: 3, name: "Mohamed Noor", phone: "+254 733 567 890", email: "m.noor@email.com", points: 317, visits: 25, spent: 31750, credit_limit: 0, balance: 0 },
];
let customerPayments = [];
let sales = [];
let nextSaleId = 1;

let suppliers = [
  { id: 1, name: "Coca-Cola Kenya", contact_person: "James Mwangi", phone: "+254 700 111 222", category: "Beverages", status: "Active", order_count: 1, total_ordered: 62000, balance: 0 },
  { id: 2, name: "Brookside Dairy", contact_person: "Grace Wanjiru", phone: "+254 700 222 333", category: "Dairy", status: "Active", order_count: 1, total_ordered: 18500, balance: 0 },
  { id: 3, name: "Bidco Africa", contact_person: "Peter Otieno", phone: "+254 700 333 444", category: "Groceries", status: "Active", order_count: 1, total_ordered: 45000, balance: 4400 },
];
let supplierPayments = [];
let purchases = [
  { id: 1, po_number: "PO-1042", supplier_id: 3, supplier: "Bidco Africa", invoice_no: "INV-5521", total: 45000, status: "Received", created_at: "2026-07-10", item_count: 3 },
  { id: 2, po_number: "PO-1041", supplier_id: 2, supplier: "Brookside Dairy", invoice_no: null, total: 18500, status: "Pending", created_at: "2026-07-09", item_count: 2 },
  { id: 3, po_number: "PO-1040", supplier_id: 1, supplier: "Coca-Cola Kenya", invoice_no: null, total: 62000, status: "Ordered", created_at: "2026-07-07", item_count: 5 },
];
let purchaseReturns = [];
let expenseCategories = [
  { id: 1, name: "Rent" }, { id: 2, name: "Utilities" }, { id: 3, name: "Payroll" },
  { id: 4, name: "Logistics" }, { id: 5, name: "Maintenance" }, { id: 6, name: "Marketing" }, { id: 7, name: "Other" },
];
let expenses = [
  { id: 1, name: "Shop Rent", category: "Rent", expense_date: "2026-07-01", amount: 45000, receipt_path: null },
  { id: 2, name: "Electricity Bill", category: "Utilities", expense_date: "2026-07-03", amount: 8200, receipt_path: null },
  { id: 3, name: "Staff Salaries", category: "Payroll", expense_date: "2026-07-05", amount: 120000, receipt_path: null },
];
let settingsStore = {
  store_name: "Nexora Supermarket — Westlands", store_phone: "+254 700 555 123",
  store_address: "Waiyaki Way, Nairobi", currency: "KES (Ksh)", vat_rate: "16",
  tax_pin: "P051234567X", payment_cash: "true", payment_card: "true", payment_mpesa: "true",
  firebase_sync_enabled: "false", receipt_header: "Thank you for shopping with us!",
  receipt_footer: "Goods sold in good condition are exchangeable within 7 days with receipt.",
  barcode_prefix: "89", barcode_format: "EAN-13", printer_name: "",
  auto_backup_enabled: "true", auto_backup_interval_hours: "24", last_backup_at: "",
};
let auditLog = [];
const ROLES = ["manager", "cashier", "accountant"];
const MODULES = ["dashboard", "pos", "products", "inventory", "sales", "customers", "suppliers", "purchases", "expenses", "reports", "settings", "users", "audit"];
const ACTIONS = ["view", "create", "edit", "delete"];
let permissionMatrix = {
  manager: Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, !(m === "settings" || m === "users") && !(a === "delete" && ["sales", "purchases"].includes(m))]))])),
  cashier: Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, ["pos", "sales", "customers"].includes(m) ? a === "view" || a === "create" : ["dashboard", "products", "inventory"].includes(m) && a === "view"]))])),
  accountant: Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, ["expenses", "purchases", "suppliers", "reports"].includes(m) ? true : ["dashboard", "customers", "products", "inventory", "sales"].includes(m) && a === "view"]))])),
};
let currentMockUser = null;

const wait = (v) => new Promise((res) => setTimeout(() => res(v), 120));
const logAudit = (action, module, details) => auditLog.unshift({ id: auditLog.length + 1, user_id: currentMockUser?.id, user_name: currentMockUser?.name || "System", action, module, details: JSON.stringify(details || {}), created_at: new Date().toISOString() });

export const mockApi = {
  __isMock: true,
  auth: {
    login: (email, password) => {
      const known = {
        "admin@nexorapos.com": { id: 1, name: "Jane Mwikali", role: "admin" },
        "cashier@nexorapos.com": { id: 2, name: "Brian Otieno", role: "cashier" },
        "manager@nexorapos.com": { id: 3, name: "Lucy Wambui", role: "manager" },
        "accountant@nexorapos.com": { id: 4, name: "David Kamau", role: "accountant" },
      };
      const user = known[email.trim().toLowerCase()];
      if (user && password.length >= 3) {
        currentMockUser = user;
        logAudit("login", "auth", { email });
        return wait({ success: true, user: { ...user, email } });
      }
      return wait({ success: false, error: "Invalid credentials (mock mode)." });
    },
    restoreSession: (user) => { currentMockUser = user; return wait({ success: true }); },
    logout: () => { logAudit("logout", "auth", {}); currentMockUser = null; return wait({ success: true }); },
    listUsers: () => wait([
      { id: 1, name: "Jane Mwikali", email: "admin@nexorapos.com", role: "admin", active: 1 },
      { id: 2, name: "Brian Otieno", email: "cashier@nexorapos.com", role: "cashier", active: 1 },
      { id: 3, name: "Lucy Wambui", email: "manager@nexorapos.com", role: "manager", active: 1 },
      { id: 4, name: "David Kamau", email: "accountant@nexorapos.com", role: "accountant", active: 1 },
    ]),
  },
  products: {
    getAll: () => wait(products),
    getByBarcode: (barcode) => wait(products.find((p) => p.barcode === barcode) || null),
    getCategories: () => wait([...new Set(products.map((p) => p.category))].map((name, id) => ({ id, name }))),
    create: (p) => { const id = Math.max(0, ...products.map((x) => x.id)) + 1; products.push({ ...p, id }); logAudit("create_product", "products", { id }); return wait({ success: true, id }); },
    update: (p) => { products = products.map((x) => (x.id === p.id ? { ...x, ...p } : x)); logAudit("update_product", "products", { id: p.id }); return wait({ success: true }); },
    delete: (id) => { products = products.filter((x) => x.id !== id); logAudit("delete_product", "products", { id }); return wait({ success: true }); },
    adjustStock: (id, delta) => { products = products.map((x) => (x.id === id ? { ...x, stock: x.stock + delta } : x)); logAudit("adjust_stock", "inventory", { id, delta }); return wait({ success: true }); },
  },
  sales: {
    create: (sale) => {
      const id = nextSaleId++;
      const invoice_no = `TXN-${8000 + id}`;
      sales.unshift({ id, invoice_no, ...sale, created_at: new Date().toISOString() });
      sale.items.forEach((it) => { products = products.map((p) => (p.id === it.product_id ? { ...p, stock: p.stock - it.qty } : p)); });
      if (sale.customer_id) {
        customers = customers.map((c) => c.id === Number(sale.customer_id)
          ? { ...c, points: c.points + Math.floor(sale.total / 100), balance: sale.payment_method === "Credit" ? c.balance + sale.total : c.balance }
          : c);
      }
      logAudit("create_sale", "sales", { invoice_no, total: sale.total });
      return wait({ success: true, id, invoice_no });
    },
    getRecent: () => wait(sales.map((s) => ({ id: s.id, invoice_no: s.invoice_no, total: s.total, payment_method: s.payment_method, created_at: s.created_at, customer: "Walk-in", item_count: s.items?.length || 0 }))),
    getSummary: () => wait({ today: sales.reduce((a, s) => a + s.total, 0), todayCount: sales.length, monthRevenue: sales.reduce((a, s) => a + s.total, 0) }),
    getWeeklyTrend: () => wait(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({ day, sales: 0 }))),
    getItems: (saleId) => wait(sales.find((s) => s.id === saleId)?.items || []),
  },
  customers: {
    getAll: () => wait(customers),
    create: (c) => { const id = Math.max(0, ...customers.map((x) => x.id)) + 1; customers.push({ ...c, id, points: 0, visits: 0, spent: 0, balance: 0, credit_limit: c.credit_limit || 0 }); logAudit("create_customer", "customers", { id }); return wait({ success: true, id }); },
    update: (c) => { customers = customers.map((x) => (x.id === c.id ? { ...x, ...c } : x)); return wait({ success: true }); },
    delete: (id) => { customers = customers.filter((x) => x.id !== id); return wait({ success: true }); },
    addPayment: ({ customer_id, amount, method }) => {
      customerPayments.unshift({ id: customerPayments.length + 1, customer_id, amount, method, created_at: new Date().toISOString() });
      customers = customers.map((c) => (c.id === Number(customer_id) ? { ...c, balance: c.balance - amount } : c));
      logAudit("customer_payment", "customers", { customer_id, amount });
      return wait({ success: true });
    },
    getStatement: (id) => wait({
      customer: customers.find((c) => c.id === id),
      sales: sales.filter((s) => Number(s.customer_id) === id).map((s) => ({ id: s.id, invoice_no: s.invoice_no, total: s.total, payment_method: s.payment_method })),
      payments: customerPayments.filter((p) => Number(p.customer_id) === id),
    }),
    getPurchaseHistory: (id) => wait(sales.filter((s) => Number(s.customer_id) === id)),
  },
  suppliers: {
    getAll: () => wait(suppliers),
    create: (s) => { const id = Math.max(0, ...suppliers.map((x) => x.id)) + 1; suppliers.push({ ...s, id, order_count: 0, total_ordered: 0, balance: 0, status: s.status || "Active" }); logAudit("create_supplier", "suppliers", { id }); return wait({ success: true, id }); },
    update: (s) => { suppliers = suppliers.map((x) => (x.id === s.id ? { ...x, ...s } : x)); return wait({ success: true }); },
    delete: (id) => { suppliers = suppliers.filter((x) => x.id !== id); return wait({ success: true }); },
    addPayment: ({ supplier_id, amount, method }) => {
      supplierPayments.unshift({ id: supplierPayments.length + 1, supplier_id, amount, method, created_at: new Date().toISOString() });
      suppliers = suppliers.map((s) => (s.id === Number(supplier_id) ? { ...s, balance: s.balance - amount } : s));
      logAudit("supplier_payment", "suppliers", { supplier_id, amount });
      return wait({ success: true });
    },
    getStatement: (id) => wait({
      supplier: suppliers.find((s) => s.id === id),
      purchases: purchases.filter((p) => Number(p.supplier_id) === id),
      payments: supplierPayments.filter((p) => Number(p.supplier_id) === id),
    }),
  },
  purchases: {
    getAll: () => wait(purchases),
    getItems: () => wait([]),
    getReturns: () => wait(purchaseReturns),
    create: (p) => {
      const id = Math.max(0, ...purchases.map((x) => x.id)) + 1;
      const total = p.items.reduce((s, it) => s + it.qty * it.cost, 0);
      const supplier = suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "Unknown";
      const po_number = `PO-${1040 + purchases.length + 1}`;
      purchases.unshift({ id, po_number, supplier_id: p.supplier_id, supplier, invoice_no: p.invoice_no || null, total, status: p.status || "Pending", created_at: new Date().toISOString().slice(0, 10), item_count: p.items.length });
      logAudit("create_purchase", "purchases", { po_number });
      return wait({ success: true, id, po_number, total });
    },
    receive: (id) => {
      const po = purchases.find((p) => p.id === id);
      if (po && po.supplier_id) suppliers = suppliers.map((s) => (s.id === Number(po.supplier_id) ? { ...s, balance: s.balance + po.total } : s));
      purchases = purchases.map((p) => (p.id === id ? { ...p, status: "Received" } : p));
      logAudit("receive_purchase", "purchases", { id });
      return wait({ success: true });
    },
    updateStatus: (id, status) => { purchases = purchases.map((p) => (p.id === id ? { ...p, status } : p)); return wait({ success: true }); },
    createReturn: (ret) => {
      const id = purchaseReturns.length + 1;
      purchaseReturns.unshift({ id, ...ret });
      products = products.map((p) => (p.id === ret.product_id ? { ...p, stock: p.stock - ret.qty } : p));
      const po = purchases.find((p) => p.id === ret.purchase_id);
      if (po?.supplier_id) suppliers = suppliers.map((s) => (s.id === Number(po.supplier_id) ? { ...s, balance: s.balance - ret.qty * ret.cost } : s));
      logAudit("purchase_return", "purchases", ret);
      return wait({ success: true, id });
    },
  },
  expenses: {
    getAll: () => wait(expenses),
    getCategories: () => wait(expenseCategories),
    createCategory: (name) => {
      if (expenseCategories.some((c) => c.name === name)) return wait({ success: false, error: "That category already exists." });
      const id = expenseCategories.length + 1;
      expenseCategories.push({ id, name });
      return wait({ success: true, id });
    },
    create: (e) => { const id = Math.max(0, ...expenses.map((x) => x.id)) + 1; expenses.unshift({ ...e, id }); logAudit("create_expense", "expenses", { id }); return wait({ success: true, id }); },
    update: (e) => { expenses = expenses.map((x) => (x.id === e.id ? { ...x, ...e } : x)); return wait({ success: true }); },
    delete: (id) => { expenses = expenses.filter((x) => x.id !== id); return wait({ success: true }); },
    attachReceipt: () => wait({ success: false, error: "Attaching receipts requires the desktop app (Electron)." }),
    openReceipt: () => wait({ success: false, error: "Opening receipts requires the desktop app (Electron)." }),
    getSummary: () => {
      const monthTotal = expenses.reduce((s, e) => s + e.amount, 0);
      const byCategory = Object.entries(expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {})).map(([category, total]) => ({ category, total }));
      return wait({ monthTotal, byCategory });
    },
  },
  reports: {
    getRevenueVsExpenses: () => wait([
      { month: "2026-05", revenue: 1050000, expenses: 650000 },
      { month: "2026-06", revenue: 1245300, expenses: 715000 },
      { month: "2026-07", revenue: 620000, expenses: 182800 },
    ]),
    getTopProducts: () => wait(products.slice(0, 5).map((p) => ({ name: p.name, revenue: p.price * 40, units: 40 }))),
    getCategorySales: () => wait([...new Set(products.map((p) => p.category))].map((name) => ({ name, value: 15000 + Math.random() * 20000 }))),
    getProfitSummary: () => wait({ revenue: 620000, cost: 460000, profit: 160000 }),
    getSalesReport: () => wait({ rows: sales.map((s) => ({ id: s.id, invoice_no: s.invoice_no, total: s.total, payment_method: s.payment_method, created_at: s.created_at, customer: "Walk-in" })), totals: { total: sales.reduce((a, s) => a + s.total, 0) } }),
    getPurchaseReport: () => wait({ rows: purchases, total: purchases.reduce((a, p) => a + p.total, 0) }),
    getProfitLoss: () => wait({ month: new Date().toISOString().slice(0, 7), revenue: 620000, cogs: 460000, grossProfit: 160000, expenses: 182800, netProfit: -22800 }),
    getInventoryReport: () => wait({ rows: products.map((p) => ({ ...p, stock_value: p.stock * p.cost })), totalValue: products.reduce((a, p) => a + p.stock * p.cost, 0) }),
    getLowStockReport: () => wait(products.filter((p) => p.stock <= p.reorder_level)),
    getCustomerReport: () => wait(customers),
    getSupplierReport: () => wait(suppliers),
  },
  settings: {
    getAll: () => wait(settingsStore),
    update: (updates) => { settingsStore = { ...settingsStore, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, String(v)])) }; return wait({ success: true }); },
    getPrinters: () => wait([]),
  },
  backup: {
    export: () => wait({ success: false, error: "Backup export requires the desktop app (Electron)." }),
    restore: () => wait({ success: false, error: "Backup restore requires the desktop app (Electron)." }),
    getHistory: () => wait([]),
    runNow: () => wait({ ran: false, reason: "requires_desktop_app" }),
  },
  sync: {
    getStatus: () => wait({ configured: false, pendingCount: 0 }),
    triggerNow: () => wait({ success: false, reason: "not_configured" }),
    setAutoSync: () => wait({ success: true }),
    onConnectionRestored: () => wait({ success: false, reason: "not_configured" }),
  },
  permissions: {
    getMatrix: () => wait({ matrix: { admin: Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, true]))])), ...permissionMatrix }, modules: MODULES, actions: ACTIONS }),
    getMine: () => {
      if (!currentMockUser) return wait({});
      if (currentMockUser.role === "admin") return wait(Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(ACTIONS.map((a) => [a, true]))])));
      return wait(permissionMatrix[currentMockUser.role] || {});
    },
    update: ({ role, module, action, allowed }) => {
      if (!ROLES.includes(role)) return wait({ success: false, error: "Invalid role." });
      permissionMatrix[role][module][action] = allowed;
      return wait({ success: true });
    },
  },
  audit: {
    getAll: ({ module } = {}) => wait(module ? auditLog.filter((l) => l.module === module) : auditLog),
    getLoginHistory: () => wait(auditLog.filter((l) => l.module === "auth")),
  },
  auth_admin: {
    createUser: () => wait({ success: false, error: "User management requires the desktop app (Electron)." }),
    setUserActive: () => wait({ success: true }),
    setUserRole: () => wait({ success: true }),
  },
};
