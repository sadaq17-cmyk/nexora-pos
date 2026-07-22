/**
 * E2E test for the 8 required auth/permission/isolation scenarios, executed
 * against the REAL src/lib/mockApi.js module (via Vite SSR module loading,
 * so import.meta.env and all real imports resolve exactly as they do in the
 * browser build).
 *
 * Scenarios:
 *   1. Platform Owner creates a Company (atomic; duplicate rejection).
 *   2. Confirm which role the auto-created account actually gets.
 *   3. That auto-created "Company Admin" account logs in (auth.login AND
 *      auth.loginByEmail).
 *   4. Company Admin creates users within their own company.
 *   5. Those newly created users can log in with their own credentials.
 *   6. Platform Owner resets the Company Admin's password (old password
 *      stops working, new one works).
 *   7. Company Admin can reset only their own company's users' passwords
 *      (own user OK; different company denied; peer/higher roles denied).
 *   8. No Company Admin can access another company's data: users list AND
 *      a core business record (products) are cross-company isolated.
 *
 * NOTE ON TERMINOLOGY: the task refers to the account auto-created during
 * company creation as "Company Admin". Scenario 2 exists specifically to
 * verify -- not assume -- which role that account actually gets. See the
 * assertion output/labels for the confirmed role and how it's used below.
 *
 * Run:  node scripts/e2e-8-scenarios.mjs   (from the project root)
 */
import { createServer } from "vite";

const store = new Map();
const storage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.window = { localStorage: storage, sessionStorage: storage };
storage.clear();

