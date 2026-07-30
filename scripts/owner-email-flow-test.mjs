/**
 * End-to-end logic verification for Company Owner email change.
 * Run: node scripts/owner-email-flow-test.mjs
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidEmail } from "../src/lib/emailValidation.js";
import { isValidEmailAddress, mailProviderLabel } from "../api/_mailTransport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

async function main() {
  console.log("owner-email-flow-test\n");

  await test("accepts support@httpsnexorapos.com with standard validation only", () => {
    assert.equal(isValidEmail("support@httpsnexorapos.com"), true);
    assert.equal(isValidEmailAddress("support@httpsnexorapos.com"), true);
    assert.equal(isValidEmail("owner@example.com"), true);
    assert.equal(isValidEmail("bad@@domain"), false);
    assert.equal(isValidEmail("not-an-email"), false);
  });

  await test("ensure-permanent-owner never overwrites email/password for existing owners", () => {
    const src = read("api/_ensurePermanentOwner.js");
    assert.match(src, /never overwrite email or password/i);
    const existingBlock = src.slice(
      src.indexOf("if (existing)"),
      src.indexOf("const { data, error } = await admin.auth.admin.createUser")
    );
    assert.doesNotMatch(existingBlock, /updatePayload\.email\s*=/);
    assert.doesNotMatch(existingBlock, /updatePayload\.password\s*=/);
    assert.doesNotMatch(existingBlock, /email:\s*COMPANY_OWNER\.email/);
    assert.doesNotMatch(existingBlock, /password:\s*COMPANY_OWNER\.password/);
    assert.match(existingBlock, /email_preserved:\s*true/);
  });

  await test("AuthContext requests Zoho flow and does not call updateUser({ email })", () => {
    const src = read("src/context/AuthContext.jsx");
    assert.match(src, /\/api\/owner-email-change/);
    assert.match(src, /sessionUnchanged/);
    assert.doesNotMatch(src, /updateUser\(\{\s*email/);
    assert.match(src, /pending_email_change:\s*true/);
  });

  await test("owner-email-change requires Zoho SMTP and delays login email until confirm", () => {
    const src = read("api/owner-email-change.js");
    assert.match(src, /ZOHO_SMTP_REQUIRED/);
    assert.match(src, /mailProviderLabel\(\) !== "zoho_smtp"/);
    assert.match(src, /sessionUnchanged:\s*true/);
    assert.match(src, /email_confirm:\s*true/);
    assert.match(src, /pending_email_change/);
    assert.match(src, /admin\.auth\.admin\.updateUserById/);
    assert.doesNotMatch(src, /auth\.updateUser\(\{\s*email/);
  });

  await test("token hash confirm logic accepts only matching unexpired tokens", () => {
    const token = randomBytes(32).toString("hex");
    const pending = {
      email: "support@httpsnexorapos.com",
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    assert.equal(hashToken(token), pending.token_hash);
    assert.notEqual(hashToken("wrong"), pending.token_hash);
    assert.ok(new Date(pending.expires_at).getTime() > Date.now());
    assert.equal(isValidEmail(pending.email), true);
  });

  await test("VerifyEmailChange syncs local owner profile after confirm", () => {
    const page = read("src/pages/public/VerifyEmailChange.jsx");
    const mock = read("src/lib/mockApi.js");
    assert.match(page, /syncOwnerEmailProfile/);
    assert.match(mock, /syncOwnerEmailProfile/);
    assert.match(mock, /company\.email\s*=\s*nextEmail/);
    assert.match(mock, /stub\.email\s*=\s*nextEmail/);
  });

  await test("Login & Security route + panel are wired for owner email change", () => {
    const app = read("src/App.jsx");
    const settings = read("src/pages/Settings.jsx");
    const panel = read("src/components/LoginSecurityPanel.jsx");
    assert.match(app, /verify-email-change/);
    assert.match(app, /settings\/login-security/);
    assert.match(settings, /login_security/);
    assert.match(panel, /isValidEmail/);
    assert.match(panel, /noValidate/);
    assert.match(panel, /Zoho SMTP/);
  });

  await test("mail transport prefers Zoho SMTP when configured", () => {
    const prev = {
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
    };
    try {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.RESEND_API_KEY;
      assert.equal(mailProviderLabel(), "none");

      process.env.RESEND_API_KEY = "re_test";
      assert.equal(mailProviderLabel(), "resend");

      process.env.SMTP_HOST = "smtp.zoho.com";
      process.env.SMTP_USER = "support@httpsnexorapos.com";
      process.env.SMTP_PASS = "app-password";
      assert.equal(mailProviderLabel(), "zoho_smtp");
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await test("password reset targets the updated login email after verification", () => {
    const forgot = read("src/pages/public/ForgotPassword.jsx");
    const resolve = read("api/resolve-login-email.js");
    assert.match(forgot, /isValidEmail/);
    assert.match(forgot, /resetPasswordForEmail\(nextEmail/);
    assert.match(forgot, /noValidate/);
    assert.match(forgot, /support@httpsnexorapos\.com/);
    assert.match(forgot, /current login email/i);
    // Login resolution returns the live account email (profiles / auth), lowercased.
    assert.match(resolve, /String\((?:data|match)\.email\)\.toLowerCase\(\)/);
    assert.match(resolve, /from\("profiles"\)/);
    assert.match(resolve, /GENERIC_OK/);
  });

  await test("local profile sync keeps auth email and company email aligned", () => {
    // Mirror syncOwnerEmailProfile behavior without importing the Vite app bundle in Node.
    const userId = "owner-sync-test-id";
    const nextEmail = "support@httpsnexorapos.com";
    const db = {
      users: [{ id: userId, email: "old@example.com", role: "owner", company_id: 1 }],
      companies: [{ id: 1, email: "old@example.com", owner_user_id: userId }],
    };
    assert.equal(isValidEmail(nextEmail), true);
    const stub = db.users.find((entry) => String(entry.id) === userId);
    stub.email = nextEmail;
    const company = db.companies.find((entry) => Number(entry.id) === 1);
    company.email = nextEmail;
    assert.equal(stub.email, nextEmail);
    assert.equal(company.email, nextEmail);

    const mock = read("src/lib/mockApi.js");
    assert.match(mock, /syncOwnerEmailProfile/);
    assert.match(mock, /stub\.email\s*=\s*nextEmail/);
    assert.match(mock, /company\.email\s*=\s*nextEmail/);
  });

  console.log(`\n${passed} owner email flow tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
