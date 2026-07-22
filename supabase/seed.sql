-- =============================================================================
-- Nexora POS — post-auth profile seed
-- =============================================================================
--
-- Auth users CANNOT be inserted via plain SQL against auth.users from the
-- client. Create them with the Auth Admin API (service role), then run this
-- file (or use scripts/create-demo-users.mjs which does both).
--
-- Recommended flow:
--   1. Apply migrations: supabase db push  (or run 001_nexora_schema.sql)
--   2. Create demo auth users:
--        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:users
--   3. Optionally re-run this seed.sql in the SQL editor if you only created
--      auth users manually and need matching profiles.
--
-- Demo credentials (after seed:users):
--   owner@nexorapos.com   / Owner123!
--   admin@nexorapos.com   / Admin123!
--   cashier@nexorapos.com / Cashier123!
--
-- Replace the UUIDs below with the real auth.users ids from your project
-- Dashboard → Authentication → Users (or from seed:users console output).
-- =============================================================================

-- Example profile upserts (update UUIDs after creating auth users):
/*
INSERT INTO public.profiles (id, name, email, role, active, branch_id)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Jane Mwikali', 'owner@nexorapos.com', 'owner', true, 1),
  ('00000000-0000-0000-0000-000000000002', 'Admin User', 'admin@nexorapos.com', 'admin', true, 1),
  ('00000000-0000-0000-0000-000000000003', 'Brian Otieno', 'cashier@nexorapos.com', 'cashier', true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  active = EXCLUDED.active,
  branch_id = EXCLUDED.branch_id;
*/

-- Lookup helper: list auth users so you can copy ids
-- SELECT id, email FROM auth.users ORDER BY created_at;

-- After auth users exist, you can also upsert by email join:
INSERT INTO public.profiles (id, name, email, role, active, branch_id)
SELECT u.id,
       CASE u.email
         WHEN 'owner@nexorapos.com' THEN 'Jane Mwikali'
         WHEN 'admin@nexorapos.com' THEN 'Admin User'
         WHEN 'cashier@nexorapos.com' THEN 'Brian Otieno'
         ELSE split_part(u.email, '@', 1)
       END,
       u.email,
       CASE u.email
         WHEN 'owner@nexorapos.com' THEN 'owner'
         WHEN 'admin@nexorapos.com' THEN 'admin'
         WHEN 'cashier@nexorapos.com' THEN 'cashier'
         ELSE 'cashier'
       END,
       true,
       1
FROM auth.users u
WHERE u.email IN ('owner@nexorapos.com', 'admin@nexorapos.com', 'cashier@nexorapos.com')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  active = EXCLUDED.active,
  branch_id = EXCLUDED.branch_id;
