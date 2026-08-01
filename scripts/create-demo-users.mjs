/**
 * Create demo Auth users + profiles for Nexora POS.
 *
 * Usage:
 *   set SUPABASE_URL=https://xxxx.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=eyJ...   (service_role — never expose in Vite)
 *   npm run seed:users
 *
 * Or (PowerShell):
 *   $env:SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   npm run seed:users
 *
 * Requires @supabase/supabase-js (installed with the app).
 */

import { createClient } from "@supabase/supabase-js";
import { assertNotProductionSupabase } from "./_prodSafety.mjs";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url) assertNotProductionSupabase(url, { scriptName: "create-demo-users.mjs" });

const DEMO_USERS = [
  {
    email: "owner@nexorapos.com",
    password: "Owner123!",
    name: "Jane Mwikali",
    role: "owner",
    branch_id: 1,
  },
  {
    email: "admin@nexorapos.com",
    password: "Admin123!",
    name: "Admin User",
    role: "admin",
    branch_id: 1,
  },
  {
    email: "cashier@nexorapos.com",
    password: "Cashier123!",
    name: "Brian Otieno",
    role: "cashier",
    branch_id: 1,
  },
];

async function main() {
  if (!url || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const demo of DEMO_USERS) {
    const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = existing?.users?.find(
      (u) => u.email?.toLowerCase() === demo.email.toLowerCase()
    );

    let userId = found?.id;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: demo.email,
        password: demo.password,
        email_confirm: true,
        user_metadata: { name: demo.name, role: demo.role },
      });
      if (error) {
        console.error(`Failed to create ${demo.email}:`, error.message);
        continue;
      }
      userId = data.user.id;
      console.log(`Created auth user ${demo.email} → ${userId}`);
    } else {
      console.log(`Auth user already exists ${demo.email} → ${userId}`);
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        name: demo.name,
        email: demo.email,
        role: demo.role,
        active: true,
        branch_id: demo.branch_id,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.error(`Failed to upsert profile for ${demo.email}:`, profileError.message);
    } else {
      console.log(`Upserted profile ${demo.role}: ${demo.email}`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
