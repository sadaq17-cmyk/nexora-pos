# Platform Owner Administration — Implementation Report

**Date:** 2026-07-23  
**Priority:** Platform Owner Admin before Company User Management  
**Scope:** Level 1 (Platform Owner / Super Admin) production wiring on existing multi-tenant schema

---

## Role matrix (three levels)

| Level | Role id | Who | Sees Platform `/platform/*` | Tenant scope |
|-------|---------|-----|------------------------------|--------------|
| **1 — Platform Owner** | `platform_owner` | Permanent Super Admin (`saadaq17@icloud.com` / `SuperAdmin`) | **Yes** — only this role | Cross-tenant (`company_id` null); JWT `app_metadata.role` |
| **2 — Company Owner** | `owner` | Tenant account owner | **Never** — routes + nav gated | Own `company_id` only |
| **3 — Staff** | `admin`, `branch_manager`, `cashier`, etc. | Company staff | **Never** | Own company + RBAC modules |

**Identification (reuse, not redesigned):**
- Runtime gate: `normalizeRole(app_metadata.role) === "platform_owner"`
- Seed: `api/_ensurePermanentOwner.js` → `PLATFORM_ADMIN`
- SQL helper already exists: `public.is_platform_owner()`
- Frontend: `isPlatformOwner()` in `src/lib/rbac.js`; Layout `platformMode`

There is **no** `is_platform_admin` column. Do not invent one.

---

## Routes (UI)

| Path | Module | Who |
|------|--------|-----|
| `/platform` | `owner_management` | platform_owner |
| `/platform/companies` | `company_accounts` | platform_owner |
| `/platform/subscriptions` | `subscriptions` | platform_owner |
| `/platform/pricing` | `plans` | platform_owner |
| `/platform/users` | `users` | platform_owner |
| `/platform/analytics` | `platform_analytics` | platform_owner |
| `/platform/audit` | `platform_audit` | platform_owner |
| `/platform/*` (branches, roles, settings, domains, payments, backup, search, approvals) | respective platform modules | platform_owner |
| `/dashboard`, `/pos`, `/inventory`, … | tenant modules | owner + staff (RBAC) |

**Isolation:**
- `App.jsx`: every `/platform/*` route uses `allowedRoles={["platform_owner"]}`
- `OwnerManagement.jsx`: hard `Navigate` away if `!isPlatformOwner(user.role)`
- `Layout.jsx`: `platformMode = isPlatformOwner && !impersonation` → only `PLATFORM_SECTIONS` in nav; company owners/staff never see those items
- While impersonating, platform nav is hidden; banner offers **Stop Impersonation** → back to `/platform`

---

## APIs

### Production platform actions (`/api/pos`)

Implemented in `api/_platformAdmin.js`, dispatched from `api/_posData.js` for `platform.*` / `owner.*`:

| Action | Purpose |
|--------|---------|
| `platform.getOverview` | Companies + users + branches + stats (enriched metrics) |
| `platform.getConsole` | Subscriptions, canonical plans, KPIs, audit slice |
| `platform.getCompany` | Single company detail |
| `platform.updateCompany` | Edit company fields / status |
| `platform.activateCompany` | Set `companies.status = active`, restore sub |
| `platform.deactivateCompany` | Soft-disable → `cancelled` |
| `platform.suspendCompany` | `suspended` + subscription `inactive` |
| `platform.deleteCompany` | Soft-delete → `cancelled` + settings flag (data retained) |
| `platform.lockCompany` / `unlockCompany` | `company_settings.settings.platform_locked` + suspend/unsuspend |
| `platform.updateSubscription` | Change plan / status / expiry |
| `platform.extendSubscription` | Extend by N days |
| `platform.resetOwnerPassword` | Auth admin password reset for company owner |
| `platform.recordAudit` | Explicit platform audit write |

**Every action** calls `requirePlatform()` → non–platform_owner receives `403 FORBIDDEN`.

### Client wiring

`src/lib/supabaseApi.js` → `api.owner.*` now calls the production `platform.*` actions (no longer stubbed to tenant hydrate only).

### Impersonation

| Endpoint | Gate |
|----------|------|
| `POST /api/admin-impersonate` | platform_owner (any non-platform user) **or** company owner (same-company **staff only**, not peer owners) |

