# Enterprise Multi-Currency System — Delivery Report

## What shipped

- **Settings → Currencies** (Owner/Admin): list, add, activate/deactivate (Owner-only deactivate), set base (Owner-only), set default, edit rates, policy toggles (`enable_multi_currency`, `admin_can_edit_rates`, `report_currency`), rate history drawer.
- **RBAC**: new `currencies` module; Owner full; Admin view/create/edit (no delete); Manager/Staff no settings access. Server enforces Owner-only base/deactivate/policy.
- **Payments (Purchases + Suppliers)**: Payment Currency, Exchange Rate, Original Amount, Base Amount, Converted Amount, Method, Reference, Payment Date; AP balance updates use **base** amount.
- **Expenses**: optional FX fields; stored `amount` is base; original + rate preserved.
- **Reports**: `formatReportMoney` converts base totals to Owner-selected `report_currency`.
- **Helpers**: `src/lib/currency.js` + `api/_currency.js` — `formatMoney`, `convertToBase`, `convertFromBase`, `getActiveCurrencies`, `getBaseCurrency`, `computeFxGainLoss`.
- **Audit**: rate changes → `currency_rate_history` + `audit_log`; payment FX metadata audited.

## Migration

**File:** `supabase/migrations/012_enterprise_multi_currency.sql`

| Object | Purpose |
|--------|---------|
| `company_currencies` | Per-company catalog (code, rates, base/default/active flags) |
| `currency_rate_history` | Who/when/old/new rate + reason |
| FX columns on `purchase_payments`, `supplier_payments`, `customer_payments`, `expenses`, `purchases`, `sales` | Additive payment/txn metadata |
| Seed | Base currency from `companies.currency`; common secondaries inactive |

Company settings keys (jsonb): `enable_multi_currency`, `admin_can_edit_rates`, `report_currency`, `base_currency_code`.

## How to verify

1. Owner → Settings → Currencies: enable multi-currency; set USD rate; view history.
2. Admin: can edit rates only if Owner enables `admin_can_edit_rates`; cannot set base or deactivate.
3. Manager: Currencies tab hidden; payment forms still show active currencies when multi-currency is on.
4. Purchases: record payment in USD against KES PO — check base equivalent and outstanding reduced by base amount.
5. Suppliers: same FX fields + reference/date.
6. Expenses: foreign currency → base stored in `amount`/`base_amount`.
7. Reports: change report currency as Owner; KPIs reformat via rate.

## Deferred

| Area | Notes |
|------|--------|
| Payroll / Petty Cash / Bank / Cash drawer | No full modules; FX columns ready on payments/expenses only |
| Live auto FX feed | UI flag `auto_update_enabled` + stub; rates are manual |
| POS tender picker | Sales still stamp company currency; multi-currency tender not wired |
| Historical revaluation | Reports convert current base→display rate; no per-txn historical FX replay |
| Customer payments UI | Columns added; customer payment form not upgraded |

## Files changed (high level)

- `supabase/migrations/012_enterprise_multi_currency.sql`
- `api/_currency.js`, `api/_posData.js`
- `src/lib/currency.js`, `rbac.js`, `permissionMiddleware.js`, `supabaseApi.js`, `mockApi.js`
- `src/context/EnterpriseSettingsContext.jsx`
- `src/components/CurrenciesSettingsPanel.jsx`, `CurrencyMoneyFields.jsx`
- `src/pages/Settings.jsx`, `Purchases.jsx`, `Suppliers.jsx`, `Expenses.jsx`, `ReportsAnalytics.jsx`
- `MULTI_CURRENCY_REPORT.md`
