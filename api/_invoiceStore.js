/**
 * Invoice verification persistence for /api/invoice-public.
 * Prefers Postgres table `invoice_verifications` (migration 003).
 * Falls back to private Supabase Storage when the table is missing (PGRST205),
 * so production QR verify works even before SQL is applied.
 */

const BUCKET = "invoice_verifications";

export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /schema cache/i.test(message)
  );
}

async function ensureBucket(admin) {
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) throw listError;
  if ((buckets || []).some((b) => b.name === BUCKET)) return;
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "1MB",
    allowedMimeTypes: ["application/json"],
  });
  // Race: bucket created concurrently
  if (error && !/already exists/i.test(String(error.message || ""))) {
    throw error;
  }
}

function objectPath(id) {
  const safe = String(id || "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 64);
  return `by-id/${safe}.json`;
}

async function storageDownload(admin, id) {
  await ensureBucket(admin);
  const { data, error } = await admin.storage.from(BUCKET).download(objectPath(id));
  if (error) {
    const status = error.statusCode || error.status || "";
    if (String(status) === "404" || /not found|object not found/i.test(String(error.message || ""))) {
      return null;
    }
    throw error;
  }
  const text = await data.text();
  return JSON.parse(text);
}

async function storageUpsert(admin, payload) {
  await ensureBucket(admin);
  const body = JSON.stringify(payload);
  const paths = new Set([objectPath(payload.receipt_no), objectPath(payload.invoice_id)]);
  for (const path of paths) {
    const { error } = await admin.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType: "application/json",
      cacheControl: "0",
    });
    if (error) throw error;
  }
  return payload;
}

export async function lookupInvoice(admin, id) {
  const { data: byReceipt, error: receiptError } = await admin
    .from("invoice_verifications")
    .select("*")
    .eq("receipt_no", id)
    .maybeSingle();

  if (receiptError) {
    if (!isMissingTableError(receiptError)) throw receiptError;
    const fromStorage = await storageDownload(admin, id);
    return { row: fromStorage, backend: "storage" };
  }

  if (byReceipt) return { row: byReceipt, backend: "postgres" };

  const { data: byInvoice, error: invoiceError } = await admin
    .from("invoice_verifications")
    .select("*")
    .eq("invoice_id", id)
    .maybeSingle();

  if (invoiceError) {
    if (!isMissingTableError(invoiceError)) throw invoiceError;
    const fromStorage = await storageDownload(admin, id);
    return { row: fromStorage, backend: "storage" };
  }

  if (byInvoice) return { row: byInvoice, backend: "postgres" };

  // Postgres table exists but no row — still check storage for dual-write period
  const fromStorage = await storageDownload(admin, id).catch(() => null);
  return { row: fromStorage, backend: fromStorage ? "storage" : "postgres" };
}

export async function upsertInvoice(admin, payload) {
  const { data, error } = await admin
    .from("invoice_verifications")
    .upsert(payload, { onConflict: "receipt_no" })
    .select("*")
    .maybeSingle();

  if (!error) {
    // Best-effort mirror to storage for resilience
    try {
      await storageUpsert(admin, data || payload);
    } catch {
      /* optional mirror */
    }
    return { row: data || payload, backend: "postgres" };
  }

  if (!isMissingTableError(error)) throw error;

  const stored = await storageUpsert(admin, payload);
  return { row: stored, backend: "storage" };
}