const results = [];
function record(scenario, name, condition, detail = "") {
  const ok = !!condition;
  results.push({ scenario, name, ok, detail: ok ? "" : detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${scenario} :: ${name}${ok ? "" : ` -- ${detail}`}`);
  return ok;
}

function readDb() {
  return JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
}

function companyPayload({ stamp, label, emailSeed, usernameSeed }) {
  return {
    company_name: `${label} ${stamp}`,
    business_type: "Retail",
    country: "Kenya",
    currency: "KES",
    time_zone: "Africa/Nairobi",
    company_email: `contact_${emailSeed}@example.com`,
    company_phone: "+254700000010",
    company_address: "123 Test Ave",
    subscription_plan: "Enterprise",
    subscription_expiry: "2027-12-31",
    status: "active",
    name: `${label} Admin`,
    username: `${usernameSeed}`.slice(0, 24),
    email: `${emailSeed}@example.com`,
    phone: "+254700000011",
    password: "SecurePass123!",
    confirm_password: "SecurePass123!",
    pin: "1234",
    branch_name: "Main Branch",
  };
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { mockApi: api } = await server.ssrLoadModule("/src/lib/mockApi.js");
  const stamp = Date.now();

  // =======================================================================
  // Scenario 1: Platform Owner creates a Company.
  // =======================================================================
  const platformLogin = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
  record("1", "platform owner logs in", platformLogin.success, platformLogin.error);

  const companyAEmail = `companyA_owner_${stamp}@example.com`;
  const companyAUsername = `coadmin${stamp}`.slice(0, 24);
  const createCompanyA = await api.owner.createCompanyAccount(
    companyPayload({ stamp, label: "Company A", emailSeed: `companyA_owner_${stamp}`, usernameSeed: companyAUsername })
  );
  record("1", "createCompanyAccount succeeds", createCompanyA.success, createCompanyA.error);

  let db = readDb();
  const companyA = db.companies.find((c) => c.id === createCompanyA.company_id);
  const companyAAdminUser = db.users.find((u) => u.id === createCompanyA.owner_user_id);
  const companyABranch = db.branches.find((b) => b.company_id === createCompanyA.company_id);
  const companyASubscription = db.subscriptions.find((s) => s.company_id === createCompanyA.company_id);
  record("1", "company record created", !!companyA, "company missing from db");
  record("1", "default branch created", !!companyABranch, "branch missing");
  record("1", "subscription created", !!companyASubscription, "subscription missing");
  record("1", "permission matrix seeded for company", !!db.permissionMatrices?.[createCompanyA.company_id], "permission matrix missing");
  record("1", "auto-created user's role is never platform_owner", companyAAdminUser?.role !== "platform_owner", `role was ${companyAAdminUser?.role}`);

  const dupCompany = await api.owner.createCompanyAccount(
    companyPayload({ stamp, label: "Company A Dup", emailSeed: `companyA_owner_${stamp}`, usernameSeed: `dup${stamp}` }) // duplicate email on purpose
  );
  record("1", "duplicate owner email rejected", !dupCompany.success, "duplicate email should have been rejected");
  record("1", "rejected duplicate created no partial writes", readDb().companies.length === db.companies.length, "company count changed after rejected signup");

  // =======================================================================
  // Scenario 2: Confirm which role the auto-created account actually gets.
  // =======================================================================
  const actualRole = companyAAdminUser?.role;
  record(
    "2",
    `auto-created account's actual role is "${actualRole}" (verified, not assumed)`,
    actualRole === "owner",
    `expected role "owner" per owner.createCompanyAccount's hardcoded role="owner"; got "${actualRole}"`
  );
  record("2", "auto-created account's company_id matches the new company", Number(companyAAdminUser?.company_id) === Number(companyA?.id), "company_id mismatch");
  record("2", "auto-created account is the company's owner_user_id", Number(companyA?.owner_user_id) === Number(companyAAdminUser?.id), "owner_user_id mismatch");
  console.log(
    `\n>>> CONFIRMED: owner.createCompanyAccount assigns role "${actualRole}" to the auto-created account (NOT "admin"). ` +
      `This account is the company's Owner, and is treated as that company's top-level administrator throughout this suite.\n`
  );

  await api.auth.logout();

  // =======================================================================
  // Scenario 3: The auto-created "Company Admin" (role: owner) logs in,
  // via both auth.login and auth.loginByEmail.
  // =======================================================================
  const adminLoginByCode = await api.auth.login(companyA.code, companyAUsername, "SecurePass123!");
  record("3", "company admin logs in via auth.login (company code + username)", adminLoginByCode.success, adminLoginByCode.error);
  record("3", "auth.login session role is owner", adminLoginByCode.user?.role === "owner", `role was ${adminLoginByCode.user?.role}`);
  await api.auth.logout();

  const adminLoginByEmail = await api.auth.loginByEmail(companyAEmail, "SecurePass123!");
  record("3", "company admin logs in via auth.loginByEmail", adminLoginByEmail.success, adminLoginByEmail.error);
  record("3", "auth.loginByEmail session role is owner", adminLoginByEmail.user?.role === "owner", `role was ${adminLoginByEmail.user?.role}`);
  // stay logged in as the Company A admin for scenario 4

  // =======================================================================
  // Scenario 4: Company Admin creates users within their own company.
  // =======================================================================
  const companyABranches = await api.branches.getAll();
  const cashierUsername = `cashierA${stamp}`.slice(0, 24);
  const cashierEmail = `cashierA_${stamp}@example.com`;
  const createdCashier = await api.auth_admin.createUser({
    name: "Company A Cashier",
    username: cashierUsername,
    email: cashierEmail,
    phone: "+254700000020",
    password: "SecurePass123!",
    pin: "1234",
    role: "cashier",
    branch_id: companyABranches[0]?.id,
    active: 1,
  });
  record("4", "company admin creates a cashier user", createdCashier.success, createdCashier.error);
  const cashierRecord = readDb().users.find((u) => u.id === createdCashier.id);
  record("4", "created user has correct company_id", Number(cashierRecord?.company_id) === Number(companyA.id), `company_id was ${cashierRecord?.company_id}`);
  record("4", "created user has correct role", cashierRecord?.role === "cashier", `role was ${cashierRecord?.role}`);
  const fetchedCashier = await api.auth.getUser(createdCashier.id);
  record("4", "created user is retrievable via auth.getUser", !!fetchedCashier && fetchedCashier.id === createdCashier.id, "user not retrievable");
  const listedUsers = await api.auth.listUsers();
  record("4", "created user appears in auth.listUsers", listedUsers.some((u) => u.id === createdCashier.id), "user missing from listUsers");

  await api.auth.logout();

  // =======================================================================
  // Scenario 5: The newly created user logs in with their own credentials.
  // =======================================================================
  const cashierLogin = await api.auth.login(companyA.code, cashierUsername, "SecurePass123!");
  record("5", "newly created cashier logs in with own credentials", cashierLogin.success, cashierLogin.error);
  record("5", "cashier session role is cashier", cashierLogin.user?.role === "cashier", `role was ${cashierLogin.user?.role}`);
  await api.auth.logout();

  // =======================================================================
  // Scenario 6: Platform Owner resets the Company Admin's password, and the
  // Company Admin can subsequently log in with the NEW password (and the
  // OLD one stops working).
  // =======================================================================
  const platformLogin2 = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
  record("6", "platform owner re-logs in", platformLogin2.success, platformLogin2.error);
  const resetAdminPw = await api.auth_admin.resetPassword(companyAAdminUser.id, "RotatedAdminPass123!");
  record("6", "platform owner resets company admin's password", resetAdminPw.success, resetAdminPw.error);
  await api.auth.logout();

  const adminLoginOldPw = await api.auth.login(companyA.code, companyAUsername, "SecurePass123!");
  record("6", "old password no longer works", !adminLoginOldPw.success, "old password should be invalidated");
  const adminLoginNewPw = await api.auth.login(companyA.code, companyAUsername, "RotatedAdminPass123!");
  record("6", "new password works", adminLoginNewPw.success, adminLoginNewPw.error);
  // stay logged in as Company A admin for scenario 7

  // =======================================================================
  // Scenario 7: Company Admin can reset only their own company's users'
  // passwords.
  // =======================================================================
  const resetOwnCompanyUser = await api.auth_admin.resetPassword(createdCashier.id, "RotatedCashierPass123!");
  record("7", "admin resets own-company cashier's password (success)", resetOwnCompanyUser.success, resetOwnCompanyUser.error);
  await api.auth.logout();
  const cashierLoginNewPw = await api.auth.login(companyA.code, cashierUsername, "RotatedCashierPass123!");
  record("7", "cashier can log in with admin-reset password", cashierLoginNewPw.success, cashierLoginNewPw.error);
  await api.auth.logout();

  // -- setup: a second company (Company B), a peer Owner in Company A, and
  // Platform Owner, to exercise every denial path.
  const platformLogin3 = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
  record("7", "platform owner logs in (setup for denial checks)", platformLogin3.success, platformLogin3.error);

  const companyBUsername = `coadminB${stamp}`.slice(0, 24);
  const companyBEmail = `companyB_owner_${stamp}@example.com`;
  const createCompanyB = await api.owner.createCompanyAccount(
    companyPayload({ stamp, label: "Company B", emailSeed: `companyB_owner_${stamp}`, usernameSeed: companyBUsername })
  );
  record("7", "company B created (setup)", createCompanyB.success, createCompanyB.error);
  const dbAfterB = readDb();
  const companyB = dbAfterB.companies.find((c) => c.id === createCompanyB.company_id);
  const companyBAdminUser = dbAfterB.users.find((u) => u.id === createCompanyB.owner_user_id);

  const peerOwner = await api.auth_admin.createUser({
    name: "Peer Owner",
    username: `peerowner${stamp}`.slice(0, 24),
    email: `peerowner_${stamp}@example.com`,
    phone: "+254700000050",
    password: "SecurePass123!",
    pin: "1234",
    role: "owner",
    branch_id: companyABranch.id,
    company_id: companyA.id,
    active: 1,
  });
  record("7", "platform owner seeds a peer Owner inside Company A (setup)", peerOwner.success, peerOwner.error);
  const platformOwnerId = readDb().users.find((u) => u.role === "platform_owner")?.id;
  await api.auth.logout();

  const adminLoginForDenials = await api.auth.login(companyA.code, companyAUsername, "RotatedAdminPass123!");
  record("7", "company admin re-logs in for denial checks", adminLoginForDenials.success, adminLoginForDenials.error);

  const crossCompanyReset = await api.auth_admin.resetPassword(companyBAdminUser.id, "ShouldNotWork123!");
  record("7", "admin denied resetting a DIFFERENT company's user password", !crossCompanyReset.success, "expected cross-company denial");

  const peerOwnerReset = await api.auth_admin.resetPassword(peerOwner.id, "ShouldNotWork123!");
  record("7", "[peer-blocking policy] admin denied resetting a PEER Owner's password (same company)", !peerOwnerReset.success, "expected peer-rank denial");

  const platformOwnerReset = await api.auth_admin.resetPassword(platformOwnerId, "ShouldNotWork123!");
  record("7", "admin denied resetting the Platform Owner's password", !platformOwnerReset.success, "expected denial resetting platform owner password");
  await api.auth.logout();

  // =======================================================================
  // Scenario 8: No Company Admin can access another company's data --
  // users list AND a core business record (products) must be isolated.
  // =======================================================================
  const companyBLogin = await api.auth.login(companyB.code, companyBUsername, "SecurePass123!");
  record("8", "company B admin logs in (setup)", companyBLogin.success, companyBLogin.error);
  const companyBProduct = await api.products.create({ name: `Company B Secret Product ${stamp}`, price: 999, cost: 500, stock: 5 });
  record("8", "company B admin creates a product (setup)", companyBProduct.success, companyBProduct.error);
  await api.auth.logout();

  const adminLoginForIsolation = await api.auth.login(companyA.code, companyAUsername, "RotatedAdminPass123!");
  record("8", "company A admin re-logs in for isolation checks", adminLoginForIsolation.success, adminLoginForIsolation.error);
  const companyAProduct = await api.products.create({ name: `Company A Product ${stamp}`, price: 111, cost: 60, stock: 8 });
  record("8", "company A admin creates its own product", companyAProduct.success, companyAProduct.error);

  const companyAProducts = await api.products.getAll();
  record("8", "company A admin sees its own product in products.getAll", companyAProducts.some((p) => p.id === companyAProduct.id), "own product missing");
  record("8", "company A admin CANNOT see Company B's product in products.getAll", !companyAProducts.some((p) => p.id === companyBProduct.id), "cross-company product leaked");

  const companyAUsersList = await api.auth.listUsers();
  record("8", "company A admin sees its own users in auth.listUsers", companyAUsersList.some((u) => u.id === createdCashier.id), "own user missing from listUsers");
  record("8", "company A admin CANNOT see Company B's admin in auth.listUsers", !companyAUsersList.some((u) => u.id === companyBAdminUser.id), "cross-company user leaked");
  record("8", "company A admin CANNOT fetch Company B's admin via auth.getUser", !(await api.auth.getUser(companyBAdminUser.id)), "cross-company auth.getUser leaked a record");
  await api.auth.logout();

  // -----------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log("\n================ SUMMARY ================");
  for (const scenario of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
    const scenarioResults = results.filter((r) => r.scenario === scenario);
    const scenarioFailed = scenarioResults.filter((r) => !r.ok);
    console.log(`Scenario ${scenario}: ${scenarioResults.length - scenarioFailed.length}/${scenarioResults.length} passed`);
  }
  console.log(`\nTOTAL: ${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) {
    console.log("\nFAILED ASSERTIONS:");
    for (const failure of failed) console.log(` - [Scenario ${failure.scenario}] ${failure.name}: ${failure.detail}`);
  }
  console.log("===========================================\n");

  if (failed.length) process.exitCode = 1;
} finally {
  await server.close();
}
