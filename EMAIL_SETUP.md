# Email Setup Guide (Resend)

Nexora POS sends two kinds of real emails: **account verification** (on signup) and **password reset**. Both are sent through [Resend](https://resend.com) from a small serverless function (`api/send-email.js`) that runs on Vercel — the API key never touches the browser.

**Sender address:** `noreply@nexorapospro.com`
**Domain:** `nexorapospro.com`

Until you complete the steps below, the app will show an honest **"email service not configured"** error on signup/password-reset instead of pretending the email was sent. That is expected and correct — not a bug.

---

## 1. Create a Resend account

1. Go to [resend.com](https://resend.com) and sign up (free tier is fine to start).
2. Verify your own email address to activate the account.

## 2. Add and verify your domain in Resend

1. In the Resend dashboard, go to **Domains → Add Domain**.
2. Enter `nexorapospro.com` and choose the region closest to your users.
3. Resend will show you a list of DNS records to add — typically:
   - One or more **DKIM** `TXT` (or `CNAME`) records (proves you own the domain and lets Resend sign emails as you).
   - An **SPF**-related `TXT` record (tells other mail servers Resend is allowed to send on your behalf).
   - Sometimes a **Return-Path/MX** record scoped to a subdomain (e.g. `send.nexorapospro.com`) used for bounce tracking.
   - Follow **exactly** what Resend's dashboard shows for your domain — the exact record names/values are generated per-domain and can change, so always use what's on screen rather than any example values.
4. Add each record in **Cloudflare** (same place your Email Routing is already configured):
   - Log into Cloudflare → select the `nexorapospro.com` zone → **DNS** → **Records**.
   - Click **Add record** for each row Resend gave you, matching Type, Name, and Content/Value exactly.
   - Leave Cloudflare's proxy status **"DNS only"** (grey cloud, not orange) for these records — outbound-email DNS records must resolve directly, not through Cloudflare's proxy.
   - This will **not** conflict with your existing Email Routing setup — Email Routing only affects inbound MX records; these new records are separate and only affect outbound sending verification/signing.
5. Back in Resend, click **Verify** (or wait — Resend also auto-checks periodically). DNS propagation can take anywhere from a few minutes to a few hours.
6. Once the domain shows **Verified** in Resend, outbound sending from `@nexorapospro.com` addresses is ready.

## 3. Generate an API key

1. In Resend, go to **API Keys → Create API Key**.
2. Give it a name (e.g. `nexora-pos-production`).
3. If Resend offers a permission scope, choose **"Sending access"** (restricted to sending emails) rather than full account access — this limits the damage if the key is ever leaked.
4. Copy the key immediately — Resend only shows it once.

## 4. Add the key to Vercel

**Never commit this key to git, and never paste it into a chat/AI tool.** It only ever goes into Vercel's environment variable storage.

**Option A — Vercel Dashboard:**

1. Open your project on [vercel.com](https://vercel.com) → **Settings → Environment Variables**.
2. Add a new variable:
   - **Name:** `RESEND_API_KEY` (exact spelling/casing matters)
   - **Value:** the key you copied from Resend
   - **Environment:** Production (add to Preview too if you want email to work on preview deployments)
3. Click **Save**.

**Option B — Vercel CLI:**

```bash
vercel env add RESEND_API_KEY production
```

Paste the key when prompted.

## 5. Redeploy

Environment variable changes only take effect on a **new deployment**. Trigger a redeploy (push a commit, or run `vercel --prod` / your existing `npm run deploy`) after adding the key.

## 6. What to expect

- **Before** domain verification finishes and/or before `RESEND_API_KEY` is set: signup and password-reset flows still work (accounts are created, reset tokens still generate), but the UI will honestly say the email couldn't be sent. This is intentional — the app never fakes a "sent" confirmation.
- **After** both are done: real verification and password-reset emails will be delivered to real inboxes from `noreply@nexorapospro.com`.
- Local development (`npm run dev`) has no serverless function runtime, so `/api/send-email` isn't reachable there — this is a known, acceptable limitation of local dev (use a real Vercel deployment, or `vercel dev`, to test actual sending).
