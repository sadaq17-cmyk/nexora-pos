# Enterprise Multi-Currency — Delivery Report

## Status: Production-ready (display + registration + settings)

### What already existed
- Migration `012_enterprise_multi_currency.sql` — `company_currencies`, FX payment columns, rate history
- Settings → Currencies panel (rates / base / policy)
- `formatMoney` via `EnterpriseSettingsContext`

### What this delivery adds
1. **Full country → currency catalog** (24 markets) in `src/lib/currency.js` + `api/_currency.js`
2. **Registration**: Country dropdown auto-selects default currency; Owner can override
3. **Per-company storage**: `country`, `currency`/`currency_code`, `currency_symbol`, `locale`
4. **Settings → Store Info**: Country + Currency (Owner) — display-only change, **no historical conversion**
5. **Production signup** via `/api/bootstrap-company-owner` (`action: signup_company`) — no extra Hobby serverless function
6. Additive migration **`021_company_currency_profile.sql`** — `companies.currency_symbol`, `companies.locale` + backfill

### Isolation
Each company stores its own money profile. Companies do not share currency state (they may independently pick the same code).

### Display
Money UI uses company `base_currency_code` / `currency` through `formatMoney`. Changing currency updates symbols/locales for display of existing numeric amounts — numbers themselves are not FX-converted.

### Future live FX
Existing `company_currencies.exchange_rate_to_base` + payment FX columns remain for future live rates. Historical transactions are **never** auto-converted when company currency changes.

### Files
- `src/lib/currency.js`, `api/_currency.js`
- `api/signup-company.js`, `api/_posData.js` (`settings.getPublic` / `settings.update`)
- `src/pages/public/Signup.jsx`, `src/pages/Settings.jsx`
- `src/context/AuthContext.jsx`, `EnterpriseSettingsContext.jsx`
- `src/lib/supabaseApi.js`, `src/lib/mockApi.js`
- `supabase/migrations/021_company_currency_profile.sql`
- `MULTI_CURRENCY_ENTERPRISE_REPORT.md`

### Verify
1. Sign up → pick Uganda → currency becomes UGX (changeable)
2. Owner → Settings → Store Info → change Country/Currency → save → POS/Dashboard money labels update
3. Confirm past sale totals show new symbol but same numeric values (no conversion)
