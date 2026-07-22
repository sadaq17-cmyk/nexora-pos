-- Purchase RBAC alignment: receive = owner/admin (app uses purchases.approve).
-- Service-role API enforces finer app RBAC; RLS remains defense-in-depth for
-- direct client access. Cashiers/staff must NOT update purchases / receive stock
-- via table policies unless they are elevated to owner/admin.

-- Ensure helper recognizes company admin roles used by the app (and JWT claims).
CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR public.jwt_role() IN ('owner','super_admin','admin','platform_owner')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND active = true
        AND role IN ('owner','super_admin','admin','platform_owner')
    );
$$;

-- Seed legacy permissions table with approve (receive) for privileged roles.
-- permissions.role CHECK only allows owner/admin/cashier (001 schema).
-- Cashier explicitly denied. Safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'permissions'
  ) THEN
    INSERT INTO public.permissions (role, module, action, allowed)
    VALUES
      ('owner', 'purchases', 'approve', true),
      ('admin', 'purchases', 'approve', true),
      ('cashier', 'purchases', 'approve', false),
      ('cashier', 'purchases', 'create', false),
      ('cashier', 'purchases', 'edit', false),
      ('cashier', 'purchases', 'view', false)
    ON CONFLICT (role, module, action) DO UPDATE SET allowed = EXCLUDED.allowed;
  END IF;
END $$;

COMMENT ON FUNCTION public.is_owner_or_admin() IS
  'True for platform_owner / owner / super_admin / admin — may mutate purchases (receive) under RLS.';
