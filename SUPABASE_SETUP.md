# Supabase Auth Setup Guide

Nexora POS uses **Supabase Auth** as the only source of truth for login, signup, sessions, and user roles. Browser `localStorage` is still used for business data (companies, products, sales, etc.), but **not** for credentials or app-owned session keys.

This guide is written for a non-developer operator. Follow the steps in order.

**Live site:** `https://www.nexorapospro.com`

---

## What you will configure

Three environment variables (in Vercel):

| Variable | Where it is used | Public? |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser + serverless | Yes (Vite public) |
| `VITE_SUPABASE_ANON_KEY` | Browser + serverless | Yes (Vite public — protected by Supabase RLS / Auth rules) |
| `SUPABASE_SERVICE_ROLE_KEY` | Serverless `/api/*` only | **No — never put this in `VITE_` vars or commit it** |

Also keep the existing email key:

| Variable | Where |
|---|---|
| `RESEND_API_KEY` | `api/send-email.js` only (unchanged) |

---

## 1. Open your Supabase project

1. Go to [supabase.com](https://supabase.com) and open your project.
2. In **Project Settings → API**, copy:
   - **Project URL** → this becomes `VITE_SUPABASE_URL`
   - **anon public** key → this becomes `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → this becomes `SUPABASE_SERVICE_ROLE_KEY`  
     (click “Reveal” — treat it like a root password)

---

## 2. Add the keys to Vercel

**Never paste the service role key into chat, git, or a frontend file.**

1. Open your project on [vercel.com](https://vercel.com) → **Settings → Environment Variables**.
2. Add each variable for **Production** (and Preview if you use preview deploys):

   - `VITE_SUPABASE_URL` = your Project URL  
   - `VITE_SUPABASE_ANON_KEY` = anon public key  
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key  

3. Save, then **redeploy** (env changes only apply on a new deployment).

---

## 3. Configure Auth URLs in Supabase

1. Supabase Dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to:

   `https://www.nexorapospro.com`

3. Add these **Redirect URLs**:

   - `https://www.nexorapospro.com/verify-email`
   - `https://www.nexorapospro.com/reset-password`
   - `https://www.nexorapospro.com/**` (optional catch-all if your Supabase plan allows wildcards)

---

## 4. Send Supabase emails through Resend (custom SMTP)

Supabase sends its own confirmation and password-reset emails. Point Supabase SMTP at Resend so delivery matches your existing domain setup.

1. Supabase Dashboard → **Project Settings → Authentication → SMTP Settings** (or **Auth → Emails → SMTP**).
2. Enable **Custom SMTP** and enter:

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` (or `587` if your UI prefers STARTTLS) |
   | Username | `resend` |
   | Password | your **Resend API key** (same family of key as `RESEND_API_KEY`) |
   | Sender email | `noreply@nexorapospro.com` |
   | Sender name | `Nexora POS` |

3. Save. Your Resend domain (`nexorapospro.com`) must already be verified — see `EMAIL_SETUP.md`.

**Note:** Admin password resets and “password changed” notifications still use `/api/send-email` + `RESEND_API_KEY` (unchanged). Signup confirmation and forgot-password emails come from Supabase’s mailer once SMTP is set.

---

## 5. Bootstrap the first Platform Owner

Public signup only creates **company owners**. The first **platform_owner** must be created manually.

1. Supabase Dashboard → **Authentication → Users → Add user**.
2. Create the user with email + password. Prefer **Auto Confirm User** so you can sign in immediately.
3. Open the **SQL Editor** and run (replace the email):

```sql
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"platform_owner","username":"platformowner","active":true}'::jsonb
where email = 'your-platform-owner@example.com';
```

4. Sign in on the live site using **Platform login** mode with identifier `platform` and that username/email + password.

**Security note:** Roles and `company_id` live in Supabase Auth **`app_metadata`** (server-only via the service role). Do **not** put roles in `user_metadata` — clients can edit that field.

---

## 6. Local development

Create a `.env` / `.env.local` file (never commit secrets):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

`SUPABASE_SERVICE_ROLE_KEY` is only needed when running serverless routes (`vercel dev` or a real Vercel deployment). Plain `npm run dev` can exercise the UI, but `/api/admin-*` and `/api/resolve-login-email` will not work without the Vercel serverless runtime + service role key.

---

## 7. What “success” looks like

- Signup creates a Supabase user + local company/branch/trial, then asks the user to confirm email.
- Login uses `signInWithPassword` after resolving username → email (server-side).
- Users admin screens talk to `/api/admin-*` with the caller’s Bearer token.
- Logging out clears the Supabase session (Supabase’s own auth storage), not an app `nexora_session` key.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| “Supabase is not configured” | Missing `VITE_SUPABASE_*` on the deployment that built the frontend |
| Admin user actions fail with 503 | Missing `SUPABASE_SERVICE_ROLE_KEY` on Vercel |
| No confirmation / reset emails | Custom SMTP not configured, or Resend domain not verified |
| Redirect lands on wrong page | Site URL / Redirect URLs missing in Supabase Auth settings |
| Platform login fails | `app_metadata.role` is not `platform_owner` |
