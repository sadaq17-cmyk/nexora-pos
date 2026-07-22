import { createClient } from "@supabase/supabase-js";

const html = await (await fetch("https://www.httpsnexorapos.com/login")).text();
const bundleMatch = html.match(/\/assets\/index-[^"]+\.js/);
if (!bundleMatch) {
  console.log(JSON.stringify({ ok: false, error: "bundle not found" }));
  process.exit(1);
}
const js = await (await fetch(`https://www.httpsnexorapos.com${bundleMatch[0]}`)).text();
const url = (js.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const anon = (js.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/) || [])[0];
if (!url || !anon) {
  console.log(JSON.stringify({ ok: false, error: "supabase config not found in bundle", url: Boolean(url), anon: Boolean(anon) }));
  process.exit(1);
}

const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.auth.signInWithPassword({
  email: "owner.honest@nexorapos.demo",
  password: "Honest@2026",
});

console.log(JSON.stringify({
  ok: Boolean(data?.session),
  err: error?.message || null,
  role: data?.user?.app_metadata?.role || null,
  company_id: data?.user?.app_metadata?.company_id ?? null,
  username: data?.user?.app_metadata?.username || null,
  email_confirmed: Boolean(data?.user?.email_confirmed_at),
}));
process.exit(data?.session ? 0 : 1);
