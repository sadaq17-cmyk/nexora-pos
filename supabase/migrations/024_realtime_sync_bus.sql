-- =============================================================================
-- 024_realtime_sync_bus.sql
-- Enterprise ERP real-time synchronization backbone.
--
-- Nexora POS Pro already writes an audit_log row (via the server-side
-- writeAudit() helper, using the service role — RLS bypassed) on virtually
-- every meaningful mutation across every module: products, inventory,
-- purchases, suppliers, sales, customers, expenses, branches, currencies,
-- subscriptions, etc. Each row carries `company_id`, `module`, `action`,
-- `user_id`/`user_name` and a `details` JSON payload.
--
-- Rather than invent a parallel event table, this migration turns audit_log
-- into the app-wide real-time sync bus:
--   1. Adds a strictly tenant-scoped SELECT policy so authenticated browser
--      sessions can read (only) their own company's audit rows.
--   2. Enables Postgres logical replication (Supabase Realtime) for the
--      table, so `postgres_changes` INSERT events stream to every open tab
--      belonging to that company the instant a mutation commits.
--
-- The browser client subscribes with the user's own JWT (anon key + session),
-- so Realtime evaluates this SELECT policy per-subscriber — a user can only
-- ever receive events for their own company, never cross-tenant data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tenant-scoped SELECT policy for audit_log (previously: no SELECT policy
--    existed at all, so RLS silently denied every row to anon/authenticated
--    roles — safe, but also meant Realtime could never deliver a row).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_select_company ON public.audit_log;
CREATE POLICY audit_log_select_company ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (company_id IS NOT NULL AND company_id = public.jwt_company_id())
  );

-- ---------------------------------------------------------------------------
-- 2) Add audit_log to the supabase_realtime publication (idempotent).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'audit_log'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
    END IF;
  END IF;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  -- Non-fatal: Realtime publication management may require dashboard access
  -- on some plans. The SELECT policy above still ships either way.
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Helpful index for the Realtime/company_id lookup + client-side polling
--    fallback (ordering by recency within a company).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_log_company_created
  ON public.audit_log (company_id, created_at DESC);
