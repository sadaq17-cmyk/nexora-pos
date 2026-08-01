/**
 * Inventory ledgers — variants, serials, FIFO/FEFO lots (migration 019).
 * Additive helpers; no-op safely when tables are missing.
 */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/i.test(msg)
  );
}

function isMissingColumnError(error) {
  const msg = String(error?.message || "");
  return error?.code === "42703" || /column .* does not exist/i.test(msg);
}

/**
 * Create an open stock lot on inbound (stock in / purchase receive / opening).
 */
export async function receiveStockLot(admin, {
  companyId,
  productId,
  variantId = null,
  warehouseId = null,
  qty,
  unitCost = 0,
  batchNumber = null,
  manufacturingDate = null,
  expiryDate = null,
  referenceType = null,
  referenceId = null,
  receivedAt = null,
}) {
  const q = Math.abs(num(qty));
  if (!companyId || !productId || q <= 0) return null;
  const row = {
    company_id: companyId,
    product_id: productId,
    variant_id: variantId || null,
    warehouse_id: warehouseId || null,
    batch_number: batchNumber || null,
    qty_received: q,
    qty_remaining: q,
    unit_cost: num(unitCost),
    received_at: receivedAt || new Date().toISOString(),
    manufacturing_date: manufacturingDate || null,
    expiry_date: expiryDate || null,
    reference_type: referenceType || null,
    reference_id: referenceId || null,
  };
  const { data, error } = await admin.from("stock_lots").insert(row).select("*").single();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return data;
}

/**
 * Consume lots using FIFO (received_at) or FEFO (expiry_date).
 * Does not change products.stock — caller owns scalar stock.
 */
export async function consumeStockLots(admin, {
  companyId,
  productId,
  variantId = null,
  warehouseId = null,
  qty,
  preference = "fifo",
  referenceType = null,
  referenceId = null,
  caller = null,
}) {
  const need = Math.abs(num(qty));
  if (!companyId || !productId || need <= 0) {
    return { success: true, allocated: [], remaining: 0 };
  }

  const pref = String(preference || "fifo").toLowerCase() === "fefo" ? "fefo" : "fifo";
  let q = admin
    .from("stock_lots")
    .select("*")
    .eq("company_id", companyId)
    .eq("product_id", productId)
    .gt("qty_remaining", 0);
  if (variantId) q = q.eq("variant_id", variantId);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  if (pref === "fefo") {
    q = q.order("expiry_date", { ascending: true, nullsFirst: false }).order("received_at", { ascending: true }).order("id", { ascending: true });
  } else {
    q = q.order("received_at", { ascending: true }).order("id", { ascending: true });
  }
  q = q.limit(200);

  const { data: lots, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { success: true, allocated: [], remaining: need, skipped: true };
    throw error;
  }

  let left = need;
  const allocated = [];
  for (const lot of lots || []) {
    if (left <= 0) break;
    const take = Math.min(num(lot.qty_remaining), left);
    if (take <= 0) continue;
    const nextRem = num(lot.qty_remaining) - take;
    const { error: updErr } = await admin
      .from("stock_lots")
      .update({ qty_remaining: nextRem })
      .eq("id", lot.id)
      .eq("company_id", companyId);
    if (updErr) throw updErr;

    const alloc = {
      company_id: companyId,
      lot_id: lot.id,
      product_id: productId,
      variant_id: variantId || lot.variant_id || null,
      qty: take,
      unit_cost: num(lot.unit_cost),
      reference_type: referenceType || null,
      reference_id: referenceId || null,
      created_by: caller?.id || null,
    };
    const { error: aErr } = await admin.from("stock_lot_allocations").insert(alloc);
    if (aErr && !isMissingTableError(aErr)) throw aErr;

    allocated.push({
      lot_id: lot.id,
      batch_number: lot.batch_number,
      expiry_date: lot.expiry_date,
      qty: take,
      unit_cost: num(lot.unit_cost),
    });
    left -= take;
  }

  return {
    success: left <= 0,
    allocated,
    remaining: left,
    preference: pref,
    error: left > 0 ? `Insufficient lot quantity (short ${left}).` : null,
  };
}

