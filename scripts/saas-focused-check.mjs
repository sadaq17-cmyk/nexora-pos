import { createServer } from "vite";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window = globalThis;

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { mockApi } = await server.ssrLoadModule("/src/lib/mockApi.js");
  const stamp = Date.now();
  const email = `owner${stamp}@example.com`;

  const signup = await mockApi.publicAuth.signupCompany({
    company_name: `Acme ${stamp}`,
    full_name: "Owner One",
    email,
    phone: "+15555550100",
    password: "Password123!",
    plan_code: "free_trial",
  });
  if (!signup.success) throw new Error(`signup failed: ${signup.error}`);
  if (!signup.verification_token) throw new Error("missing verification token in DEV");

  const conflict = await mockApi.publicAuth.signupCompany({
    company_name: `Other ${stamp}`,
    full_name: "Owner Two",
    email,
    phone: "+15555550101",
    password: "Password123!",
  });
  if (conflict.success || conflict.code !== "EMAIL_EXISTS") {
    throw new Error("unique email conflict failed");
  }

  const plans = await mockApi.platformPublic.getPlans();
  const unsafe = ["password_hash", "pin_hash", "password"];
  if (!plans.length || plans.some((plan) => unsafe.some((key) => key in plan))) {
    throw new Error("public plans returned unsafe or empty payload");
  }

  const verify1 = await mockApi.publicAuth.verifyEmail(signup.verification_token);
  const verify2 = await mockApi.publicAuth.verifyEmail(signup.verification_token);
  if (!verify1.success || verify2.success || verify2.code !== "USED") {
    throw new Error("verification one-time semantics failed");
  }

  const login = await mockApi.auth.loginByEmail(email, "Password123!", true);
  if (!login.success || login.user.role !== "owner" || login.user.company_id == null) {
    throw new Error("email login failed or granted invalid role");
  }

  const denied = await mockApi.owner.getPlatformConsole();
  if (denied.success) throw new Error("company owner accessed platform console");

  const expired = await mockApi.publicAuth.verifyEmail("not-a-real-token");
  if (expired.success || expired.code !== "INVALID") throw new Error("invalid token check failed");

  console.log(JSON.stringify({
    ok: true,
    company_code: signup.company_code,
    role: login.user.role,
    plan_count: plans.length,
    public_plan_fields: Object.keys(plans[0]).sort(),
  }, null, 2));
} finally {
  await server.close();
}
