-- Nexora POS — RLS hardening notes / additive safeguards
-- Base RLS is enabled in 001_nexora_schema.sql for all business tables.
-- This migration documents production expectations and adds defensive grants.

-- Ensure anon cannot bypass RLS via table privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Future tables inherit RLS denial-by-default for anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- NOTE: App operational data currently persists primarily in the browser
-- (localStorage mockApi). When migrating business tables to Postgres, keep
-- company_id scoping policies and never expose SUPABASE_SERVICE_ROLE_KEY
-- to the client. Auth remains via Supabase Auth with email verification.
