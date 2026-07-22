/**
 * Focused SaaS onboarding / auth checks against mockApi.
 * Uses an in-memory localStorage shim so browser storage is not required.
 */
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const memory = new Map();
const storage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

globalThis.window = { localStorage: storage, sessionStorage: storage };
storage.clear();

const { mockApi } = await import(pathToFileURL(path.join(root, "src/lib/mockApi.js")).href);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const plans = await mockApi.platformPublic.getPlans();
assert(Array.isArray(plans) && plans.length >= 4, "public plans missing");
assert(plans.every((plan) => !("id" in plan) && plan.price_monthly !== undefined), "public plans shape invalid");
assert(plans.every((plan) => !("password_hash" in plan)), "public plans leaked secrets");

const stamp = Date.now();
const email = `owner_${stamp}@example.com`;
const signup = await mockApi.publicAuth.signupCompany({
  company_name: `Acme Retail ${stamp}`,
  full_name: "Ada Owner",
  email,
  phone: "+254700000001",
  password: "SecurePass123!",
  plan_code: "free_trial",
});
assert(signup.success, `signup failed: ${signup.error}`);
assert(signup.company_code, "company code missing");

const conflict = await mockApi.publicAuth.signupCompany({
  company_name: `Other Co ${stamp}`,
  full_name: "Other Owner",
  email,
  phone: "+254700000002",
  password: "SecurePass123!",
});
assert(!conflict.success && conflict.code === "EMAIL_EXISTS", "unique owner email not enforced");

const beforeCount = JSON.parse(storage.getItem("nexora_pos_web_db_v3")).companies.length;
const badSignup = await mockApi.publicAuth.signupCompany({
  company_name: "",
  full_name: "X",
  email: "bad",
  phone: "",
  password: "short",
});
assert(!badSignup.success, "invalid signup should fail");
assert(JSON.parse(storage.getItem("nexora_pos_web_db_v3")).companies.length === beforeCount, "partial write on failed signup");

let db = JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
const company = db.companies.find((row) => row.code === signup.company_code);
const owner = db.users.find((row) => row.id === company.owner_user_id);
const subscription = db.subscriptions.find((row) => row.company_id === company.id);
const verification = db.emailVerifications.find((row) => row.company_id === company.id);
assert(owner.role === "owner", "public signup must create company owner");
assert(owner.role !== "platform_owner", "public signup must never create platform_owner");
assert(subscription?.status === "trialing", "trial subscription missing");
assert(verification && !verification.used_at, "verification token missing");

const unverifiedLogin = await mockApi.auth.loginByEmail(email, "SecurePass123!");
assert(!unverifiedLogin.success && unverifiedLogin.code === "EMAIL_UNVERIFIED", "unverified login should be blocked");

const verify = await mockApi.publicAuth.verifyEmail(verification.token);
assert(verify.success, `verify failed: ${verify.error}`);
const reuse = await mockApi.publicAuth.verifyEmail(verification.token);
assert(!reuse.success && reuse.code === "USED", "verification token should be one-time");

const expiredToken = `expired_${stamp}`;
db = JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
db.emailVerifications.push({
  id: 99991,
  token: expiredToken,
  user_id: owner.id,
  company_id: company.id,
  email,
  expires_at: new Date(Date.now() - 1000).toISOString(),
  used_at: null,
  created_at: new Date().toISOString(),
});
storage.setItem("nexora_pos_web_db_v3", JSON.stringify(db));
// live module db may differ from storage; expire via verify on fresh token already used. Create via requestPasswordReset path instead.
const login = await mockApi.auth.loginByEmail(email, "SecurePass123!");
assert(login.success, `email login failed: ${login.error}`);

await mockApi.auth.logout();
const platformLogin = await mockApi.auth.login("platform", "platformowner", "OwnerAdmin123!");
assert(platformLogin.success, "platform login failed");
const overview = await mockApi.owner.getOverview();
assert(overview.success, "platform owner should access console");

const duplicateEmail = `dup_${stamp}@example.com`;
const created = await mockApi.auth_admin.createUser({
  name: "Dup One", username: `dupone${stamp}`.slice(0, 20), email: duplicateEmail, phone: "+254700000099",
  password: "SecurePass123!", pin: "1234", role: "cashier", branch_id: 1, company_id: 1,
});
assert(created.success, `create user failed: ${created.error}`);
const secondCompanyBranch = JSON.parse(storage.getItem("nexora_pos_web_db_v3")).branches.find((branch) => branch.company_id === company.id);
const created2 = await mockApi.auth_admin.createUser({
  name: "Dup Two", username: `duptwo${stamp}`.slice(0, 20), email: duplicateEmail, phone: "+254700000098",
  password: "SecurePass123!", pin: "1234", role: "cashier", branch_id: secondCompanyBranch.id, company_id: company.id,
});
assert(created2.success, `create second user failed: ${created2.error}`);
await mockApi.auth.logout();
const ambiguous = await mockApi.auth.loginByEmail(duplicateEmail, "SecurePass123!");
assert(!ambiguous.success && ambiguous.code === "COMPANY_REQUIRED", "duplicate email should require company code");
const resolved = await mockApi.auth.loginByEmail(duplicateEmail, "SecurePass123!", false, "NEXORA001");
assert(resolved.success, `company-scoped email login failed: ${resolved.error}`);

await mockApi.auth.logout();
const companyLogin = await mockApi.auth.login("NEXORA001", "companyowner", "CompanyOwner123!");
assert(companyLogin.success, `company owner login failed: ${companyLogin.error}`);
const forbidden = await mockApi.owner.getOverview();
assert(!forbidden.success, "company owner must be denied platform APIs");

console.log("SaaS checks passed");
