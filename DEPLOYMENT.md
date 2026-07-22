# Nexora POS Enterprise — Deployment Guide

Production-safe automatic and manual deployment to **Vercel**.

**Live custom domain:** [https://www.httpsnexorapos.com](https://www.httpsnexorapos.com)  
**Apex note:** Prefer the `www` host for the app. If the apex (`httpsnexorapos.com`) is also configured in Vercel, point it at the same project (redirect or alias); the pipelines verify the `www` URL.

---

## How automatic deploys work

Once this project has a **Git remote** connected to GitHub and the required secrets are configured:

1. An approved change is merged (or pushed) to the **`main`** branch.
2. GitHub Actions runs [`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml).
3. The workflow **fail-fast** gates:
   - `npm ci`
   - `npm run lint` — **blocks deploy on lint errors**
   - `npm run build` — **blocks deploy on build failure**
4. Only if lint + build succeed:
   - `vercel pull` / `vercel build --prod` / `vercel deploy --prebuilt --prod`
5. Key routes are HTTP-verified (`200` required). Failures fail the job.
6. Build status + live URL + route checks are written to the **GitHub Step Summary**.

You can also trigger the same pipeline manually via **Actions → Deploy Production → Run workflow** (`workflow_dispatch`).

### Required GitHub secrets

| Secret | Where to get it |
| --- | --- |
| `VERCEL_TOKEN` | [Vercel → Account → Tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Local `.vercel/project.json` → `orgId` (after `vercel link`) |
| `VERCEL_PROJECT_ID` | Local `.vercel/project.json` → `projectId` |

Add them under **GitHub repo → Settings → Secrets and variables → Actions**.  
**Never commit tokens.** Do not print `VERCEL_TOKEN` in logs or docs.

---

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Vercel → Project Settings → Environment Variables (server-side only, **not** `VITE_`-prefixed) | Powers real account-verification / password-reset email delivery via [`api/send-email.js`](api/send-email.js). See [`EMAIL_SETUP.md`](EMAIL_SETUP.md) for full setup steps. Without it, those two flows show an honest "email service not configured" error instead of faking success. |

---

## Manual / local deploy

From the project root (Node ≥ 18.18):

```bash
npm run deploy
```

This runs [`scripts/deploy.mjs`](scripts/deploy.mjs):

1. `npm run lint` — abort on failure (no build, no deploy)
2. `npm run build` — abort on failure (no deploy)
3. `npx --yes vercel --prod --yes` (passes `--token` if `VERCEL_TOKEN` is set in the environment)
4. HTTP GET verification of the production URL + key routes + custom domain `/login`
5. Writes `deployment-report.md` and appends a line to `deployments.log`

### Dry-run (no production deploy)

```bash
node scripts/deploy.mjs --dry-run
# or
npm run deploy -- --dry-run
```

Dry-run still runs **lint + build**, skips the real `vercel --prod` call, and verifies the **currently live** URL / custom domain instead.

### Windows note

The orchestrator resolves `npm.cmd` / `npx.cmd` on Windows. If Node is not on your PATH in PowerShell:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
```

---

## What blocks a deploy

| Gate | Effect |
| --- | --- |
| Lint **errors** | Abort — no build, no deploy |
| Production **build** failure | Abort — no deploy |
| Vercel deploy failure / missing production URL | Abort — skip verification as success |
| HTTP verification (non-200 on key routes after retries) | Overall **FAIL** (deploy may have already shipped; fix and redeploy) |

Lint **warnings** are allowed (`--max-warnings=99999`). Only genuine errors fail the gate.

Key routes checked:

- `/`, `/login`, `/dashboard`, `/pos`, `/owner-management`, `/users`, `/reports`
- Custom: `https://www.httpsnexorapos.com/login`

---

## Reports and logs

| File | Purpose |
| --- | --- |
| `deployment-report.md` | Latest run report (timestamp, statuses, URLs, route table, PASS/FAIL). **Overwritten** each run. |
| `deployments.log` | Append-only history (one line per run). |

**Gitignore choice:** both are **ignored** (local/CI artifacts, not source). The GitHub Actions workflow publishes the equivalent info to `$GITHUB_STEP_SUMMARY` instead of committing these files.

---

## Lint scripts

```bash
npm run lint        # gate used by deploy (errors fail; warnings OK)
npm run lint:fix   # auto-fix safe issues
```

ESLint uses classic `.eslintrc.cjs` (ESLint 8.x) targeting `src/**/*.{js,jsx}`.

---

## Current limitation (this machine)

`git` may not be installed locally and there may be no local git repo / remote. **True automatic deploys** require:

1. A git repository with a GitHub remote
2. The three Vercel secrets above
3. Pushes (or merges) to `main`

Until then, use `npm run deploy` (or `--dry-run`) from a linked Vercel project (`.vercel/project.json` already present for `nexoraposapp/nexora-pos`).
