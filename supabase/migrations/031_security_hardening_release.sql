-- 031: Final enterprise security hardening
-- 1) Revoke client EXECUTE on DEFINER sale/purchase RPCs (service_role /api/pos only)
-- 2) Tighten profiles UPDATE + freeze privilege columns for self-updates
-- Safe / idempotent.

-- ---------------------------------------------------------------------------
-- 1) DEFINER RPCs: authenticated clients must not call with forged company_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pos_create_sale'
  ) THEN
    REVOKE ALL ON FUNCTION public.pos_create_sale(jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.pos_create_sale(jsonb) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_create_sale(jsonb) TO service_role;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pos_approve_purchase'
  ) THEN
    REVOKE ALL ON FUNCTION public.pos_approve_purchase(jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.pos_approve_purchase(jsonb) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.pos_approve_purchase(jsonb) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) profiles: peer updates require owner/admin; self cannot escalate role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_update ON public.profiles;

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_owner()
    OR id = auth.uid()
    OR (
      company_id = public.jwt_company_id()
      AND public.is_owner_or_admin()
    )
  )
  WITH CHECK (
    public.is_platform_owner()
    OR id = auth.uid()
    OR (
      company_id = public.jwt_company_id()
      AND public.is_owner_or_admin()
    )
  );

CREATE OR REPLACE FUNCTION public.profiles_guard_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_owner() OR public.is_owner_or_admin() THEN
    RETURN NEW;
  END IF;
  -- Non-managers (including self): cannot change privilege / tenancy fields.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.active IS DISTINCT FROM OLD.active
     OR COALESCE(NEW.account_status, '') IS DISTINCT FROM COALESCE(OLD.account_status, '')
     OR COALESCE(NEW.login_enabled, true) IS DISTINCT FROM COALESCE(OLD.login_enabled, true)
  THEN
    RAISE EXCEPTION 'Privilege fields cannot be changed for this account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_privilege ON public.profiles;
CREATE TRIGGER trg_profiles_guard_privilege
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.profiles_guard_privilege_columns();
