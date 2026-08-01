# Nexora POS Pro — Security Audit Report

**Date:** 2026-07-26  
**Scope:** Full application security audit (OWASP Top 10) prior to production release  
**Auditor role:** Senior Cybersecurity Engineer / Penetration Tester / Enterprise Software Security Architect  

---

## Executive verdict

**Conditional production readiness: NOT FULL GO yet.**

All **Critical** and **High** application-code vulnerabilities identified in this audit pass have been **fixed in source**. Automated local verification is green (18 PASS / 0 FAIL). Remaining blockers are **operational / dependency / deployment** items listed under Remaining recommendations — not unfixed Critical/High code defects.

---

## Vulnerabilities found and fixed

| ID | Finding | Risk | Fix applied | Files |
|----|---------|------|-------------|-------|
| C1 | Open branded email relay (`verification` / `password_reset` / spoofable links via `*.vercel.app`) | **Critical** | Public relay removed. Contact remains public (rate-limited + honeypot). `password_changed` requires Bearer + self-email only. `verification`/`password_reset` require `SEND_EMAIL_SECRET` / `INTERNAL_API_SECRET`. Link allowlist tightened (no wildcard Vercel). Admin reset mails via `sendOutboundEmail` directly. | `api/send-email.js`, `api/admin-reset-password.js`, `src/pages/public/ResetPassword.jsx` |
| C2 | `companies.hydrate` cross-tenant upsert | **Critical** | Caller may only hydrate own `company_id`; managers+ only; `owner_user_id` forced to caller for non-platform. | `api/_posData.js` |
| C3 | `listScoped` / `countScoped` unscoped fallback leaked all tenants | **Critical** | Removed unscoped fallbacks; column errors fail closed. | `api/_posData.js` |
| H1 | `companies.getById` IDOR | **High** | Non-platform callers restricted to own company. | `api/_posData.js` |
| H2 | `settings.update` missing role gate | **High** | Requires Owner/Admin/Super Admin (`isUserManagerRole`). | `api/_posData.js` |
| H3 | `bootstrap-company-owner` arbitrary `company_id` claim | **High** | Empty-role claim only if company exists, no foreign owner, email matches; otherwise use `signup_company`. | `api/bootstrap-company-owner.js` |
| H4 | `invoice-public` POST forge/overwrite | **High** | Force caller `company_id`; block overwrite of other tenants; sanitize IDs; generic errors. | `api/invoice-public.js` |
| H5 | Username→email oracle + full auth user scan | **High** | Profiles lookup by username+company; no full directory scan; tighter rate limits; timing pad; username requires company scope. | `api/resolve-login-email.js` |
| H6 | XSS via `document.write` print paths | **High** | HTML-escape all interpolated user/supplier/PO fields. | `src/pages/Purchases.jsx`, `src/pages/Suppliers.jsx` |
| H7 | Demo mock credentials mirrored production passwords | **High** | DEV mock users use non-production demo passwords/emails only. | `src/lib/mockApi.js` |
| M1 | Public `health.probe` leaked schema/AI metadata | **Medium** | Anonymous → `{ ok: true }` only; full probe for authenticated Owner/Platform Owner. Bearer honored on public actions. | `api/_posData.js`, `api/pos.js` |
| M2 | API error messages leaked internals | **Medium** | Generic production errors from `/api/pos` and email delivery. | `api/pos.js`, `api/send-email.js` |
| M3 | Incomplete API security headers | **Medium** | Added HSTS + Permissions-Policy on API responses (edge headers already in `vercel.json`). | `api/_authHelpers.js` |

---

## Validation results

| Check | Result |
|-------|--------|
| `scripts/production-verification.mjs` | **18 PASS · 0 FAIL · 8 SKIP** |
| `scripts/verify-rls.mjs` (static) | **PASS** |
| `scripts/auth-logic-test.mjs` | **19 tests passed** |
| Vite production build | **PASS** |
| Secrets in repo (service role / live keys) | **Not found as plaintext** (redacted `.env*.bak` only) |
| Security headers (`vercel.json`) | HSTS, CSP, XFO, XCTO, Referrer-Policy, Permissions-Policy present |

