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
  { id: 1, name: "Ahmed Ali", phone: "+254 712 345 678", email: "ahmed.ali@email.com", points: 245, visits: 18, spent: 24500 },
  { id: 2, name: "Fatima Hassan", phone: "+254 723 456 789", email: "fatima.h@email.com", points: 182, visits: 12, spent: 18200 },
  { id: 3, name: "Mohamed Noor", phone: "+254 733 567 890", email: "m.noor@email.com", points: 317, visits: 25, spent: 31750 },
];
let sales = [];
let nextSaleId = 1;

let suppliers = [
  { id: 1, name: "Coca-Cola Kenya", contact_person: "James Mwangi", phone: "+254 700 111 222", category: "Beverages", status: "Active", order_count: 1, total_ordered: 62000 },
  { id: 2, name: "Brookside Dairy", contact_person: "Grace Wanjiru", phone: "+254 700 222 333", category: "Dairy", status: "Active", order_count: 1, total_ordered: 18500 },
  { id: 3, name: "Bidco Africa", contact_person: "Peter Otieno", phone: "+254 700 333 444", category: "Groceries", status: "Active", order_count: 1, total_ordered: 45000 },
];
let purchases = [
  { id: 1, po_number: "PO-1042", supplier_id: 3, supplier: "Bidco Africa", total: 45000, status: "Received", created_at: "2026-07-10", item_count: 3 },
  { id: 2, po_number: "PO-1041", supplier_id: 2, supplier: "Brookside Dairy", total: 18500, status: "Pending", created_at: "2026-07-09", item_count: 2 },
  { id: 3, po_number: "PO-1040", supplier_id: 1, supplier: "Coca-Cola Kenya", total: 62000, status: "Ordered", created_at: "2026-07-07", item_count: 5 },
];
let expenses = [
  { id: 1, name: "Shop Rent", category: "Rent", expense_date: "2026-07-01", amount: 45000 },
  { id: 2, name: "Electricity Bill", category: "Utilities", expense_date: "2026-07-03", amount: 8200 },
  { id: 3, name: "Staff Salaries", category: "Payroll", expense_date: "2026-07-05", amount: 120000 },
];
let settingsStore = {
  store_name: "Nexora Supermarket — Westlands", store_phone: "+254 700 555 123",
  store_address: "Waiyaki Way, Nairobi", currency: "KES (Ksh)", vat_rate: "16",
  tax_pin: "P051234567X", payment_cash: "true", payment_card: "true", payment_mpesa: "true",
  firebase_sync_enabled: "false",
};

const wait = (v) => new Promise((res) => setTimeout(() => res(v), 120));