export async function registerSerials(admin, {
  companyId,
  productId,
  variantId = null,
  warehouseId = null,
  lotId = null,
  serials = [],
  status = "available",
}) {
  const list = (Array.isArray(serials) ? serials : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (!companyId || !productId || !list.length) return { success: true, inserted: 0 };
  const rows = list.map((serial_number) => ({
    company_id: companyId,
    product_id: productId,
    variant_id: variantId || null,
    warehouse_id: warehouseId || null,
    lot_id: lotId || null,
    serial_number,
    status: status || "available",
    received_at: new Date().toISOString(),
  }));
  const { data, error } = await admin.from("product_serials").insert(rows).select("id");
  if (error) {
    if (isMissingTableError(error)) return { success: true, inserted: 0, skipped: true };
    if (error.code === "23505") return { success: false, error: "Duplicate serial number for this company." };
    throw error;
  }
  return { success: true, inserted: (data || []).length };
}

export async function markSerialsSold(admin, {
  companyId,
  serials = [],
  saleId = null,
}) {
  const list = (Array.isArray(serials) ? serials : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (!companyId || !list.length) return { success: true, updated: 0 };
  const { data, error } = await admin
    .from("product_serials")
    .update({
      status: "sold",
      sold_at: new Date().toISOString(),
      sale_id: saleId || null,
    })
    .eq("company_id", companyId)
    .in("serial_number", list)
    .eq("status", "available")
    .select("id");
  if (error) {
    if (isMissingTableError(error)) return { success: true, updated: 0, skipped: true };
    throw error;
  }
  return { success: true, updated: (data || []).length };
}

export async function upsertVariantSku(admin, {
  companyId,
  productId,
  id = null,
  name,
  sku = null,
  barcode = null,
  attributes = {},
  price = null,
  cost = 0,
  stock = null,
  active = true,
}) {
  if (!companyId || !productId || !String(name || "").trim()) {
    return { success: false, error: "Product and variant name are required." };
  }
  const payload = {
    company_id: companyId,
    product_id: productId,
    name: String(name).trim(),
    sku: sku ? String(sku).trim() : null,
    barcode: barcode ? String(barcode).trim() : null,
    attributes: attributes && typeof attributes === "object" ? attributes : {},
    price: price == null || price === "" ? null : num(price),
    cost: num(cost),
    active: active !== false,
    updated_at: new Date().toISOString(),
  };
  if (stock != null && stock !== "") payload.stock = Math.max(0, num(stock));

  if (id) {
    const { data, error } = await admin
      .from("product_variant_skus")
      .update(payload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return { success: false, error: "Variant ledger not migrated (019)." };
      throw error;
    }
    return { success: true, variant: data };
  }

  const { data, error } = await admin.from("product_variant_skus").insert(payload).select("*").single();
  if (error) {
    if (isMissingTableError(error)) return { success: false, error: "Variant ledger not migrated (019)." };
    if (error.code === "23505") return { success: false, error: "Variant SKU or barcode already exists." };
    throw error;
  }
  return { success: true, variant: data };
}

export async function listVariantSkus(admin, companyId, { productId = null, limit = 500 } = {}) {
  let q = admin
    .from("product_variant_skus")
    .select("*")
    .eq("company_id", companyId)
    .order("product_id", { ascending: true })
    .order("name", { ascending: true })
    .limit(Math.min(2000, limit));
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return data || [];
}

export async function listSerials(admin, companyId, { productId = null, status = null, limit = 200 } = {}) {
  let q = admin
    .from("product_serials")
    .select("*")
    .eq("company_id", companyId)
    .order("received_at", { ascending: false })
    .limit(Math.min(1000, limit));
  if (productId) q = q.eq("product_id", productId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return data || [];
}

export async function listOpenLots(admin, companyId, { productId = null, warehouseId = null, limit = 200 } = {}) {
  let q = admin
    .from("stock_lots")
    .select("*")
    .eq("company_id", companyId)
    .gt("qty_remaining", 0)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("received_at", { ascending: true })
    .limit(Math.min(1000, limit));
  if (productId) q = q.eq("product_id", productId);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return data || [];
}

export { isMissingTableError, isMissingColumnError, num };
