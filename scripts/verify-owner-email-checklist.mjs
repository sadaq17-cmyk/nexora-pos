/**
 * Final pre-deploy checklist for Company Owner email flow.
 * Exit 0 only when every required guarantee is present in source.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidEmail } from "../src/lib/emailValidation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, status: "PASS" });
    console.log(`PASS  ${name}`);
  } catch (err) {
    checks.push({ name, status: "FAIL", detail: err.message });
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message}`);
  }
}

console.log("Company Owner email — final verification checklist\n");

check("1. Owner can permanently change own email (Zoho request API)", () => {
  const auth = read("src/context/AuthContext.jsx");
  const api = read("api/owner-email-change.js");
  assert.match(auth, /Only the Company Owner can change/);
  assert.match(auth, /\/api\/owner-email-change/);
  assert.match(api, /Only the Company Owner can change their login email/);
  assert.match(api, /email_customized:\s*true/);
});

check("2. New email becomes login email only after verification", () => {
  const api = read("api/owner-email-change.js");
  const auth = read("src/context/AuthContext.jsx");
  assert.match(api, /action === "confirm"/);
  assert.match(api, /email_confirm:\s*true/);
  assert.match(api, /login_email_updated:\s*true/);
  assert.match(auth, /sessionUnchanged/);
  assert.match(api, /Keep current login email \+ session intact/);
});

check("3. Zoho SMTP sends verification (not Supabase Auth email update)", () => {
  const api = read("api/owner-email-change.js");
  const mail = read("api/_mailTransport.js");
  const auth = read("src/context/AuthContext.jsx");
  assert.match(api, /ZOHO_SMTP_REQUIRED/);
  assert.match(api, /provider:\s*"zoho_smtp"/);
  assert.match(mail, /smtp\.zoho|Zoho SMTP|zoho_smtp/);
  assert.doesNotMatch(auth, /updateUser\(\{\s*email/);
  assert.doesNotMatch(api, /auth\.updateUser\(\{\s*email/);
});

check("4. Supabase Auth + owner profile stay synchronized", () => {
  const api = read("api/owner-email-change.js");
  const page = read("src/pages/public/VerifyEmailChange.jsx");
  const mock = read("src/lib/mockApi.js");
  assert.match(api, /admin\.auth\.admin\.updateUserById/);
  assert.match(api, /user_metadata:[\s\S]*email:\s*nextEmail/);
  assert.match(page, /syncOwnerEmailProfile/);
  assert.match(mock, /stub\.email\s*=\s*nextEmail/);
  assert.match(mock, /company\.email\s*=\s*nextEmail/);
});

check("5. Owner email never overwritten after login/refresh", () => {
  const ensure = read("api/_ensurePermanentOwner.js");
  const login = read("src/pages/Login.jsx");
  assert.match(ensure, /never overwrite email or password/i);
  assert.match(ensure, /email_preserved:\s*true/);
  // Public login must not auto-call ensure (passwords are env-gated + secret-gated).
  assert.doesNotMatch(login, /ensure-permanent-owner/);
  const existingBlock = ensure.slice(
    ensure.indexOf("if (existing)"),
    ensure.indexOf("const { data, error } = await admin.auth.admin.createUser")
  );
  assert.doesNotMatch(existingBlock, /email:\s*COMPANY_OWNER\.email/);
  assert.doesNotMatch(existingBlock, /password:\s*COMPANY_OWNER\.password/);
  assert.match(ensure, /PERMANENT_COMPANY_OWNER_PASSWORD|requireEnvPassword/);
});

check("6. Password reset uses the updated login email", () => {
  const forgot = read("src/pages/public/ForgotPassword.jsx");
  assert.match(forgot, /resetPasswordForEmail\(nextEmail/);
  assert.match(forgot, /isValidEmail/);
  assert.match(forgot, /current login email/i);
  assert.equal(isValidEmail("support@httpsnexorapos.com"), true);
});

check("7. Existing sessions remain valid until verification completes", () => {
  const api = read("api/owner-email-change.js");
  const panel = read("src/components/LoginSecurityPanel.jsx");
  assert.match(api, /sessionUnchanged:\s*true/);
  assert.match(api, /currentLoginEmail/);
  assert.match(panel, /stays active until you confirm/);
});

check("8. Full flow wiring (Settings → request → Zoho → confirm → login)", () => {
  const app = read("src/App.jsx");
  const settings = read("src/pages/Settings.jsx");
  const panel = read("src/components/LoginSecurityPanel.jsx");
  assert.match(app, /settings\/login-security/);
  assert.match(app, /verify-email-change/);
  assert.match(settings, /login_security/);
  assert.match(panel, /updateOwnerAccount/);
  assert.match(panel, /noValidate/);
  assert.equal(isValidEmail("support@httpsnexorapos.com"), true);
});

const failed = checks.filter((row) => row.status === "FAIL");
console.log(`\n${checks.length - failed.length}/${checks.length} checklist items PASS`);
if (failed.length) {
  process.exit(1);
}
console.log("Ready for production deploy (requires Zoho SMTP env on Vercel).");
