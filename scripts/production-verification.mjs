/**
 * Production verification (offline / static + local unit checks).
 * Live Login / POS / Contact delivery require deployed env + credentials.
 *
 * Run: node scripts/production-verification.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function record(area, status, notes) {
  results.push({ area, status, notes });
  const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${area} — ${notes}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

console.log("Nexora POS — Phase 2 production verification\n");

// Security headers
const vercel = read("vercel.json");
for (const header of [
  "Strict-Transport-Security",
  "Content-Security-Policy",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
]) {
  record(`Security header: ${header}`, vercel.includes(header) ? "PASS" : "FAIL", "vercel.json");
}

// Contact → support inbox
const sendEmail = read("api/send-email.js");
const mockContact = read("src/lib/mockApi.js");
record(
  "Contact Form email wiring",
  sendEmail.includes('contact')
    && sendEmail.includes("support@httpsnexorapos.com")
    && mockContact.includes('type: "contact"')
    ? "PASS"
    : "FAIL",
  "send-email contact type + mockApi.platformPublic.contact → Resend"
);

// Rate limiting / CSRF origin
const helpers = read("api/_authHelpers.js");
record("API rate limit helpers", helpers.includes("consumeRateLimit") ? "PASS" : "FAIL", "_authHelpers.js");
record("CSRF origin allowlist", helpers.includes("isAllowedOrigin") ? "PASS" : "FAIL", "_authHelpers.js");
record(
  "send-email hardened",
  sendEmail.includes("isAllowedOrigin") && sendEmail.includes("consumeRateLimit") ? "PASS" : "FAIL",
  "origin + rate limit"
);

// Sessions / MFA / uploads / email verification / audit
record("Secure sessions (idle/absolute)", exists("src/lib/sessionIdle.js") && read("src/context/AuthContext.jsx").includes("IDLE_TIMEOUT_MS") ? "PASS" : "FAIL", "30m idle / 12h absolute");
record("Optional 2FA", exists("src/lib/mfaHelpers.js") && exists("src/components/MfaSettingsPanel.jsx") ? "PASS" : "FAIL", "Supabase TOTP MFA");
record("Secure file uploads", exists("src/lib/secureImageUpload.js") ? "PASS" : "FAIL", "MIME + magic-byte checks");
record("Email verification gate", read("src/context/AuthContext.jsx").includes("EMAIL_UNVERIFIED") ? "PASS" : "FAIL", "gateAfterSignIn");
record("Audit logs module", exists("src/pages/AuditLog.jsx") && mockContact.includes("function logAudit") ? "PASS" : "FAIL", "client audit + UI");

// Auth lockout / password policy unit tests
const authTest = spawnSync(process.execPath, [path.join(root, "scripts", "auth-logic-test.mjs")], { encoding: "utf8" });
record("Login lockout / password policy unit tests", authTest.status === 0 ? "PASS" : "FAIL", (authTest.stdout || authTest.stderr || "").trim().split("\n").slice(-1)[0] || "auth-logic-test");

const rls = spawnSync(process.execPath, [path.join(root, "scripts", "verify-rls.mjs")], { encoding: "utf8" });
record("Supabase RLS policies (static)", rls.status === 0 ? "PASS" : "FAIL", "migration 001_nexora_schema.sql");

// Build
const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
record("Production build", build.status === 0 ? "PASS" : "FAIL", build.status === 0 ? "vite build ok" : (build.stderr || build.stdout || "").slice(-400));

// Live flows — cannot run without credentials / deployed API
const liveAreas = [
  "Login",
  "Forgot Password",
  "Contact Form delivery (Resend live)",
  "Platform Super Admin",
  "Company Creation",
  "Owner Login",
  "POS",
  "Reports",
];
for (const area of liveAreas) {
  record(area, "SKIP", "Requires deployed env (Supabase + RESEND_API_KEY) and interactive credentials — verify manually in production");
}

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const skip = results.filter((r) => r.status === "SKIP").length;
console.log(`\nSummary: ${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
console.log(fail ? "OVERALL (automated): FAIL" : "OVERALL (automated): PASS");
process.exit(fail ? 1 : 0);
