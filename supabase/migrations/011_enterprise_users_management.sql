-- 011_enterprise_users_management.sql
-- Enterprise Users & Management: profile lifecycle fields + richer audit context.
-- Safe / idempotent — additive only. Does not alter auth.users.

-- ---------------------------------------------------------------------------
-- Profiles: HR / security / activity columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS login_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS force_logout_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_name text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS login_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ip text,
  ADD COLUMN IF NOT EXISTS last_device text,
  ADD COLUMN IF NOT EXISTS last_browser text,
  ADD COLUMN IF NOT EXISTS last_os text,
  ADD COLUMN IF NOT EXISTS failed_login_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IS NULL OR account_status IN ('active', 'inactive', 'suspended', 'locked'));

CREATE INDEX IF NOT EXISTS profiles_company_status_idx
  ON public.profiles (company_id, account_status);

CREATE INDEX IF NOT EXISTS profiles_employee_id_idx
  ON public.profiles (company_id, employee_id)
  WHERE employee_id IS NOT NULL AND employee_id <> '';

-- Backfill status from active flag where missing
UPDATE public.profiles
SET account_status = CASE WHEN active IS FALSE THEN 'inactive' ELSE 'active' END
WHERE account_status IS NULL OR account_status = '';

-- ---------------------------------------------------------------------------
-- Audit log: who / what / where enrichment
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS device text,
  ADD COLUMN IF NOT EXISTS browser text,
  ADD COLUMN IF NOT EXISTS os text,
  ADD COLUMN IF NOT EXISTS old_values jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb;

CREATE INDEX IF NOT EXISTS audit_log_module_created_idx
  ON public.audit_log (module, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON public.audit_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Company subscription display helpers (additive columns on company_subscriptions)
-- ---------------------------------------------------------------------------

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS auto_renewal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

COMMENT ON COLUMN public.profiles.account_status IS 'active | inactive | suspended | locked';
COMMENT ON COLUMN public.profiles.employee_id IS 'Company-scoped employee / badge ID';
COMMENT ON COLUMN public.audit_log.old_values IS 'Optional JSON snapshot before change';
COMMENT ON COLUMN public.audit_log.new_values IS 'Optional JSON snapshot after change';
