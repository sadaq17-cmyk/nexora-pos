-- Nexora POS Enterprise — Multi-Currency System
-- Additive only. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Company-scoped currencies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_currencies (
  id                    BIGSERIAL PRIMARY KEY,
  company_id            bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code                  text NOT NULL,
  name                  text NOT NULL,
  symbol                text NOT NULL DEFAULT '',
  decimal_places        integer NOT NULL DEFAULT 2 CHECK (decimal_places >= 0 AND decimal_places <= 6),
  is_active             boolean NOT NULL DEFAULT true,
  is_base               boolean NOT NULL DEFAULT false,
  is_default            boolean NOT NULL DEFAULT false,
  exchange_rate_to_base numeric(18, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_base > 0),
  auto_update_enabled   boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS company_currencies_company_id_idx
  ON public.company_currencies (company_id);
CREATE INDEX IF NOT EXISTS company_currencies_active_idx
  ON public.company_currencies (company_id, is_active);

-- At most one base and one default per company (partial unique indexes)
CREATE UNIQUE INDEX IF NOT EXISTS company_currencies_one_base_idx
  ON public.company_currencies (company_id)
  WHERE is_base = true;

CREATE UNIQUE INDEX IF NOT EXISTS company_currencies_one_default_idx
  ON public.company_currencies (company_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- Exchange rate history / audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currency_rate_history (
  id                BIGSERIAL PRIMARY KEY,
  company_id        bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  currency_code     text NOT NULL,
  old_rate          numeric(18, 8),
  new_rate          numeric(18, 8) NOT NULL,
  reason            text,
  changed_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_name   text,
  ip_address        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS currency_rate_history_company_idx
  ON public.currency_rate_history (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS currency_rate_history_code_idx
  ON public.currency_rate_history (company_id, currency_code, created_at DESC);

-- ---------------------------------------------------------------------------
-- FX metadata on payment / money tables (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_payments
  ADD COLUMN IF NOT EXISTS payment_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS base_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS fx_gain_loss numeric(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS invoice_currency text;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS payment_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS base_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS fx_gain_loss numeric(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS invoice_currency text;

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS payment_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS base_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS company_id bigint REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS base_amount numeric(12, 2);

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS base_total numeric(12, 2);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS base_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2);

-- ---------------------------------------------------------------------------
-- Seed company_currencies from existing companies.currency (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.company_currencies (
  company_id, code, name, symbol, decimal_places,
  is_active, is_base, is_default, exchange_rate_to_base
)
SELECT
  c.id,
  UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES')),
  CASE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
    WHEN 'KES' THEN 'Kenyan Shilling'
    WHEN 'USD' THEN 'US Dollar'
    WHEN 'EUR' THEN 'Euro'
    WHEN 'GBP' THEN 'British Pound'
    WHEN 'AED' THEN 'UAE Dirham'
    WHEN 'SAR' THEN 'Saudi Riyal'
    WHEN 'TZS' THEN 'Tanzanian Shilling'
    WHEN 'UGX' THEN 'Ugandan Shilling'
    WHEN 'RWF' THEN 'Rwandan Franc'
    WHEN 'SOS' THEN 'Somali Shilling'
    WHEN 'ETB' THEN 'Ethiopian Birr'
    WHEN 'CDF' THEN 'Congolese Franc'
    ELSE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
  END,
  CASE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
    WHEN 'KES' THEN 'KSh'
    WHEN 'USD' THEN '$'
    WHEN 'EUR' THEN '€'
    WHEN 'GBP' THEN '£'
    WHEN 'AED' THEN 'د.إ'
    WHEN 'SAR' THEN '﷼'
    WHEN 'TZS' THEN 'TSh'
    WHEN 'UGX' THEN 'USh'
    WHEN 'RWF' THEN 'FRw'
    WHEN 'SOS' THEN 'Sh.So'
    WHEN 'ETB' THEN 'Br'
    WHEN 'CDF' THEN 'FC'
    ELSE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
  END,
  CASE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
    WHEN 'TZS' THEN 0
    WHEN 'UGX' THEN 0
    WHEN 'RWF' THEN 0
    ELSE 2
  END,
  true,
  true,
  true,
  1
FROM public.companies c
ON CONFLICT (company_id, code) DO NOTHING;

-- Common secondary currencies (inactive until Owner activates) for each company
INSERT INTO public.company_currencies (
  company_id, code, name, symbol, decimal_places,
  is_active, is_base, is_default, exchange_rate_to_base
)
SELECT
  c.id,
  v.code,
  v.name,
  v.symbol,
  v.decimals,
  false,
  false,
  false,
  v.rate
FROM public.companies c
CROSS JOIN (
  VALUES
    ('USD', 'US Dollar', '$', 2, 0.0077),
    ('EUR', 'Euro', '€', 2, 0.0071),
    ('GBP', 'British Pound', '£', 2, 0.0061),
    ('AED', 'UAE Dirham', 'د.إ', 2, 0.028),
    ('SAR', 'Saudi Riyal', '﷼', 2, 0.029)
) AS v(code, name, symbol, decimals, rate)
WHERE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES')) <> v.code
ON CONFLICT (company_id, code) DO NOTHING;

-- Mirror multi-currency flags into company_settings.settings jsonb (non-destructive)
UPDATE public.company_settings cs
SET settings = COALESCE(cs.settings, '{}'::jsonb)
  || jsonb_build_object(
    'enable_multi_currency', COALESCE(cs.settings->>'enable_multi_currency', 'true'),
    'admin_can_edit_rates', COALESCE(cs.settings->>'admin_can_edit_rates', 'false'),
    'report_currency', COALESCE(
      cs.settings->>'report_currency',
      cs.settings->>'currency',
      (SELECT UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES')) FROM public.companies c WHERE c.id = cs.company_id),
      'KES'
    ),
    'base_currency_code', COALESCE(
      cs.settings->>'base_currency_code',
      cs.settings->>'currency',
      (SELECT UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES')) FROM public.companies c WHERE c.id = cs.company_id),
      'KES'
    )
  ),
  updated_at = now();

COMMENT ON TABLE public.company_currencies IS 'Per-company currency catalog with rates to base';
COMMENT ON TABLE public.currency_rate_history IS 'Audit trail for exchange rate changes';
COMMENT ON COLUMN public.purchase_payments.base_amount IS 'Payment amount converted to company base currency';
COMMENT ON COLUMN public.purchase_payments.original_amount IS 'Amount in payment_currency';
COMMENT ON COLUMN public.purchase_payments.fx_gain_loss IS 'FX gain/loss vs invoice currency when applicable';
