# Payroll & HR Module Report

**Module:** Enterprise Payroll & HR Management  
**Date:** 2026-07-23  
**Migration:** `020_payroll_hr_enterprise.sql` (additive; schema freeze after 014 respected)  
**Scope:** Company-scoped (not Platform Owner console)

---

## Verdict

**Enterprise Complete: mostly yes (coherent MVP shipped).**  
Core HR + payroll lifecycle, Kenya-oriented statutory calc, payslips (print/PDF/QR payload), bank export, reports, self-service, RBAC, audit, Owner dashboard widgets, and Executive AI payroll tools are implemented end-to-end. Remaining gaps are mostly polish/integrations (email/SMS delivery, rich digital signature UX, Platform cross-tenant KPIs).

---

## Feature matrix

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Employee Management | **Done** | Auto `EMP-#####`, profile, docs table, dept/position/branch/contract/status/photo_url, bank fields |
| 2 | Attendance | **Done** | Check-in/out, OT hours, lateness, absences; leave marks `on_leave` |
| 3 | Leave Management | **Done** | Annual/sick/maternity/paternity/emergency; approve/reject; balances |
| 4 | Salary Structure | **Done** | Basic + JSON allowances/deductions, OT/bonus/commission flags |
| 5 | Payroll Processing | **Done** | Create → preview → approve → lock/unlock → rollback → regenerate |
| 6 | Tax calculations | **Done** | PAYE bands, NSSF, NHIF/SHA bands, pension, loans/advances, custom deductions; company settings |
| 7 | Payslip | **Done** (email Partial) | Print HTML + jsPDF PDF + QR payload; company logo best-effort; signature line; no SMTP send |
| 8 | Bank Transfer Export | **Done** | CSV + Excel via xlsx |
| 9 | Payroll Reports | **Done** | Monthly/yearly, department, branch, employee history, journal refs, cost KPIs |
| 10 | Employee Self-Service | **Done** | `/payroll/self` — payslips, leave, attendance, history (self-scoped) |
| 11 | Owner Dashboard | **Done** | Payroll KPIs on Owner controls + Payroll Overview tab + AI insights hooks |
| 12 | Executive AI Payroll | **Done** | `payroll_summary`, `payroll_anomalies`, `payroll_forecast` — Executive allowlist only |
| 13 | RBAC | **Done** | Module `payroll` + role defaults + aliases `hr_manager`→admin, `payroll_officer`→accountant |
| 14 | Audit logs | **Done** | Every major payroll action writes `audit_log` |
| 15 | Multi-lang / FX / isolation | **Partial / Done** | AI language-aware (existing); payroll amounts use company currency settings; `company_id` + RLS |
| 16 | Mobile + desktop UI | **Done** | Responsive tabbed UI matching Nexora patterns |
| 17 | Finance / Notifications | **Partial** | Journal on approve + expense best-effort; notifications not extended for payroll due dates |

---

## Schema (migration 020)

| Table | Purpose |
|-------|---------|
| `hr_payroll_settings` | Per-company tax/leave/OT defaults |
| `hr_employees` | Employee master (optional `user_id` → profiles) |
| `hr_employee_documents` | Document metadata |
| `hr_attendance` | Daily attendance |
| `hr_leave_requests` | Leave workflow |
| `hr_leave_balances` | Annual balances |
| `hr_salary_structures` | Active salary packages |
| `hr_loans_advances` | Loans/advances with monthly deduction |
| `hr_payroll_runs` | Monthly runs + status machine |
| `hr_payslips` | Per-employee slip + `lines` JSONB |

All tables: `company_id NOT NULL`, RLS `tenant_match(company_id)`, indexes on `(company_id, …)`.

---

## RBAC mapping

| Persona | Mapped role | `payroll` permissions |
|---------|-------------|----------------------|
| Platform Owner | `platform_owner` | Full (company-scoped via `company_id` when operating as tenant; no platform console payroll UI yet) |
| Company Owner | `owner` | Full |
| Super Admin | `super_admin` | Full |
| HR Manager | `admin` (alias `hr_manager`) | Full CRUD + approve |
| Payroll Officer | `accountant` (alias `payroll_officer`) | view/create/edit/approve/print/export (no delete) |
| Branch Manager | `branch_manager` | view/create/edit/approve/print (leave + attendance) |
| Employee | `cashier` (alias `employee`) | view/create/print — **server self-scopes** to linked `hr_employees.user_id` |

Permission keys live in `src/lib/rbac.js` (`MODULES` + `buildDefaultMatrix`) and `API_PERMISSION_MAP` in `permissionMiddleware.js`.

---

## API surface

Namespace `payroll.*` via `api/_payroll.js` → `handlePosAction` in `_posData.js`.

Key actions: employees CRUD, attendance, leave, salary, loans, runs (preview/approve/lock/unlock/rollback/regenerate), payslips, bankExport, getDashboard, getReports, selfOverview, settings.

---

## UI routes

| Route | Page | Gate |
|-------|------|------|
| `/payroll` | `Payroll.jsx` tabs | `payroll.view` |
| `/payroll/self` | `PayrollSelfService.jsx` | `payroll.view` |

Nav: Layout → Payroll + My HR (module `payroll`).

---

## Isolation

- Service-role API always filters by caller `company_id` (platform may pass `params.company_id`).
- RLS on all new tables with `tenant_match`.
- Self-service and cashier paths refuse cross-employee reads/writes.

---

## Gaps / Partial

1. **Email/SMS payslip delivery** — not wired (no mailer); print/PDF only.
2. **Digital signature** — print line + `signed_at` field; no e-sign provider.
3. **Photo upload** — `photo_url` / document `file_url` stored; no dedicated upload service UI.
4. **Platform Owner cross-tenant payroll KPIs** — deferred by design.
5. **Notifications center** — not yet listing pending leave / payroll due.
6. **Existing permission matrices** in DB may omit `payroll` until Owner re-saves roles; `ensurePermissionShape` fills defaults on client.

---

## Deploy status

| Step | Status |
|------|--------|
| Migration `020` `db push --linked` | **Applied** |
| `npm run build` | **Succeeded** (local + Vercel) |
| `npx vercel --prod --yes` | **Deployed** → https://www.nexorapospro.com (alias); https://nexora-2r011iyt1-nexoraposapp.vercel.app |

---

## Files changed (primary)

- `supabase/migrations/020_payroll_hr_enterprise.sql`
- `api/_payroll.js` (new)
- `api/_posData.js` (wire-in)
- `api/_aiEngine.js` (executive tools)
- `src/lib/rbac.js`, `permissionMiddleware.js`, `supabaseApi.js`, `mockApi.js`, `payslipExport.js`
- `src/pages/Payroll.jsx`, `PayrollSelfService.jsx`, `Dashboard.jsx`
- `src/App.jsx`, `src/components/Layout.jsx`
- `PAYROLL_HR_MODULE_REPORT.md` (this file)

---

## Enterprise Complete?

**Yes for company-scoped payroll MVP** (employees → leave/attendance → salary → run → payslip → bank export → reports → self-service → RBAC/audit/AI).  
**Not 100%** if email delivery, e-signature, photo upload pipeline, and Platform-wide payroll analytics are required for that label.
