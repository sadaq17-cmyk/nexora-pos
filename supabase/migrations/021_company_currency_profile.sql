-- Additive: per-company money profile (no historical conversion)
-- Frozen schema preserved; columns only added when missing.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS currency_symbol text,
  ADD COLUMN IF NOT EXISTS locale text;

-- Backfill from existing currency code where possible
UPDATE public.companies c
SET
  currency_symbol = COALESCE(
    NULLIF(TRIM(c.currency_symbol), ''),
    CASE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
      WHEN 'KES' THEN 'KSh'
      WHEN 'UGX' THEN 'USh'
      WHEN 'TZS' THEN 'TSh'
      WHEN 'RWF' THEN 'FRw'
      WHEN 'ETB' THEN 'Br'
      WHEN 'SOS' THEN 'Sh.So'
      WHEN 'SSP' THEN '£'
      WHEN 'BIF' THEN 'FBu'
      WHEN 'ZAR' THEN 'R'
      WHEN 'CDF' THEN 'FC'
      WHEN 'NGN' THEN '₦'
      WHEN 'GHS' THEN 'GH₵'
      WHEN 'ZMW' THEN 'ZK'
      WHEN 'BWP' THEN 'P'
      WHEN 'NAD' THEN 'N$'
      WHEN 'MWK' THEN 'MK'
      WHEN 'MZN' THEN 'MT'
      WHEN 'EGP' THEN 'E£'
      WHEN 'AED' THEN 'د.إ'
      WHEN 'SAR' THEN '﷼'
      WHEN 'QAR' THEN 'ر.ق'
      WHEN 'USD' THEN '$'
      WHEN 'GBP' THEN '£'
      WHEN 'EUR' THEN '€'
      ELSE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
    END
  ),
  locale = COALESCE(
    NULLIF(TRIM(c.locale), ''),
    CASE UPPER(COALESCE(NULLIF(TRIM(c.currency), ''), 'KES'))
      WHEN 'KES' THEN 'en-KE'
      WHEN 'UGX' THEN 'en-UG'
      WHEN 'TZS' THEN 'sw-TZ'
      WHEN 'RWF' THEN 'rw-RW'
      WHEN 'ETB' THEN 'am-ET'
      WHEN 'SOS' THEN 'so-SO'
      WHEN 'SSP' THEN 'en-SS'
      WHEN 'BIF' THEN 'fr-BI'
      WHEN 'ZAR' THEN 'en-ZA'
      WHEN 'CDF' THEN 'fr-CD'
      WHEN 'NGN' THEN 'en-NG'
      WHEN 'GHS' THEN 'en-GH'
      WHEN 'ZMW' THEN 'en-ZM'
      WHEN 'BWP' THEN 'en-BW'
      WHEN 'NAD' THEN 'en-NA'
      WHEN 'MWK' THEN 'en-MW'
      WHEN 'MZN' THEN 'pt-MZ'
      WHEN 'EGP' THEN 'ar-EG'
      WHEN 'AED' THEN 'en-AE'
      WHEN 'SAR' THEN 'ar-SA'
      WHEN 'QAR' THEN 'ar-QA'
      WHEN 'USD' THEN 'en-US'
      WHEN 'GBP' THEN 'en-GB'
      WHEN 'EUR' THEN 'en-IE'
      ELSE 'en-KE'
    END
  )
WHERE c.currency_symbol IS NULL
   OR TRIM(c.currency_symbol) = ''
   OR c.locale IS NULL
   OR TRIM(c.locale) = '';

-- Mirror into company_settings.settings without overwriting explicit values
UPDATE public.company_settings cs
SET settings = COALESCE(cs.settings, '{}'::jsonb) || jsonb_build_object(
  'currency', COALESCE(cs.settings->>'currency', c.currency, 'KES'),
  'currency_code', COALESCE(cs.settings->>'currency_code', cs.settings->>'currency', c.currency, 'KES'),
  'currency_symbol', COALESCE(cs.settings->>'currency_symbol', c.currency_symbol, 'KSh'),
  'locale', COALESCE(cs.settings->>'locale', c.locale, 'en-KE'),
  'country', COALESCE(cs.settings->>'country', c.country, 'Kenya'),
  'base_currency_code', COALESCE(cs.settings->>'base_currency_code', cs.settings->>'currency', c.currency, 'KES'),
  'report_currency', COALESCE(cs.settings->>'report_currency', cs.settings->>'currency', c.currency, 'KES')
)
FROM public.companies c
WHERE cs.company_id = c.id;
