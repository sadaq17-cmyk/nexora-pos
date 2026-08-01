# Nexora AI Dual Mode — Implementation Report

**Date:** 2026-07-23  
**Scope:** Production Dual Mode AI (PUBLIC + EXECUTIVE) for Nexora POS  
**Status:** Complete (build green)

## Architecture shipped

One serverless AI service with two permission modes:

| Mode | Brand | Who | Behavior |
|------|--------|-----|----------|
| **PUBLIC** | Nexora AI | All authenticated company users | Role-scoped tools via existing POS data plane |
| **EXECUTIVE** | Nexora Executive AI | Company Owner (`owner`) and Platform Owner | Elevated read tools; UI auto-enabled; hidden from Admin/Manager/Cashier/Accountant |

- **Backend:** AI actions on `api/pos.js` (`ai.meta` / `ai.chat`) + shared engine `api/_aiEngine.js`  
  *(Separate `api/nexora-ai.js` was avoided — Vercel Hobby allows max 12 serverless functions.)*
- **Frontend:** Floating assistant in app shell (`src/components/ai/NexoraAiAssistant.jsx`)
- **Auth:** Bearer JWT via `verifyCallerFromRequest`; executive mode rejected unless owner/platform owner
- **Tenancy:** All tool calls use caller `company_id` through `handlePosAction` / admin user filters
- **Secrets:** Tool payloads redact password/token/api_key fields; LLM never invents numbers without tools
- **Config:** If no API key, returns clear `AI_NOT_CONFIGURED` (no mock answers)
- **Audit:** Executive queries write `audit_log` with action `executive_ai.query`, module `nexora_executive_ai`

## Milestone checklist

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Scaffold AI API + auth gate + mode selection | **Done** |
| 2 | Public chat UI + help/Q&A with permission-scoped tools | **Done** |
| 3 | Owner detection + Executive UI shell | **Done** |
| 4 | Executive data tools (users, audit, sessions/login, security) | **Done** |
| 5 | Health + branch/financial + alerts + recommendations | **Done** |
| 6 | Screenshot troubleshooting flow | **Done** |
| 7 | Audit logging for executive AI | **Done** |
| 8 | Build + fix + deploy + report | **Done** |

## Files changed / added

### Added
- `api/_aiEngine.js` — shared prompts, tools, OpenAI client, RBAC tool gate, audit writer
- `src/lib/nexoraAiApi.js` — authenticated client helpers (`/api/pos` actions)
- `src/components/ai/NexoraAiAssistant.jsx` — floating dual-mode UI
- `src/styles/nexora-ai.css` — enterprise-aligned assistant styles
- `NEXORA_AI_IMPLEMENTATION_REPORT.md` — this report

### Modified
- `api/pos.js` — hosts `ai.meta` / `ai.chat` (no extra serverless function)
- `src/components/Layout.jsx` — mount assistant for authenticated shell
- `src/main.jsx` — import AI styles

## Public tools (role-gated)

- `sales_summary`, `inventory_low_stock`, `products_search`, `customers_lookup`
- `suppliers_lookup`, `purchases_summary`, `expenses_summary`, `reports_summary`
- `branches_list`, `notifications_list`, `settings_help`

Role view matrix in `_aiEngine.js` mirrors enterprise RBAC defaults (cashier ≠ sales totals, etc.).

## Executive tools (owner-only)

- `company_overview`, `users_list`, `audit_logs`, `login_history`
- `security_signals`, `active_sessions_signal`, `health_probe`
- `branch_comparison`, `financial_analysis`, `critical_alerts`, `smart_recommendations`
- Plus all public tools

Executive UI chips map to these capabilities (Dashboard, BI, Users, Audit, Login, Sessions, Security, Health, Branches, Finance, Alerts, Screenshot, Recommendations).

## How to configure API keys

Set **server-only** environment variables (Vercel Project → Settings → Environment Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | **Yes** (or alternate below) | OpenAI (or compatible) API key |
| `NEXORA_AI_API_KEY` | Alternate | Same as `OPENAI_API_KEY` if you prefer Nexora-named env |
| `AI_API_KEY` | Alternate | Third fallback name |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` (use a vision-capable model for screenshots, e.g. `gpt-4o-mini` / `gpt-4o`) |
| `NEXORA_AI_MODEL` | No | Alternate model env |
| `OPENAI_BASE_URL` | No | Default `https://api.openai.com/v1` (override for Azure/compatible gateways) |
| `NEXORA_AI_BASE_URL` | No | Alternate base URL |

Also required (already used by POS):

- `VITE_SUPABASE_URL` / `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Vercel CLI example

```bash
npx vercel env add OPENAI_API_KEY production
npx vercel --prod --yes
```

After deploy, open any authenticated company page → floating **Nexora AI** / **Nexora Executive AI** button (bottom-right).

### API usage

`POST /api/pos`

```json
{ "action": "ai.meta" }
```

```json
{
  "action": "ai.chat",
  "params": {
    "mode": "auto",
    "messages": [{ "role": "user", "content": "What is low stock today?" }],
    "image_base64": "data:image/png;base64,..."
  }
}
```

- `mode`: `auto` | `public` | `executive` (executive rejected for non-owners)
- Authorization: `Bearer <supabase_access_token>`
- **Deploy note:** First attempt with a dedicated `api/nexora-ai.js` failed on Hobby (“max 12 Serverless Functions”). AI is therefore mounted on `api/pos.js`.

## Security notes

- No cross-company leakage: tools filter by JWT `company_id`
- Executive UI never rendered for non-owners (no mode switch exposed)
- Screenshots accepted in-memory for the LLM call only; not persisted to storage
- Secrets redacted before tool results enter the model context
- Rate limited per caller+IP (`40` / minute)

## Remaining gaps / follow-ups

1. **True SSE streaming** — engine is solid request/response; streaming flag is accepted but completion path is non-stream for reliability with tool loops. Can add SSE after tool loop finalization if desired.
2. **Device session store** — “Active Sessions” uses server `last_login` / `last_activity` proxies; browser localStorage sessions (Login & Security panel) are not globally queryable from the server.
3. **Custom permission matrix** — AI public tool gate uses default role→module map; company-custom matrices are not yet loaded for AI tool allowlists (POS data still company-scoped).
4. **OPENAI_API_KEY on production** — must be set in Vercel or AI returns `AI_NOT_CONFIGURED`.

## Verification

- `npm run build` — succeeded
- Deploy — `npx vercel --prod --yes` succeeded
- **Production alias:** https://www.nexorapospro.com
- **Deployment URL:** https://nexora-mxjy0qr1v-nexoraposapp.vercel.app
- **Inspect:** https://vercel.com/nexoraposapp/nexora-pos/9VovZ45KbYsex1NunNGFRLGQ2CLB
