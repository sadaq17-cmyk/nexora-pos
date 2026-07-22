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

async function freshApi() {
  // cache-bust to force a brand new module instance (simulating a full page reload)
  const mod = await server.ssrLoadModule(`/src/lib/mockApi.js?t=${Date.now()}_${Math.random()}`);
  return mod.mockApi;
}

let api = await freshApi();
const platformLogin = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
console.log("platform login:", platformLogin.success);

const created = await api.owner.createCompanyAccount({
  company_name: "Reload Test Co",
  business_type: "Retail",
  country: "Kenya",
  currency: "KES",
  time_zone: "Africa/Nairobi",
  company_email: "contact_reloadtest@example.com",
  company_phone: "+254700000010",
  company_address: "123 Test Ave",
  subscription_plan: "Enterprise",
  subscription_expiry: "2027-12-31",
  status: "active",
  name: "Reload Owner",
  username: "reloadowner1",
  email: "reloadowner1@example.com",
  phone: "+254700000011",
  password: "SecurePass123!",
  confirm_password: "SecurePass123!",
  pin: "1234",
  branch_name: "Main Branch",
});
console.log("company created:", created.success, created.error || "", created.company_id);

console.log("--- Simulating LOGOUT + fresh page load (new module instance) ---");
api = await freshApi();

const ownerLogin = await api.auth.loginByEmail("reloadowner1@example.com", "SecurePass123!");
console.log("owner login after reload:", ownerLogin.success, ownerLogin.error || "", ownerLogin.user?.role, ownerLogin.user?.company_id);

console.log("--- Simulating client-side nav to /users (NO reload) ---");
const mineNoReload = await api.permissions.getMine();
console.log("permissions.getMine() [no reload] users:", JSON.stringify(mineNoReload.users));

console.log("--- Simulating a HARD navigation reload before checking /users/new ---");
api = await freshApi();
// restoreSession-equivalent: real app calls auth.restoreSession(cachedUser) on reload.
const restored = await api.auth.restoreSession({ id: ownerLogin.user.id, role: ownerLogin.user.role, company_id: ownerLogin.user.company_id, session_id: ownerLogin.user.session_id });
console.log("restoreSession after reload:", restored.success, restored.error || "");
const mineAfterReload = await api.permissions.getMine();
console.log("permissions.getMine() [after reload] users:", JSON.stringify(mineAfterReload.users));

await server.close();