Design:
1. Mint Supabase Auth magic-link for target (`admin.generateLink`)
2. Client `verifyOtp` → real session as target
3. Owner tokens kept in memory for **Stop Impersonation**
4. Audit: `impersonation_started` in `audit_log`
5. Platform Owner cannot be impersonated
6. Nested impersonation blocked client-side
7. Exit: Layout banner → restore session → `/platform`

### Access gate for suspended/locked tenants

`companies.checkAccess` now calls `evaluateCompanyAccessGate()` so suspended / locked / cancelled companies cannot use the product (platform_owner exempt when acting without company context).

---

## Status mapping (reuse existing CHECK constraints)

**DB `companies.status`:** `active | pending_verification | suspended | cancelled`  
**DB `company_subscriptions.status`:** `active | trialing | past_due | cancelled | inactive`

**Display status (computed, no migration):**

| Display | Source |
|---------|--------|
| Active | Company active + sub not expired |
| Suspended | `companies.status = suspended` **or** `settings.platform_locked` |
| Expired | Expiry/trial end in the past (or inactive sub) while not cancelled |
| Disabled | `companies.status = cancelled` (deactivate/delete) |

Lock flag lives in existing `company_settings.settings` JSON (`platform_locked`) — **no new table/column**.

---

## Metrics / KPIs

| KPI | Source |
|-----|--------|
| Total / Active companies | `companies` + display status |
| Branch / User / Product / Sales counts | Count queries on existing tables |
| Sales totals | Sum of `sales.total` (best-effort, per company) |
| Monthly revenue* | Estimated from active paid `CANONICAL_PLANS.price_monthly` × subscription counts |
| Total revenue* | Sum of tenant sales totals |
| AI / SMS / Storage | **Not metered** — UI shows honest “Not metered” (0) |
| Audit logs | `audit_log` |
| System health | Static `ok` probe placeholder |

\* Honest labels in UI — not fake payment ledger rows.

---

## What was reused vs additive

### Reused (no schema redesign)
- `companies`, `company_subscriptions`, `company_settings`, `profiles`, `branches`, `products`, `sales`, `audit_log`
- Role `platform_owner` + `_ensurePermanentOwner` seed
- `/platform/*` UI shell (`OwnerManagement.jsx`, Layout, App routes)
- Impersonation endpoint pattern
- `CANONICAL_PLANS` as plan catalog

### Additive (code only — **no new migrations**)
- `api/_platformAdmin.js` (new module)
- Dispatch hook in `_posData.js`
- Production `supabaseApi.owner.*` methods
- Richer companies table + actions in `OwnerManagement.jsx`
- Audit on impersonation start
- Suspend/lock gate in `companies.checkAccess`
- Permission middleware entries for new owner methods

### Deferred / gaps
| Item | Reason |
|------|--------|
| Runtime editable plans / features / domains / billing tables | Not in Postgres; mock-only. Plans stay code-defined. |
| Create company from Platform UI → live Auth + DB | Signup/bootstrap path remains; create form returns NOT_IMPLEMENTED on production API |
| AI / SMS / Storage metering tables | Not required for admin MVP; would need additive tables later |
| Hard TTL on impersonation tokens | Exit-able via banner; full reload without restored tokens ends impersonation |
| Hard delete of tenant data | Soft-disable only (safer; preserves multi-tenant history) |
| Company User Management redesign | **Stopped / deferred** per priority |

---

## Isolation guarantees

1. **UI:** Platform routes require `platform_owner`; nav never shows platform sections to Level 2/3.
2. **API:** Platform mutations reject non–platform_owner server-side.
3. **RLS / company_id:** Unchanged tenant isolation for operational POS APIs; platform uses service-role admin client only inside verified platform actions.
4. **Impersonation:** Company owners cannot cross tenants or impersonate peer owners; cannot reach platform pages while in tenant session.
5. **Lifecycle:** Suspend/lock/disable blocks tenant `checkAccess`.

---

## Production readiness

| Area | Status |
|------|--------|
| Platform dashboard + company actions (core) | **Ready** |
| Subscription change / extend / activate / suspend / lock | **Ready** |
| Impersonate + audit | **Ready** |
| Multi-tenant isolation preserved | **Yes** |
| Domains / billing / feature-flag CRUD | Deferred (honest stubs) |
| Usage metering (AI/SMS/storage) | Deferred (labeled) |

**Verdict:** Production-ready for **core Platform Owner Administration** (manage companies, subscriptions, lifecycle, impersonation, KPIs from existing data). Not a full SaaS billing console until domains/billing/metering tables are added intentionally.
