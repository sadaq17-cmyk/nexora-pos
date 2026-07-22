# Enterprise Users & Management Upgrade Report

**Date:** 2026-07-22  
**Scope:** Users & Management enterprise upgrade (RBAC, Users UI, security, subscription, notifications, audit, dashboard)  
**Build:** `npm run build` — **PASSED**

---

## Phase 0 — Gap matrix (before → after)

| Capability | Owner | Admin | Manager | Staff | Before | After |
|---|---|---|---|---|---|---|
| Company / billing / subscription / backup | Yes | No | No | No | Admin still had subscription/backup in default matrix | Admin stripped; Owner-only route + nav for Plan |
| Assign/remove Admin | Yes | No | No | No | OK (admin cannot assign admin) | Unchanged |
| Staff CRUD + activate/deactivate/reset pwd | Yes | Yes | **No** | No | Manager could manage cashiers/sales | Manager **removed** from user management |
| Products / inventory / purchases / suppliers / customers / reports | Yes | Yes | Yes | Assigned only | Manager had weak purchases/suppliers (view) + users/audit | Manager full ops on listed modules; no users/settings/roles/audit |
| Settings / roles / audit | Owner (+ Admin limited) | Roles view/edit limited | No | No | Manager had audit + users | Aligned |
| Enterprise user fields (employee ID, dept, status lifecycle, device) | — | — | — | — | Basic name/email/role/active | Extended in Auth metadata + migration `011` |
| Account controls (suspend/unlock/force logout/force pwd) | Yes | Yes | No | No | Activate + password + delete | Full control set on Users page |
| Login lockout / MFA / session idle | — | — | — | — | Present (local lockout, MFA, idle) | Gate extended for suspended/locked/login disabled/force logout |
| Notifications center | Owner/Admin ops | Yes | Via dashboard | Via dashboard | Bell dropdown (low stock only) | Page + enriched derived alerts |
| Audit search / export / device columns | Yes | If permitted | No | No | Module filter only | Search, action filter, CSV/Excel, IP/device columns |
| Dashboard AI insights | Viewers of dashboard | Yes | Yes | If allowed | KPIs + charts | Rule-based Business Insights panel |

---

## What shipped

### Phase 1 — RBAC
- Updated `src/lib/rbac.js` default matrix for **Admin** and **Manager (`branch_manager`)**.
- Manager can no longer manage users (`isUserManagerRole`, `canManageRole`, assignable roles).
- Mirrored in `api/_authHelpers.js`.
- Subscription route/nav gated **Owner-only**.
- User create/edit routes no longer allow `branch_manager`.

### Phase 2 — Users Management
- Upgraded `Users.jsx` (search/filters, status badges, device/activity columns, account controls).
- Upgraded `UserForm.jsx` (employee ID, department, position, address, national ID, account status, login enable, force password change).
- Extended `admin-create-user` / `admin-update-user` / `safeUserFields` for new metadata + control actions.
- Migration: `supabase/migrations/011_enterprise_users_management.sql` (profiles + audit enrichment + subscription helper columns).

### Phase 3 — Login security
- `gateAfterSignIn` rejects inactive / suspended / login-disabled / locked accounts.
- Honors `force_logout_at` vs session start (admin force logout).
- Existing MFA, password policy, idle timeout (30m), absolute timeout (12h), and local failed-login lockout remain.

### Phase 4 — Subscription (Owner only)
- Redesigned `Subscription.jsx` with plan, days remaining, payment status, auto renewal, start/expiry, derived status (Active / Expiring Soon / Expired / Suspended).

### Phase 5 — Notifications
- New `Notifications` page + sidebar link.
- `notifications.list` now derives low stock, open POs, supplier due, subscription warnings, failed logins (API + mock).

### Phase 6 — Audit
- Search, action filter, IP/device columns, old/new change display, CSV + Excel export.
- Migration adds optional `ip` / `device` / `browser` / `os` / `old_values` / `new_values` on `audit_log`.

### Phase 7 — Dashboard
- Added **AI Business Insights** panel (rule-based: sales trend %, top product, restock, subscription warning).

### Phase 8 — Suppliers / Purchases / Products / Reports
- **No rewrite.** Prior enterprise purchase workflow (draft/partial receive/due dates) left intact. Critical gap fill only via notifications for open POs / due payments.

---

## Deferred (intentionally)

- Server-side persistent failed-login counters per user in Postgres (client lockout already exists).
- Writing device/IP onto `app_metadata` on every login (UI fields ready; Security Center already tracks local sessions).
- Full push/email notification delivery pipeline.
- PDF audit export (CSV/Excel shipped; PDF can reuse report PDF helpers later).
- Real LLM-based insights (rule-based panel shipped).
- Applying migration `011` to production Supabase (must be run in SQL editor / CLI before profiles columns are queryable).
- Platform Owner multi-tenant HR sync beyond Auth metadata.

---

## How to verify

1. **Build:** `npm run build` (green).
2. **RBAC:** Sign in as Owner → see Plan + Users + Audit. As Admin → Users yes, Plan no. As Manager → Products/Purchases/Suppliers/Customers/Reports yes; Users/Settings/Plan/Roles/Audit hidden. As Cashier → POS only (plus product view for checkout).
3. **Users:** Create user with Employee ID / Department / Status Suspended; confirm login blocked for suspended/disabled.
4. **Controls:** From Users table — Suspend, Unlock, Force logout, Force password change, Disable login.
5. **Notifications:** Open `/notifications` — expect low-stock / PO / due alerts when data exists.
6. **Audit:** Filter + export CSV/Excel.
7. **Dashboard:** Confirm Business Insights panel beside Sales Trend.
8. **DB:** Run `011_enterprise_users_management.sql` in Supabase before relying on new `profiles` columns.

---

## Deploy status

- **Commit:** Skipped (not requested).
- **Production deploy:** **Succeeded** via `npx vercel --prod --yes` (retry after transient `fetch failed`).
- **Inspect:** https://vercel.com/nexoraposapp/nexora-pos/BSbq8fonPT8jjWq9uJzcBTm5xbPU
- **Production URL:** https://www.httpsnexorapos.com (custom domain) / Vercel alias from deploy output.
- **Note:** Apply migration `011` in Supabase for full profile column sync; Auth `app_metadata` path works without it for most UI fields.
