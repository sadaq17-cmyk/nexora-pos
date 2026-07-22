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
  const mod = await server.ssrLoadModule(`/src/lib/mockApi.js?t=${Date.now()}_${Math.random()}`);
  return mod.mockApi;
}

function payload(n) {
  return {
    company_name: `Seq Co ${n}`,
    business_type: "Retail",
    country: "Kenya",
    currency: "KES",
    time_zone: "Africa/Nairobi",
    company_email: `contact_seq${n}@example.com`,
    company_phone: "+254700000010",
    company_address: "123 Test Ave",
    subscription_plan: "Enterprise",
    subscription_expiry: "2027-12-31",
    status: "active",
    name: `Seq Owner ${n}`,
    username: `seqowner${n}`,
    email: `seqowner${n}@example.com`,
    phone: "+254700000011",
    password: "SecurePass123!",
    confirm_password: "SecurePass123!",
    pin: "1234",
    branch_name: "Main Branch",
  };
}

// --- Session 1: platform owner creates company #1 ---
let api = await freshApi();
await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
const c1 = await api.owner.createCompanyAccount(payload(1));
console.log("company 1 created:", c1.success, c1.company_id);

// --- Session 2 (reload): owner 1 logs in, checks permissions (sanity) ---
api = await freshApi();
const o1login = await api.auth.loginByEmail("seqowner1@example.com", "SecurePass123!");
console.log("owner1 login:", o1login.success, o1login.user?.company_id);
const mine1 = await api.permissions.getMine();
console.log("owner1 users perm:", JSON.stringify(mine1.users));

// --- Session 3 (reload): owner1 logs out, platform owner logs back in, creates company #2 ---
api = await freshApi();
await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
const c2 = await api.owner.createCompanyAccount(payload(2));
console.log("company 2 created:", c2.success, c2.company_id, c2.error || "");

// --- Session 4 (reload): owner 2 logs in, checks permissions ---
api = await freshApi();
const o2login = await api.auth.loginByEmail("seqowner2@example.com", "SecurePass123!");
console.log("owner2 login:", o2login.success, o2login.user?.company_id, o2login.error || "");
const mine2 = await api.permissions.getMine();
console.log("owner2 users perm:", JSON.stringify(mine2.users));

// Raw storage inspection
const rawDb = JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
console.log("permissionMatrices keys:", Object.keys(rawDb.permissionMatrices || {}));
console.log("permissionMatrices[company2] owner.users:", JSON.stringify(rawDb.permissionMatrices?.[c2.company_id]?.owner?.users));

await server.close();