---

## Remaining recommendations (do before FULL GO)

| Priority | Item | Notes |
|----------|------|-------|
| **High** | Confirm `nodemailer@^9.0.3` lockfile sync | `package.json` bumped to `^9.0.3`; re-run `npm install` if `package-lock.json` did not update cleanly. |
| **High** | Replace / isolate `xlsx` | Known prototype pollution / ReDoS; no upstream fix on community build. Prefer server-side export or paid SheetJS build. |
| **Medium** | Upgrade `react-router` / `react-router-dom` | Moderate open-redirect / SSR issues — `npm audit fix` when ready. |
| **Medium** | Server-side login lockout | Client `loginAttemptTracker` is UX-only; add Supabase Auth rate limits + Edge/WAF or server lock counters. |
| **Medium** | Set `SEND_EMAIL_SECRET` on Vercel | Required if any server path still calls transactional `verification`/`password_reset` via `/api/send-email`. |
| **Medium** | CSP `style-src 'unsafe-inline'` | Acceptable short-term; move toward hashed/nonces for stricter CSP. |
| **Low** | Expand Supabase `is_staff()` roles | Static RLS note: DB helpers cover owner/admin/cashier; align with full app RBAC when schema allows. |
| **Ops** | Deploy patched API + rotate any previously exposed credentials | Especially if demo/production passwords were ever shared. |
| **Ops** | Confirm HTTPS-only custom domain + HSTS preload eligibility | Edge headers already configured. |

---

## OWASP Top 10 coverage (summary)

| Category | Status |
|----------|--------|
| A01 Broken Access Control | Fixed (hydrate, getById, settings, invoice POST, bootstrap, listScoped) |
| A02 Cryptographic Failures | Passwords via Supabase Auth; no plaintext storage in prod path |
| A03 Injection | Parameterized Supabase queries; XSS print paths escaped; email link allowlist |
| A04 Insecure Design | Open email relay closed; public health probe minimized |
| A05 Security Misconfiguration | Headers reinforced; debug/error leakage reduced |
| A06 Vulnerable Components | Nodemailer/xlsx/react-router remain — see recommendations |
| A07 Identification & Auth Failures | Session Bearer checks; resolve-login hardened; client lockout still advisory |
| A08 Software Integrity Failures | No CI signing changes in this pass |
| A09 Logging & Monitoring Failures | Audit module present; secrets not logged in fixed paths |
| A10 SSRF | No new SSRF surfaces; outbound email links host-allowlisted |

---

## Modified files (this remediation pass)

1. `api/send-email.js`
2. `api/admin-reset-password.js`
3. `api/_posData.js`
4. `api/bootstrap-company-owner.js`
5. `api/invoice-public.js`
6. `api/resolve-login-email.js`
7. `api/pos.js`
8. `api/_authHelpers.js`
9. `src/pages/public/ResetPassword.jsx`
10. `src/pages/Purchases.jsx`
11. `src/pages/Suppliers.jsx`
12. `src/lib/mockApi.js`
13. `scripts/production-verification.mjs`
14. `SECURITY_REPORT.md` (this file)

---

## Production readiness statement

- **Code security (Critical/High app defects):** Remediated.  
- **FULL GO for enterprise financial SaaS:** **No** until:
  1. Patched build is **deployed** to production,
  2. `nodemailer` (and preferably `react-router`) upgrades are applied,
  3. `xlsx` risk is accepted or mitigated,
  4. Server-side brute-force controls are confirmed on Supabase/Vercel,
  5. Post-deploy smoke tests (login, POS sale, invoice verify, contact form) pass on the live host.

Treat this release as **security-hardened and ready to deploy**, not yet **fully production-certified**.