export const mockApi = {
  __isMock: true,
  auth: {
    login: (email, password) => {
      const known = {
        "admin@nexorapos.com": { id: 1, name: "Jane Mwikali", role: "admin" },
        "cashier@nexorapos.com": { id: 2, name: "Brian Otieno", role: "cashier" },
        "manager@nexorapos.com": { id: 3, name: "Lucy Wambui", role: "manager" },
      };
      const user = known[email.trim().toLowerCase()];
      if (user && password.length >= 3) return wait({ success: true, user: { ...user, email } });
      return wait({ success: false, error: "Invalid credentials (mock mode)." });
    },
    listUsers: () => wait([]),
  },
  products: {
    getAll: () => wait(products),
    getByBarcode: (barcode) => wait(products.find((p) => p.barcode === barcode) || null),
    getCategories: () => wait([...new Set(products.map((p) => p.category))].map((name, id) => ({ id, name }))),
    create: (p) => { const id = Math.max(0, ...products.map((x) => x.id)) + 1; products.push({ ...p, id }); return wait({ success: true, id }); },
    update: (p) => { products = products.map((x) => (x.id === p.id ? { ...x, ...p } : x)); return wait({ success: true }); },
    delete: (id) => { products = products.filter((x) => x.id !== id); return wait({ success: true }); },
    adjustStock: (id, delta) => { products = products.map((x) => (x.id === id ? { ...x, stock: x.stock + delta } : x)); return wait({ success: true }); },
  },
  sales: {
    create: (sale) => {
      const id = nextSaleId++;
      const invoice_no = `TXN-${8000 + id}`;
      sales.unshift({ id, invoice_no, ...sale, created_at: new Date().toISOString() });
      sale.items.forEach((it) => {
        products = products.map((p) => (p.id === it.product_id ? { ...p, stock: p.stock - it.qty } : p));
      });
      return wait({ success: true, id, invoice_no });
    },
    getRecent: () =>
      wait(
        sales.map((s) => ({
          id: s.id, invoice_no: s.invoice_no, total: s.total, payment_method: s.payment_method,
          created_at: s.created_at, customer: "Walk-in", item_count: s.items?.length || 0,
        }))
      ),
    getSummary: () => wait({
      today: sales.reduce((a, s) => a + s.total, 0),
      todayCount: sales.length,
      monthRevenue: sales.reduce((a, s) => a + s.total, 0),
    }),
    getWeeklyTrend: () => {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      return wait(days.map((day) => ({ day, sales: 0 })));
    },
    getItems: (saleId) => wait(sales.find((s) => s.id === saleId)?.items || []),
  },
  customers: {
    getAll: () => wait(customers),
    create: (c) => { const id = Math.max(0, ...customers.map((x) => x.id)) + 1; customers.push({ ...c, id, points: 0, visits: 0, spent: 0 }); return wait({ success: true, id }); },
  },
  suppliers: {
    getAll: () => wait(suppliers),
    create: (s) => { const id = Math.max(0, ...suppliers.map((x) => x.id)) + 1; suppliers.push({ ...s, id, order_count: 0, total_ordered: 0, status: s.status || "Active" }); return wait({ success: true, id }); },
    update: (s) => { suppliers = suppliers.map((x) => (x.id === s.id ? { ...x, ...s } : x)); return wait({ success: true }); },
    delete: (id) => { suppliers = suppliers.filter((x) => x.id !== id); return wait({ success: true }); },
  },
  purchases: {
    getAll: () => wait(purchases),
    getItems: () => wait([]),
    create: (p) => {
      const id = Math.max(0, ...purchases.map((x) => x.id)) + 1;
      const total = p.items.reduce((s, it) => s + it.qty * it.cost, 0);
      const supplier = suppliers.find((s) => s.id === Number(p.supplier_id))?.name || "Unknown";
      const po_number = `PO-${1040 + purchases.length + 1}`;
      purchases.unshift({ id, po_number, supplier_id: p.supplier_id, supplier, total, status: p.status || "Pending", created_at: new Date().toISOString().slice(0, 10), item_count: p.items.length });
      return wait({ success: true, id, po_number, total });
    },
    receive: (id) => { purchases = purchases.map((p) => (p.id === id ? { ...p, status: "Received" } : p)); return wait({ success: true }); },
    updateStatus: (id, status) => { purchases = purchases.map((p) => (p.id === id ? { ...p, status } : p)); return wait({ success: true }); },
  },
  expenses: {
    getAll: () => wait(expenses),
    create: (e) => { const id = Math.max(0, ...expenses.map((x) => x.id)) + 1; expenses.unshift({ ...e, id }); return wait({ success: true, id }); },
    update: (e) => { expenses = expenses.map((x) => (x.id === e.id ? { ...x, ...e } : x)); return wait({ success: true }); },
    delete: (id) => { expenses = expenses.filter((x) => x.id !== id); return wait({ success: true }); },
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
  },
  settings: {
    getAll: () => wait(settingsStore),
    update: (updates) => { settingsStore = { ...settingsStore, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, String(v)])) }; return wait({ success: true }); },
  },
  backup: {
    export: () => wait({ success: false, error: "Backup export requires the desktop app (Electron)." }),
    restore: () => wait({ success: false, error: "Backup restore requires the desktop app (Electron)." }),
  },
  sync: {
    getStatus: () => wait({ configured: false, pendingCount: sales.filter((s) => !s.synced).length }),
    triggerNow: () => wait({ success: false, reason: "not_configured" }),
    setAutoSync: () => wait({ success: true }),
  },
  auth_admin: {
    createUser: () => wait({ success: false, error: "User management requires the desktop app (Electron)." }),
    setUserActive: () => wait({ success: true }),
    setUserRole: () => wait({ success: true }),
  },
};
