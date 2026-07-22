/**
 * E2E test for the 6 required auth/permission scenarios, executed against the
 * REAL src/lib/mockApi.js module (via Vite SSR module loading, so import.meta.env
 * and all real imports resolve exactly as they do in the browser build).
 *
 * Scenarios:
 *   1. Platform Owner creates a Company.
 *   2. Company Admin logs in.
 *   3. Company Admin creates users.
 *   4. Users of any company role (incl. Company Admin) cannot access Platform Owner routes/APIs.
 *   5. Platform Owner can reset a Company Admin's password.
 *   6. Company Admin can reset only their own company's users' passwords
 *      (not other companies, not the Platform Owner; peer/higher roles flagged).
 *
 * Run:  node scripts/e2e-6-scenarios.mjs   (from the project root)
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
  const stamp = ok ? "PASS" : "FAIL";
  console.log(`[${stamp}] ${scenario} :: ${name}${ok ? "" : ` -- ${detail}`}`);
  return ok;
}

function readDb() {
  return JSON.parse(storage.getItem("nexora_pos_web_db_v3"));
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { mockApi: api } = await server.ssrLoadModule("/src/lib/mockApi.js");
  const stamp = Date.now();

  // ---------------------------------------------------------------------
  // Scenario 1: Platform Owner creates a Company.
  // ---------------------------------------------------------------------
  const platformLogin = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
  record("1", "platform owner logs in", platformLogin.success, platformLogin.error);

  const newCompanyEmail = `owner_${stamp}@example.com`;
  const newCompanyUsername = `owner${stamp}`.slice(0, 24);
  const createCompany = await api.owner.createCompanyAccount({
    company_name: `Acme Retail ${stamp}`,
    business_type: "Retail",
    country: "Kenya",
    currency: "KES",
    time_zone: "Africa/Nairobi",
    company_email: `contact_${stamp}@acme.example`,
    company_phone: "+254700000010",
    company_address: "123 Test Ave",
    subscription_plan: "Enterprise",
    subscription_expiry: "2027-12-31",
    status: "active",
    name: "New Co Owner",
    username: newCompanyUsername,
    email: newCompanyEmail,
    phone: "+254700000011",
    password: "SecurePass123!",
    confirm_password: "SecurePass123!",
    pin: "1234",
    branch_name: "Main Branch",
  });
  record("1", "createCompanyAccount succeeds", createCompany.success, createCompany.error);

  let dbAfterCreate = readDb();
  const newCompany = dbAfterCreate.companies.find((c) => c.id === createCompany.company_id);
  const newOwnerUser = dbAfterCreate.users.find((u) => u.id === createCompany.owner_user_id);
  const newBranch = dbAfterCreate.branches.find((b) => b.company_id === createCompany.company_id);
  const newSubscription = dbAfterCreate.subscriptions.find((s) => s.company_id === createCompany.company_id);
  record("1", "company record created", !!newCompany, "company missing from db");
  record("1", "first user role is owner (never platform_owner)", newOwnerUser?.role === "owner", `role was ${newOwnerUser?.role}`);
  record("1", "default branch created", !!newBranch, "branch missing");
  record("1", "subscription created", !!newSubscription, "subscription missing");
  record("1", "permission matrix seeded for company", !!dbAfterCreate.permissionMatrices?.[createCompany.company_id], "permission matrix missing");

  const dupCompany = await api.owner.createCompanyAccount({
    company_name: `Acme Retail Dup ${stamp}`,
    business_type: "Retail",
    country: "Kenya",
    currency: "KES",
    time_zone: "Africa/Nairobi",
    company_email: `contact2_${stamp}@acme.example`,
    company_phone: "+254700000012",
    company_address: "456 Test Ave",
    subscription_plan: "Enterprise",
    subscription_expiry: "2027-12-31",
    status: "active",
    name: "Dup Owner",
    username: `dup${stamp}`.slice(0, 24),
    email: newCompanyEmail, // duplicate on purpose
    phone: "+254700000013",
    password: "SecurePass123!",
    confirm_password: "SecurePass123!",
    pin: "4321",
    branch_name: "Main Branch",
  });
  record("1", "duplicate owner email rejected (no partial writes)", !dupCompany.success, "duplicate email should have been rejected");
  const companyCountAfterDup = readDb().companies.length;
  record("1", "rejected duplicate did not create a company", companyCountAfterDup === dbAfterCreate.companies.length, "company count changed after rejected signup");

  await api.auth.logout();

  // ---------------------------------------------------------------------
  // Scenario 2: Company Admin logs in.
  // ---------------------------------------------------------------------
  const adminLogin = await api.auth.login("NEXORA001", "admin", "NexoraDemo123!");
  record("2", "company admin logs in", adminLogin.success, adminLogin.error);
  record("2", "logged-in role is admin", adminLogin.user?.role === "admin", `role was ${adminLogin.user?.role}`);
  record("2", "admin scoped to demo company", Number(adminLogin.user?.company_id) === 1, `company_id was ${adminLogin.user?.company_id}`);

  // ---------------------------------------------------------------------
  // Scenario 3: Company Admin creates users.
  // ---------------------------------------------------------------------
  const branches = await api.branches.getAll();
  const ownBranch = branches.find((b) => Number(b.company_id) === 1) || branches[0];
  const newCashierUsername = `cashier${stamp}`.slice(0, 24);
  const newCashierEmail = `cashier_${stamp}@nexora.demo`;
  const createdCashier = await api.auth_admin.createUser({
    name: "New Cashier",
    username: newCashierUsername,
    email: newCashierEmail,
    phone: "+254700000020",
    password: "SecurePass123!",
    pin: "1234",
    role: "cashier",
    branch_id: ownBranch?.id ?? 1,
    active: 1,
  });
  record("3", "company admin creates a cashier user", createdCashier.success, createdCashier.error);
  const cashierRecord = readDb().users.find((u) => u.id === createdCashier.id);
  record("3", "created user scoped to admin's own company", Number(cashierRecord?.company_id) === 1, `company_id was ${cashierRecord?.company_id}`);

  const createdEscalation = await api.auth_admin.createUser({
    name: "Escalation Attempt",
    username: `escalate${stamp}`.slice(0, 24),
    email: `escalate_${stamp}@nexora.demo`,
    phone: "+254700000021",
    password: "SecurePass123!",
    pin: "1234",
    role: "super_admin",
    branch_id: ownBranch?.id ?? 1,
    active: 1,
  });
  record("3", "admin cannot create a super_admin user (rank escalation blocked)", !createdEscalation.success, "expected escalation to be blocked");

  // ---------------------------------------------------------------------
  // Scenario 4: Users of any company role (incl. Company Admin) cannot
  // access Platform Owner routes/APIs.
  // ---------------------------------------------------------------------
  const adminOverview = await api.owner.getOverview();
  record("4", "company admin denied owner.getOverview", !adminOverview.success, "admin should not access platform overview");
  const adminCreateCompany = await api.owner.createCompanyAccount({ company_name: "Hacked Co" });
  record("4", "company admin denied owner.createCompanyAccount", !adminCreateCompany.success, "admin should not create companies");
  const adminPlatformConsole = await api.owner.getPlatformConsole();
  record("4", "company admin denied owner.getPlatformConsole", !adminPlatformConsole.success, "admin should not access platform console");

  await api.auth.logout();
  const cashierLogin = await api.auth.login("NEXORA001", newCashierUsername, "SecurePass123!");
  record("4", "cashier login works (setup for isolation check)", cashierLogin.success, cashierLogin.error);
  const cashierOverview = await api.owner.getOverview();
  record("4", "cashier denied owner.getOverview", !cashierOverview.success, "cashier should not access platform overview");
  await api.auth.logout();

  const companyOwnerLoginForIsolation = await api.auth.login("NEXORA001", "companyowner", "CompanyOwner123!");
  record("4", "company owner login works (setup for isolation check)", companyOwnerLoginForIsolation.success, companyOwnerLoginForIsolation.error);
  const ownerOverview = await api.owner.getOverview();
  record("4", "company owner denied owner.getOverview (platform-only)", !ownerOverview.success, "owner should not access platform overview");
  const ownerCreateCompany = await api.owner.createCompanyAccount({ company_name: "Hacked Co 2" });
  record("4", "company owner denied owner.createCompanyAccount (cannot manage other companies)", !ownerCreateCompany.success, "owner should not create companies");
  await api.auth.logout();

  // ---------------------------------------------------------------------
  // Scenario 5: Platform Owner can reset a Company Admin's password.
  // ---------------------------------------------------------------------
  const platformLogin2 = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
  record("5", "platform owner re-logs in", platformLogin2.success, platformLogin2.error);
  const adminUserId = readDb().users.find((u) => Number(u.company_id) === 1 && u.username === "admin")?.id;
  const resetAdminPw = await api.auth_admin.resetPassword(adminUserId, "NewAdminPass123!");
  record("5", "platform owner resets company admin password", resetAdminPw.success, resetAdminPw.error);
  await api.auth.logout();
  const adminLoginOldPw = await api.auth.login("NEXORA001", "admin", "NexoraDemo123!");
  record("5", "old admin password no longer works", !adminLoginOldPw.success, "old password should be invalidated");
  const adminLoginNewPw = await api.auth.login("NEXORA001", "admin", "NewAdminPass123!");
  record("5", "new admin password works", adminLoginNewPw.success, adminLoginNewPw.error);
  await api.auth.logout();

  // ---------------------------------------------------------------------
  // Scenario 6: Company Admin can reset only their own company's users'
  // passwords.
  // ---------------------------------------------------------------------
  // 6a: Admin resets a same-company cashier's password -> should succeed.
  const adminLoginForReset = await api.auth.login("NEXORA001", "admin", "NewAdminPass123!");
  record("6", "company admin logs in for password-reset checks", adminLoginForReset.success, adminLoginForReset.error);
  const resetOwnCompanyUser = await api.auth_admin.resetPassword(createdCashier.id, "RotatedPass123!");
  record("6", "admin resets own-company cashier password", resetOwnCompanyUser.success, resetOwnCompanyUser.error);
  await api.auth.logout();
  const cashierLoginNewPw = await api.auth.login("NEXORA001", newCashierUsername, "RotatedPass123!");
  record("6", "cashier can log in with admin-reset password", cashierLoginNewPw.success, cashierLoginNewPw.error);
  await api.auth.logout();

  // 6b: Admin resets a Platform Owner's password -> must be denied.
  const adminLoginForReset2 = await api.auth.login("NEXORA001", "admin", "NewAdminPass123!");
  record("6", "company admin re-logs in", adminLoginForReset2.success, adminLoginForReset2.error);
  const platformOwnerId = readDb().users.find((u) => u.role === "platform_owner")?.id;
  const resetPlatformOwnerAttempt = await api.auth_admin.resetPassword(platformOwnerId, "ShouldNotWork123!");
  record("6", "admin cannot reset Platform Owner password", !resetPlatformOwnerAttempt.success, "expected denial resetting platform owner password");
  await api.auth.logout();

  // 6c: Admin resets a user in a DIFFERENT company (same manageable rank,
  // e.g. cashier) -> must be denied by cross-company isolation, isolated
  // from the role-hierarchy check.
  const otherCompanyOwnerLogin = await api.auth.login(newCompany.code, newCompanyUsername, "SecurePass123!");
  record("6", "other company's owner logs in (setup)", otherCompanyOwnerLogin.success, otherCompanyOwnerLogin.error);
  const otherCompanyBranches = await api.branches.getAll();
  const otherCashier = await api.auth_admin.createUser({
    name: "Other Co Cashier",
    username: `othercashier${stamp}`.slice(0, 24),
    email: `othercashier_${stamp}@example.com`,
    phone: "+254700000030",
    password: "SecurePass123!",
    pin: "1234",
    role: "cashier",
    branch_id: otherCompanyBranches[0]?.id,
    active: 1,
  });
  record("6", "other company cashier created (setup)", otherCashier.success, otherCashier.error);
  await api.auth.logout();

  const adminLoginForReset3 = await api.auth.login("NEXORA001", "admin", "NewAdminPass123!");
  record("6", "company admin re-logs in (cross-company check)", adminLoginForReset3.success, adminLoginForReset3.error);
  const crossCompanyReset = await api.auth_admin.resetPassword(otherCashier.id, "CrossCompany123!");
  record("6", "admin cannot reset a DIFFERENT company's cashier password", !crossCompanyReset.success, "expected cross-company denial");

  // 6d (ambiguous, flagged): Admin resets a PEER Admin's password in the
  // SAME company -> current behavior after fix: denied (peer rank, same
  // as owner/super_admin peer-blocking pattern already in rbac.js).
  // NOTE: a peer Admin cannot create another peer Admin (blocked by design,
  // same as Owner/Super Admin peer-blocking) -- so the Company Owner
  // creates the second Admin here purely as test setup.
  await api.auth.logout();
  const ownerSetupLogin = await api.auth.login("NEXORA001", "companyowner", "CompanyOwner123!");
  record("6", "company owner logs in to seed a peer admin (setup)", ownerSetupLogin.success, ownerSetupLogin.error);
  const peerAdmin = await api.auth_admin.createUser({
    name: "Peer Admin",
    username: `peeradmin${stamp}`.slice(0, 24),
    email: `peeradmin_${stamp}@nexora.demo`,
    phone: "+254700000040",
    password: "SecurePass123!",
    pin: "1234",
    role: "admin",
    branch_id: ownBranch?.id ?? 1,
    active: 1,
  });
  record("6", "company owner creates a second (peer) admin (setup)", peerAdmin.success, peerAdmin.error);
  await api.auth.logout();
  const adminLoginForPeerCheck = await api.auth.login("NEXORA001", "admin", "NewAdminPass123!");
  record("6", "company admin re-logs in for peer check", adminLoginForPeerCheck.success, adminLoginForPeerCheck.error);
  const peerAdminReset = await api.auth_admin.resetPassword(peerAdmin.id, "PeerAttempt123!");
  record("6", "[FLAGGED-AMBIGUOUS] admin cannot reset a PEER admin's password", !peerAdminReset.success, "peer-rank reset should currently be denied");

  // 6e (ambiguous, flagged): Admin resets the company OWNER's password ->
  // current behavior after fix: denied (owner outranks admin).
  const companyOwnerId = readDb().users.find((u) => Number(u.company_id) === 1 && u.role === "owner")?.id;
  const ownerResetAttempt = await api.auth_admin.resetPassword(companyOwnerId, "OwnerAttempt123!");
  record("6", "[FLAGGED-AMBIGUOUS] admin cannot reset the company Owner's password", !ownerResetAttempt.success, "owner outranks admin; reset should currently be denied");
  await api.auth.logout();

  // -----------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log("\n================ SUMMARY ================");
  for (const scenario of ["1", "2", "3", "4", "5", "6"]) {
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
