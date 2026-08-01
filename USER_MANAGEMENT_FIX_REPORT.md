# User Management Fix Report

**Date:** 2026-07-23  
**Scope:** Owner → User Management empty list (create worked; list always empty)  
**Constraint:** Bugfix only — no new modules

---

## Root cause

`POST /api/admin-list-users` correctly returned `{ success: true, users: [...] }`, but production `supabaseApi.auth.listUsers()` returned that **envelope object** unchanged.

`Users.jsx` then did:

```js
setUsers(Array.isArray(rows) ? rows : []);
```

An object is not an array → **always `[]`**. Create/login were fine (auth.users + profiles + `company_id` were written). Mock API already unwrapped `.users`; production did not.

---

## Fixes

| Area | Change |
|---|---|
| `src/lib/supabaseApi.js` | `listUsers` unwraps `users` array; `getUser` uses filtered `id` body |
| `api/admin-list-users.js` | Dual-source merge: Auth + `profiles` (same company), branch names, totals, metadata-drift rescue |
| `src/pages/Users.jsx` | Defensive normalize; totals (total/active/inactive); columns Name/Email/Role/Branch/Status/Last Login/Active; View/Edit/Activate/Deactivate/Reset Password/Delete |
| `src/pages/UserForm.jsx` | After create, navigate with `createdUser` for optimistic list insert |

**RLS / schema:** No migration required. List uses service-role admin API. Existing `profiles_select` already allows `company_id = jwt_company_id()` for Owners. Multi-tenant filter remains `sameCompany(caller.company_id, …)` (Platform Owner unrestricted).

---

## How list + create stay in sync

1. **Create** writes `auth.users` (`app_metadata.company_id`) + `profiles` upsert with the same `company_id`.
2. **List** merges both sources and company-filters; profile-only rows still appear if Auth metadata drifted.
3. **UI** unwraps `users` and optionally seeds from create navigation state, then reloads from the API.

---

## Verify

1. Owner → Users → see self + all company users (not empty).
2. Create three users → each appears immediately (optimistic) and after refresh.
3. Activate / Deactivate / Reset Password / Delete work for manageable roles.
4. Totals: total / active / inactive match the table.
5. Second company Owner never sees the first company’s users.

---

## Deploy

- **Build:** `npm run build` — PASSED  
- **Production deploy:** PASSED (`npx vercel --prod --yes`)  
- **Production URL:** https://www.nexorapospro.com  
- **Inspect:** https://vercel.com/nexoraposapp/nexora-pos/HCxrb28ZcnqAGsxB1HeNLrT3u33W  
- **Commit:** Not created (not requested)  
- **Production-ready:** **Yes** — Owner list now receives the `users` array; create/list stay in sync via Auth + profiles merge + optimistic UI.
