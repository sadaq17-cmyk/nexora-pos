-- Additive-only (SCHEMA_FREEZE): supplier soft-delete / archive / opening balance
-- Safe to re-run: IF NOT EXISTS patterns throughout.
-- Why additive-safe: new nullable columns + indexes only; no renames/drops; no RLS predicate changes.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS opening_balance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.suppliers.opening_balance IS 'Opening AP balance at supplier onboarding (base currency)';
COMMENT ON COLUMN public.suppliers.archived_at IS 'When set, supplier is archived (inactive for new POs)';
COMMENT ON COLUMN public.suppliers.deleted_at IS 'Soft-delete timestamp; hard delete avoided for ledger integrity';

CREATE INDEX IF NOT EXISTS suppliers_company_deleted_at_idx
  ON public.suppliers (company_id, deleted_at);

CREATE INDEX IF NOT EXISTS suppliers_company_archived_at_idx
  ON public.suppliers (company_id, archived_at);

-- Normalize legacy Archived rows without timestamps (best-effort, non-destructive)
UPDATE public.suppliers
SET archived_at = COALESCE(archived_at, created_at, now())
WHERE status = 'Archived'
  AND archived_at IS NULL;

-- Probe-friendly comment for schema health tooling
COMMENT ON TABLE public.suppliers IS
  'Vendor master: profile, AP balance, soft-delete/archive timestamps (migration 015)';
