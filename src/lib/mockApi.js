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
};
