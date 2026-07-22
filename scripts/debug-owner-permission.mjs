import { createServer } from "vite";

const store = new Map();
const storage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.window = { localStorage: storage, sessionStorage: storage };

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { mockApi: api } = await server.ssrLoadModule("/src/lib/mockApi.js");

const platformLogin = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
console.log("platform login:", platformLogin.success, platformLogin.error || "");

const created = await api.owner.createCompanyAccount({
  company_name: "Debug Owner Perm Co",
  business_type: "Retail",
  country: "Kenya",
  currency: "KES",
  time_zone: "Africa/Nairobi",
  company_email: "contact_debugowner@example.com",
  company_phone: "+254700000010",
  company_address: "123 Test Ave",
  subscription_plan: "Enterprise",
  subscription_expiry: "2027-12-31",
  status: "active",
  name: "Debug Owner",
  username: "debugowner1",
  email: "debugowner1@example.com",
  phone: "+254700000011",
  password: "SecurePass123!",
  confirm_password: "SecurePass123!",
  pin: "1234",
  branch_name: "Main Branch",
});
console.log("company created:", created.success, created.error || "", created);

const ownerLogin = await api.auth.loginByEmail
  ? await api.auth.loginByEmail("debugowner1@example.com", "SecurePass123!")
  : null;
console.log("owner login via loginByEmail:", ownerLogin?.success, ownerLogin?.error || "", ownerLogin?.user?.role);

const mine = await api.permissions.getMine();
console.log("permissions.getMine() users module:", JSON.stringify(mine.users));

const createUserResult = await api.auth_admin.createUser({
  name: "Debug Cashier",
  username: "debugcashier1",
  email: "debugcashier1@example.com",
  phone: "",
  password: "CashierPass123!",
  pin: "5678",
  role: "cashier",
  branch_id: 1,
  active: 1,
});
console.log("auth_admin.createUser result:", JSON.stringify(createUserResult));

await server.close();
