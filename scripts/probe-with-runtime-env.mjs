/**
 * Run under: npx vercel env run -e production -- node scripts/probe-with-runtime-env.mjs
 * Never prints secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { lookupInvoice, upsertInvoice } from "../api/_invoiceStore.js";

const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

console.log("url_ok=", /^https?:\/\//i.test(url));
console.log("service_ok=", service.length > 20);

if (!/^https?:\/\//i.test(url) || service.length < 20) {
  console.error("CONFIG_BAD");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const probe = await admin.from("invoice_verifications").select("receipt_no").limit(1);
console.log("table_ok=", !probe.error);
if (probe.error) console.log("table_error_code=", probe.error.code);

const sample = {
  receipt_no: "NX-PROBE-0000001",
  invoice_id: "NX-PROBE-0000001",
  company_name: "Probe Co",
  branch_name: "HQ",
  customer_name: "Walk-in",
  payment_method: "CASH",
  currency_code: "KES",
  currency_symbol: "KSh",
  total: 1,
  status: "Valid",
  items: [{ name: "Probe", qty: 1, price: 1 }],
  sale_date: new Date().toISOString(),
  company_id: 1,
  updated_at: new Date().toISOString(),
};

try {
  const up = await upsertInvoice(admin, sample);
  console.log("upsert_backend=", up.backend);
  const found = await lookupInvoice(admin, sample.receipt_no);
  console.log("lookup_ok=", Boolean(found.row));
  console.log("lookup_backend=", found.backend);
  console.log("PROBE_OK");
} catch (err) {
  console.error("PROBE_FAIL", err?.message || String(err));
  process.exit(2);
}
