# Subscription Pricing Report

## Summary

Nexora POS subscription pricing is now centralized in **KES** with four paid plans plus a **7-day Enterprise-feature free trial**. Upgrade/downgrade preserves all company data. After trial/subscription expiry, **only the Company Owner** can log in to choose a plan; staff are blocked.

## Plans (source of truth)

| Plan | Code | Price (KES / month) | Branches | Users | Products |
|------|------|---------------------|----------|-------|----------|
| Free Trial | `free_trial` | 0 (7 days) | Unlimited | Unlimited | Unlimited |
| Starter | `starter` | 5,500 | 1 | 3 | 1,000 |
| Business | `business` | 10,000 | 3 | 10 | Unlimited |
| Professional | `professional` | 15,000 | 10 | 50 | Unlimited |
| Enterprise | `enterprise` | 25,000 | Unlimited | Unlimited | Unlimited |

Catalog files:
- `src/lib/subscriptionPlans.js` (app)
- `src/lib/saasPlans.js` (re-exports for existing imports)
- `api/_saasPlans.js` (API mirror — cannot import from `src/`)

## What changed

1. **Catalog** — Replaced USD Basic/Professional/Contact-Sales Enterprise with KES Starter / Business / Professional / Enterprise.
2. **Trial** — Always **7 days** with **all Enterprise features/limits**. Signup forces `free_trial` regardless of marketing CTA.
3. **Post-trial lock** — `companies.checkAccess` honors `expires_at` / `trial_ends_at`. Auth gate: owners → `/subscription/renew`; staff → signed out with clear message.
4. **UI** — Pricing cards, Owner Subscription page, Subscription Renew, Signup, Home/Help/FAQ copy updated to KES amounts and plan names.
5. **Upgrade / downgrade** — Owner can change plan via `subscription.changePlan` / `requestRenewal` / `update`. Updates `plan_code` + limits only; **no data wipe**.
6. **Soft limits** — Enforced on create for branches, products, users (and warehouses in mock): returns `PLAN_LIMIT` without deleting existing rows.

## Files touched (primary)

- `src/lib/subscriptionPlans.js` *(new)*
- `src/lib/saasPlans.js`
- `api/_saasPlans.js` *(new)*
- `api/_posData.js`
- `api/admin-create-user.js`
- `src/lib/mockApi.js`
- `src/lib/supabaseApi.js`
- `src/context/AuthContext.jsx`
- `src/pages/Subscription.jsx`
- `src/pages/SubscriptionRenew.jsx`
- `src/pages/public/Pricing.jsx`
- `src/pages/public/Signup.jsx`
- `src/pages/public/Home.jsx`
- `src/pages/public/Help.jsx`
- `src/lib/publicSiteContent.js`
- `src/pages/Approvals.jsx`
- `SUBSCRIPTION_PRICING_REPORT.md` *(this file)*

## How to verify

1. Open `/pricing` — four KES plans (Starter 5,500 … Enterprise 25,000); CTAs start free trial.
2. Sign up a new company — workspace starts on `free_trial` for 7 days with Enterprise limits.
3. As Owner, open `/subscription` — switch Starter ↔ Business ↔ Professional ↔ Enterprise; confirm products/customers/sales still present.
4. Expire a trial (set `expires_at` / status in platform console or DB) — Owner reaches renew portal; staff login is rejected with owner-only message.
5. On Starter, try creating a 2nd branch or 4th user — expect plan-limit error; existing records remain.

## Build / deploy

- `npm run build` — **green**
- Production deploy — **ok**
  - Deployment: https://nexora-f97n5f37y-nexoraposapp.vercel.app
  - Alias: https://www.httpsnexorapos.com
  - Inspect: https://vercel.com/nexoraposapp/nexora-pos/7MdtvVU6DQbgv6STRsEfJtocx1dC

## Notes / non-goals

- No payment gateway / M-Pesa checkout was added — plan activation records the chosen catalog plan and extends access.
- Legacy plan code `basic` maps to `starter`.
- Platform console can still edit plans; canonical paid plans force-sync prices/limits from the catalog on merge.
