-- Public invoice verification registry (QR landing page).
-- Only rows stored here can be verified; fake IDs return not found.

CREATE TABLE IF NOT EXISTS public.invoice_verifications (
  id              bigserial PRIMARY KEY,
  receipt_no      text NOT NULL UNIQUE,
  invoice_id      text NOT NULL,
  company_name    text NOT NULL DEFAULT '',
  branch_name     text NOT NULL DEFAULT '',
  customer_name   text NOT NULL DEFAULT 'Walk-in',
  payment_method  text NOT NULL DEFAULT '',
  currency_code   text NOT NULL DEFAULT 'KES',
  currency_symbol text NOT NULL DEFAULT '',
  total           numeric(12,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Valid'
                  CHECK (status IN ('Valid', 'Cancelled', 'Refunded')),
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  sale_date       timestamptz NOT NULL DEFAULT now(),
  company_id      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_verifications_invoice_id_idx
  ON public.invoice_verifications (invoice_id);

ALTER TABLE public.invoice_verifications ENABLE ROW LEVEL SECURITY;

-- Public read of verification rows only (no write for anon).
DROP POLICY IF EXISTS invoice_verifications_public_select ON public.invoice_verifications;
CREATE POLICY invoice_verifications_public_select
  ON public.invoice_verifications
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Ensure API roles can use the table once created
GRANT SELECT ON public.invoice_verifications TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_verifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_verifications_id_seq TO service_role;

-- NOTE: Until this migration is applied in the Supabase SQL Editor, production
-- /api/invoice-public falls back to a private Storage bucket `invoice_verifications`.
