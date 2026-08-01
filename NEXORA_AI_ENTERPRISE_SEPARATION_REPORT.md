# Nexora AI — Enterprise Separation Report

**Date:** 2026-07-23  
**Scope:** Split Nexora Executive AI vs Nexora Assistant AI, top-nav floating window, language parity, API hardening  
**Status:** Implemented (build + deploy documented below)

## Architecture

Two independent AI modes share one engine (`api/_aiEngine.js`) hosted on `POST /api/pos` (`ai.meta` / `ai.chat`) to stay within Vercel Hobby serverless limits.

| Mode | Brand | Who (UI + API) | Tool surface |
|------|--------|----------------|--------------|
| **executive** | Nexora Executive AI | Company Owner, Super Admin, Platform Owner | BI, P&L, revenue, expenses, cash-flow signals, forecast, inventory/supplier/customer analytics, employee performance, audit, users, security, health, plus operational tools |
| **assistant** | Nexora Assistant AI | Cashier, Staff, Manager, Admin, and other non-owner roles | Product/price/barcode/stock, today’s orders, invoice track, payment FAQ, recommendations, customer support lookup — **no** financial/security/owner tools |

Legacy aliases: `public` / `staff` / `customer` → `assistant`. `private` / `owner` → `executive` (still RBAC-gated).

## Role matrix

| Role | Sees in nav | Default mode | Can call `mode: executive` |
|------|-------------|--------------|----------------------------|
| Owner | Executive AI | executive | Yes |
| Super Admin | Executive AI | executive | Yes |
| Platform Owner | Executive AI | executive | Yes |
| Admin | Assistant AI | assistant | **No** (403 `EXECUTIVE_FORBIDDEN`) |
| Manager (branch/sales/inventory) | Assistant AI | assistant | **No** |
| Cashier / Sales / Accountant | Assistant AI | assistant | **No** |
| Customer portal | N/A (no authenticated company shell AI mount today) | — | — |

UI gate: `isOwner || isPlatformOwner || isSuperAdmin` in `NexoraAiAssistant.jsx`.  
API gate: `canUseExecutiveAi()` in `resolveAiMode` + defense-in-depth inside `runNexoraAiChat`.

## Endpoints

`POST /api/pos`

### Meta
```json
{ "action": "ai.meta" }
```
Returns `owner_capable`, `default_mode`, brands, language flags, section/action lists.

### Chat
```json
{
  "action": "ai.chat",
  "params": {
    "mode": "auto | assistant | executive",
    "messages": [{ "role": "user", "content": "…" }],
    "image_base64": "data:image/png;base64,… (executive screenshot optional)"
  }
}
```

Authorization: Bearer JWT via existing `verifyCallerFromRequest`.  
Rate limit: 40 AI requests / minute / IP.

## Tool allowlists

### Assistant (never includes financial/security tools)
- `products_search`, `barcode_lookup`, `stock_availability`, `inventory_low_stock`
- `orders_today`, `invoice_lookup`, `customers_support_lookup`
- `product_recommendations`, `payment_help`, `faq_help`, `settings_help`

Hard deny: any name in `EXECUTIVE_ONLY_TOOL_NAMES` returns `EXECUTIVE_ONLY` even if prompt-injected.

### Executive-only (plus all assistant tools)
- `company_overview`, `users_list`, `audit_logs`, `login_history`
- `security_signals`, `active_sessions_signal`, `health_probe`
- `branch_comparison`, `financial_analysis`, `forecast_outlook`, `employee_performance`
- `critical_alerts`, `smart_recommendations`
- `sales_summary`, `expenses_summary`, `purchases_summary`, `reports_summary`
- `suppliers_lookup`, `customers_lookup`, `branches_list`, `notifications_list`

## UI placement (receipt decoupling)

- **Receipt panel** (`src/pages/POS.jsx`) remains independent — no AI mount, no shared panel.
- **Top-right nav** (`Layout.jsx`): Notifications → Theme → Profile → **Executive AI / Assistant AI**
- Clicking AI opens a **resizable floating window** (`NexoraAiAssistant`) anchored under the top bar (full-bleed sheet on mobile).
- Bottom-right FAB removed.

### Executive UI tabs
Executive Dashboard, Business Intelligence, Inventory, Suppliers, Customers, Finance, Reports, Audit Logs, User Monitoring, Security, Forecast, Settings (+ screenshot attach).

### Assistant UI quick actions
Search Product, Check Stock, Today’s Orders, Track Invoice, Payment Help, Barcode Search.

## Language behavior

System prompts for both modes include mandatory rules:
- Detect language of each user message
- Reply in the **same** language
- Support mixed-language style; do **not** force English
- Applies to all languages the configured OpenAI model supports

No separate NLP library — detection/reply language is enforced via system instruction on every chat turn.

## Security

- RBAC on UI and API; Staff cannot open Executive branding or call executive mode
- Assistant tool list excludes financial/security tools; executor double-checks allowlist
- Secrets redacted from tool payloads (`password`, `api_key`, tokens, etc.)
- Executive queries audited to `audit_log` as `executive_ai.query` / module `nexora_executive_ai`
- API keys / env / DB credentials never returned to the model or UI
- Tenancy: tools run through existing company-scoped `handlePosAction`

## Files changed

| File | Change |
|------|--------|
| `api/_aiEngine.js` | Dual allowlists, Super Admin executive access, language rules, new assistant/executive tools, hard denies |
| `api/pos.js` | Unchanged host for `ai.meta` / `ai.chat` (already present) |
| `src/components/ai/NexoraAiAssistant.jsx` | Dual UIs, controlled floating window, nav button export, Super Admin gate |
| `src/components/Layout.jsx` | Top-nav AI trigger; controlled open state; no FAB |
| `src/styles/nexora-ai.css` | Enterprise dual-mode styles (brand/accent, not generic purple Copilot) |
| `src/lib/nexoraAiApi.js` | Mode docs (`assistant` / `executive`) |
| `NEXORA_AI_ENTERPRISE_SEPARATION_REPORT.md` | This report |

## Verification

- `npm run build` — **succeeded**
- `npx vercel --prod --yes` — **succeeded**
- **Production alias:** https://www.nexorapospro.com
- **Deployment URL:** https://nexora-2bh7gjk4l-nexoraposapp.vercel.app
- **Inspect:** https://vercel.com/nexoraposapp/nexora-pos/6YPkgjhJQsvQZ5v3GLZeU2nd8ARU
- Manual checks remaining for operators: Owner sees Executive AI; Cashier sees Assistant AI; Cashier `mode: executive` → 403; POS receipt independent; non-English reply (when API key set)

## Gaps / follow-ups

1. Dedicated Customer Portal AI shell is not mounted (no customer portal app shell found) — staff/customer assistant is available in the authenticated company Layout for staff roles.
2. SSE streaming still request/response (same as prior dual-mode report).
3. Company-custom RBAC matrices are not loaded into AI tool gates (defaults used; POS data remains company-scoped).
4. `OPENAI_API_KEY` must be set in Vercel production or AI returns `AI_NOT_CONFIGURED`.

## Production readiness

**Yes**, for the authenticated company app: separation is enforced UI + API, receipt is decoupled, language instructions are in place, and existing POS/OpenAI hosting path is preserved. Requires a configured OpenAI key for live answers.
