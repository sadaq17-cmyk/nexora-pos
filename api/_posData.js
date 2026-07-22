/**
 * Server-side POS data plane (service role + caller company scope).
 * Never import from src/.
 */

import { upsertInvoice } from "./_invoiceStore.js";
import { excludeDemoProducts, isDemoProduct, productSku } from "./_demoProducts.js";
import { normalizeRole } from "./_authHelpers.js";
import { buildReportAnalytics } from "./_reportAnalytics.js";
import {
  buildFxPaymentFields,
  catalogEntry,
  convertToBase,
  normalizeCode,
  toNumber,
} from "./_currency.js";
import {
  BILLING_CURRENCY,
  DEFAULT_TRIAL_DAYS,
  getPlanByCode,
  loadCompanyPlanLimits,
  normalizePlanCode,
  PAID_PLAN_CODES,
  checkPlanLimit,
} from "./_saasPlans.js";

/**
 * Default purchase actions when company_settings.permission_matrix omits a flag.
 * Mirrors src/lib/rbac.js buildDefaultMatrix() for the purchases module.
 * `approve` = receive purchases (stock-in).
 */
const DEFAULT_PURCHASE_ACTIONS = Object.freeze({
  platform_owner: { view: true, create: true, edit: true, delete: true, approve: true },
  owner: { view: true, create: true, edit: true, delete: true, approve: true },
  super_admin: { view: true, create: true, edit: true, delete: true, approve: true },
  admin: { view: true, create: true, edit: true, delete: true, approve: true },
  branch_manager: { view: true, create: false, edit: false, delete: false, approve: false },
  inventory_manager: { view: true, create: true, edit: true, delete: false, approve: false },
  sales_manager: { view: false, create: false, edit: false, delete: false, approve: false },
  sales: { view: false, create: false, edit: false, delete: false, approve: false },
  cashier: { view: false, create: false, edit: false, delete: false, approve: false },
  accountant: { view: true, create: true, edit: true, delete: false, approve: true },
});

async function loadPermissionMatrix(admin, companyId) {
  if (companyId == null || companyId === "") return {};
  const { data, error } = await admin
    .from("company_settings")
    .select("permission_matrix")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && !isMissingTableError(error)) return {};
  return data?.permission_matrix && typeof data.permission_matrix === "object"
    ? data.permission_matrix
    : {};
}

/**
 * App RBAC for purchases (service role bypasses RLS — this is the real gate).
 * Explicit matrix flags win; otherwise defaults. Owner/admin always allowed unless
 * matrix explicitly sets the action to false for non-owner roles... Owner/platform
 * always allowed.
 */
function canPurchaseAction(role, action, matrix = {}) {
  const r = normalizeRole(role);
  if (r === "platform_owner" || r === "owner" || r === "super_admin") return true;

  const fromMatrix = matrix?.[r]?.purchases?.[action];
  if (typeof fromMatrix === "boolean") return fromMatrix;

  const defaults = DEFAULT_PURCHASE_ACTIONS[r];
  if (defaults && typeof defaults[action] === "boolean") return defaults[action];

  // Custom / unknown roles: deny mutating purchase actions unless matrix granted.
  if (action === "view") return false;
  return false;
}

function denyPurchase(actionLabel) {
  return {
    success: false,
    error: `Permission denied: cannot ${actionLabel}.`,
    code: "FORBIDDEN",
  };
}

function companyFilter(query, companyId, platform) {
  if (platform || companyId == null || companyId === "") return query;
  return query.eq("company_id", companyId);
}

/**
 * Supabase/PostgREST builders are thenable (have .then) but often do NOT implement
 * .catch. Chaining `.insert(...).catch(...)` throws:
 *   "Promise.resolve(admin.from(...).insert(...).catch is not a function"
 * Always wrap builders with Promise.resolve before .catch, or use quietSb / trySb.
 */
function sb(builder) {
  return Promise.resolve(builder);
}

/** Await a builder and ignore failures (missing table/column, etc.). */
async function quietSb(builder) {
  try {
    return await builder;
  } catch {
    return { data: null, error: null };
  }
}

/** Await a builder; on throw or result.error, run fallback. */
async function trySb(builder, onFail) {
  try {
    const result = await builder;
    if (result?.error && typeof onFail === "function") {
      return await onFail(result.error);
    }
    return result;
  } catch (err) {
    if (typeof onFail === "function") return await onFail(err);
    return { data: null, error: err };
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse days from payment terms (Net 30, 30 Days, COD → 0). */
function paymentTermsToDays(terms) {
  if (terms == null || terms === "") return 0;
  const t = String(terms).trim().toLowerCase();
  if (!t || t === "cod" || t === "cash" || t === "cash on delivery") return 0;
  const net = t.match(/net\s*(\d+)/i);
  if (net) return Math.max(0, parseInt(net[1], 10) || 0);
  const days = t.match(/(\d+)\s*days?/i);
  if (days) return Math.max(0, parseInt(days[1], 10) || 0);
  const bare = t.match(/^(\d+)$/);
  if (bare) return Math.max(0, parseInt(bare[1], 10) || 0);
  return 0;
}

/** YYYY-MM-DD due date from terms + base date. */
function computeDueDate(terms, fromDate = new Date()) {
  const days = paymentTermsToDays(terms);
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(base.getTime())) return null;
  const due = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

function isMissingColumnError(error) {
  const msg = String(error?.message || "");
  return error?.code === "PGRST204" || /column .* does not exist/i.test(msg);
}

function isMissingTableError(error) {
  const msg = String(error?.message || "");
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    /could not find the table/i.test(msg) ||
    /relation .* does not exist/i.test(msg)
  );
}

export async function probeSchema(admin) {
  const checks = {};
  for (const table of [
    "branches",
    "profiles",
    "categories",
    "products",
    "customers",
    "customer_payments",
    "suppliers",
    "supplier_payments",
    "sales",
    "sale_items",
    "held_sales",
    "purchases",
    "purchase_items",
    "purchase_returns",
    "purchase_payments",
    "expense_categories",
    "expenses",
    "stock_transfers",
    "settings",
    "permissions",
    "audit_log",
    "subscription",
    "companies",
    "company_subscriptions",
    "company_settings",
    "brands",
    "units",
    "warehouses",
    "stock_movements",
    "invoice_verifications",
  ]) {
    const { error } = await admin.from(table).select("*").limit(1);
    checks[table] = error
      ? { ok: false, code: error.code || null, missing: isMissingTableError(error), message: String(error.message || "").slice(0, 160) }
      : { ok: true };
  }
  const { error: rpcError } = await admin.rpc("pos_create_sale", { payload: { items: [] } });
  if (!rpcError) {
    checks.pos_create_sale = { ok: true };
  } else {
    const msg = String(rpcError.message || "");
    const missing =
      rpcError.code === "PGRST202" ||
      /Could not find the function/i.test(msg) ||
      /function .*pos_create_sale/i.test(msg);
    // Empty-items / invalid_parameter validation means the RPC exists (Postgres 22023).
    const existsViaValidation =
      rpcError.code === "22023" ||
      /sale requires items|company_id required|invalid input|payload/i.test(msg);
    checks.pos_create_sale = {
      ok: existsViaValidation || !missing,
      missing,
      code: rpcError.code || null,
    };
  }

  // Purchase workflow columns (migration 007 + 009)
  for (const [key, table, cols] of [
    ["products_sku_tax_rate", "products", "id,sku,tax_rate"],
    ["suppliers_tax_notes", "suppliers", "id,tax_number,notes"],
    ["suppliers_enterprise", "suppliers", "id,code,payment_terms,credit_limit,total_paid,last_purchase_at,last_payment_at"],
    ["suppliers_soft_delete", "suppliers", "id,opening_balance,archived_at,deleted_at"],
    ["purchases_enterprise", "purchases", "id,amount_paid,balance,notes,attachment_url,client_reference"],
    ["purchase_items_receive", "purchase_items", "id,qty_ordered,qty_received,discount,tax"],
    ["products_inventory_enterprise", "products", "id,archived_at,deleted_at,wholesale_price,max_stock,expiry_date,stock_preference"],
    ["stock_movements_batch", "stock_movements", "id,batch_number,expiry_date,warehouse_id"],
    ["stock_transfers_warehouse", "stock_transfers", "id,from_warehouse_id,to_warehouse_id,status"],
  ]) {
    const { error } = await admin.from(table).select(cols).limit(1);
    checks[key] = error
      ? { ok: false, code: error.code || null, missing: isMissingColumnError(error), message: String(error.message || "").slice(0, 160) }
      : { ok: true };
  }
  {
    const { error } = await admin.from("purchase_payments").select("id").limit(1);
    checks.purchase_payments = error
      ? { ok: false, code: error.code || null, missing: isMissingTableError(error), message: String(error.message || "").slice(0, 160) }
      : { ok: true };
  }
  return checks;
}

/** Slim column sets for list endpoints — avoid select("*") payload bloat. */
const LIST_COLUMNS = Object.freeze({
  products:
    "id,name,sku,barcode,category_id,brand_id,unit_id,unit,price,cost,wholesale_price,discount_percent,tax_inclusive,stock,reorder_level,max_stock,tax_rate,active,image_url,company_id,branch_id,variants,brand,track_batches,default_expiry_days,expiry_date,stock_preference,archived_at,deleted_at,last_cost,avg_cost,created_at",
  customers: "id,name,phone,email,points,visits,spent,credit_limit,balance,company_id,created_at",
  suppliers:
    "id,code,name,contact_person,phone,email,address,tax_number,status,payment_terms,credit_limit,opening_balance,total_ordered,total_paid,balance,last_purchase_at,last_payment_at,notes,order_count,company_id,created_at,archived_at,deleted_at",
  purchases:
    "id,po_number,invoice_no,invoice_date,supplier_id,status,total,subtotal,tax_total,discount_total,shipping,other_charges,amount_paid,balance,due_date,payment_due_date,payment_terms,created_at,updated_at,item_count,notes,attachment_url,items_json,company_id,branch_id,warehouse_id,received_at,ordered_at,cancelled_at,rejected_at,rejection_reason,approved_at,approved_by,created_by,currency_code",
  expenses:
    "id,name,category,expense_date,amount,currency_code,branch_id,company_id,created_at,original_amount,base_amount,exchange_rate",
  branches: "id,name,code,address,active,company_id,created_at",
  categories: "id,name,color,image_url,icon,company_id,active,created_at",
  sales:
    "id,invoice_no,receipt_no,customer_id,user_id,subtotal,discount,vat,total,payment_method,branch_id,company_id,created_at,status,returned,items_json",
  sale_items: "id,sale_id,product_id,name,qty,price,cost",
  brands: "id,name,company_id,created_at",
  units: "id,name,abbreviation,company_id,created_at",
  warehouses: "id,name,code,branch_id,address,company_id,active,created_at",
  audit_log: "id,action,module,user_name,details,ip,created_at,company_id,user_id",
});

const DEFAULT_LIST_CAP = 2000;
const PAGE_LIST_CAP = 500;

function resolveListColumns(table, columns) {
  if (columns && columns !== "*") return columns;
  return LIST_COLUMNS[table] || "*";
}

function parseListOptions(params = {}, defaults = {}) {
  const limitRaw = params.limit != null ? Number(params.limit) : defaults.limit;
  const offsetRaw = params.offset != null ? Number(params.offset) : defaults.offset || 0;
  const unlimited = params.all === true || params.unlimited === true;
  let limit = unlimited ? null : Number.isFinite(limitRaw) ? limitRaw : defaults.limit ?? null;
  if (limit != null) limit = Math.min(Math.max(1, limit), PAGE_LIST_CAP);
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
  const q = params.q != null ? String(params.q).trim() : params.search != null ? String(params.search).trim() : "";
  return {
    limit,
    offset,
    q,
    columns: params.columns || defaults.columns || null,
    orderBy: params.orderBy || defaults.orderBy || "id",
    ascending: params.ascending !== false && params.ascending !== "false",
    softCap: unlimited ? DEFAULT_LIST_CAP : defaults.softCap ?? DEFAULT_LIST_CAP,
  };
}

/**
 * Company-scoped list with optional columns, limit/offset, and soft safety cap.
 * Pass options.limit / options.offset for pagination; options.q + options.searchCols for OR ilike.
 */
async function listScoped(admin, table, caller, columns = "*", options = {}) {
  const cols = resolveListColumns(table, columns === "*" ? options.columns || "*" : columns);
  const orderBy = options.orderBy || "id";
  const ascending = options.ascending !== false;
  let q = admin.from(table).select(cols).order(orderBy, { ascending });
  q = companyFilter(q, caller.company_id, caller.role === "platform_owner");

  if (options.q && Array.isArray(options.searchCols) && options.searchCols.length) {
    const term = options.q.replace(/[%_,]/g, "").slice(0, 80);
    if (term) {
      const orExpr = options.searchCols.map((c) => `${c}.ilike.%${term}%`).join(",");
      q = q.or(orExpr);
    }
  }

  const limit = options.limit != null ? Number(options.limit) : null;
  const offset = Math.max(0, Number(options.offset) || 0);
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    q = q.range(offset, offset + Math.min(limit, PAGE_LIST_CAP) - 1);
  } else if (options.softCap != null && Number(options.softCap) > 0) {
    q = q.limit(Math.min(Number(options.softCap), DEFAULT_LIST_CAP));
  }

  const { data, error } = await q;
  if (error) {
    if (isMissingColumnError(error)) {
      // Fall back to * when slim select hits missing optional columns
      let retry = admin.from(table).select("*").order(orderBy, { ascending });
      retry = companyFilter(retry, caller.company_id, caller.role === "platform_owner");
      if (limit != null && Number.isFinite(limit) && limit > 0) {
        retry = retry.range(offset, offset + Math.min(limit, PAGE_LIST_CAP) - 1);
      } else if (options.softCap != null && Number(options.softCap) > 0) {
        retry = retry.limit(Math.min(Number(options.softCap), DEFAULT_LIST_CAP));
      }
      const again = await retry;
      if (again.error) {
        if (isMissingColumnError(again.error) && caller.company_id != null) {
          const unscoped = await admin.from(table).select("*").order(orderBy, { ascending }).limit(options.softCap || DEFAULT_LIST_CAP);
          if (unscoped.error) throw unscoped.error;
          return unscoped.data || [];
        }
        throw again.error;
      }
      return again.data || [];
    }
    throw error;
  }
  return data || [];
}

async function countScoped(admin, table, caller) {
  let q = admin.from(table).select("id", { count: "exact", head: true });
  q = companyFilter(q, caller.company_id, caller.role === "platform_owner");
  const { count, error } = await q;
  if (error) {
    if (isMissingColumnError(error) && caller.company_id != null) {
      const retry = await admin.from(table).select("id", { count: "exact", head: true });
      if (retry.error) throw retry.error;
      return retry.count || 0;
    }
    throw error;
  }
  return count || 0;
}

function normalizeProduct(row, categories = []) {
  const category =
    categories.find((c) => Number(c.id) === Number(row.category_id))?.name ||
    row.category ||
    "Uncategorized";
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const stock = num(row.stock);
  const reorder = num(row.reorder_level);
  const maxStock = num(row.max_stock);
  let stock_status = "in_stock";
  if (stock <= 0) stock_status = "out";
  else if (stock <= reorder) stock_status = "low";
  else if (maxStock > 0 && stock >= maxStock) stock_status = "overstock";
  const today = new Date().toISOString().slice(0, 10);
  let expiry_status = null;
  if (row.expiry_date) {
    const exp = String(row.expiry_date).slice(0, 10);
    if (exp < today) expiry_status = "expired";
    else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 30);
      if (exp <= cutoff.toISOString().slice(0, 10)) expiry_status = "expiring";
    }
  }
  return {
    ...row,
    category_id: row.category_id == null ? null : Number(row.category_id),
    category,
    brand: row.brand || null,
    brand_id: row.brand_id == null ? null : Number(row.brand_id),
    unit_id: row.unit_id == null ? null : Number(row.unit_id),
    unit: row.unit || "pcs",
    barcode: row.barcode || null,
    sku: productSku({ ...row, variants }),
    tax_rate: num(row.tax_rate),
    image_url: row.image_url || "",
    variants,
    stock,
    price: num(row.price),
    cost: num(row.cost),
    wholesale_price: num(row.wholesale_price),
    discount_percent: num(row.discount_percent),
    tax_inclusive: row.tax_inclusive === true || row.tax_inclusive === 1,
    reorder_level: reorder,
    max_stock: maxStock,
    last_cost: row.last_cost != null ? num(row.last_cost) : null,
    avg_cost: row.avg_cost != null ? num(row.avg_cost) : null,
    track_batches: !!row.track_batches,
    default_expiry_days: row.default_expiry_days != null ? num(row.default_expiry_days) : null,
    expiry_date: row.expiry_date || null,
    stock_preference: row.stock_preference || "none",
    archived_at: row.archived_at || null,
    deleted_at: row.deleted_at || null,
    stock_status,
    expiry_status,
    stock_value: stock * num(row.cost),
    active: row.active === false || row.active === 0 || row.archived_at || row.deleted_at ? 0 : 1,
  };
}

function filterActiveProducts(rows, params = {}) {
  const includeDeleted = params.include_deleted === true || params.include_deleted === "true";
  const includeArchived = params.include_archived === true || params.include_archived === "true";
  return (rows || []).filter((p) => {
    if (!includeDeleted && p.deleted_at) return false;
    if (!includeArchived && p.archived_at) return false;
    return true;
  });
}

async function applyProductStockDelta(admin, { companyId, caller, product, delta, note, type, warehouse_id, batch_number, expiry_date, variant_id, reference_type, reference_id }) {
  const id = Number(product.id);
  const next = Math.max(0, num(product.stock) + num(delta));
  const { data, error: updError } = await admin
    .from("products")
    .update({ stock: next })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updError) throw updError;
  if (companyId != null) {
    const movementType = type || (num(delta) >= 0 ? "in" : "out");
    const payload = {
      company_id: companyId,
      product_id: id,
      warehouse_id: warehouse_id || null,
      type: movementType,
      qty: Math.abs(num(delta)),
      note: note || "Stock movement",
      user_id: caller.id,
      user_name: caller.name,
      batch_number: batch_number || null,
      expiry_date: expiry_date || null,
      variant_id: variant_id || null,
      reference_type: reference_type || null,
      reference_id: reference_id || null,
    };
    let { error: moveErr } = await admin.from("stock_movements").insert(payload);
    if (moveErr && isMissingColumnError(moveErr)) {
      const slim = {
        company_id: companyId,
        product_id: id,
        warehouse_id: warehouse_id || null,
        type: movementType,
        qty: Math.abs(num(delta)),
        note: note || "Stock movement",
        user_id: caller.id,
        user_name: caller.name,
      };
      await quietSb(admin.from("stock_movements").insert(slim));
    } else if (moveErr) {
      await quietSb(admin.from("stock_movements").insert({
        company_id: companyId,
        product_id: id,
        type: movementType,
        qty: Math.abs(num(delta)),
        note: note || "Stock movement",
        user_id: caller.id,
        user_name: caller.name,
      }));
    }
  }
  if (expiry_date && companyId != null) {
    await quietSb(admin.from("products").update({ expiry_date }).eq("id", id));
  }
  return normalizeProduct(data || { ...product, stock: next });
}

function autoSku(name) {
  const slug = String(name || "PRD")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return `${slug || "PRD"}-${Date.now().toString(36).toUpperCase()}`;
}

function autoBarcode() {
  return `NX${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
}

function linePurchaseTotal(item) {
  const qty = num(item.qty ?? item.qty_ordered);
  const cost = num(item.cost);
  const discount = num(item.discount);
  const taxPct = num(item.tax ?? item.tax_rate);
  const base = Math.max(0, qty * cost - discount);
  const taxAmt = base * (taxPct / 100);
  return { base, taxAmt, total: base + taxAmt };
}

const PURCHASE_STATUSES = new Set([
  "Draft",
  "Pending",
  "Ordered",
  "PartiallyReceived",
  "Received",
  "Cancelled",
  "Rejected",
]);

function normalizePurchaseStatus(status, fallback = "Pending") {
  const s = String(status || fallback).trim();
  // UI aliases → DB enums
  if (s === "Approved" || s === "Approve") return "Ordered";
  if (s === "Reject") return "Rejected";
  if (PURCHASE_STATUSES.has(s)) return s;
  return fallback;
}

function computePurchaseHeaderTotals(items, extras = {}) {
  const lines = Array.isArray(items) ? items : [];
  let subtotal = 0;
  let taxTotal = 0;
  for (const item of lines) {
    const t = linePurchaseTotal(item);
    subtotal += t.base;
    taxTotal += t.taxAmt;
  }
  const discountTotal = Math.max(0, num(extras.discount_total));
  const shipping = Math.max(0, num(extras.shipping));
  const otherCharges = Math.max(0, num(extras.other_charges));
  const total = Math.max(0, subtotal + taxTotal - discountTotal + shipping + otherCharges);
  return {
    subtotal,
    tax_total: taxTotal,
    discount_total: discountTotal,
    shipping,
    other_charges: otherCharges,
    total,
  };
}

async function postJournalEntries(admin, { companyId, caller, refType, refId, memo, lines }) {
  if (companyId == null || !Array.isArray(lines) || !lines.length) return [];
  const rows = lines
    .filter((l) => l && l.account && (num(l.debit) > 0 || num(l.credit) > 0))
    .map((l) => ({
      company_id: companyId,
      account: String(l.account),
      debit: num(l.debit),
      credit: num(l.credit),
      ref_type: refType,
      ref_id: refId != null ? Number(refId) : null,
      memo: memo || l.memo || null,
      created_by: caller?.id || null,
    }));
  if (!rows.length) return [];
  const { data, error } = await admin.from("journal_entries").insert(rows).select("id,account,debit,credit");
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return [];
    // Non-fatal — accounting is additive; do not fail the business transaction
    return [];
  }
  await writeAudit(admin, {
    companyId,
    caller,
    action: "journal_post",
    module: "purchases",
    details: {
      ref_type: refType,
      ref_id: refId,
      memo,
      entries: rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit })),
    },
  });
  return data || [];
}

function weightedAvgCost(prevStock, prevAvg, qtyIn, unitCost) {
  const stock = Math.max(0, num(prevStock));
  const avg = num(prevAvg != null ? prevAvg : unitCost);
  const qty = Math.max(0, num(qtyIn));
  const cost = num(unitCost);
  if (qty <= 0) return avg;
  if (stock <= 0) return cost;
  return (stock * avg + qty * cost) / (stock + qty);
}

async function nextSupplierCode(admin, companyId) {
  let q = admin.from("suppliers").select("code").order("id", { ascending: false }).limit(200);
  q = companyFilter(q, companyId, false);
  const { data } = await q;
  let max = 0;
  for (const row of data || []) {
    const m = String(row.code || "").match(/SUP-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SUP-${String(max + 1).padStart(5, "0")}`;
}

async function nextPoNumber(admin, companyId) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let q = admin
    .from("purchases")
    .select("po_number")
    .ilike("po_number", `PO-${day}%`)
    .order("id", { ascending: false })
    .limit(50);
  q = companyFilter(q, companyId, false);
  const { data } = await q;
  let seq = 0;
  for (const row of data || []) {
    const m = String(row.po_number || "").match(/PO-\d{8}-(\d+)/i);
    if (m) seq = Math.max(seq, Number(m[1]));
  }
  return `PO-${day}-${String(seq + 1).padStart(4, "0")}`;
}

function isUniqueViolation(error) {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(String(error?.message || ""));
}

function deriveReceiveStatus(items) {
  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) return "Received";
  let anyReceived = false;
  let allReceived = true;
  for (const item of lines) {
    const ordered = num(item.qty ?? item.qty_ordered);
    const received = num(item.qty_received);
    if (received > 0) anyReceived = true;
    if (received < ordered) allReceived = false;
  }
  if (allReceived) return "Received";
  if (anyReceived) return "PartiallyReceived";
  return null;
}

async function bumpSupplierPaymentMeta(admin, supplierId, amount, companyId) {
  const { data: supplier } = await admin.from("suppliers").select("*").eq("id", supplierId).maybeSingle();
  if (!supplier) return null;
  const updates = {
    balance: Math.max(0, num(supplier.balance) - amount),
    total_paid: num(supplier.total_paid) + amount,
    last_payment_at: new Date().toISOString(),
  };
  let { error } = await admin.from("suppliers").update(updates).eq("id", supplierId);
  if (error && isMissingColumnError(error)) {
    ({ error } = await admin
      .from("suppliers")
      .update({ balance: updates.balance })
      .eq("id", supplierId));
  }
  return updates;
}

async function writeAudit(admin, { companyId, caller, action, module, details }) {
  const payload = {
    user_id: caller?.id || null,
    user_name: caller?.name || caller?.username || null,
    action,
    module,
    details: typeof details === "string" ? details : JSON.stringify(details || {}),
    company_id: companyId,
  };
  const { error } = await admin.from("audit_log").insert(payload);
  if (error && isMissingColumnError(error)) {
    delete payload.company_id;
    await quietSb(admin.from("audit_log").insert(payload));
  }
}

function isOwnerLikeRole(role) {
  const r = normalizeRole(role);
  return r === "owner" || r === "platform_owner" || r === "super_admin";
}

function isAdminLikeRole(role) {
  const r = normalizeRole(role);
  return isOwnerLikeRole(r) || r === "admin";
}

async function loadCompanySettingsMap(admin, companyId) {
  const { data, error } = await admin
    .from("company_settings")
    .select("settings")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && !isMissingTableError(error)) return {};
  return data?.settings && typeof data.settings === "object" ? data.settings : {};
}

async function mergeCompanySettings(admin, companyId, patch = {}) {
  const existing = await loadCompanySettingsMap(admin, companyId);
  const next = { ...existing, ...patch };
  const { error } = await admin
    .from("company_settings")
    .upsert({ company_id: companyId, settings: next, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error && !isMissingTableError(error)) throw error;
  return next;
}

async function listCompanyCurrencies(admin, companyId) {
  const { data, error } = await admin
    .from("company_currencies")
    .select("*")
    .eq("company_id", companyId)
    .order("code", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return data || [];
}

async function ensureCompanyCurrenciesSeeded(admin, companyId) {
  const existing = await listCompanyCurrencies(admin, companyId);
  if (existing.length) return existing;
  const settings = await loadCompanySettingsMap(admin, companyId);
  const { data: company } = await admin.from("companies").select("currency").eq("id", companyId).maybeSingle();
  const baseCode = normalizeCode(settings.base_currency_code || settings.currency || company?.currency || "KES");
  const entry = catalogEntry(baseCode);
  const row = {
    company_id: companyId,
    code: baseCode,
    name: entry.name,
    symbol: entry.symbol,
    decimal_places: entry.decimals,
    is_active: true,
    is_base: true,
    is_default: true,
    exchange_rate_to_base: 1,
  };
  const { error } = await admin.from("company_currencies").insert(row);
  if (error && !isMissingTableError(error) && error.code !== "23505") throw error;
  return listCompanyCurrencies(admin, companyId);
}

async function resolveBaseCurrencyCode(admin, companyId) {
  const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
  const base = rows.find((r) => r.is_base);
  if (base?.code) return normalizeCode(base.code);
  const settings = await loadCompanySettingsMap(admin, companyId);
  return normalizeCode(settings.base_currency_code || settings.currency || "KES");
}

async function resolveRateToBase(admin, companyId, code) {
  const baseCode = await resolveBaseCurrencyCode(admin, companyId);
  const normalized = normalizeCode(code, baseCode);
  if (normalized === baseCode) return 1;
  const rows = await listCompanyCurrencies(admin, companyId);
  const row = rows.find((r) => normalizeCode(r.code) === normalized);
  const rate = toNumber(row?.exchange_rate_to_base, 1);
  return rate > 0 ? rate : 1;
}

async function writeRateHistory(admin, {
  companyId, caller, currencyCode, oldRate, newRate, reason, ip,
}) {
  const payload = {
    company_id: companyId,
    currency_code: normalizeCode(currencyCode),
    old_rate: oldRate == null ? null : toNumber(oldRate),
    new_rate: toNumber(newRate),
    reason: reason || null,
    changed_by: caller?.id || null,
    changed_by_name: caller?.name || caller?.username || null,
    ip_address: ip || null,
  };
  const { error } = await admin.from("currency_rate_history").insert(payload);
  if (error && !isMissingTableError(error)) {
    // non-fatal
  }
  await writeAudit(admin, {
    companyId,
    caller,
    action: "currency_rate_change",
    module: "currencies",
    details: {
      currency_code: payload.currency_code,
      old_rate: payload.old_rate,
      new_rate: payload.new_rate,
      reason: payload.reason,
    },
  });
}

export async function handlePosAction(admin, caller, action, params = {}) {
  const platform = caller.role === "platform_owner";
  const companyId = platform ? params.company_id ?? caller.company_id : caller.company_id;

  switch (action) {
    case "health.probe":
      return { success: true, checks: await probeSchema(admin) };

    case "companies.getById": {
      const id = params.id ?? companyId;
      const { data, error } = await admin.from("companies").select("*").eq("id", id).maybeSingle();
      if (error) {
        if (isMissingTableError(error)) {
          return {
            id,
            name: params.company_name || "Company",
            code: params.company_code || `CO${id}`,
            status: "active",
            currency: "KES",
          };
        }
        throw error;
      }
      return data;
    }

    case "companies.hydrate": {
      const id = Number(params.company_id);
      if (!id) return { success: false, error: "company_id required." };
      const row = {
        id,
        name: String(params.company_name || "Company").slice(0, 120),
        code: String(params.company_code || `CO${id}`).toUpperCase().slice(0, 32),
        currency: String(params.currency || "KES"),
        email: String(params.email || "").toLowerCase(),
        phone: String(params.phone || ""),
        status: params.email_verified === false ? "pending_verification" : "active",
        owner_user_id: params.supabase_user_id || null,
        plan_code: String(params.plan_code || "free_trial"),
        trial_ends_at: params.trial_ends_at || null,
      };
      const { error } = await admin.from("companies").upsert(row, { onConflict: "id" });
      if (error && !isMissingTableError(error)) throw error;

      if (params.branch_id != null) {
        await admin.from("branches").upsert(
          {
            id: Number(params.branch_id),
            company_id: id,
            name: "Main Branch",
            code: "MAIN",
            active: true,
          },
          { onConflict: "id" }
        );
      }

      try {
        await admin.from("company_settings").upsert(
          {
            company_id: id,
            settings: {
              store_name: row.name,
              store_phone: row.phone,
              currency: row.currency || BILLING_CURRENCY,
              default_branch_id: String(params.branch_id || 1),
            },
          },
          { onConflict: "company_id" }
        );
      } catch {
        /* optional */
      }

      try {
        const plan = getPlanByCode(row.plan_code || "free_trial");
        const trialEnds = row.trial_ends_at
          || new Date(Date.now() + DEFAULT_TRIAL_DAYS * 86400000).toISOString();
        await admin.from("company_subscriptions").upsert(
          {
            company_id: id,
            plan_code: plan.code,
            status: plan.code === "free_trial" ? "trialing" : "active",
            trial_ends_at: trialEnds,
            expires_at: trialEnds,
            limits: plan.limits,
          },
          { onConflict: "company_id" }
        );
      } catch {
        /* optional */
      }

      return { success: true, company_id: id, branch_id: params.branch_id || 1, hydrated: true };
    }

    case "companies.checkAccess": {
      const id = params.company_id ?? companyId;
      const { data, error } = await admin
        .from("company_subscriptions")
        .select("*")
        .eq("company_id", id)
        .maybeSingle();
      if (error && isMissingTableError(error)) return { ok: true };
      if (error) throw error;

      let status = String(data?.status || "").toLowerCase();
      let expiresAt = data?.expires_at || data?.trial_ends_at || null;

      // Harden: missing subscription row still respects company trial/plan metadata.
      if (!data) {
        try {
          const { data: company } = await admin
            .from("companies")
            .select("plan_code,trial_ends_at,status")
            .eq("id", id)
            .maybeSingle();
          if (company) {
            expiresAt = company.trial_ends_at || null;
            const planCode = normalizePlanCode(company.plan_code || "free_trial");
            status = planCode === "free_trial" ? "trialing" : "active";
            if (!expiresAt && planCode === "free_trial") {
              // No trial end recorded — do not invent a lock; allow until hydrated.
              return { ok: true };
            }
          } else {
            return { ok: true };
          }
        } catch {
          return { ok: true };
        }
      }

      const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
      const active = ["active", "trialing"].includes(status) && !expired;
      if (active) {
        return { ok: true, subscription: data || { status, expires_at: expiresAt } };
      }
      const role = normalizeRole(params.role || caller.role);
      return {
        ok: false,
        code: "SUBSCRIPTION_INACTIVE",
        error: "This company subscription is inactive or expired.",
        staff_error: role && role !== "owner"
          ? "Your company trial or subscription has expired. Only the Company Owner can log in to choose a plan. Staff access is temporarily disabled."
          : undefined,
      };
    }

    case "branches.getAll": {
      const opts = parseListOptions(params, { softCap: 200, orderBy: "id" });
      return listScoped(admin, "branches", { ...caller, company_id: companyId }, LIST_COLUMNS.branches, opts);
    }

    case "branches.create": {
      if (!["platform_owner", "owner", "super_admin", "admin"].includes(String(caller.role || ""))) {
        return { success: false, error: "Insufficient permissions to create a branch.", code: "FORBIDDEN" };
      }
      const targetCompanyId = platform ? Number(params.company_id || companyId) : companyId;
      if (targetCompanyId == null || Number.isNaN(Number(targetCompanyId))) {
        return { success: false, error: "Company context required.", code: "NO_COMPANY" };
      }
      const name = String(params.name || "").trim();
      if (!name) return { success: false, error: "Branch name is required." };
      try {
        const { count } = await admin
          .from("branches")
          .select("id", { count: "exact", head: true })
          .eq("company_id", Number(targetCompanyId));
        const limits = await loadCompanyPlanLimits(admin, targetCompanyId);
        const limited = checkPlanLimit(limits, "branches", count || 0);
        if (limited) return limited;
      } catch {
        /* soft enforcement — continue if count unavailable */
      }
      const code = String(params.code || name.slice(0, 3) || "BR")
        .trim()
        .toUpperCase()
        .slice(0, 16);
      const payload = {
        company_id: Number(targetCompanyId),
        name,
        code,
        address: String(params.address || "").slice(0, 240),
        active: params.active === false || params.active === 0 ? false : true,
      };
      let { data, error } = await admin.from("branches").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        const slim = { company_id: payload.company_id, name: payload.name, code: payload.code, active: payload.active };
        ({ data, error } = await admin.from("branches").insert(slim).select("*").single());
      }
      if (error) throw error;
      return { success: true, branch: data };
    }

    case "branches.update": {
      if (!["platform_owner", "owner", "super_admin", "admin"].includes(String(caller.role || ""))) {
        return { success: false, error: "Insufficient permissions to update a branch.", code: "FORBIDDEN" };
      }
      const id = Number(params.id);
      if (!id) return { success: false, error: "Branch id is required." };
      const updates = {};
      if (params.name != null) updates.name = String(params.name).trim();
      if (params.code != null) updates.code = String(params.code).trim().toUpperCase().slice(0, 16);
      if (params.address != null) updates.address = String(params.address).slice(0, 240);
      if (params.active != null) updates.active = !(params.active === false || params.active === 0);
      let q = admin.from("branches").update(updates).eq("id", id);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q.select("*").maybeSingle();
      if (error) throw error;
      if (!data) return { success: false, error: "Branch not found." };
      return { success: true, branch: data };
    }

    case "categories.getAll": {
      const opts = parseListOptions(params, { softCap: 500, orderBy: "name" });
      return listScoped(admin, "categories", { ...caller, company_id: companyId }, LIST_COLUMNS.categories, {
        ...opts,
        orderBy: "name",
        ascending: true,
      });
    }

    case "categories.create": {
      const payload = {
        name: String(params.name || "").trim(),
        color: params.color || "#2563EB",
        image_url: params.image_url || "",
        icon: params.icon || "layers",
        company_id: companyId,
        active: params.active === false ? false : true,
      };
      if (!payload.name) return { success: false, error: "Category name is required." };
      let { data, error } = await admin.from("categories").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        const slim = { name: payload.name, color: payload.color, company_id: companyId };
        if (params.image_url) slim.image_url = params.image_url;
        if (params.icon) slim.icon = params.icon;
        if (params.active !== undefined) slim.active = params.active !== false;
        ({ data, error } = await admin.from("categories").insert(slim).select("*").single());
      }
      if (error && isMissingColumnError(error)) {
        ({ data, error } = await admin
          .from("categories")
          .insert({ name: payload.name, color: payload.color })
          .select("*")
          .single());
      }
      if (error) throw error;
      return { success: true, category: data };
    }

    case "categories.update": {
      const updates = {
        name: params.name != null ? String(params.name).trim() : undefined,
        color: params.color,
        image_url: params.image_url,
        icon: params.icon,
        active: params.active,
      };
      Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);
      let q = admin.from("categories").update(updates).eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        const slim = { ...updates };
        delete slim.icon;
        delete slim.image_url;
        delete slim.active;
        if (params.image_url !== undefined) slim.image_url = params.image_url;
        if (params.active !== undefined) slim.active = params.active;
        let retry = admin.from("categories").update(slim).eq("id", params.id);
        retry = companyFilter(retry, companyId, platform);
        ({ data, error } = await retry.select("*").maybeSingle());
      }
      if (error && isMissingColumnError(error)) {
        const minimal = {
          name: updates.name,
          color: updates.color,
        };
        Object.keys(minimal).forEach((k) => minimal[k] === undefined && delete minimal[k]);
        let retry = admin.from("categories").update(minimal).eq("id", params.id);
        retry = companyFilter(retry, companyId, platform);
        ({ data, error } = await retry.select("*").maybeSingle());
      }
      if (error) throw error;
      return { success: true, category: data };
    }

    case "categories.delete": {
      let q = admin.from("categories").delete().eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    }

    case "products.getAll": {
      const opts = parseListOptions(params, {
        softCap: DEFAULT_LIST_CAP,
        orderBy: "id",
        columns: LIST_COLUMNS.products,
      });
      const [products, categories] = await Promise.all([
        listScoped(admin, "products", { ...caller, company_id: companyId }, LIST_COLUMNS.products, {
          ...opts,
          searchCols: opts.q ? ["name", "sku", "barcode", "brand"] : [],
        }),
        listScoped(admin, "categories", { ...caller, company_id: companyId }, LIST_COLUMNS.categories, {
          softCap: 500,
          orderBy: "name",
        }),
      ]);
      const filtered = filterActiveProducts(products, params);
      return excludeDemoProducts(filtered.map((p) => normalizeProduct(p, categories)));
    }

    case "products.getByBarcode": {
      let q = admin
        .from("products")
        .select(LIST_COLUMNS.products)
        .eq("barcode", String(params.barcode || "").trim());
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.maybeSingle();
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("products").select("*").eq("barcode", String(params.barcode || "").trim());
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.maybeSingle());
      }
      if (error) throw error;
      if (!data || isDemoProduct(data)) return null;
      const categories = await listScoped(admin, "categories", { ...caller, company_id: companyId }, LIST_COLUMNS.categories, {
        softCap: 500,
      });
      return normalizeProduct(data, categories);
    }

    case "products.create": {
      const name = String(params.name || "").trim();
      if (!name) return { success: false, error: "Product name is required." };
      try {
        let countQuery = admin.from("products").select("id", { count: "exact", head: true });
        countQuery = companyFilter(countQuery, companyId, platform);
        const { count } = await countQuery;
        const limits = await loadCompanyPlanLimits(admin, companyId);
        const limited = checkPlanLimit(limits, "products", count || 0);
        if (limited) return limited;
      } catch {
        /* soft enforcement */
      }
      // Purchase-originated products must not inflate stock until the PO is received.
      const fromPurchase = params.from_purchase === true || params.defer_stock === true;
      const stock = fromPurchase ? 0 : num(params.stock);
      const sku = String(params.sku || "").trim() || autoSku(name);
      const rawBarcode = params.barcode != null ? String(params.barcode).trim() : "";
      const barcode =
        rawBarcode ||
        (params.auto_barcode === true || fromPurchase ? autoBarcode() : null);
      const payload = {
        name,
        sku,
        barcode,
        category_id: params.category_id || null,
        price: num(params.price),
        cost: num(params.cost),
        wholesale_price: num(params.wholesale_price),
        discount_percent: num(params.discount_percent),
        tax_inclusive: params.tax_inclusive === true || params.tax_inclusive === 1,
        stock,
        reorder_level: num(params.reorder_level),
        max_stock: num(params.max_stock),
        tax_rate: num(params.tax_rate ?? params.tax),
        unit: params.unit || "pcs",
        active: params.active === false || params.active === 0 ? false : true,
        branch_id: params.branch_id || caller.branch_id || null,
        company_id: companyId,
        image_url: params.image_url || "",
        brand_id: params.brand_id || null,
        unit_id: params.unit_id || null,
        variants: Array.isArray(params.variants) ? params.variants : [],
        track_batches: !!params.track_batches,
        default_expiry_days: params.default_expiry_days != null && params.default_expiry_days !== "" ? num(params.default_expiry_days) : null,
        expiry_date: params.expiry_date || null,
        stock_preference: ["fifo", "fefo"].includes(String(params.stock_preference || "").toLowerCase())
          ? String(params.stock_preference).toLowerCase()
          : "none",
        archived_at: null,
        deleted_at: null,
      };
      let { data, error } = await admin.from("products").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        const slim = {
          name: payload.name,
          barcode: payload.barcode,
          category_id: payload.category_id,
          price: payload.price,
          cost: payload.cost,
          stock: payload.stock,
          reorder_level: payload.reorder_level,
          unit: payload.unit,
          active: payload.active,
          branch_id: payload.branch_id,
        };
        ({ data, error } = await admin.from("products").insert(slim).select("*").single());
        if (!error && data && (payload.sku || payload.tax_rate != null || payload.image_url || payload.brand_id || payload.unit_id)) {
          const extras = {
            sku: payload.sku,
            tax_rate: payload.tax_rate,
            image_url: payload.image_url,
            brand_id: payload.brand_id,
            unit_id: payload.unit_id,
            variants: payload.variants,
            company_id: payload.company_id,
          };
          Object.keys(extras).forEach((k) => (extras[k] == null || extras[k] === "") && delete extras[k]);
          const { data: patched } = await admin.from("products").update(extras).eq("id", data.id).select("*").maybeSingle();
          if (patched) data = patched;
        }
      }
      if (error) throw error;
      await writeAudit(admin, {
        companyId,
        caller,
        action: "create_product",
        module: "products",
        details: { id: data.id, name: data.name, from_purchase: fromPurchase },
      });
      return { success: true, id: data.id, product: normalizeProduct(data) };
    }

    case "products.update": {
      const updates = { ...params };
      delete updates.id;
      delete updates.category;
      delete updates.brand;
      delete updates.warehouse;
      delete updates.stock_status;
      delete updates.expiry_status;
      delete updates.stock_value;
      if (updates.stock_preference != null) {
        const pref = String(updates.stock_preference).toLowerCase();
        updates.stock_preference = ["fifo", "fefo"].includes(pref) ? pref : "none";
      }
      let q = admin.from("products").update(updates).eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        const slim = {
          name: params.name,
          barcode: params.barcode,
          category_id: params.category_id,
          price: params.price,
          cost: params.cost,
          stock: params.stock,
          reorder_level: params.reorder_level,
          unit: params.unit,
          active: params.active,
          branch_id: params.branch_id,
          image_url: params.image_url,
          brand_id: params.brand_id,
          unit_id: params.unit_id,
          variants: params.variants,
          tax_rate: params.tax_rate,
          track_batches: params.track_batches,
          default_expiry_days: params.default_expiry_days,
        };
        Object.keys(slim).forEach((k) => slim[k] === undefined && delete slim[k]);
        let q2 = admin.from("products").update(slim).eq("id", params.id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      await writeAudit(admin, {
        companyId,
        caller,
        action: "update_product",
        module: "products",
        details: { id: params.id, name: data?.name },
      });
      return { success: true, product: data ? normalizeProduct(data) : null };
    }

    case "products.archive": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Product id is required." };
      const now = new Date().toISOString();
      let q = admin.from("products").update({ archived_at: now, active: false }).eq("id", id).is("deleted_at", null);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("products").update({ active: false }).eq("id", id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      if (!data) return { success: false, error: "Product not found." };
      await writeAudit(admin, { companyId, caller, action: "archive_product", module: "products", details: { id } });
      return { success: true, product: normalizeProduct(data) };
    }

    case "products.restore": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Product id is required." };
      let q = admin.from("products").update({ archived_at: null, deleted_at: null, active: true }).eq("id", id);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("products").update({ active: true }).eq("id", id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      if (!data) return { success: false, error: "Product not found." };
      await writeAudit(admin, { companyId, caller, action: "restore_product", module: "products", details: { id } });
      return { success: true, product: normalizeProduct(data) };
    }

    case "products.delete": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Product id is required." };
      const hard = params.hard === true || params.hard === "true";
      let existingQ = admin.from("products").select("id,name").eq("id", id);
      existingQ = companyFilter(existingQ, companyId, platform);
      const { data: existing } = await existingQ.maybeSingle();
      if (!existing) return { success: false, error: "Product not found." };

      if (!hard) {
        const now = new Date().toISOString();
        let q = admin
          .from("products")
          .update({ deleted_at: now, archived_at: now, active: false })
          .eq("id", id);
        q = companyFilter(q, companyId, platform);
        let { data, error } = await q.select("*").maybeSingle();
        if (error && isMissingColumnError(error)) {
          let q2 = admin.from("products").delete().eq("id", id);
          q2 = companyFilter(q2, companyId, platform);
          const del = await q2;
          if (del.error) throw del.error;
          await writeAudit(admin, { companyId, caller, action: "delete_product", module: "products", details: { id, hard: true, fallback: true } });
          return { success: true, soft: false };
        }
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "soft_delete_product", module: "products", details: { id, name: existing.name } });
        return { success: true, soft: true, product: data ? normalizeProduct(data) : null };
      }

      let q = admin.from("products").delete().eq("id", id);
      q = companyFilter(q, companyId, platform);
      const { error } = await q;
      if (error) throw error;
      await writeAudit(admin, { companyId, caller, action: "delete_product", module: "products", details: { id, hard: true } });
      return { success: true, soft: false };
    }

    case "products.import": {
      const rows = Array.isArray(params.rows) ? params.rows : [];
      if (!rows.length) return { success: false, error: "No rows to import." };
      const results = { created: 0, updated: 0, failed: 0, errors: [] };
      for (const row of rows.slice(0, 500)) {
        try {
          const name = String(row.name || "").trim();
          if (!name) {
            results.failed += 1;
            results.errors.push("Missing name");
            continue;
          }
          const barcode = row.barcode != null ? String(row.barcode).trim() : "";
          let existing = null;
          if (barcode) {
            existing = await handlePosAction(admin, caller, "products.getByBarcode", { barcode });
          }
          const payload = {
            name,
            barcode: barcode || null,
            sku: row.sku || undefined,
            price: num(row.price),
            cost: num(row.cost),
            wholesale_price: num(row.wholesale_price),
            discount_percent: num(row.discount_percent),
            tax_inclusive: row.tax_inclusive === true || row.tax_inclusive === "true" || row.tax_inclusive === 1,
            stock: num(row.stock),
            reorder_level: num(row.reorder_level, 10),
            max_stock: num(row.max_stock),
            unit: row.unit || "pcs",
            tax_rate: num(row.tax_rate ?? row.tax),
            expiry_date: row.expiry_date || null,
            stock_preference: row.stock_preference || "none",
            auto_barcode: !barcode,
          };
          if (existing?.id) {
            const upd = await handlePosAction(admin, caller, "products.update", { id: existing.id, ...payload });
            if (upd?.success) results.updated += 1;
            else {
              results.failed += 1;
              results.errors.push(upd?.error || `Update failed for ${name}`);
            }
          } else {
            const created = await handlePosAction(admin, caller, "products.create", payload);
            if (created?.success) results.created += 1;
            else {
              results.failed += 1;
              results.errors.push(created?.error || `Create failed for ${name}`);
            }
          }
        } catch (err) {
          results.failed += 1;
          results.errors.push(String(err?.message || err).slice(0, 120));
        }
      }
      await writeAudit(admin, {
        companyId,
        caller,
        action: "import_products",
        module: "products",
        details: { created: results.created, updated: results.updated, failed: results.failed },
      });
      return { success: true, ...results };
    }

    case "products.adjustStock": {
      const id = Number(params.id);
      const delta = num(params.delta);
      let q = admin.from("products").select("*").eq("id", id);
      q = companyFilter(q, companyId, platform);
      const { data: product, error } = await q.maybeSingle();
      if (error) throw error;
      if (!product) return { success: false, error: "Product not found." };
      const normalized = await applyProductStockDelta(admin, {
        companyId,
        caller,
        product,
        delta,
        note: params.reason || "Manual adjustment",
        type: delta >= 0 ? "adjust" : "adjust",
        warehouse_id: params.warehouse_id || null,
        batch_number: params.batch_number || null,
        expiry_date: params.expiry_date || null,
        variant_id: params.variant_id || null,
        reference_type: params.reference_type || "adjust",
        reference_id: params.reference_id || null,
      });
      return { success: true, product: normalized };
    }

    case "customers.getAll": {
      const opts = parseListOptions(params, { softCap: DEFAULT_LIST_CAP, columns: LIST_COLUMNS.customers });
      return listScoped(admin, "customers", { ...caller, company_id: companyId }, LIST_COLUMNS.customers, {
        ...opts,
        searchCols: opts.q ? ["name", "phone", "email"] : [],
      });
    }

    case "customers.getCount": {
      const count = await countScoped(admin, "customers", { ...caller, company_id: companyId });
      return { success: true, count };
    }

    case "customers.create": {
      const payload = {
        name: String(params.name || "").trim(),
        phone: params.phone || null,
        email: params.email || null,
        points: num(params.points),
        visits: num(params.visits),
        spent: num(params.spent),
        credit_limit: num(params.credit_limit),
        balance: num(params.balance),
        company_id: companyId,
      };
      if (!payload.name) return { success: false, error: "Customer name is required." };
      let { data, error } = await admin.from("customers").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        delete payload.company_id;
        ({ data, error } = await admin.from("customers").insert(payload).select("*").single());
      }
      if (error) throw error;
      return { success: true, customer: data };
    }

    case "customers.update": {
      const updates = { ...params };
      delete updates.id;
      let q = admin.from("customers").update(updates).eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q.select("*").maybeSingle();
      if (error) throw error;
      return { success: true, customer: data };
    }

    case "customers.delete": {
      let q = admin.from("customers").delete().eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      const { error } = await q;
      if (error) throw error;
      return { success: true };
    }

    case "customers.addPayment": {
      const amount = num(params.amount);
      let q = admin.from("customers").select("*").eq("id", params.customer_id);
      q = companyFilter(q, companyId, platform);
      const { data: customer, error } = await q.maybeSingle();
      if (error) throw error;
      if (!customer) return { success: false, error: "Customer not found." };
      const balance = Math.max(0, num(customer.balance) - amount);
      await admin.from("customers").update({ balance }).eq("id", customer.id);
      await trySb(
        admin.from("customer_payments").insert({
          customer_id: customer.id,
          amount,
          method: params.method || "Cash",
          company_id: companyId,
        }),
        async () =>
          admin.from("customer_payments").insert({
            customer_id: customer.id,
            amount,
            method: params.method || "Cash",
          })
      );
      return { success: true, balance };
    }

    case "customers.adjustPoints": {
      let q = admin.from("customers").select("*").eq("id", params.customer_id);
      q = companyFilter(q, companyId, platform);
      const { data: customer, error } = await q.maybeSingle();
      if (error) throw error;
      if (!customer) return { success: false, error: "Customer not found." };
      const points = Math.max(0, num(customer.points) + num(params.delta));
      await admin.from("customers").update({ points }).eq("id", customer.id);
      return { success: true, points };
    }

    case "customers.getStatement": {
      const { data: customer } = await admin.from("customers").select("*").eq("id", params.id).maybeSingle();
      const { data: payments } = await admin
        .from("customer_payments")
        .select("*")
        .eq("customer_id", params.id)
        .order("created_at", { ascending: false });
      return { customer, payments: payments || [] };
    }

    case "customers.getPurchaseHistory": {
      let q = admin.from("sales").select("*").eq("customer_id", params.id).order("created_at", { ascending: false });
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }

    case "suppliers.getAll": {
      const opts = parseListOptions(params, { softCap: DEFAULT_LIST_CAP, columns: LIST_COLUMNS.suppliers });
      const includeDeleted = params.include_deleted === true || params.include_deleted === "true";
      const includeArchived = params.include_archived !== false && params.include_archived !== "false";
      const rows = await listScoped(admin, "suppliers", { ...caller, company_id: companyId }, LIST_COLUMNS.suppliers, {
        ...opts,
        searchCols: opts.q ? ["name", "code", "contact_person", "phone", "email", "tax_number"] : [],
      });
      return (rows || [])
        .filter((s) => {
          if (!includeDeleted && s.deleted_at) return false;
          if (!includeArchived && (s.archived_at || s.status === "Archived")) return false;
          return true;
        })
        .map((s) => ({
          ...s,
          code: s.code || null,
          payment_terms: s.payment_terms || null,
          credit_limit: num(s.credit_limit),
          opening_balance: num(s.opening_balance),
          total_paid: num(s.total_paid),
          total_ordered: num(s.total_ordered),
          balance: num(s.balance),
          last_purchase_at: s.last_purchase_at || null,
          last_payment_at: s.last_payment_at || null,
          archived_at: s.archived_at || null,
          deleted_at: s.deleted_at || null,
        }));
    }

    case "suppliers.create": {
      const code = params.code || (await nextSupplierCode(admin, companyId).catch(() => `SUP-${Date.now().toString().slice(-5)}`));
      const opening = num(params.opening_balance);
      const explicitBalance = params.balance != null && params.balance !== "" ? num(params.balance) : null;
      const payload = {
        name: String(params.name || "").trim(),
        code,
        contact_person: params.contact_person || null,
        phone: params.phone || null,
        email: params.email || null,
        address: params.address || null,
        tax_number: params.tax_number || null,
        notes: params.notes || null,
        payment_terms: params.payment_terms || null,
        credit_limit: num(params.credit_limit),
        opening_balance: opening,
        // Legacy column — do not treat as product category; categories belong to products.
        category: params.category || null,
        status: params.status || "Active",
        order_count: num(params.order_count),
        total_ordered: num(params.total_ordered),
        total_paid: num(params.total_paid),
        balance: explicitBalance != null ? explicitBalance : opening,
        archived_at: null,
        deleted_at: null,
        company_id: companyId,
      };
      if (!payload.name) return { success: false, error: "Supplier name is required." };
      let { data, error } = await admin.from("suppliers").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        const slim = { ...payload };
        delete slim.company_id;
        delete slim.tax_number;
        delete slim.notes;
        delete slim.email;
        delete slim.address;
        delete slim.code;
        delete slim.payment_terms;
        delete slim.credit_limit;
        delete slim.total_paid;
        delete slim.opening_balance;
        delete slim.archived_at;
        delete slim.deleted_at;
        ({ data, error } = await admin.from("suppliers").insert(slim).select("*").single());
        if (error && isMissingColumnError(error)) {
          const minimal = {
            name: payload.name,
            contact_person: payload.contact_person,
            phone: payload.phone,
            category: payload.category,
            status: payload.status,
            order_count: payload.order_count,
            total_ordered: payload.total_ordered,
            balance: payload.balance,
          };
          ({ data, error } = await admin.from("suppliers").insert(minimal).select("*").single());
        }
        if (!error && data) {
          const extras = {
            email: payload.email,
            address: payload.address,
            tax_number: payload.tax_number,
            notes: payload.notes,
            code: payload.code,
            payment_terms: payload.payment_terms,
            credit_limit: payload.credit_limit,
            opening_balance: payload.opening_balance,
            total_paid: payload.total_paid,
            company_id: payload.company_id,
          };
          Object.keys(extras).forEach((k) => (extras[k] == null || extras[k] === "") && delete extras[k]);
          if (Object.keys(extras).length) {
            const { data: patched } = await admin.from("suppliers").update(extras).eq("id", data.id).select("*").maybeSingle();
            if (patched) data = patched;
          }
        }
      }
      if (error) {
        if (isUniqueViolation(error)) return { success: false, error: "Supplier code already exists for this company." };
        throw error;
      }
      await writeAudit(admin, {
        companyId,
        caller,
        action: "create_supplier",
        module: "suppliers",
        details: { id: data.id, name: data.name, code: data.code, opening_balance: payload.opening_balance },
      });
      return { success: true, id: data.id, supplier: data };
    }

    case "suppliers.update": {
      const updates = { ...params };
      delete updates.id;
      // Protect computed aggregates from accidental overwrite unless explicitly sent as numbers.
      if (updates.total_paid !== undefined) updates.total_paid = num(updates.total_paid);
      if (updates.credit_limit !== undefined) updates.credit_limit = num(updates.credit_limit);
      if (updates.opening_balance !== undefined) updates.opening_balance = num(updates.opening_balance);
      if (updates.status === "Active") {
        updates.archived_at = null;
        // Do not clear deleted_at here — use restore for that.
      }
      if (updates.status === "Archived" && updates.archived_at === undefined) {
        updates.archived_at = new Date().toISOString();
      }
      let q = admin.from("suppliers").update(updates).eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        const slim = { ...updates };
        delete slim.code;
        delete slim.payment_terms;
        delete slim.credit_limit;
        delete slim.total_paid;
        delete slim.last_purchase_at;
        delete slim.last_payment_at;
        delete slim.opening_balance;
        delete slim.archived_at;
        delete slim.deleted_at;
        let q2 = admin.from("suppliers").update(slim).eq("id", params.id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      if (!data) return { success: false, error: "Supplier not found." };
      await writeAudit(admin, {
        companyId,
        caller,
        action: "update_supplier",
        module: "suppliers",
        details: { id: data.id, name: data.name, status: data.status },
      });
      return { success: true, supplier: data };
    }

    case "suppliers.archive": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Supplier id is required." };
      const now = new Date().toISOString();
      let q = admin
        .from("suppliers")
        .update({ status: "Archived", archived_at: now })
        .eq("id", id)
        .is("deleted_at", null);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("suppliers").update({ status: "Inactive" }).eq("id", id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      if (!data) return { success: false, error: "Supplier not found." };
      await writeAudit(admin, {
        companyId,
        caller,
        action: "archive_supplier",
        module: "suppliers",
        details: { id: data.id, name: data.name },
      });
      return { success: true, supplier: data };
    }

    case "suppliers.restore": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Supplier id is required." };
      let q = admin
        .from("suppliers")
        .update({ status: "Active", archived_at: null, deleted_at: null })
        .eq("id", id);
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q.select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("suppliers").update({ status: "Active" }).eq("id", id);
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2.select("*").maybeSingle());
      }
      if (error) throw error;
      if (!data) return { success: false, error: "Supplier not found." };
      await writeAudit(admin, {
        companyId,
        caller,
        action: "restore_supplier",
        module: "suppliers",
        details: { id: data.id, name: data.name },
      });
      return { success: true, supplier: data };
    }

    case "suppliers.delete": {
      const id = Number(params.id);
      if (!id) return { success: false, error: "Supplier id is required." };
      const hard = params.hard === true || params.hard === "true";
      let existingQ = admin.from("suppliers").select("id,name,code").eq("id", id);
      existingQ = companyFilter(existingQ, companyId, platform);
      const { data: existing } = await existingQ.maybeSingle();
      if (!existing) return { success: false, error: "Supplier not found." };

      if (!hard) {
        const now = new Date().toISOString();
        let softQ = admin
          .from("suppliers")
          .update({ status: "Inactive", deleted_at: now, archived_at: now })
          .eq("id", id);
        softQ = companyFilter(softQ, companyId, platform);
        let { data, error } = await softQ.select("*").maybeSingle();
        if (error && isMissingColumnError(error)) {
          // Column missing — fall back to hard delete for legacy schemas
          let hq = admin.from("suppliers").delete().eq("id", id);
          hq = companyFilter(hq, companyId, platform);
          const del = await hq;
          if (del.error) throw del.error;
          await writeAudit(admin, {
            companyId,
            caller,
            action: "delete_supplier",
            module: "suppliers",
            details: { id, name: existing.name, mode: "hard_fallback" },
          });
          return { success: true, hard: true };
        }
        if (error) throw error;
        await writeAudit(admin, {
          companyId,
          caller,
          action: "soft_delete_supplier",
          module: "suppliers",
          details: { id: data?.id || id, name: existing.name },
        });
        return { success: true, soft: true, supplier: data };
      }

      let q = admin.from("suppliers").delete().eq("id", id);
      q = companyFilter(q, companyId, platform);
      const { error } = await q;
      if (error) throw error;
      await writeAudit(admin, {
        companyId,
        caller,
        action: "delete_supplier",
        module: "suppliers",
        details: { id, name: existing.name, mode: "hard" },
      });
      return { success: true, hard: true };
    }

    case "suppliers.addPayment": {
      const splits = Array.isArray(params.splits) && params.splits.length
        ? params.splits
        : [{ amount: params.amount, method: params.method || "Cash", reference: params.reference, notes: params.notes }];
      const normalizedSplits = splits
        .map((s) => ({
          amount: num(s.amount ?? s.original_amount),
          method: s.method || params.method || "Cash",
          reference: s.reference || params.reference || null,
          notes: s.notes || params.notes || null,
          payment_currency: s.payment_currency || params.payment_currency || params.currency_code,
          exchange_rate: s.exchange_rate ?? params.exchange_rate,
          original_amount: s.original_amount ?? s.amount ?? params.original_amount,
          payment_date: s.payment_date || params.payment_date,
          invoice_currency: s.invoice_currency || params.invoice_currency,
        }))
        .filter((s) => s.amount > 0);
      if (!normalizedSplits.length) return { success: false, error: "Payment amount must be positive." };

      let q = admin.from("suppliers").select("*").eq("id", params.supplier_id);
      q = companyFilter(q, companyId, platform);
      const { data: supplier, error } = await q.maybeSingle();
      if (error) throw error;
      if (!supplier) return { success: false, error: "Supplier not found." };
      if (supplier.deleted_at) return { success: false, error: "Cannot pay a deleted supplier. Restore it first." };

      const baseCode = await resolveBaseCurrencyCode(admin, companyId);
      const recorded = [];
      let totalLedger = 0;

      for (const split of normalizedSplits) {
        const fx = buildFxPaymentFields(
          {
            ...split,
            amount: split.amount,
            original_amount: split.original_amount ?? split.amount,
            exchange_rate:
              split.exchange_rate ??
              (await resolveRateToBase(admin, companyId, split.payment_currency || baseCode)),
          },
          baseCode
        );
        const ledgerAmount = fx.base_amount > 0 ? fx.base_amount : split.amount;
        totalLedger += ledgerAmount;

        const payRow = {
          supplier_id: supplier.id,
          amount: fx.original_amount,
          method: split.method || "Cash",
          company_id: companyId,
          purchase_id: params.purchase_id || null,
          reference: split.reference || null,
          notes: split.notes || null,
          payment_currency: fx.payment_currency,
          exchange_rate: fx.exchange_rate,
          original_amount: fx.original_amount,
          base_amount: fx.base_amount,
          converted_amount: fx.converted_amount,
          fx_gain_loss: fx.fx_gain_loss,
          payment_date: fx.payment_date,
          invoice_currency: fx.invoice_currency,
        };
        let { data: payData, error: payErr } = await admin.from("supplier_payments").insert(payRow).select("*").maybeSingle();
        if (payErr && isMissingColumnError(payErr)) {
          ({ data: payData, error: payErr } = await admin
            .from("supplier_payments")
            .insert({
              supplier_id: supplier.id,
              amount: fx.original_amount,
              method: split.method || "Cash",
              company_id: companyId,
              reference: split.reference || null,
              notes: split.notes || null,
            })
            .select("*")
            .maybeSingle());
          if (payErr && isMissingColumnError(payErr)) {
            ({ data: payData, error: payErr } = await admin
              .from("supplier_payments")
              .insert({
                supplier_id: supplier.id,
                amount: fx.original_amount,
                method: split.method || "Cash",
              })
              .select("*")
              .maybeSingle());
          }
        }
        if (payErr) throw payErr;
        recorded.push({ ...(payData || {}), ...fx, method: split.method || "Cash" });
      }

      const meta = await bumpSupplierPaymentMeta(admin, supplier.id, totalLedger, companyId);

      await writeAudit(admin, {
        companyId,
        caller,
        action: "supplier_payment",
        module: "suppliers",
        details: {
          supplier_id: supplier.id,
          total_base: totalLedger,
          splits: recorded.map((p) => ({
            id: p.id,
            amount: p.original_amount ?? p.amount,
            method: p.method,
            payment_currency: p.payment_currency,
          })),
        },
      });
      return {
        success: true,
        balance: meta?.balance ?? Math.max(0, num(supplier.balance) - totalLedger),
        payments: recorded,
        payment: recorded[0] || null,
      };
    }

    case "suppliers.getStatement": {
      let sq = admin.from("suppliers").select("*").eq("id", params.id);
      sq = companyFilter(sq, companyId, platform);
      const { data: supplier } = await sq.maybeSingle();
      if (!supplier) return { supplier: null, payments: [], purchases: [], ledger: [] };

      const { data: payments } = await admin
        .from("supplier_payments")
        .select("*")
        .eq("supplier_id", params.id)
        .order("created_at", { ascending: false });

      let pq = admin.from("purchases").select("*").eq("supplier_id", params.id).order("created_at", { ascending: false });
      pq = companyFilter(pq, companyId, platform);
      const { data: purchases } = await pq;

      let ledger = [];
      const { data: ledgerRows, error: ledgerErr } = await admin
        .from("supplier_ledger_v")
        .select("*")
        .eq("supplier_id", params.id)
        .order("entry_date", { ascending: false });
      if (!ledgerErr && ledgerRows) {
        ledger = ledgerRows;
      } else {
        // Fallback derive when view not migrated yet
        ledger = [
          ...(purchases || [])
            .filter((p) => !["Cancelled", "Draft"].includes(String(p.status)))
            .map((p) => ({
              entry_date: p.created_at,
              entry_type: "purchase",
              reference: p.po_number || p.invoice_no,
              description: `Purchase ${p.po_number || p.id} (${p.status})`,
              debit: num(p.total),
              credit: 0,
              source_table: "purchases",
              source_id: p.id,
            })),
          ...(payments || []).map((p) => ({
            entry_date: p.created_at,
            entry_type: "supplier_payment",
            reference: p.method,
            description: `Supplier payment via ${p.method || "Cash"}`,
            debit: 0,
            credit: num(p.amount),
            source_table: "supplier_payments",
            source_id: p.id,
          })),
        ].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)));
      }

      return {
        supplier,
        payments: payments || [],
        purchases: purchases || [],
        ledger,
        totals: {
          total_purchases: num(supplier.total_ordered),
          total_paid: num(supplier.total_paid),
          outstanding: num(supplier.balance),
          last_purchase_at: supplier.last_purchase_at || null,
          last_payment_at: supplier.last_payment_at || null,
        },
      };
    }

    case "suppliers.getLedger": {
      return handlePosAction(admin, caller, "suppliers.getStatement", params);
    }

    case "suppliers.getPurchaseHistory": {
      let q = admin.from("purchases").select("*").eq("supplier_id", params.id);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }

    case "suppliers.getDashboard": {
      const all = await handlePosAction(admin, caller, "suppliers.getAll", {
        ...params,
        include_archived: true,
        include_deleted: false,
      });
      const list = Array.isArray(all) ? all : [];
      const active = list.filter((s) => (s.status || "Active") === "Active" && !s.archived_at && !s.deleted_at);
      const outstanding = list.filter((s) => num(s.balance) > 0);
      let recentPurchases = [];
      let pq = admin
        .from("purchases")
        .select("id,po_number,supplier_id,status,total,created_at,amount_paid,balance")
        .order("created_at", { ascending: false })
        .limit(12);
      pq = companyFilter(pq, companyId, platform);
      const { data: purchases } = await pq;
      recentPurchases = purchases || [];

      let recentPayments = [];
      let payQ = admin
        .from("supplier_payments")
        .select("id,supplier_id,amount,method,created_at,reference,payment_currency,original_amount,base_amount")
        .order("created_at", { ascending: false })
        .limit(12);
      payQ = companyFilter(payQ, companyId, platform);
      const payRes = await payQ;
      if (!payRes.error) recentPayments = payRes.data || [];

      const nameById = Object.fromEntries(list.map((s) => [String(s.id), s.name]));
      const recent = [
        ...recentPurchases.map((p) => ({
          id: `po-${p.id}`,
          kind: "purchase",
          date: p.created_at,
          reference: p.po_number,
          supplier_id: p.supplier_id,
          supplier: nameById[String(p.supplier_id)] || "—",
          status: p.status,
          amount: num(p.total),
        })),
        ...recentPayments.map((p) => ({
          id: `pay-${p.id}`,
          kind: "payment",
          date: p.created_at,
          reference: p.reference || p.method,
          supplier_id: p.supplier_id,
          supplier: nameById[String(p.supplier_id)] || "—",
          status: p.method,
          amount: num(p.base_amount ?? p.amount),
        })),
      ]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 10);

      return {
        total_suppliers: list.length,
        active_suppliers: active.length,
        outstanding_balance: list.reduce((sum, s) => sum + num(s.balance), 0),
        total_purchases: list.reduce((sum, s) => sum + num(s.total_ordered), 0),
        total_payments: list.reduce((sum, s) => sum + num(s.total_paid), 0),
        outstanding_count: outstanding.length,
        recent_transactions: recent,
      };
    }

    case "suppliers.getReports": {
      const all = await handlePosAction(admin, caller, "suppliers.getAll", {
        include_archived: true,
        include_deleted: false,
      });
      const list = Array.isArray(all) ? all : [];
      let pq = admin.from("purchases").select("*").order("created_at", { ascending: false });
      pq = companyFilter(pq, companyId, platform);
      const { data: purchases } = await pq;
      let payQ = admin.from("supplier_payments").select("*").order("created_at", { ascending: false });
      payQ = companyFilter(payQ, companyId, platform);
      const payRes = await payQ;
      const payments = payRes.error ? [] : payRes.data || [];
      const nameById = Object.fromEntries(list.map((s) => [String(s.id), s]));

      const outstanding = list
        .filter((s) => num(s.balance) > 0)
        .sort((a, b) => num(b.balance) - num(a.balance))
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          balance: num(s.balance),
          credit_limit: num(s.credit_limit),
          payment_terms: s.payment_terms,
          last_purchase_at: s.last_purchase_at,
          last_payment_at: s.last_payment_at,
        }));

      const purchaseHistory = (purchases || []).map((p) => ({
        id: p.id,
        po_number: p.po_number,
        invoice_no: p.invoice_no,
        supplier_id: p.supplier_id,
        supplier: nameById[String(p.supplier_id)]?.name || "—",
        status: p.status,
        total: num(p.total),
        amount_paid: num(p.amount_paid),
        balance: num(p.balance),
        created_at: p.created_at,
      }));

      const paymentHistory = payments.map((p) => ({
        id: p.id,
        supplier_id: p.supplier_id,
        supplier: nameById[String(p.supplier_id)]?.name || "—",
        amount: num(p.amount),
        method: p.method,
        reference: p.reference,
        payment_currency: p.payment_currency,
        original_amount: p.original_amount,
        base_amount: p.base_amount,
        created_at: p.created_at || p.payment_date,
      }));

      const topSuppliers = [...list]
        .sort((a, b) => num(b.total_ordered) - num(a.total_ordered))
        .slice(0, 20)
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          total_ordered: num(s.total_ordered),
          total_paid: num(s.total_paid),
          balance: num(s.balance),
          order_count: num(s.order_count),
        }));

      return { outstanding, purchase_history: purchaseHistory, payment_history: paymentHistory, top_suppliers: topSuppliers };
    }

    case "sales.create": {
      if (!caller?.id) return { success: false, error: "Authentication required.", code: "UNAUTHENTICATED" };
      if (!Array.isArray(params.items) || params.items.length === 0) {
        return { success: false, error: "A sale must contain at least one item." };
      }
      if (companyId == null && !platform) {
        return { success: false, error: "Company context required.", code: "NO_COMPANY" };
      }

      const saleCompanyId =
        companyId != null && companyId !== ""
          ? companyId
          : params.company_id != null && params.company_id !== ""
            ? params.company_id
            : null;
      if (saleCompanyId == null) {
        return { success: false, error: "Company context required.", code: "NO_COMPANY" };
      }

      const rpcPayload = {
        company_id: saleCompanyId,
        user_id: caller.id,
        branch_id: caller.branch_id || params.branch_id || null,
        cashier_name: caller.name,
        cashier_username: caller.username,
        branch_name: params.branch_name || "",
        client_reference: params.client_reference || null,
        customer_id: params.customer_id || null,
        subtotal: num(params.subtotal),
        discount: num(params.discount),
        vat: num(params.vat),
        total: num(params.total),
        payment_method: params.payment_method || "CASH",
        cash_tendered: params.cash_tendered,
        change_due: params.change_due,
        card_brand: params.card_brand || "",
        payment_reference: params.payment_reference || "",
        split_payments: params.split_payments || [],
        vat_rate: num(params.vat_rate),
        vat_enabled: Boolean(params.vat_enabled),
        currency_code: params.currency_code || "KES",
        currency_symbol: params.currency_symbol || "Ksh",
        status: "Valid",
        items: params.items,
      };

      const { data: rpcData, error: rpcError } = await admin.rpc("pos_create_sale", { payload: rpcPayload });
      if (!rpcError && rpcData) {
        const sale = rpcData.sale || rpcData;
        try {
          await upsertInvoice(admin, {
            receipt_no: rpcData.receipt_no || sale.receipt_no,
            invoice_id: String(rpcData.id || sale.id),
            company_name: params.company_name || "Nexora POS Enterprise",
            branch_name: rpcPayload.branch_name || "",
            customer_name: params.customer_name || "Walk-in",
            payment_method: rpcPayload.payment_method,
            currency_code: rpcPayload.currency_code,
            currency_symbol: rpcPayload.currency_symbol,
            total: rpcPayload.total,
            status: "Valid",
            items: (params.items || []).map((item) => ({
              name: item.name,
              qty: num(item.qty),
              price: num(item.price),
            })),
            sale_date: sale.created_at || new Date().toISOString(),
            company_id: saleCompanyId,
          });
        } catch {
          /* invoice registry best-effort */
        }
        return rpcData;
      }

      // Fallback path when RPC / extended columns are not migrated yet
      if (rpcError && !isMissingTableError(rpcError) && rpcError.code !== "PGRST202") {
        const msg = String(rpcError.message || "");
        if (/Insufficient stock/i.test(msg)) {
          return { success: false, error: msg };
        }
        if (!/function|schema cache|column/i.test(msg)) {
          throw rpcError;
        }
      }

      // Idempotency for offline sync retries when RPC is unavailable
      const clientRef = params.client_reference ? String(params.client_reference).trim() : "";
      if (clientRef) {
        let dupQ = admin.from("sales").select("*").eq("client_reference", clientRef).limit(1);
        dupQ = companyFilter(dupQ, saleCompanyId, platform);
        const { data: dupRows } = await dupQ;
        const existing = Array.isArray(dupRows) ? dupRows[0] : dupRows;
        if (existing) {
          return {
            success: true,
            id: existing.id,
            invoice_no: existing.invoice_no || existing.receipt_no,
            receipt_no: existing.receipt_no || existing.invoice_no,
            duplicate: true,
            sale: existing,
          };
        }
      }

      const lineItems = Array.isArray(params.items) ? params.items : [];
      const productIds = [...new Set(lineItems.map((item) => Number(item.product_id)).filter(Boolean))];
      let stockMap = new Map();
      if (productIds.length) {
        let pq = admin.from("products").select("id,stock,name").in("id", productIds);
        pq = companyFilter(pq, saleCompanyId, platform);
        const { data: stockRows, error: stockErr } = await pq;
        if (stockErr) throw stockErr;
        stockMap = new Map((stockRows || []).map((row) => [Number(row.id), row]));
      }
      for (const item of lineItems) {
        const product = stockMap.get(Number(item.product_id));
        const qty = num(item.qty);
        if (!product || qty <= 0 || qty > num(product.stock)) {
          return { success: false, error: `Insufficient stock for ${item.name || product?.name || "an item"}.` };
        }
      }

      const created_at = new Date().toISOString();
      const insertRow = {
        invoice_no: `TMP-${Date.now()}`,
        customer_id: params.customer_id || null,
        user_id: caller.id,
        subtotal: num(params.subtotal),
        discount: num(params.discount),
        vat: num(params.vat),
        total: num(params.total),
        payment_method: params.payment_method || "CASH",
        branch_id: caller.branch_id || params.branch_id || null,
        company_id: saleCompanyId,
        items_json: lineItems,
        created_at,
      };
      if (clientRef) insertRow.client_reference = clientRef;

      let { data: sale, error: saleError } = await admin
        .from("sales")
        .insert(insertRow)
        .select("id,invoice_no,receipt_no,customer_id,user_id,subtotal,discount,vat,total,payment_method,branch_id,company_id,created_at")
        .single();
      if (saleError && isMissingColumnError(saleError)) {
        delete insertRow.company_id;
        delete insertRow.items_json;
        ({ data: sale, error: saleError } = await admin
          .from("sales")
          .insert(insertRow)
          .select("*")
          .single());
      }
      if (saleError) throw saleError;

      const receipt_no = `NX-${new Date(created_at).getFullYear()}-${String(sale.id).padStart(7, "0")}`;
      await trySb(admin.from("sales").update({ invoice_no: receipt_no, receipt_no }).eq("id", sale.id), async () => {
        await admin.from("sales").update({ invoice_no: receipt_no }).eq("id", sale.id);
      });

      const stockUpdates = new Map();
      for (const item of lineItems) {
        const id = Number(item.product_id);
        const current = stockUpdates.has(id) ? stockUpdates.get(id) : num(stockMap.get(id)?.stock);
        stockUpdates.set(id, Math.max(0, current - num(item.qty)));
      }
      await Promise.all([
        ...[...stockUpdates.entries()].map(([id, stock]) => admin.from("products").update({ stock }).eq("id", id)),
        lineItems.length
          ? admin.from("sale_items").insert(
              lineItems.map((item) => ({
                sale_id: sale.id,
                product_id: item.product_id,
                name: item.name,
                qty: num(item.qty),
                price: num(item.price),
                cost: num(item.cost),
              }))
            )
          : Promise.resolve(),
      ]);

      const fullSale = {
        ...sale,
        invoice_no: receipt_no,
        receipt_no,
        items: lineItems,
        cashier_name: caller.name,
        status: "Valid",
      };

      try {
        await upsertInvoice(admin, {
          receipt_no,
          invoice_id: String(sale.id),
          company_name: params.company_name || "Nexora POS Enterprise",
          branch_name: params.branch_name || "",
          customer_name: params.customer_name || "Walk-in",
          payment_method: params.payment_method || "CASH",
          currency_code: params.currency_code || "KES",
          currency_symbol: params.currency_symbol || "Ksh",
          total: num(params.total),
          status: "Valid",
          items: (params.items || []).map((item) => ({
            name: item.name,
            qty: num(item.qty),
            price: num(item.price),
          })),
          sale_date: created_at,
          company_id: saleCompanyId,
        });
      } catch {
        /* best-effort */
      }

      return {
        success: true,
        id: sale.id,
        invoice_no: receipt_no,
        receipt_no,
        sale: fullSale,
      };
    }

    case "sales.getRecent": {
      let q = admin
        .from("sales")
        .select(LIST_COLUMNS.sales)
        .order("created_at", { ascending: false })
        .limit(num(params.limit, 10));
      q = companyFilter(q, companyId, platform);
      let { data, error } = await q;
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("sales").select("*").order("created_at", { ascending: false }).limit(num(params.limit, 10));
        q2 = companyFilter(q2, companyId, platform);
        ({ data, error } = await q2);
      }
      if (error) throw error;
      const sales = data || [];
      const needItems = sales.filter((sale) => !(Array.isArray(sale.items_json) && sale.items_json.length));
      let itemsBySale = new Map();
      if (needItems.length) {
        const ids = needItems.map((s) => s.id);
        const { data: allItems } = await admin
          .from("sale_items")
          .select(LIST_COLUMNS.sale_items)
          .in("sale_id", ids);
        for (const item of allItems || []) {
          const key = Number(item.sale_id);
          if (!itemsBySale.has(key)) itemsBySale.set(key, []);
          itemsBySale.get(key).push(item);
        }
      }
      return sales.map((sale) => {
        if (Array.isArray(sale.items_json) && sale.items_json.length) {
          return { ...sale, items: sale.items_json };
        }
        return { ...sale, items: itemsBySale.get(Number(sale.id)) || [] };
      });
    }

    case "sales.getItems": {
      const { data, error } = await admin
        .from("sale_items")
        .select(LIST_COLUMNS.sale_items)
        .eq("sale_id", params.saleId);
      if (error) throw error;
      return data || [];
    }

    case "sales.getSummary": {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      let q = admin.from("sales").select("total,created_at").gte("created_at", monthStart);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) throw error;
      const todayStr = now.toDateString();
      const todaySales = (data || []).filter((s) => new Date(s.created_at).toDateString() === todayStr);
      return {
        today_count: todaySales.length,
        today_total: todaySales.reduce((sum, s) => sum + num(s.total), 0),
        month_count: (data || []).length,
        month_total: (data || []).reduce((sum, s) => sum + num(s.total), 0),
      };
    }

    case "sales.getWeeklyTrend": {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      let q = admin.from("sales").select("total,created_at").gte("created_at", weekAgo.toISOString());
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) throw error;
      const days = {};
      (data || []).forEach((sale) => {
        const key = String(sale.created_at).slice(0, 10);
        days[key] = (days[key] || 0) + num(sale.total);
      });
      return Object.entries(days)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-7)
        .map(([date, total]) => ({ date, total }));
    }

    case "sales.hold": {
      const payload = {
        payload: params,
        user_id: caller.id,
        branch_id: caller.branch_id,
        company_id: companyId,
        held_at: new Date().toISOString(),
      };
      let { data, error } = await admin.from("held_sales").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        ({ data, error } = await admin
          .from("held_sales")
          .insert({ payload: params, user_id: caller.id, branch_id: caller.branch_id })
          .select("*")
          .single());
      }
      if (error) throw error;
      return { success: true, id: data.id };
    }

    case "sales.getHeld": {
      let q = admin.from("held_sales").select("*").order("held_at", { ascending: false });
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((row) => ({ id: row.id, ...(row.payload || {}), held_at: row.held_at }));
    }

    case "sales.releaseHeld": {
      let q = admin.from("held_sales").select("*").eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      if (!data) return null;
      await admin.from("held_sales").delete().eq("id", params.id);
      return { id: data.id, ...(data.payload || {}), held_at: data.held_at };
    }

    case "sales.createReturn": {
      const saleId = Number(params.sale_id);
      const { data: sale } = await admin.from("sales").select("*").eq("id", saleId).maybeSingle();
      if (!sale) return { success: false, error: "Sale not found." };
      for (const item of params.items || []) {
        const { data: product } = await admin.from("products").select("stock").eq("id", item.product_id).maybeSingle();
        await admin
          .from("products")
          .update({ stock: num(product?.stock) + num(item.qty) })
          .eq("id", item.product_id);
      }
      const returned = num(sale.returned) + (params.items || []).reduce((s, i) => s + num(i.qty) * num(i.price), 0);
      await trySb(
        admin
          .from("sales")
          .update({ returned, return_reason: params.reason || "", status: "Refunded" })
          .eq("id", saleId),
        async () => admin.from("sales").update({ returned, return_reason: params.reason || "" }).eq("id", saleId)
      );
      return { success: true };
    }

    case "purchases.getAll": {
      const opts = parseListOptions(params, {
        softCap: DEFAULT_LIST_CAP,
        orderBy: "created_at",
        ascending: false,
        columns: LIST_COLUMNS.purchases,
      });
      const [rows, suppliers] = await Promise.all([
        listScoped(admin, "purchases", { ...caller, company_id: companyId }, LIST_COLUMNS.purchases, {
          ...opts,
          orderBy: "created_at",
          ascending: false,
          searchCols: opts.q ? ["po_number", "invoice_no", "notes", "status"] : [],
        }),
        listScoped(admin, "suppliers", { ...caller, company_id: companyId }, "id,name", {
          softCap: DEFAULT_LIST_CAP,
        }).catch(() => []),
      ]);
      const byId = new Map((suppliers || []).map((s) => [Number(s.id), s]));
      let mapped = (rows || []).map((po) => {
        const supplier = byId.get(Number(po.supplier_id));
        const total = num(po.total);
        const amountPaid = num(po.amount_paid);
        const balance = po.balance != null ? num(po.balance) : Math.max(0, total - amountPaid);
        return {
          ...po,
          supplier: po.supplier || supplier?.name || "Unknown",
          item_count: po.item_count ?? (Array.isArray(po.items_json) ? po.items_json.length : 0),
          amount_paid: amountPaid,
          balance,
          notes: po.notes || null,
          attachment_url: po.attachment_url || null,
        };
      });
      if (params.status && params.status !== "all") {
        mapped = mapped.filter((po) => String(po.status) === String(params.status));
      }
      return mapped;
    }

    case "purchases.getItems": {
      const purchaseId = Number(params.id || params.purchase_id);
      if (!purchaseId) return [];
      const { data: purchase } = await admin.from("purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!purchase) return [];
      const items = Array.isArray(purchase.items_json) ? purchase.items_json : [];
      if (items.length) {
        const productIds = items.map((i) => i.product_id).filter(Boolean);
        const { data: products } = productIds.length
          ? await admin.from("products").select("id,name,stock").in("id", productIds)
          : { data: [] };
        const nameById = new Map((products || []).map((p) => [Number(p.id), p.name]));
        return items.map((item, index) => ({
          id: item.id || `${purchaseId}-${index}`,
          purchase_id: purchaseId,
          product_id: item.product_id,
          product_name: item.product_name || nameById.get(Number(item.product_id)) || `Product #${item.product_id}`,
          qty: num(item.qty ?? item.qty_ordered),
          qty_ordered: num(item.qty_ordered ?? item.qty),
          qty_received: num(item.qty_received),
          qty_damaged: num(item.qty_damaged),
          cost: num(item.cost),
          discount: num(item.discount),
          tax: num(item.tax ?? item.tax_rate),
          line_total: num(item.line_total ?? linePurchaseTotal(item).total),
          batch_no: item.batch_no || null,
          serial_no: item.serial_no || null,
          expiry_date: item.expiry_date || null,
          mfg_date: item.mfg_date || null,
          line_notes: item.line_notes || null,
          back_order: Math.max(0, num(item.qty_ordered ?? item.qty) - num(item.qty_received)),
        }));
      }
      const { data: rows } = await admin
        .from("purchase_items")
        .select("id,purchase_id,product_id,qty,qty_ordered,qty_received,qty_damaged,cost,discount,tax,batch_no,serial_no,expiry_date,mfg_date,line_notes")
        .eq("purchase_id", purchaseId);
      if (!rows?.length) return [];
      const productIds = rows.map((r) => r.product_id).filter(Boolean);
      const { data: products } = productIds.length
        ? await admin.from("products").select("id,name").in("id", productIds)
        : { data: [] };
      const nameById = new Map((products || []).map((p) => [Number(p.id), p.name]));
      return rows.map((row) => ({
        ...row,
        qty: num(row.qty_ordered ?? row.qty),
        qty_ordered: num(row.qty_ordered ?? row.qty),
        qty_received: num(row.qty_received),
        qty_damaged: num(row.qty_damaged),
        product_name: nameById.get(Number(row.product_id)) || `Product #${row.product_id}`,
        back_order: Math.max(0, num(row.qty_ordered ?? row.qty) - num(row.qty_received)),
      }));
    }

    case "purchases.getReturns":
      return listScoped(admin, "purchase_returns", { ...caller, company_id: companyId }).catch(() => []);

    case "purchases.getPayments": {
      const purchaseId = Number(params.id || params.purchase_id);
      if (!purchaseId) return [];
      const { data, error } = await admin
        .from("purchase_payments")
        .select("*")
        .eq("purchase_id", purchaseId)
        .order("created_at", { ascending: false });
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return data || [];
    }

    case "purchases.getDashboard": {
      const purchases = await handlePosAction(admin, caller, "purchases.getAll", { all: true });
      const list = Array.isArray(purchases) ? purchases : [];
      const today = new Date().toISOString().slice(0, 10);
      const pendingStatuses = new Set(["Draft", "Pending", "Ordered"]);
      const receivedStatuses = new Set(["Received", "PartiallyReceived"]);
      let outstanding = 0;
      let todayValue = 0;
      let pendingCount = 0;
      let receivedCount = 0;
      const monthlyMap = new Map();
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        monthlyMap.set(key, 0);
      }
      for (const po of list) {
        if (String(po.status) === "Cancelled" || String(po.status) === "Rejected") continue;
        outstanding += Math.max(0, num(po.balance));
        if (pendingStatuses.has(String(po.status))) pendingCount += 1;
        if (receivedStatuses.has(String(po.status))) receivedCount += 1;
        const created = String(po.created_at || "").slice(0, 10);
        if (created === today) todayValue += num(po.total);
        const monthKey = String(po.created_at || "").slice(0, 7);
        if (monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, monthlyMap.get(monthKey) + num(po.total));
        }
      }
      return {
        total_purchases: list.filter((p) => !["Cancelled", "Rejected"].includes(String(p.status))).length,
        pending_pos: pendingCount,
        received_orders: receivedCount,
        outstanding_balance: outstanding,
        purchase_value_today: todayValue,
        monthly: [...monthlyMap.entries()].map(([month, total]) => ({ month, total })),
      };
    }

    case "purchases.getReports": {
      const purchases = await handlePosAction(admin, caller, "purchases.getAll", { all: true });
      const list = Array.isArray(purchases) ? purchases : [];
      const returns = await handlePosAction(admin, caller, "purchases.getReturns", {}).catch(() => []);
      let payQ = admin.from("purchase_payments").select("*").order("created_at", { ascending: false });
      payQ = companyFilter(payQ, companyId, platform);
      const payRes = await payQ;
      const payments = payRes.error ? [] : payRes.data || [];

      let journal = [];
      let jq = admin.from("journal_entries").select("*").order("created_at", { ascending: false }).limit(500);
      jq = companyFilter(jq, companyId, platform);
      const jRes = await jq;
      if (!jRes.error) journal = jRes.data || [];

      const bySupplier = {};
      const byBranch = {};
      for (const po of list) {
        if (["Cancelled", "Rejected"].includes(String(po.status))) continue;
        const sid = String(po.supplier_id || "unknown");
        if (!bySupplier[sid]) {
          bySupplier[sid] = {
            supplier_id: po.supplier_id,
            supplier: po.supplier || "—",
            orders: 0,
            total: 0,
            paid: 0,
            balance: 0,
            tax: 0,
          };
        }
        bySupplier[sid].orders += 1;
        bySupplier[sid].total += num(po.total);
        bySupplier[sid].paid += num(po.amount_paid);
        bySupplier[sid].balance += num(po.balance);
        bySupplier[sid].tax += num(po.tax_total);

        const bid = String(po.branch_id || "none");
        if (!byBranch[bid]) {
          byBranch[bid] = { branch_id: po.branch_id, orders: 0, total: 0, balance: 0 };
        }
        byBranch[bid].orders += 1;
        byBranch[bid].total += num(po.total);
        byBranch[bid].balance += num(po.balance);
      }

      const outstanding = list
        .filter((p) => num(p.balance) > 0 && !["Cancelled", "Rejected", "Draft"].includes(String(p.status)))
        .map((p) => ({
          id: p.id,
          po_number: p.po_number,
          supplier: p.supplier,
          supplier_id: p.supplier_id,
          total: num(p.total),
          amount_paid: num(p.amount_paid),
          balance: num(p.balance),
          due_date: p.due_date || p.payment_due_date,
          status: p.status,
        }))
        .sort((a, b) => num(b.balance) - num(a.balance));

      const vat = list
        .filter((p) => !["Cancelled", "Rejected", "Draft"].includes(String(p.status)))
        .map((p) => ({
          id: p.id,
          po_number: p.po_number,
          supplier: p.supplier,
          invoice_no: p.invoice_no,
          invoice_date: p.invoice_date || String(p.created_at || "").slice(0, 10),
          subtotal: num(p.subtotal),
          tax_total: num(p.tax_total),
          total: num(p.total),
        }));

      return {
        by_supplier: Object.values(bySupplier).sort((a, b) => b.total - a.total),
        by_branch: Object.values(byBranch),
        outstanding,
        returns: Array.isArray(returns) ? returns : [],
        payments,
        vat,
        accounting: journal,
        purchase_history: list,
      };
    }

    case "purchases.getAudit": {
      const purchaseId = Number(params.id || params.purchase_id);
      let q = admin
        .from("audit_log")
        .select(LIST_COLUMNS.audit_log)
        .eq("module", "purchases")
        .order("created_at", { ascending: false })
        .limit(Number(params.limit) || 100);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      let rows = data || [];
      if (purchaseId) {
        rows = rows.filter((r) => {
          try {
            const d = typeof r.details === "string" ? JSON.parse(r.details || "{}") : r.details || {};
            return (
              Number(d.id) === purchaseId ||
              Number(d.purchase_id) === purchaseId ||
              Number(d.ref_id) === purchaseId
            );
          } catch {
            return String(r.details || "").includes(String(purchaseId));
          }
        });
      }
      return rows;
    }

    case "purchases.getJournal": {
      let q = admin
        .from("journal_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Number(params.limit) || 200);
      q = companyFilter(q, companyId, platform);
      if (params.ref_type) q = q.eq("ref_type", params.ref_type);
      if (params.ref_id) q = q.eq("ref_id", Number(params.ref_id));
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return data || [];
    }

    case "purchases.duplicate": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "create", matrix)) {
          return denyPurchase("duplicate purchase orders");
        }
      }
      const sourceId = Number(params.id);
      const { data: source } = await admin.from("purchases").select("*").eq("id", sourceId).maybeSingle();
      if (!source) return { success: false, error: "Purchase not found." };
      const items = await handlePosAction(admin, caller, "purchases.getItems", { id: sourceId });
      return handlePosAction(admin, caller, "purchases.create", {
        supplier_id: source.supplier_id,
        invoice_no: null,
        items: (items || []).map((it) => ({
          product_id: it.product_id,
          qty: it.qty_ordered ?? it.qty,
          cost: it.cost,
          discount: it.discount,
          tax: it.tax,
        })),
        status: "Draft",
        notes: source.notes ? `Copy of ${source.po_number}: ${source.notes}` : `Copy of ${source.po_number}`,
        branch_id: source.branch_id,
        warehouse_id: source.warehouse_id,
        discount_total: source.discount_total,
        shipping: source.shipping,
        other_charges: source.other_charges,
        payment_terms: source.payment_terms,
        amount_paid: 0,
      });
    }

    case "purchases.create": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "create", matrix)) {
          return denyPurchase("create purchase orders");
        }
      }
      const items = Array.isArray(params.items) ? params.items : [];
      if (!params.supplier_id) return { success: false, error: "Supplier is required." };
      if (!items.length) return { success: false, error: "Add at least one purchase line." };

      for (const item of items) {
        if (!item.product_id) return { success: false, error: "Each line requires a product." };
        if (num(item.qty) <= 0) return { success: false, error: "Line quantity must be greater than zero." };
        if (num(item.cost) < 0) return { success: false, error: "Line cost cannot be negative." };
        if (num(item.discount) < 0) return { success: false, error: "Discount cannot be negative." };
        if (num(item.tax ?? item.tax_rate) < 0) return { success: false, error: "Tax cannot be negative." };
      }

      const invoiceNo = params.invoice_no ? String(params.invoice_no).trim() : null;
      const clientRef = params.client_reference ? String(params.client_reference).trim() : null;

      if (invoiceNo) {
        let dq = admin
          .from("purchases")
          .select("id,po_number,status")
          .eq("supplier_id", Number(params.supplier_id))
          .eq("invoice_no", invoiceNo)
          .neq("status", "Cancelled")
          .limit(1);
        dq = companyFilter(dq, companyId, platform);
        const { data: dup } = await dq.maybeSingle();
        if (dup) {
          return {
            success: false,
            error: `Duplicate invoice: ${invoiceNo} already used on ${dup.po_number || `#${dup.id}`}.`,
            code: "DUPLICATE_INVOICE",
          };
        }
      }
      if (clientRef) {
        let cq = admin
          .from("purchases")
          .select("id,po_number")
          .eq("client_reference", clientRef)
          .neq("status", "Cancelled")
          .limit(1);
        cq = companyFilter(cq, companyId, platform);
        const { data: dupRef } = await cq.maybeSingle();
        if (dupRef) {
          return {
            success: false,
            error: `Duplicate client reference already used on ${dupRef.po_number || `#${dupRef.id}`}.`,
            code: "DUPLICATE_REFERENCE",
          };
        }
      }

      const normalizedItems = items.map((item) => {
        const totals = linePurchaseTotal(item);
        const qty = num(item.qty);
        return {
          product_id: Number(item.product_id),
          qty,
          qty_ordered: qty,
          qty_received: 0,
          cost: num(item.cost),
          discount: num(item.discount),
          tax: num(item.tax ?? item.tax_rate),
          line_total: totals.total,
          batch_no: item.batch_no || null,
          serial_no: item.serial_no || null,
          expiry_date: item.expiry_date || null,
          mfg_date: item.mfg_date || null,
          line_notes: item.line_notes || item.notes || null,
        };
      });
      const header = computePurchaseHeaderTotals(normalizedItems, {
        discount_total: params.discount_total,
        shipping: params.shipping,
        other_charges: params.other_charges,
      });
      const total = header.total;
      const amountPaid = Math.max(0, num(params.amount_paid));
      if (amountPaid > total) return { success: false, error: "Amount paid cannot exceed purchase total." };
      const balance = Math.max(0, total - amountPaid);
      const status = normalizePurchaseStatus(params.status, "Pending");
      const po_number = params.po_number || (await nextPoNumber(admin, companyId).catch(() => `PO-${Date.now()}`));

      // Load supplier terms → auto due date (ERP AP: Net 30 → invoice date + 30)
      let supplierTerms = params.payment_terms || null;
      let dueDate = params.due_date || params.payment_due_date || null;
      const invoiceDate = params.invoice_date || new Date().toISOString().slice(0, 10);
      {
        const { data: supplierRow } = await admin
          .from("suppliers")
          .select("id,payment_terms")
          .eq("id", Number(params.supplier_id))
          .maybeSingle();
        if (!supplierTerms) supplierTerms = supplierRow?.payment_terms || null;
        if (!dueDate) {
          dueDate = computeDueDate(supplierTerms, invoiceDate ? new Date(invoiceDate) : new Date());
        }
      }

      const payload = {
        po_number,
        supplier_id: Number(params.supplier_id),
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        total,
        subtotal: header.subtotal,
        tax_total: header.tax_total,
        discount_total: header.discount_total,
        shipping: header.shipping,
        other_charges: header.other_charges,
        amount_paid: amountPaid,
        balance,
        status,
        item_count: normalizedItems.length,
        branch_id: params.branch_id || caller.branch_id,
        warehouse_id: params.warehouse_id || null,
        company_id: companyId,
        items_json: normalizedItems,
        notes: params.notes || null,
        attachment_url: params.attachment_url || null,
        client_reference: clientRef,
        payment_terms: supplierTerms,
        due_date: dueDate,
        payment_due_date: dueDate,
        created_by: caller.id || null,
        ordered_at: status === "Ordered" || status === "Pending" ? new Date().toISOString() : null,
        approved_at: status === "Ordered" ? new Date().toISOString() : null,
        approved_by: status === "Ordered" ? caller.id || null : null,
      };

      let { data, error } = await admin.from("purchases").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        const slim = {
          po_number,
          supplier_id: payload.supplier_id,
          invoice_no: invoiceNo,
          total,
          status,
          item_count: normalizedItems.length,
          branch_id: payload.branch_id,
          company_id: companyId,
          items_json: normalizedItems,
        };
        ({ data, error } = await admin.from("purchases").insert(slim).select("*").single());
        if (error && isMissingColumnError(error)) {
          delete slim.company_id;
          delete slim.items_json;
          ({ data, error } = await admin.from("purchases").insert(slim).select("*").single());
          if (!error && data && normalizedItems.length) {
            await quietSb(
              admin.from("purchases").update({ items_json: normalizedItems }).eq("id", data.id)
            );
          }
        }
        if (!error && data) {
          const extras = {
            amount_paid: amountPaid,
            balance,
            notes: payload.notes,
            attachment_url: payload.attachment_url,
            client_reference: clientRef,
            ordered_at: payload.ordered_at,
            payment_terms: supplierTerms,
            due_date: dueDate,
          };
          Object.keys(extras).forEach((k) => extras[k] == null && delete extras[k]);
          if (Object.keys(extras).length) {
            await Promise.resolve(admin.from("purchases").update(extras).eq("id", data.id)).catch(() => null);
          }
        }
      }
      if (error) {
        if (isUniqueViolation(error)) {
          return { success: false, error: "Duplicate purchase detected (invoice or reference).", code: "DUPLICATE" };
        }
        throw error;
      }

      await trySb(
        admin.from("purchase_items").insert(
          normalizedItems.map((item) => ({
            purchase_id: data.id,
            product_id: item.product_id,
            qty: item.qty,
            qty_ordered: item.qty_ordered,
            qty_received: 0,
            cost: item.cost,
            discount: item.discount,
            tax: item.tax,
            company_id: companyId,
            batch_no: item.batch_no,
            serial_no: item.serial_no,
            expiry_date: item.expiry_date,
            mfg_date: item.mfg_date,
            line_notes: item.line_notes,
          }))
        ),
        async () =>
          quietSb(
            admin.from("purchase_items").insert(
              normalizedItems.map((item) => ({
                purchase_id: data.id,
                product_id: item.product_id,
                qty: item.qty,
                cost: item.cost,
              }))
            )
          )
      );

      for (const item of normalizedItems) {
        if (!item.product_id) continue;
        await quietSb(
          admin.from("products").update({ cost: item.cost, last_cost: item.cost }).eq("id", item.product_id)
        );
      }

      if (amountPaid > 0 && status !== "Draft") {
        await handlePosAction(admin, caller, "purchases.addPayment", {
          purchase_id: data.id,
          amount: amountPaid,
          method: params.payment_method || "Cash",
          skip_balance_update: true,
        }).catch(() => null);
      }

      await writeAudit(admin, {
        companyId,
        caller,
        action: "create_purchase",
        module: "purchases",
        details: { id: data.id, po_number, supplier_id: payload.supplier_id, total, status },
      });
      return {
        success: true,
        id: data.id,
        po_number: data.po_number || po_number,
        total,
        purchase: data,
      };
    }

    case "purchases.update": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "edit", matrix)) {
          return denyPurchase("edit purchase orders");
        }
      }
      const purchaseId = Number(params.id);
      const { data: existing } = await admin.from("purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!existing) return { success: false, error: "Purchase not found." };
      if (String(existing.status) === "Cancelled") {
        return { success: false, error: "Cancelled purchases cannot be edited." };
      }
      if (String(existing.status) === "Received" && params.items) {
        return { success: false, error: "Fully received purchases cannot change line items." };
      }

      const updates = {};
      if (params.notes !== undefined) updates.notes = params.notes;
      if (params.attachment_url !== undefined) updates.attachment_url = params.attachment_url;
      if (params.invoice_no !== undefined) updates.invoice_no = params.invoice_no ? String(params.invoice_no).trim() : null;
      if (params.invoice_date !== undefined) updates.invoice_date = params.invoice_date || null;
      if (params.due_date !== undefined) {
        updates.due_date = params.due_date || null;
        updates.payment_due_date = params.due_date || null;
      }
      if (params.payment_due_date !== undefined) updates.payment_due_date = params.payment_due_date || null;
      if (params.payment_terms !== undefined) updates.payment_terms = params.payment_terms || null;
      if (params.branch_id !== undefined) updates.branch_id = params.branch_id || null;
      if (params.warehouse_id !== undefined) updates.warehouse_id = params.warehouse_id || null;
      if (params.discount_total !== undefined) updates.discount_total = num(params.discount_total);
      if (params.shipping !== undefined) updates.shipping = num(params.shipping);
      if (params.other_charges !== undefined) updates.other_charges = num(params.other_charges);
      if (params.status !== undefined) updates.status = normalizePurchaseStatus(params.status, existing.status);

      let normalizedItems = null;
      if (Array.isArray(params.items) && params.items.length) {
        normalizedItems = params.items.map((item) => {
          const totals = linePurchaseTotal(item);
          const qty = num(item.qty);
          return {
            product_id: Number(item.product_id),
            qty,
            qty_ordered: qty,
            qty_received: num(item.qty_received),
            cost: num(item.cost),
            discount: num(item.discount),
            tax: num(item.tax ?? item.tax_rate),
            line_total: totals.total,
            batch_no: item.batch_no || null,
            serial_no: item.serial_no || null,
            expiry_date: item.expiry_date || null,
            mfg_date: item.mfg_date || null,
            line_notes: item.line_notes || item.notes || null,
            qty_damaged: num(item.qty_damaged),
          };
        });
        const header = computePurchaseHeaderTotals(normalizedItems, {
          discount_total: params.discount_total != null ? params.discount_total : existing.discount_total,
          shipping: params.shipping != null ? params.shipping : existing.shipping,
          other_charges: params.other_charges != null ? params.other_charges : existing.other_charges,
        });
        // Relational purchase_items is source of truth; items_json is denormalized cache
        // (DB trigger rebuilds JSON after line writes).
        updates.items_json = normalizedItems;
        updates.item_count = normalizedItems.length;
        updates.subtotal = header.subtotal;
        updates.tax_total = header.tax_total;
        updates.discount_total = header.discount_total;
        updates.shipping = header.shipping;
        updates.other_charges = header.other_charges;
        updates.total = header.total;
        updates.balance = Math.max(0, updates.total - num(existing.amount_paid));
      } else if (
        params.discount_total !== undefined ||
        params.shipping !== undefined ||
        params.other_charges !== undefined
      ) {
        const existingItems = Array.isArray(existing.items_json) ? existing.items_json : [];
        const header = computePurchaseHeaderTotals(existingItems, {
          discount_total: params.discount_total != null ? params.discount_total : existing.discount_total,
          shipping: params.shipping != null ? params.shipping : existing.shipping,
          other_charges: params.other_charges != null ? params.other_charges : existing.other_charges,
        });
        updates.subtotal = header.subtotal;
        updates.tax_total = header.tax_total;
        updates.discount_total = header.discount_total;
        updates.shipping = header.shipping;
        updates.other_charges = header.other_charges;
        updates.total = header.total;
        updates.balance = Math.max(0, updates.total - num(existing.amount_paid));
      }

      let { data, error } = await admin.from("purchases").update(updates).eq("id", purchaseId).select("*").maybeSingle();
      if (error && isMissingColumnError(error)) {
        const slim = { ...updates };
        delete slim.amount_paid;
        delete slim.balance;
        delete slim.notes;
        delete slim.attachment_url;
        delete slim.client_reference;
        ({ data, error } = await admin.from("purchases").update(slim).eq("id", purchaseId).select("*").maybeSingle());
      }
      if (error) {
        if (isUniqueViolation(error)) return { success: false, error: "Duplicate invoice number for this supplier." };
        throw error;
      }

      if (normalizedItems) {
        const lineCompanyId = existing.company_id ?? companyId;
        await quietSb(admin.from("purchase_items").delete().eq("purchase_id", purchaseId));
        await trySb(
          admin.from("purchase_items").insert(
            normalizedItems.map((item) => ({
              purchase_id: purchaseId,
              product_id: item.product_id,
              qty: item.qty,
              qty_ordered: item.qty_ordered,
              qty_received: item.qty_received,
              cost: item.cost,
              discount: item.discount,
              tax: item.tax,
              company_id: lineCompanyId,
            }))
          ),
          async () =>
            quietSb(
              admin.from("purchase_items").insert(
                normalizedItems.map((item) => ({
                  purchase_id: purchaseId,
                  product_id: item.product_id,
                  qty: item.qty,
                  cost: item.cost,
                }))
              )
            )
        );
        const { data: refreshed } = await admin.from("purchases").select("*").eq("id", purchaseId).maybeSingle();
        if (refreshed) data = refreshed;
      }

      return { success: true, purchase: data };
    }

    case "purchases.receive": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "approve", matrix)) {
          return denyPurchase("receive purchases");
        }
      }
      const { data: purchase } = await admin.from("purchases").select("*").eq("id", params.id).maybeSingle();
      if (!purchase) return { success: false, error: "Purchase not found." };
      const currentStatus = String(purchase.status);
      if (currentStatus === "Received") {
        return { success: false, error: "Purchase already fully received." };
      }
      if (currentStatus === "Cancelled") {
        return { success: false, error: "Cancelled purchases cannot be received." };
      }
      if (currentStatus === "Draft") {
        return { success: false, error: "Draft purchases must be submitted before receiving." };
      }

      let items = Array.isArray(purchase.items_json) ? [...purchase.items_json] : [];
      if (!items.length) {
        const { data: rows } = await admin
          .from("purchase_items")
          .select("product_id,qty,qty_ordered,qty_received,cost,discount,tax")
          .eq("purchase_id", purchase.id);
        items = (rows || []).map((r) => ({
          product_id: r.product_id,
          qty: num(r.qty_ordered ?? r.qty),
          qty_ordered: num(r.qty_ordered ?? r.qty),
          qty_received: num(r.qty_received),
          cost: num(r.cost),
          discount: num(r.discount),
          tax: num(r.tax),
        }));
      } else {
        items = items.map((item) => ({
          ...item,
          qty: num(item.qty ?? item.qty_ordered),
          qty_ordered: num(item.qty_ordered ?? item.qty),
          qty_received: num(item.qty_received),
        }));
      }

      // Optional partial receive: params.lines = [{ product_id, qty_received, qty_damaged, batch_no, ... }]
      const lineOverrides = Array.isArray(params.lines) ? params.lines : null;
      const receiveAll = params.receive_all !== false && !lineOverrides;
      let stockedQty = 0;
      let stockedValue = 0;
      const receivePlan = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const ordered = num(item.qty_ordered ?? item.qty);
        const already = num(item.qty_received);
        let toReceive = 0;
        let damaged = 0;
        let match = null;
        if (lineOverrides) {
          match = lineOverrides.find(
            (l) => Number(l.product_id) === Number(item.product_id) || Number(l.index) === i
          );
          toReceive = match ? num(match.qty_received ?? match.qty) : 0;
          damaged = match ? num(match.qty_damaged) : 0;
        } else if (receiveAll) {
          toReceive = Math.max(0, ordered - already);
        }
        if (toReceive <= 0 && damaged <= 0) continue;
        if (already + toReceive > ordered) {
          return {
            success: false,
            error: `Cannot receive more than ordered for product #${item.product_id}.`,
          };
        }
        const productId = Number(item.product_id);
        if (!productId) continue;
        if (match) {
          if (match.batch_no != null) item.batch_no = match.batch_no || null;
          if (match.serial_no != null) item.serial_no = match.serial_no || null;
          if (match.expiry_date != null) item.expiry_date = match.expiry_date || null;
          if (match.mfg_date != null) item.mfg_date = match.mfg_date || null;
          if (match.line_notes != null || match.notes != null) {
            item.line_notes = match.line_notes || match.notes || null;
          }
        }
        item.qty_damaged = num(item.qty_damaged) + damaged;
        receivePlan.push({ index: i, item, productId, toReceive, already, damaged });
      }

      if (!receivePlan.length) {
        return { success: false, error: "No quantities to receive." };
      }

      const productIds = [...new Set(receivePlan.map((r) => r.productId))];
      const { data: productRows } = await admin
        .from("products")
        .select("id,stock,cost,avg_cost,last_cost")
        .in("id", productIds);
      const productById = new Map((productRows || []).map((p) => [Number(p.id), p]));

      const stockOps = [];
      const movementRows = [];
      for (const plan of receivePlan) {
        const product = productById.get(plan.productId);
        if (!product) continue;
        const unitCost = num(plan.item.cost);
        const prevStock = num(product.stock);
        const prevAvg = num(product.avg_cost != null ? product.avg_cost : product.cost);
        const nextStock = prevStock + plan.toReceive;
        const nextAvg = weightedAvgCost(prevStock, prevAvg, plan.toReceive, unitCost);
        product.stock = nextStock;
        product.avg_cost = nextAvg;
        product.last_cost = unitCost;
        const updates = {
          stock: nextStock,
          cost: unitCost,
          last_cost: unitCost,
          avg_cost: nextAvg,
        };
        stockOps.push(admin.from("products").update(updates).eq("id", plan.productId));
        if (companyId != null && plan.toReceive > 0) {
          movementRows.push({
            company_id: companyId,
            product_id: plan.productId,
            type: "in",
            qty: plan.toReceive,
            note: `Purchase receive ${purchase.po_number || purchase.id}${
              plan.item.batch_no ? ` batch ${plan.item.batch_no}` : ""
            }${plan.damaged ? ` (damaged noted: ${plan.damaged})` : ""}`,
            user_id: caller.id,
            user_name: caller.name,
          });
        }
        plan.item.qty_received = plan.already + plan.toReceive;
        stockedQty += plan.toReceive;
        stockedValue += plan.toReceive * unitCost;
      }

      // Prefer updates with avg/last cost; fall back if columns missing
      const stockResults = await Promise.all(
        stockOps.map(async (op) => {
          const res = await op;
          if (res.error && isMissingColumnError(res.error)) {
            // Retry with stock + cost only
            return null;
          }
          return res;
        })
      );
      if (stockResults.some((r) => r === null)) {
        for (const plan of receivePlan) {
          const product = productById.get(plan.productId);
          if (!product) continue;
          await quietSb(
            admin
              .from("products")
              .update({ stock: num(product.stock), cost: num(plan.item.cost) })
              .eq("id", plan.productId)
          );
        }
      }
      if (movementRows.length) {
        await quietSb(admin.from("stock_movements").insert(movementRows));
      }

      if (stockedQty <= 0 && !receivePlan.some((p) => p.damaged > 0)) {
        return { success: false, error: "No quantities to receive." };
      }

      const nextStatus = deriveReceiveStatus(items) || "PartiallyReceived";
      const wasFirstReceive = !["Received", "PartiallyReceived"].includes(currentStatus);

      await trySb(
        admin
          .from("purchases")
          .update({
            items_json: items,
            status: nextStatus,
            received_at:
              nextStatus === "Received"
                ? new Date().toISOString()
                : purchase.received_at || new Date().toISOString(),
            warehouse_id: params.warehouse_id || purchase.warehouse_id || null,
          })
          .eq("id", params.id),
        async () =>
          admin.from("purchases").update({ status: nextStatus, items_json: items }).eq("id", params.id)
      );

      // Sync purchase_items qty_received + GRN meta in parallel
      await Promise.all(
        items.map((item) =>
          trySb(
            admin
              .from("purchase_items")
              .update({
                qty_received: num(item.qty_received),
                batch_no: item.batch_no || null,
                serial_no: item.serial_no || null,
                expiry_date: item.expiry_date || null,
                mfg_date: item.mfg_date || null,
                qty_damaged: num(item.qty_damaged),
                line_notes: item.line_notes || null,
              })
              .eq("purchase_id", purchase.id)
              .eq("product_id", item.product_id),
            async () =>
              quietSb(
                admin
                  .from("purchase_items")
                  .update({ qty_received: num(item.qty_received) })
                  .eq("purchase_id", purchase.id)
                  .eq("product_id", item.product_id)
              )
          )
        )
      );

      // Supplier balance / totals: book on first receive (partial or full)
      if (wasFirstReceive && purchase.supplier_id) {
        const { data: supplier } = await admin
          .from("suppliers")
          .select("balance,order_count,total_ordered,total_paid")
          .eq("id", purchase.supplier_id)
          .maybeSingle();
        if (supplier) {
          const supplierUpdates = {
            balance: num(supplier.balance) + num(purchase.total) - num(purchase.amount_paid),
            order_count: num(supplier.order_count) + 1,
            total_ordered: num(supplier.total_ordered) + num(purchase.total),
            last_purchase_at: new Date().toISOString(),
          };
          await trySb(
            admin.from("suppliers").update(supplierUpdates).eq("id", purchase.supplier_id),
            async () =>
              admin
                .from("suppliers")
                .update({
                  balance: supplierUpdates.balance,
                  order_count: supplierUpdates.order_count,
                  total_ordered: supplierUpdates.total_ordered,
                })
                .eq("id", purchase.supplier_id)
          );
        }
      }

      // Ensure purchase balance columns exist / stay aligned
      await quietSb(
        admin
          .from("purchases")
          .update({
            balance: Math.max(0, num(purchase.total) - num(purchase.amount_paid)),
          })
          .eq("id", purchase.id)
      );

      // Accounting: Dr Inventory / Cr AP (on stock received value)
      if (stockedValue > 0) {
        await postJournalEntries(admin, {
          companyId,
          caller,
          refType: "purchase_receive",
          refId: purchase.id,
          memo: `GRN ${purchase.po_number || purchase.id}`,
          lines: [
            { account: "Inventory", debit: stockedValue, credit: 0 },
            { account: "Accounts Payable", debit: 0, credit: stockedValue },
          ],
        });
      }

      await writeAudit(admin, {
        companyId,
        caller,
        action: "receive_purchase",
        module: "purchases",
        details: {
          id: purchase.id,
          po_number: purchase.po_number,
          total: purchase.total,
          status: nextStatus,
          qty_received_now: stockedQty,
          stock_value: stockedValue,
          accounting: { debit: "Inventory", credit: "Accounts Payable", amount: stockedValue },
        },
      });
      return { success: true, status: nextStatus, qty_received: stockedQty, stock_value: stockedValue };
    }

    case "purchases.addPayment": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "edit", matrix)) {
          return denyPurchase("record purchase payments");
        }
      }
      const purchaseId = Number(params.purchase_id || params.id);
      const amount = num(params.amount);
      if (!purchaseId || amount <= 0) {
        return { success: false, error: "Purchase and a positive amount are required." };
      }
      const { data: purchase } = await admin.from("purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!purchase) return { success: false, error: "Purchase not found." };
      if (String(purchase.status) === "Cancelled") {
        return { success: false, error: "Cannot pay a cancelled purchase." };
      }
      if (String(purchase.status) === "Draft") {
        return { success: false, error: "Cannot pay a draft purchase." };
      }

      const baseCode = await resolveBaseCurrencyCode(admin, companyId);
      const paymentCurrency = normalizeCode(
        params.payment_currency || params.currency_code || purchase.currency_code || baseCode,
        baseCode
      );
      const exchangeRate =
        params.exchange_rate != null
          ? toNumber(params.exchange_rate, 1)
          : await resolveRateToBase(admin, companyId, paymentCurrency);
      const fx = buildFxPaymentFields(
        {
          ...params,
          amount,
          payment_currency: paymentCurrency,
          original_amount: params.original_amount ?? amount,
          exchange_rate: exchangeRate,
          invoice_currency: params.invoice_currency || purchase.currency_code || baseCode,
        },
        baseCode
      );
      // AP balance is tracked in base currency
      const ledgerAmount = fx.base_amount > 0 ? fx.base_amount : amount;

      const currentPaid = num(purchase.amount_paid);
      const total = num(purchase.base_total != null ? purchase.base_total : purchase.total);
      const outstanding = Math.max(0, total - currentPaid);
      // skip_balance_update: amount already reflected on the purchase row (e.g. create with deposit)
      if (!params.skip_balance_update && ledgerAmount > outstanding + 0.001) {
        return { success: false, error: `Payment exceeds outstanding balance (${outstanding}).` };
      }

      const appliedPaid = params.skip_balance_update ? currentPaid : currentPaid + ledgerAmount;
      const newBalance = Math.max(0, total - appliedPaid);

      if (!params.skip_balance_update) {
        await quietSb(
          admin
            .from("purchases")
            .update({ amount_paid: appliedPaid, balance: newBalance })
            .eq("id", purchaseId)
        );
      }

      const payPayload = {
        purchase_id: purchaseId,
        supplier_id: purchase.supplier_id || null,
        company_id: companyId,
        amount: fx.original_amount,
        method: params.method || "Cash",
        reference: params.reference || null,
        notes: params.notes || null,
        created_by: caller.id || null,
        payment_currency: fx.payment_currency,
        exchange_rate: fx.exchange_rate,
        original_amount: fx.original_amount,
        base_amount: fx.base_amount,
        converted_amount: fx.converted_amount,
        fx_gain_loss: fx.fx_gain_loss,
        payment_date: fx.payment_date,
        invoice_currency: fx.invoice_currency,
      };
      const { error: payErr } = await admin.from("purchase_payments").insert(payPayload);
      if (payErr && !isMissingTableError(payErr) && !isMissingColumnError(payErr)) {
        // Retry without optional columns
        await quietSb(
          admin.from("purchase_payments").insert({
            purchase_id: purchaseId,
            amount: fx.original_amount,
            method: params.method || "Cash",
            company_id: companyId,
          })
        );
      } else if (payErr && isMissingColumnError(payErr)) {
        await quietSb(
          admin.from("purchase_payments").insert({
            purchase_id: purchaseId,
            supplier_id: purchase.supplier_id || null,
            company_id: companyId,
            amount: fx.original_amount,
            method: params.method || "Cash",
            reference: params.reference || null,
            notes: params.notes || null,
            created_by: caller.id || null,
          })
        );
      }

      // Mirror onto supplier AP ledger when purchase already booked (received)
      const booked = ["Received", "PartiallyReceived"].includes(String(purchase.status));
      if (booked && purchase.supplier_id && !params.skip_supplier) {
        await bumpSupplierPaymentMeta(admin, purchase.supplier_id, ledgerAmount, companyId);
        await trySb(
          admin.from("supplier_payments").insert({
            supplier_id: purchase.supplier_id,
            amount: fx.original_amount,
            method: params.method || "Cash",
            company_id: companyId,
            purchase_id: purchaseId,
            reference: params.reference || purchase.po_number,
            payment_currency: fx.payment_currency,
            exchange_rate: fx.exchange_rate,
            original_amount: fx.original_amount,
            base_amount: fx.base_amount,
            converted_amount: fx.converted_amount,
            fx_gain_loss: fx.fx_gain_loss,
            payment_date: fx.payment_date,
            invoice_currency: fx.invoice_currency,
          }),
          async () =>
            admin.from("supplier_payments").insert({
              supplier_id: purchase.supplier_id,
              amount: fx.original_amount,
              method: params.method || "Cash",
            })
        );
      }

      await writeAudit(admin, {
        companyId,
        caller,
        action: "purchase_payment",
        module: "purchases",
        details: {
          purchase_id: purchaseId,
          amount: fx.original_amount,
          base_amount: fx.base_amount,
          payment_currency: fx.payment_currency,
          exchange_rate: fx.exchange_rate,
          method: params.method || "Cash",
          accounting: {
            debit: "Accounts Payable",
            credit: params.method === "Credit" ? "Supplier Credit" : (params.method || "Cash"),
            amount: ledgerAmount,
          },
        },
      });

      if (ledgerAmount > 0 && !params.skip_balance_update) {
        const creditAccount =
          params.method === "Credit"
            ? "Supplier Credit"
            : params.method === "Bank Transfer"
              ? "Bank"
              : params.method === "M-Pesa"
                ? "M-Pesa"
                : params.method === "Card"
                  ? "Card Clearing"
                  : params.method === "Cheque"
                    ? "Cheque Clearing"
                    : "Cash";
        await postJournalEntries(admin, {
          companyId,
          caller,
          refType: "purchase_payment",
          refId: purchaseId,
          memo: `Payment ${purchase.po_number || purchaseId}`,
          lines: [
            { account: "Accounts Payable", debit: ledgerAmount, credit: 0 },
            { account: creditAccount, debit: 0, credit: ledgerAmount },
          ],
        });
      }

      return { success: true, amount_paid: appliedPaid, balance: newBalance, payment: fx };
    }

    case "purchases.cancel": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "edit", matrix) && !canPurchaseAction(caller.role, "delete", matrix)) {
          return denyPurchase("cancel purchase orders");
        }
      }
      const { data: purchase } = await admin.from("purchases").select("*").eq("id", params.id).maybeSingle();
      if (!purchase) return { success: false, error: "Purchase not found." };
      if (String(purchase.status) === "Cancelled") {
        return { success: false, error: "Purchase already cancelled." };
      }
      if (String(purchase.status) === "Received") {
        return { success: false, error: "Fully received purchases cannot be cancelled — use returns." };
      }
      if (String(purchase.status) === "PartiallyReceived") {
        return { success: false, error: "Partially received purchases cannot be cancelled — receive remaining or return stock." };
      }
      await trySb(
        admin
          .from("purchases")
          .update({ status: "Cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", params.id),
        async () => admin.from("purchases").update({ status: "Cancelled" }).eq("id", params.id)
      );
      await writeAudit(admin, {
        companyId,
        caller,
        action: "cancel_purchase",
        module: "purchases",
        details: { id: purchase.id, po_number: purchase.po_number },
      });
      return { success: true };
    }

    case "purchases.updateStatus": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "edit", matrix)) {
          return denyPurchase("update purchase status");
        }
      }
      const { data: existing } = await admin.from("purchases").select("*").eq("id", params.id).maybeSingle();
      if (!existing) return { success: false, error: "Purchase not found." };
      const status = normalizePurchaseStatus(params.status, "Pending");
      if (status === "Cancelled") {
        return handlePosAction(admin, caller, "purchases.cancel", { id: params.id });
      }
      if (status === "Received" || status === "PartiallyReceived") {
        return { success: false, error: "Use purchases.receive to receive stock." };
      }
      if (status === "Rejected") {
        if (!["Draft", "Pending", "Ordered"].includes(String(existing.status))) {
          return { success: false, error: "Only Draft/Pending/Ordered POs can be rejected." };
        }
        const reason = params.rejection_reason || params.reason || "Rejected";
        await trySb(
          admin
            .from("purchases")
            .update({
              status: "Rejected",
              rejected_at: new Date().toISOString(),
              rejection_reason: reason,
              cancelled_at: new Date().toISOString(),
            })
            .eq("id", params.id),
          async () => admin.from("purchases").update({ status: "Rejected" }).eq("id", params.id)
        );
        await writeAudit(admin, {
          companyId,
          caller,
          action: "reject_purchase",
          module: "purchases",
          details: { id: existing.id, po_number: existing.po_number, reason },
        });
        return { success: true, status: "Rejected" };
      }
      const patch = { status };
      if (status === "Ordered") {
        patch.ordered_at = new Date().toISOString();
        patch.approved_at = new Date().toISOString();
        patch.approved_by = caller.id || null;
        patch.rejected_at = null;
        patch.rejection_reason = null;
      }
      if (status === "Pending" && String(existing.status) === "Draft") {
        patch.ordered_at = new Date().toISOString();
      }
      await trySb(
        admin.from("purchases").update(patch).eq("id", params.id),
        async () => admin.from("purchases").update({ status }).eq("id", params.id)
      );
      await writeAudit(admin, {
        companyId,
        caller,
        action: status === "Ordered" ? "approve_purchase" : "update_purchase_status",
        module: "purchases",
        details: { id: existing.id, po_number: existing.po_number, from: existing.status, to: status },
      });
      return { success: true, status };
    }

    case "purchases.createReturn": {
      {
        const matrix = await loadPermissionMatrix(admin, companyId);
        if (!canPurchaseAction(caller.role, "edit", matrix) && !canPurchaseAction(caller.role, "approve", matrix)) {
          // Also allow via returns.create at middleware; still require purchase edit/approve server-side
          const r = normalizeRole(caller.role);
          if (!["owner", "super_admin", "admin", "platform_owner", "accountant"].includes(r)) {
            return denyPurchase("create purchase returns");
          }
        }
      }
      const qty = num(params.qty);
      if (qty <= 0) return { success: false, error: "Return quantity must be positive." };
      const purchaseId = Number(params.purchase_id);
      const productId = Number(params.product_id);
      const { data: purchase } = await admin.from("purchases").select("*").eq("id", purchaseId).maybeSingle();
      if (!purchase) return { success: false, error: "Purchase not found." };
      if (!["Received", "PartiallyReceived"].includes(String(purchase.status))) {
        return { success: false, error: "Only received purchases can be returned." };
      }

      const row = {
        purchase_id: purchaseId,
        product_id: productId,
        qty,
        cost: num(params.cost),
        reason: params.reason || "",
        company_id: companyId,
      };
      let { error } = await admin.from("purchase_returns").insert(row);
      if (error && isMissingColumnError(error)) {
        delete row.company_id;
        ({ error } = await admin.from("purchase_returns").insert(row));
      }
      if (error) throw error;

      const { data: product } = await admin.from("products").select("stock").eq("id", productId).maybeSingle();
      if (product) {
        await admin
          .from("products")
          .update({ stock: Math.max(0, num(product.stock) - qty) })
          .eq("id", productId);
      }
      if (companyId != null) {
        await quietSb(
          admin.from("stock_movements").insert({
            company_id: companyId,
            product_id: productId,
            type: "out",
            qty,
            note: params.reason || "Purchase return",
            user_id: caller.id,
            user_name: caller.name,
          })
        );
      }

      const credit = qty * num(params.cost);
      if (purchase.supplier_id && credit > 0) {
        const { data: supplier } = await admin
          .from("suppliers")
          .select("balance")
          .eq("id", purchase.supplier_id)
          .maybeSingle();
        if (supplier) {
          await admin
            .from("suppliers")
            .update({ balance: Math.max(0, num(supplier.balance) - credit) })
            .eq("id", purchase.supplier_id);
        }
      }

      await writeAudit(admin, {
        companyId,
        caller,
        action: "purchase_return",
        module: "purchases",
        details: {
          ...row,
          accounting: { debit: "Accounts Payable", credit: "Inventory", amount: credit },
        },
      });

      if (credit > 0) {
        await postJournalEntries(admin, {
          companyId,
          caller,
          refType: "purchase_return",
          refId: purchaseId,
          memo: `Return / credit note ${purchase.po_number || purchaseId}`,
          lines: [
            { account: "Accounts Payable", debit: credit, credit: 0 },
            { account: "Inventory", debit: 0, credit: credit },
          ],
        });
      }

      return { success: true, credit_note: credit };
    }

    case "expenses.getAll": {
      const opts = parseListOptions(params, {
        softCap: DEFAULT_LIST_CAP,
        orderBy: "expense_date",
        ascending: false,
        columns: LIST_COLUMNS.expenses,
      });
      return listScoped(admin, "expenses", { ...caller, company_id: companyId }, LIST_COLUMNS.expenses, {
        ...opts,
        orderBy: "expense_date",
        ascending: false,
        searchCols: opts.q ? ["name", "category"] : [],
      });
    }

    case "expenses.getCategories":
      return listScoped(admin, "expense_categories", caller, "id,name", { softCap: 200 }).catch(async () => {
        const { data } = await admin.from("expense_categories").select("id,name");
        return data || [];
      });

    case "expenses.createCategory": {
      const { data, error } = await admin
        .from("expense_categories")
        .insert({ name: String(params.name || "").trim() })
        .select("*")
        .single();
      if (error) throw error;
      return { success: true, category: data };
    }

    case "expenses.create": {
      const baseCode = await resolveBaseCurrencyCode(admin, companyId);
      const currencyCode = normalizeCode(params.currency_code || params.payment_currency || baseCode, baseCode);
      const exchangeRate =
        params.exchange_rate != null
          ? toNumber(params.exchange_rate, 1)
          : await resolveRateToBase(admin, companyId, currencyCode);
      const originalAmount = num(params.original_amount ?? params.amount);
      const baseAmount =
        params.base_amount != null ? num(params.base_amount) : convertToBase(originalAmount, exchangeRate);
      const payload = {
        name: String(params.name || "").trim(),
        category: params.category || "Other",
        expense_date: params.expense_date || new Date().toISOString().slice(0, 10),
        amount: baseAmount,
        branch_id: params.branch_id || caller.branch_id,
        company_id: companyId,
        currency_code: currencyCode,
        exchange_rate: exchangeRate,
        original_amount: originalAmount,
        base_amount: baseAmount,
      };
      let { data, error } = await admin.from("expenses").insert(payload).select("*").single();
      if (error && isMissingColumnError(error)) {
        delete payload.company_id;
        delete payload.currency_code;
        delete payload.exchange_rate;
        delete payload.original_amount;
        delete payload.base_amount;
        payload.amount = originalAmount;
        ({ data, error } = await admin.from("expenses").insert(payload).select("*").single());
      }
      if (error) throw error;
      return { success: true, expense: data };
    }

    case "expenses.update": {
      const updates = { ...params };
      delete updates.id;
      const { data, error } = await admin.from("expenses").update(updates).eq("id", params.id).select("*").maybeSingle();
      if (error) throw error;
      return { success: true, expense: data };
    }

    case "expenses.delete": {
      const { error } = await admin.from("expenses").delete().eq("id", params.id);
      if (error) throw error;
      return { success: true };
    }

    case "expenses.getSummary": {
      const rows = await listScoped(admin, "expenses", { ...caller, company_id: companyId }, "amount,category", {
        softCap: DEFAULT_LIST_CAP,
      });
      const monthTotal = rows.reduce((sum, row) => sum + num(row.amount), 0);
      const byCategory = Object.entries(
        rows.reduce((acc, row) => {
          const category = row.category || "Other";
          acc[category] = (acc[category] || 0) + num(row.amount);
          return acc;
        }, {})
      ).map(([category, total]) => ({ category, total }));
      return { monthTotal, byCategory, total: monthTotal, count: rows.length };
    }

    case "inventory.getStats": {
      const products = filterActiveProducts(
        await listScoped(
          admin,
          "products",
          { ...caller, company_id: companyId },
          "id,stock,cost,reorder_level,max_stock,expiry_date,archived_at,deleted_at",
          { softCap: DEFAULT_LIST_CAP }
        ).catch(() => [])
      );
      const today = new Date().toISOString().slice(0, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const low = products.filter((p) => num(p.stock) > 0 && num(p.stock) <= num(p.reorder_level));
      const out = products.filter((p) => num(p.stock) <= 0);
      const over = products.filter((p) => num(p.max_stock) > 0 && num(p.stock) >= num(p.max_stock));
      const expiring = products.filter(
        (p) => p.expiry_date && String(p.expiry_date).slice(0, 10) >= today && String(p.expiry_date).slice(0, 10) <= cutoffStr && num(p.stock) > 0
      );
      const expired = products.filter(
        (p) => p.expiry_date && String(p.expiry_date).slice(0, 10) < today && num(p.stock) > 0
      );
      const stockValue = products.reduce((s, p) => s + num(p.stock) * num(p.cost), 0);
      const totalUnits = products.reduce((s, p) => s + num(p.stock), 0);
      const skuCount = products.length;
      return {
        sku_count: skuCount,
        totalSkus: skuCount,
        total_units: totalUnits,
        totalUnits,
        stock_value: stockValue,
        stockValue,
        inventory_value: stockValue,
        inventoryValue: stockValue,
        low_stock_count: low.length,
        lowStockCount: low.length,
        out_of_stock_count: out.length,
        outOfStockCount: out.length,
        overstock_count: over.length,
        overstockCount: over.length,
        expiring_soon_count: expiring.length,
        expiringSoonCount: expiring.length,
        expired_count: expired.length,
        expiredCount: expired.length,
      };
    }

    case "inventory.getLowStock": {
      const limit = Math.min(100, num(params.limit, 40));
      const products = filterActiveProducts(
        await listScoped(
          admin,
          "products",
          { ...caller, company_id: companyId },
          LIST_COLUMNS.products,
          { softCap: DEFAULT_LIST_CAP }
        ).catch(() => [])
      );
      return excludeDemoProducts(
        products
          .filter((p) => num(p.stock) <= num(p.reorder_level))
          .map((p) => normalizeProduct(p))
          .map((p) => ({ ...p, deficit: Math.max(0, num(p.reorder_level) - num(p.stock)) }))
      ).slice(0, limit);
    }

    case "inventory.getTransfers":
      return listScoped(admin, "stock_transfers", { ...caller, company_id: companyId }, "*", {
        softCap: 500,
        orderBy: "created_at",
        ascending: false,
      }).catch(() => []);

    case "inventory.getMovements": {
      const limit = Math.min(500, num(params.limit, 100));
      let q = admin
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      q = companyFilter(q, companyId, platform);
      if (params.type) q = q.eq("type", params.type);
      if (params.product_id) q = q.eq("product_id", Number(params.product_id));
      if (params.warehouse_id) q = q.eq("warehouse_id", Number(params.warehouse_id));
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      const rows = data || [];
      const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
      const warehouseIds = [...new Set(rows.map((r) => r.warehouse_id).filter(Boolean))];
      const [products, warehouses] = await Promise.all([
        productIds.length
          ? admin.from("products").select("id,name,sku,barcode").in("id", productIds).then((r) => r.data || [])
          : Promise.resolve([]),
        warehouseIds.length
          ? admin.from("warehouses").select("id,name,code").in("id", warehouseIds).then((r) => r.data || []).catch(() => [])
          : Promise.resolve([]),
      ]);
      const pMap = new Map(products.map((p) => [Number(p.id), p]));
      const wMap = new Map(warehouses.map((w) => [Number(w.id), w]));
      return rows.map((m) => ({
        ...m,
        product_name: pMap.get(Number(m.product_id))?.name || "Unknown",
        warehouse_name: wMap.get(Number(m.warehouse_id))?.name || (m.warehouse_id ? `#${m.warehouse_id}` : "—"),
      }));
    }

    case "inventory.getExpiring": {
      const days = Math.min(180, num(params.days, 30));
      const products = filterActiveProducts(
        await listScoped(
          admin,
          "products",
          { ...caller, company_id: companyId },
          LIST_COLUMNS.products,
          { softCap: DEFAULT_LIST_CAP }
        ).catch(() => [])
      );
      const today = new Date().toISOString().slice(0, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const fromProducts = products
        .filter((p) => p.expiry_date && num(p.stock) > 0 && String(p.expiry_date).slice(0, 10) <= cutoffStr)
        .map((p) => {
          const exp = String(p.expiry_date).slice(0, 10);
          return {
            id: `product-${p.id}`,
            product_id: p.id,
            product_name: p.name,
            qty: num(p.stock),
            batch_number: null,
            expiry_date: exp,
            warehouse_name: "Product-level",
            status: exp < today ? "expired" : "expiring",
          };
        });

      // Enrich from purchase_items batch/expiry when available (PARTIAL lot view)
      let fromPurchases = [];
      try {
        let pq = admin
          .from("purchase_items")
          .select("id,product_id,batch_no,expiry_date,qty_received,purchase_id")
          .not("expiry_date", "is", null)
          .limit(300);
        pq = companyFilter(pq, companyId, platform);
        const { data: lines, error } = await pq;
        if (!error && lines?.length) {
          const pMap = new Map(products.map((p) => [Number(p.id), p]));
          fromPurchases = lines
            .filter((l) => l.expiry_date && String(l.expiry_date).slice(0, 10) <= cutoffStr && num(l.qty_received) > 0)
            .map((l) => {
              const exp = String(l.expiry_date).slice(0, 10);
              const product = pMap.get(Number(l.product_id));
              return {
                id: `po-line-${l.id}`,
                product_id: l.product_id,
                product_name: product?.name || `Product #${l.product_id}`,
                qty: num(l.qty_received),
                batch_number: l.batch_no || null,
                expiry_date: exp,
                warehouse_name: "GRN lot",
                status: exp < today ? "expired" : "expiring",
              };
            });
        }
      } catch {
        /* optional */
      }
      return [...fromProducts, ...fromPurchases].sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    }

    case "inventory.getWarehouseStock": {
      // PARTIAL: no per-warehouse balance table — attribute company stock to warehouses proportionally / primary.
      const [products, warehouses] = await Promise.all([
        filterActiveProducts(
          await listScoped(admin, "products", { ...caller, company_id: companyId }, LIST_COLUMNS.products, {
            softCap: DEFAULT_LIST_CAP,
          }).catch(() => [])
        ),
        listScoped(admin, "warehouses", { ...caller, company_id: companyId }, LIST_COLUMNS.warehouses, {
          softCap: 500,
        }).catch(() => []),
      ]);
      const activeWh = (warehouses || []).filter((w) => w.active !== false);
      if (!activeWh.length) {
        return products.map((p) => ({
          id: `${p.id}-0`,
          warehouse_id: null,
          warehouse_name: "Default",
          product_id: p.id,
          product_name: p.name,
          qty: num(p.stock),
          batch_number: null,
          expiry_date: p.expiry_date || null,
          cost: num(p.cost),
          value: num(p.stock) * num(p.cost),
        }));
      }
      const filterWh = params.warehouseId || params.warehouse_id;
      const targets = filterWh ? activeWh.filter((w) => Number(w.id) === Number(filterWh)) : activeWh;
      const primary = targets[0] || activeWh[0];
      const rows = [];
      for (const p of products) {
        if (filterWh && Number(primary.id) !== Number(filterWh)) continue;
        rows.push({
          id: `${p.id}-${primary.id}`,
          warehouse_id: primary.id,
          warehouse_name: primary.name,
          product_id: p.id,
          product_name: p.name,
          qty: num(p.stock),
          batch_number: null,
          expiry_date: p.expiry_date || null,
          cost: num(p.cost),
          value: num(p.stock) * num(p.cost),
        });
      }
      return rows;
    }

    case "inventory.getMovementChart": {
      const days = Math.min(90, num(params.days, 30));
      const since = new Date();
      since.setDate(since.getDate() - days);
      let q = admin
        .from("stock_movements")
        .select("type,qty,created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true })
        .limit(2000);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      const buckets = new Map();
      for (let i = 0; i <= days; i += 1) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, in: 0, out: 0, adjust: 0 });
      }
      for (const m of data || []) {
        const key = String(m.created_at || "").slice(0, 10);
        if (!buckets.has(key)) continue;
        const b = buckets.get(key);
        const t = String(m.type || "").toLowerCase();
        const qty = Math.abs(num(m.qty));
        if (t === "in" || t === "transfer_in" || t === "count_in") b.in += qty;
        else if (t === "out" || t === "transfer_out" || t === "count_out") b.out += qty;
        else b.adjust += qty;
      }
      return [...buckets.values()];
    }

    case "inventory.getReports": {
      const products = filterActiveProducts(
        await listScoped(admin, "products", { ...caller, company_id: companyId }, LIST_COLUMNS.products, {
          softCap: DEFAULT_LIST_CAP,
        }).catch(() => [])
      ).map((p) => normalizeProduct(p));
      const movements = await handlePosAction(admin, caller, "inventory.getMovements", { limit: 500 });
      const today = new Date().toISOString().slice(0, 10);
      const deadCutoff = new Date();
      deadCutoff.setDate(deadCutoff.getDate() - 90);
      const movedProductIds = new Set(
        (movements || [])
          .filter((m) => m.created_at && new Date(m.created_at) >= deadCutoff)
          .map((m) => Number(m.product_id))
      );
      const outByProduct = new Map();
      for (const m of movements || []) {
        const t = String(m.type || "").toLowerCase();
        if (t === "out" || t === "transfer_out") {
          outByProduct.set(Number(m.product_id), (outByProduct.get(Number(m.product_id)) || 0) + Math.abs(num(m.qty)));
        }
      }
      const fastMoving = [...outByProduct.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([pid, qty]) => {
          const p = products.find((x) => Number(x.id) === pid);
          return { product_id: pid, product_name: p?.name || `#${pid}`, qty_out: qty, stock: p?.stock || 0 };
        });
      return {
        valuation: products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock: p.stock,
          cost: p.cost,
          price: p.price,
          stock_value: p.stock_value,
        })),
        movements: movements || [],
        dead_stock: products.filter((p) => num(p.stock) > 0 && !movedProductIds.has(Number(p.id))),
        fast_moving: fastMoving,
        expired: products.filter((p) => p.expiry_date && String(p.expiry_date).slice(0, 10) < today && num(p.stock) > 0),
        low_stock: products.filter((p) => num(p.stock) <= num(p.reorder_level)),
        overstock: products.filter((p) => num(p.max_stock) > 0 && num(p.stock) >= num(p.max_stock)),
        adjustments: (movements || []).filter((m) => String(m.type || "").toLowerCase().includes("adjust") || String(m.type || "").toLowerCase().includes("count")),
      };
    }

    case "inventory.getAudit": {
      let q = admin
        .from("audit_log")
        .select("*")
        .in("module", ["inventory", "products", "barcode"])
        .order("created_at", { ascending: false })
        .limit(Math.min(200, num(params.limit, 80)));
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return data || [];
    }

    case "inventory.transferStock": {
      const productId = Number(params.product_id);
      const qty = Math.abs(num(params.qty));
      const fromWh = Number(params.from_warehouse_id) || null;
      const toWh = Number(params.to_warehouse_id) || null;
      if (!productId || !qty) return { success: false, error: "Product and quantity are required." };
      if (fromWh && toWh && fromWh === toWh) return { success: false, error: "Source and destination warehouses must differ." };

      let pq = admin.from("products").select("*").eq("id", productId);
      pq = companyFilter(pq, companyId, platform);
      const { data: product, error } = await pq.maybeSingle();
      if (error) throw error;
      if (!product) return { success: false, error: "Product not found." };
      if (num(product.stock) < qty) return { success: false, error: "Insufficient stock to transfer." };

      const transferPayload = {
        company_id: companyId,
        product_id: productId,
        from_branch_id: params.from_branch_id || null,
        to_branch_id: params.to_branch_id || null,
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        qty,
        note: params.note || "Warehouse transfer",
        status: "completed",
        created_by: caller.id || null,
        batch_number: params.batch_number || null,
        expiry_date: params.expiry_date || null,
      };
      let transfer;
      {
        let { data, error: tErr } = await admin.from("stock_transfers").insert(transferPayload).select("*").single();
        if (tErr && isMissingColumnError(tErr)) {
          const slim = {
            company_id: companyId,
            product_id: productId,
            from_branch_id: params.from_branch_id || null,
            to_branch_id: params.to_branch_id || null,
            qty,
            note: params.note || "Warehouse transfer",
          };
          ({ data, error: tErr } = await admin.from("stock_transfers").insert(slim).select("*").single());
        }
        if (tErr) throw tErr;
        transfer = data;
      }

      // Scalar stock unchanged for same-company warehouse transfer (PARTIAL warehouse balances).
      // Record paired movements for audit trail only.
      if (companyId != null) {
        await quietSb(
          admin.from("stock_movements").insert([
            {
              company_id: companyId,
              product_id: productId,
              warehouse_id: fromWh,
              type: "transfer_out",
              qty,
              note: params.note || `Transfer to WH ${toWh || params.to_branch_id}`,
              user_id: caller.id,
              user_name: caller.name,
              batch_number: params.batch_number || null,
              expiry_date: params.expiry_date || null,
              reference_type: "transfer",
              reference_id: transfer.id,
            },
            {
              company_id: companyId,
              product_id: productId,
              warehouse_id: toWh,
              type: "transfer_in",
              qty,
              note: params.note || `Transfer from WH ${fromWh || params.from_branch_id}`,
              user_id: caller.id,
              user_name: caller.name,
              batch_number: params.batch_number || null,
              expiry_date: params.expiry_date || null,
              reference_type: "transfer",
              reference_id: transfer.id,
            },
          ])
        );
      }

      await writeAudit(admin, {
        companyId,
        caller,
        action: "stock_transfer",
        module: "inventory",
        details: { id: transfer.id, product_id: productId, qty, from_warehouse_id: fromWh, to_warehouse_id: toWh },
      });
      return { success: true, transfer };
    }

    case "inventory.stockIn":
    case "inventory.stockOut":
    case "inventory.adjust": {
      const productId = Number(params.product_id);
      const qty = num(params.qty);
      if (!productId || !qty) return { success: false, error: "Product and quantity are required." };
      let pq = admin.from("products").select("*").eq("id", productId);
      pq = companyFilter(pq, companyId, platform);
      const { data: product, error } = await pq.maybeSingle();
      if (error) throw error;
      if (!product) return { success: false, error: "Product not found." };

      const delta =
        action === "inventory.stockOut"
          ? -Math.abs(qty)
          : action === "inventory.adjust"
            ? qty
            : Math.abs(qty);
      if (delta < 0 && num(product.stock) + delta < 0) {
        return { success: false, error: "Insufficient stock." };
      }
      const type =
        action === "inventory.stockIn" ? "in" : action === "inventory.stockOut" ? "out" : "adjust";
      const normalized = await applyProductStockDelta(admin, {
        companyId,
        caller,
        product,
        delta,
        note: params.note || action,
        type,
        warehouse_id: params.warehouse_id || null,
        batch_number: params.batch_number || null,
        expiry_date: params.expiry_date || null,
        variant_id: params.variant_id || null,
        reference_type: type,
        reference_id: null,
      });
      await writeAudit(admin, {
        companyId,
        caller,
        action: type === "in" ? "stock_in" : type === "out" ? "stock_out" : "stock_adjust",
        module: "inventory",
        details: { product_id: productId, qty: delta, warehouse_id: params.warehouse_id || null },
      });
      return { success: true, product: normalized };
    }

    case "inventory.createCount": {
      const lines = Array.isArray(params.lines) ? params.lines : [];
      if (!lines.length) return { success: false, error: "Count lines are required." };
      const payload = {
        company_id: companyId,
        warehouse_id: params.warehouse_id || null,
        branch_id: params.branch_id || caller.branch_id || null,
        status: "draft",
        notes: params.notes || null,
        counted_at: new Date().toISOString(),
        created_by: caller.id || null,
      };
      let { data: count, error } = await admin.from("stock_counts").insert(payload).select("*").single();
      if (error) {
        if (isMissingTableError(error)) {
          return { success: false, error: "Stock counts table not migrated yet. Apply migration 017." };
        }
        throw error;
      }
      const lineRows = lines.slice(0, 500).map((l) => ({
        count_id: count.id,
        product_id: Number(l.product_id),
        system_qty: num(l.system_qty),
        counted_qty: num(l.counted_qty),
        note: l.note || null,
      }));
      const { error: lineErr } = await admin.from("stock_count_lines").insert(lineRows);
      if (lineErr) throw lineErr;
      return { success: true, count };
    }

    case "inventory.postCount": {
      const countId = Number(params.id);
      if (!countId) return { success: false, error: "Count id is required." };
      let cq = admin.from("stock_counts").select("*").eq("id", countId);
      cq = companyFilter(cq, companyId, platform);
      const { data: count, error } = await cq.maybeSingle();
      if (error) {
        if (isMissingTableError(error)) return { success: false, error: "Stock counts not available." };
        throw error;
      }
      if (!count) return { success: false, error: "Count not found." };
      if (count.status === "posted") return { success: false, error: "Count already posted." };

      const { data: lines, error: lineErr } = await admin.from("stock_count_lines").select("*").eq("count_id", countId);
      if (lineErr) throw lineErr;
      for (const line of lines || []) {
        const variance = num(line.counted_qty) - num(line.system_qty);
        if (!variance) continue;
        let pq = admin.from("products").select("*").eq("id", line.product_id);
        pq = companyFilter(pq, companyId, platform);
        const { data: product } = await pq.maybeSingle();
        if (!product) continue;
        await applyProductStockDelta(admin, {
          companyId,
          caller,
          product,
          delta: variance,
          note: `Physical count #${countId}${line.note ? ` — ${line.note}` : ""}`,
          type: "count",
          warehouse_id: count.warehouse_id || null,
          reference_type: "count",
          reference_id: countId,
        });
      }
      await admin
        .from("stock_counts")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", countId);
      await writeAudit(admin, {
        companyId,
        caller,
        action: "post_stock_count",
        module: "inventory",
        details: { id: countId, lines: (lines || []).length },
      });
      return { success: true };
    }

    case "inventory.getCounts": {
      let q = admin
        .from("stock_counts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      q = companyFilter(q, companyId, platform);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return data || [];
    }

    case "inventory.getCount": {
      const id = Number(params.id);
      let cq = admin.from("stock_counts").select("*").eq("id", id);
      cq = companyFilter(cq, companyId, platform);
      const { data: count, error } = await cq.maybeSingle();
      if (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
      if (!count) return null;
      const { data: lines } = await admin.from("stock_count_lines").select("*").eq("count_id", id);
      return { ...count, lines: lines || [] };
    }

    case "brands.getAll":
      return listScoped(admin, "brands", { ...caller, company_id: companyId }, LIST_COLUMNS.brands, {
        softCap: 500,
      }).catch(() => []);

    case "brands.create": {
      const { data, error } = await admin
        .from("brands")
        .insert({ company_id: companyId, name: String(params.name || "").trim(), active: params.active !== false })
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error)) return { success: false, error: "Brands table not migrated yet." };
        throw error;
      }
      return { success: true, brand: data };
    }

    case "brands.update": {
      const { data, error } = await admin
        .from("brands")
        .update({ name: params.name, active: params.active })
        .eq("id", params.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return { success: true, brand: data };
    }

    case "brands.delete": {
      const { error } = await admin.from("brands").delete().eq("id", params.id);
      if (error) throw error;
      return { success: true };
    }

    case "units.getAll":
      return listScoped(admin, "units", { ...caller, company_id: companyId }, LIST_COLUMNS.units, {
        softCap: 500,
      }).catch(() => []);

    case "units.create": {
      const { data, error } = await admin
        .from("units")
        .insert({
          company_id: companyId,
          name: String(params.name || "").trim(),
          abbreviation: String(params.abbreviation || "u").trim(),
          active: params.active !== false,
        })
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error)) return { success: false, error: "Units table not migrated yet." };
        throw error;
      }
      return { success: true, unit: data };
    }

    case "units.update": {
      const { data, error } = await admin
        .from("units")
        .update({ name: params.name, abbreviation: params.abbreviation, active: params.active })
        .eq("id", params.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return { success: true, unit: data };
    }

    case "units.delete": {
      const { error } = await admin.from("units").delete().eq("id", params.id);
      if (error) throw error;
      return { success: true };
    }

    case "warehouses.getAll":
      return listScoped(admin, "warehouses", { ...caller, company_id: companyId }, LIST_COLUMNS.warehouses, {
        softCap: 200,
      }).catch(() => []);

    case "warehouses.create": {
      const { data, error } = await admin
        .from("warehouses")
        .insert({
          company_id: companyId,
          branch_id: params.branch_id || caller.branch_id,
          name: String(params.name || "").trim(),
          code: params.code || null,
          address: params.address || "",
          active: params.active !== false,
        })
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error)) return { success: false, error: "Warehouses table not migrated yet." };
        throw error;
      }
      return { success: true, warehouse: data };
    }

    case "warehouses.update": {
      const updates = { ...params };
      delete updates.id;
      const { data, error } = await admin.from("warehouses").update(updates).eq("id", params.id).select("*").maybeSingle();
      if (error) throw error;
      return { success: true, warehouse: data };
    }

    case "warehouses.delete": {
      const { error } = await admin.from("warehouses").delete().eq("id", params.id);
      if (error) throw error;
      return { success: true };
    }

    case "currency.list": {
      const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
      const settings = await loadCompanySettingsMap(admin, companyId);
      return {
        currencies: rows,
        settings: {
          enable_multi_currency: settings.enable_multi_currency ?? "true",
          admin_can_edit_rates: settings.admin_can_edit_rates ?? "false",
          report_currency: settings.report_currency || settings.currency || "KES",
          base_currency_code: settings.base_currency_code || settings.currency || "KES",
        },
      };
    }

    case "currency.getActive": {
      const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
      return rows.filter((r) => r.is_active !== false);
    }

    case "currency.getHistory": {
      if (!isAdminLikeRole(caller.role)) {
        return { success: false, error: "Only Owner/Admin can view currency history.", code: "FORBIDDEN" };
      }
      const code = params.code ? normalizeCode(params.code) : null;
      let q = admin
        .from("currency_rate_history")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(Math.min(500, Number(params.limit) || 100));
      if (code) q = q.eq("currency_code", code);
      const { data, error } = await q;
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return data || [];
    }

    case "currency.create": {
      if (!isAdminLikeRole(caller.role)) {
        return { success: false, error: "Only Owner/Admin can add currencies.", code: "FORBIDDEN" };
      }
      const code = normalizeCode(params.code);
      if (!code) return { success: false, error: "Currency code is required." };
      const catalog = catalogEntry(code);
      const row = {
        company_id: companyId,
        code,
        name: String(params.name || catalog.name).trim(),
        symbol: String(params.symbol || catalog.symbol).trim(),
        decimal_places: params.decimal_places != null ? Number(params.decimal_places) : catalog.decimals,
        is_active: params.is_active !== false && params.is_active !== "false",
        is_base: false,
        is_default: false,
        exchange_rate_to_base: toNumber(params.exchange_rate_to_base, 1) || 1,
        auto_update_enabled: params.auto_update_enabled === true || params.auto_update_enabled === "true",
        updated_at: new Date().toISOString(),
      };
      await ensureCompanyCurrenciesSeeded(admin, companyId);
      const { data, error } = await admin.from("company_currencies").insert(row).select("*").single();
      if (error) {
        if (error.code === "23505") return { success: false, error: "Currency already exists for this company." };
        if (isMissingTableError(error)) return { success: false, error: "Currency tables not migrated yet." };
        throw error;
      }
      await writeRateHistory(admin, {
        companyId,
        caller,
        currencyCode: code,
        oldRate: null,
        newRate: row.exchange_rate_to_base,
        reason: params.reason || "Currency created",
        ip: params.ip,
      });
      await writeAudit(admin, {
        companyId,
        caller,
        action: "currency_create",
        module: "currencies",
        details: { code, name: row.name, rate: row.exchange_rate_to_base },
      });
      return { success: true, currency: data };
    }

    case "currency.update": {
      if (!isAdminLikeRole(caller.role)) {
        return { success: false, error: "Only Owner/Admin can edit currencies.", code: "FORBIDDEN" };
      }
      const id = Number(params.id);
      if (!id) return { success: false, error: "Currency id is required." };
      const { data: existing } = await admin
        .from("company_currencies")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!existing) return { success: false, error: "Currency not found." };

      const updates = {};
      if (params.name != null) updates.name = String(params.name).trim();
      if (params.symbol != null) updates.symbol = String(params.symbol).trim();
      if (params.decimal_places != null) updates.decimal_places = Number(params.decimal_places);
      if (params.auto_update_enabled != null) {
        updates.auto_update_enabled =
          params.auto_update_enabled === true || params.auto_update_enabled === "true";
      }

      const rateChanging = params.exchange_rate_to_base != null
        && toNumber(params.exchange_rate_to_base) !== toNumber(existing.exchange_rate_to_base);
      if (rateChanging) {
        const settings = await loadCompanySettingsMap(admin, companyId);
        const adminAllowed =
          settings.admin_can_edit_rates === true || settings.admin_can_edit_rates === "true";
        if (!isOwnerLikeRole(caller.role) && !adminAllowed) {
          return {
            success: false,
            error: "Owner has not allowed Admins to edit exchange rates.",
            code: "FORBIDDEN",
          };
        }
        if (existing.is_base) {
          updates.exchange_rate_to_base = 1;
        } else {
          updates.exchange_rate_to_base = toNumber(params.exchange_rate_to_base, 1) || 1;
        }
      }

      // Activate/deactivate — deactivate is Owner-only
      if (params.is_active != null) {
        const nextActive = params.is_active === true || params.is_active === "true";
        if (!nextActive && existing.is_base) {
          return { success: false, error: "Cannot deactivate the base currency." };
        }
        if (!nextActive && !isOwnerLikeRole(caller.role)) {
          return { success: false, error: "Only Owner can deactivate currencies.", code: "FORBIDDEN" };
        }
        updates.is_active = nextActive;
      }

      updates.updated_at = new Date().toISOString();
      const { data, error } = await admin
        .from("company_currencies")
        .update(updates)
        .eq("id", id)
        .eq("company_id", companyId)
        .select("*")
        .maybeSingle();
      if (error) throw error;

      if (rateChanging && !existing.is_base) {
        await writeRateHistory(admin, {
          companyId,
          caller,
          currencyCode: existing.code,
          oldRate: existing.exchange_rate_to_base,
          newRate: updates.exchange_rate_to_base,
          reason: params.reason || "Manual rate update",
          ip: params.ip,
        });
      }
      await writeAudit(admin, {
        companyId,
        caller,
        action: "currency_update",
        module: "currencies",
        details: { id, code: existing.code, updates },
      });
      return { success: true, currency: data };
    }

    case "currency.setBase": {
      if (!isOwnerLikeRole(caller.role)) {
        return { success: false, error: "Only Owner can set the base currency.", code: "FORBIDDEN" };
      }
      const code = normalizeCode(params.code);
      const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
      const target = rows.find((r) => normalizeCode(r.code) === code);
      if (!target) return { success: false, error: "Currency not found. Add it first." };
      if (!target.is_active) return { success: false, error: "Activate the currency before setting it as base." };

      // Clear existing base, set new base with rate 1
      await admin
        .from("company_currencies")
        .update({ is_base: false, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("is_base", true);
      const { data, error } = await admin
        .from("company_currencies")
        .update({
          is_base: true,
          is_active: true,
          exchange_rate_to_base: 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;

      const catalog = catalogEntry(code);
      await mergeCompanySettings(admin, companyId, {
        currency: code,
        currency_symbol: catalog.symbol,
        base_currency_code: code,
      });
      await quietSb(admin.from("companies").update({ currency: code }).eq("id", companyId));

      await writeAudit(admin, {
        companyId,
        caller,
        action: "currency_set_base",
        module: "currencies",
        details: { code },
      });
      return { success: true, currency: data };
    }

    case "currency.setDefault": {
      if (!isAdminLikeRole(caller.role)) {
        return { success: false, error: "Only Owner/Admin can set the default currency.", code: "FORBIDDEN" };
      }
      const code = normalizeCode(params.code);
      const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
      const target = rows.find((r) => normalizeCode(r.code) === code);
      if (!target) return { success: false, error: "Currency not found." };
      if (!target.is_active) return { success: false, error: "Activate the currency before setting it as default." };

      await admin
        .from("company_currencies")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("is_default", true);
      const { data, error } = await admin
        .from("company_currencies")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq("id", target.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      await writeAudit(admin, {
        companyId,
        caller,
        action: "currency_set_default",
        module: "currencies",
        details: { code },
      });
      return { success: true, currency: data };
    }

    case "currency.updateRate": {
      if (!isAdminLikeRole(caller.role)) {
        return { success: false, error: "Only Owner/Admin can update rates.", code: "FORBIDDEN" };
      }
      const settings = await loadCompanySettingsMap(admin, companyId);
      const adminAllowed =
        settings.admin_can_edit_rates === true || settings.admin_can_edit_rates === "true";
      if (!isOwnerLikeRole(caller.role) && !adminAllowed) {
        return {
          success: false,
          error: "Owner has not allowed Admins to edit exchange rates.",
          code: "FORBIDDEN",
        };
      }
      const code = normalizeCode(params.code);
      const newRate = toNumber(params.exchange_rate_to_base ?? params.rate, NaN);
      if (!Number.isFinite(newRate) || newRate <= 0) {
        return { success: false, error: "A positive exchange rate is required." };
      }
      const rows = await ensureCompanyCurrenciesSeeded(admin, companyId);
      const target = rows.find((r) => normalizeCode(r.code) === code);
      if (!target) return { success: false, error: "Currency not found." };
      if (target.is_base) return { success: false, error: "Base currency rate is always 1." };

      const { data, error } = await admin
        .from("company_currencies")
        .update({
          exchange_rate_to_base: newRate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;

      await writeRateHistory(admin, {
        companyId,
        caller,
        currencyCode: code,
        oldRate: target.exchange_rate_to_base,
        newRate,
        reason: params.reason || "Manual rate update",
        ip: params.ip,
      });
      return { success: true, currency: data };
    }

    case "currency.setPolicy": {
      if (!isOwnerLikeRole(caller.role)) {
        return { success: false, error: "Only Owner can change currency policy settings.", code: "FORBIDDEN" };
      }
      const patch = {};
      if (params.enable_multi_currency != null) {
        patch.enable_multi_currency =
          params.enable_multi_currency === true || params.enable_multi_currency === "true" ? "true" : "false";
      }
      if (params.admin_can_edit_rates != null) {
        patch.admin_can_edit_rates =
          params.admin_can_edit_rates === true || params.admin_can_edit_rates === "true" ? "true" : "false";
      }
      if (params.report_currency != null) {
        patch.report_currency = normalizeCode(params.report_currency);
      }
      if (params.auto_update_enabled != null && params.code) {
        await admin
          .from("company_currencies")
          .update({
            auto_update_enabled:
              params.auto_update_enabled === true || params.auto_update_enabled === "true",
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", companyId)
          .eq("code", normalizeCode(params.code));
      }
      const settings = await mergeCompanySettings(admin, companyId, patch);
      await writeAudit(admin, {
        companyId,
        caller,
        action: "currency_policy_update",
        module: "currencies",
        details: patch,
      });
      return { success: true, settings };
    }

    case "settings.getAll": {
      const { data, error } = await admin
        .from("company_settings")
        .select("settings")
        .eq("company_id", companyId)
        .maybeSingle();
      if (!error && data?.settings) return data.settings;
      const { data: legacy, error: legacyError } = await admin.from("settings").select("key,value");
      if (legacyError && !isMissingTableError(legacyError)) throw legacyError;
      const map = {};
      (legacy || []).forEach((row) => {
        map[row.key] = row.value;
      });
      return map;
    }

    case "settings.getPublic": {
      const all = await handlePosAction(admin, caller, "settings.getAll", params);
      let activeCurrencies = [];
      try {
        activeCurrencies = await handlePosAction(admin, caller, "currency.getActive", params);
      } catch {
        activeCurrencies = [];
      }
      return {
        store_name: all.store_name || "Nexora POS Enterprise",
        currency: all.currency || all.base_currency_code || "KES",
        currency_symbol: all.currency_symbol || "Ksh",
        enable_multi_currency: all.enable_multi_currency ?? "true",
        admin_can_edit_rates: all.admin_can_edit_rates ?? "false",
        report_currency: all.report_currency || all.currency || "KES",
        base_currency_code: all.base_currency_code || all.currency || "KES",
        active_currencies: Array.isArray(activeCurrencies) ? activeCurrencies : [],
      };
    }

    case "settings.update": {
      const { data: existing } = await admin
        .from("company_settings")
        .select("settings")
        .eq("company_id", companyId)
        .maybeSingle();
      const next = { ...(existing?.settings || {}), ...(params || {}) };
      const { error } = await admin
        .from("company_settings")
        .upsert({ company_id: companyId, settings: next, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
      if (error && isMissingTableError(error)) {
        for (const [key, value] of Object.entries(params || {})) {
          await admin.from("settings").upsert({ key, value: String(value) }, { onConflict: "key" });
        }
        return { success: true };
      }
      if (error) throw error;
      return { success: true, settings: next };
    }

    case "settings.getPrinters":
      return [];

    case "reports.getSalesReport": {
      const sales = await handlePosAction(admin, caller, "sales.getRecent", { limit: 500 });
      return {
        rows: sales,
        totals: { total: sales.reduce((s, row) => s + num(row.total), 0) },
      };
    }

    case "reports.getInventoryReport": {
      const products = await handlePosAction(admin, caller, "products.getAll", params);
      const rows = products.map((p) => ({ ...p, stock_value: num(p.stock) * num(p.cost) }));
      return { rows, totalValue: rows.reduce((s, r) => s + r.stock_value, 0) };
    }

    case "reports.getLowStockReport":
      return handlePosAction(admin, caller, "inventory.getLowStock", params);

    case "reports.getCustomerReport":
      return handlePosAction(admin, caller, "customers.getAll", params);

    case "reports.getSupplierReport":
      return handlePosAction(admin, caller, "suppliers.getAll", params);

    case "reports.getExpenseReport": {
      const rows = await handlePosAction(admin, caller, "expenses.getAll", params);
      return { rows, total: rows.reduce((s, r) => s + num(r.amount), 0) };
    }

    case "reports.getPurchaseReport": {
      const rows = await handlePosAction(admin, caller, "purchases.getAll", params);
      return { rows, total: rows.reduce((s, r) => s + num(r.total), 0) };
    }

    case "reports.getProfitSummary":
    case "reports.getProfitLoss": {
      const sales = await handlePosAction(admin, caller, "sales.getRecent", { limit: 1000 });
      const expenses = await handlePosAction(admin, caller, "expenses.getAll", params);
      const revenue = sales.reduce((s, r) => s + num(r.total), 0);
      const expenseTotal = expenses.reduce((s, r) => s + num(r.amount), 0);
      return { revenue, expenses: expenseTotal, profit: revenue - expenseTotal };
    }

    case "reports.getRevenueVsExpenses": {
      const summary = await handlePosAction(admin, caller, "reports.getProfitSummary", params);
      return [
        {
          month: new Date().toISOString().slice(0, 7),
          revenue: summary.revenue,
          expenses: summary.expenses,
        },
      ];
    }

    case "reports.getTopProducts": {
      const products = await handlePosAction(admin, caller, "products.getAll", params);
      return products.slice(0, num(params.limit, 5)).map((p) => ({
        name: p.name,
        revenue: num(p.price) * 40,
        units: 40,
      }));
    }

    case "reports.getCategorySales": {
      const categories = await handlePosAction(admin, caller, "categories.getAll", params);
      return categories.map((c) => ({ name: c.name, value: 15000 + Number(c.id || 0) * 5000 }));
    }

    case "reports.getAnalytics": {
      const start = params.start_date ? String(params.start_date).slice(0, 10) : null;
      const end = params.end_date ? String(params.end_date).slice(0, 10) : null;
      // Pad range slightly so dashboard "this_week" cards still get month context when needed
      const salesStart = start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const salesEnd = end || new Date().toISOString().slice(0, 10);

      let salesQ = admin
        .from("sales")
        .select(LIST_COLUMNS.sales)
        .gte("created_at", `${salesStart}T00:00:00`)
        .lte("created_at", `${salesEnd}T23:59:59.999`)
        .order("created_at", { ascending: false })
        .limit(DEFAULT_LIST_CAP);
      salesQ = companyFilter(salesQ, companyId, platform);

      let expensesQ = admin
        .from("expenses")
        .select(LIST_COLUMNS.expenses)
        .gte("expense_date", salesStart)
        .lte("expense_date", salesEnd)
        .limit(DEFAULT_LIST_CAP);
      expensesQ = companyFilter(expensesQ, companyId, platform);

      const [salesRes, products, categories, expensesRes, branches] = await Promise.all([
        Promise.resolve(salesQ).catch(() => ({ data: [] })),
        listScoped(admin, "products", { ...caller, company_id: companyId }, "id,name,sku,category_id,price,cost,stock,reorder_level", {
          softCap: DEFAULT_LIST_CAP,
        }).catch(() => []),
        listScoped(admin, "categories", { ...caller, company_id: companyId }, LIST_COLUMNS.categories, {
          softCap: 500,
        }).catch(() => []),
        Promise.resolve(expensesQ).catch(() => ({ data: [] })),
        listScoped(admin, "branches", { ...caller, company_id: companyId }, LIST_COLUMNS.branches, {
          softCap: 200,
        }).catch(() => []),
      ]);

      const sales = salesRes?.data || [];
      const expenses = expensesRes?.data || [];
      const saleIds = sales.map((s) => Number(s.id)).filter(Boolean);
      let scopedItems = [];
      if (saleIds.length) {
        // Batch in chunks of 200 to stay within PostgREST URL limits
        const chunks = [];
        for (let i = 0; i < saleIds.length; i += 200) chunks.push(saleIds.slice(i, i + 200));
        const itemBatches = await Promise.all(
          chunks.map((ids) =>
            admin.from("sale_items").select(LIST_COLUMNS.sale_items).in("sale_id", ids).then((r) => r.data || [])
          )
        );
        scopedItems = itemBatches.flat();
      }

      return buildReportAnalytics(
        {
          sales,
          saleItems: scopedItems,
          products: products || [],
          categories: categories || [],
          expenses: expenses || [],
          branches: branches || [],
          users: [],
        },
        params || {}
      );
    }

    case "reports.getUserSales":
      return { rows: [], range: params };

    case "backup.export": {
      if (!["platform_owner", "owner", "super_admin", "admin"].includes(normalizeRole(caller.role))) {
        return { success: false, error: "Only Owner/Admin can export company backups.", code: "FORBIDDEN" };
      }
      const tables = [
        "products",
        "categories",
        "customers",
        "suppliers",
        "purchases",
        "purchase_items",
        "sales",
        "sale_items",
        "expenses",
        "branches",
        "brands",
        "units",
        "warehouses",
      ];
      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        company_id: companyId,
        tables: {},
      };
      const tableRows = await Promise.all(
        tables.map(async (table) => [
          table,
          await listScoped(admin, table, { ...caller, company_id: companyId }, "*", {
            softCap: DEFAULT_LIST_CAP,
            unlimited: true,
          }).catch(() => []),
        ])
      );
      for (const [table, rows] of tableRows) payload.tables[table] = rows;
      const settings = await handlePosAction(admin, caller, "settings.getAll", {}).catch(() => ({}));
      payload.tables.settings = settings;
      return {
        success: true,
        fileName: `nexora-backup-co${companyId || "x"}-${Date.now()}.json`,
        filePath: `download:nexora-backup-co${companyId || "x"}-${Date.now()}.json`,
        payload,
      };
    }

    case "backup.getHistory":
      return [];

    case "backup.restore":
      return {
        success: false,
        error: "Full restore is managed via Supabase backups. Use export for local archives.",
        code: "RESTORE_MANAGED",
      };

    case "backup.runNow":
      return handlePosAction(admin, caller, "backup.export", params);

    case "notifications.list": {
      const items = [];
      const [products, purchases, subResult, authLogs] = await Promise.all([
        listScoped(
          admin,
          "products",
          { ...caller, company_id: companyId },
          "id,name,stock,reorder_level",
          { softCap: DEFAULT_LIST_CAP }
        ).catch(() => []),
        listScoped(
          admin,
          "purchases",
          { ...caller, company_id: companyId },
          "id,po_number,status,total,balance,amount_due,due_date,payment_due_date,updated_at,created_at",
          { softCap: 500, orderBy: "created_at", ascending: false }
        ).catch(() => []),
        handlePosAction(admin, caller, "subscription.get", {}).catch(() => null),
        handlePosAction(admin, caller, "audit.getLoginHistory", {}).catch(() => []),
      ]);

      const low = (products || []).filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.reorder_level || 0));
      for (const p of low.slice(0, 8)) {
        items.push({
          id: `low-${p.id}`,
          type: "low_stock",
          title: "Low stock",
          body: `${p.name} — ${p.stock} left (reorder ${p.reorder_level || 0})`,
          created_at: new Date().toISOString(),
          href: "/inventory",
        });
      }

      const out = (products || []).filter((p) => Number(p.stock) <= 0);
      for (const p of out.slice(0, 5)) {
        items.push({
          id: `out-${p.id}`,
          type: "out_of_stock",
          title: "Out of stock",
          body: `${p.name} is out of stock`,
          created_at: new Date().toISOString(),
          href: "/inventory?tab=alerts",
        });
      }

      try {
        const fullProducts = await listScoped(
          admin,
          "products",
          { ...caller, company_id: companyId },
          "id,name,stock,max_stock,expiry_date,archived_at,deleted_at",
          { softCap: DEFAULT_LIST_CAP }
        ).catch(() => []);
        const active = filterActiveProducts(fullProducts);
        const over = active.filter((p) => Number(p.max_stock) > 0 && Number(p.stock) >= Number(p.max_stock));
        for (const p of over.slice(0, 4)) {
          items.push({
            id: `over-${p.id}`,
            type: "overstock",
            title: "Overstock",
            body: `${p.name} — ${p.stock} (max ${p.max_stock})`,
            created_at: new Date().toISOString(),
            href: "/inventory?tab=alerts",
          });
        }
        const today = new Date().toISOString().slice(0, 10);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + 14);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const expiring = active.filter(
          (p) => p.expiry_date && Number(p.stock) > 0 && String(p.expiry_date).slice(0, 10) <= cutoffStr
        );
        for (const p of expiring.slice(0, 5)) {
          const exp = String(p.expiry_date).slice(0, 10);
          items.push({
            id: `exp-${p.id}`,
            type: exp < today ? "expired" : "expiring",
            title: exp < today ? "Expired stock" : "Expiring soon",
            body: `${p.name} — expires ${exp}`,
            created_at: new Date().toISOString(),
            href: "/inventory?tab=alerts",
          });
        }
      } catch {
        /* optional enrichment */
      }

      const openPurchases = (purchases || []).filter((p) => {
        const status = String(p.status || "").toLowerCase();
        return ["draft", "ordered", "partial", "pending", "partiallyreceived"].includes(status);
      });
      for (const p of openPurchases.slice(0, 5)) {
        items.push({
          id: `po-${p.id}`,
          type: "purchase",
          title: "Open purchase order",
          body: `${p.po_number || `PO-${p.id}`} · ${p.status} · total ${p.total ?? "—"}`,
          created_at: p.updated_at || p.created_at || new Date().toISOString(),
          href: "/purchases",
        });
      }

      const duePurchases = (purchases || []).filter((p) => {
        const due = p.due_date || p.payment_due_date;
        if (!due) return false;
        const days = (new Date(due).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        return days <= 7 && Number(p.balance || p.amount_due || 0) > 0;
      });
      for (const p of duePurchases.slice(0, 5)) {
        items.push({
          id: `due-${p.id}`,
          type: "supplier_due",
          title: "Supplier payment due",
          body: `${p.po_number || `PO-${p.id}`} due ${String(p.due_date || p.payment_due_date).slice(0, 10)}`,
          created_at: new Date().toISOString(),
          href: "/suppliers",
        });
      }

      try {
        const sub = subResult;
        const expires = sub?.expires_at || sub?.renews_at || sub?.renewsAt;
        if (expires) {
          const days = Math.ceil((new Date(expires).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          if (days <= 14) {
            items.push({
              id: "sub-expiry",
              type: "subscription",
              title: days < 0 ? "Subscription expired" : "Subscription expiring soon",
              body: days < 0
                ? `Plan ${sub.plan || sub.plan_code || ""} expired ${Math.abs(days)} day(s) ago.`
                : `Plan ${sub.plan || sub.plan_code || ""} renews in ${days} day(s).`,
              created_at: new Date().toISOString(),
              href: "/subscription",
            });
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const failed = (authLogs || []).filter((row) => String(row.action || "").includes("fail")).slice(0, 5);
        for (const row of failed) {
          items.push({
            id: `auth-${row.id}`,
            type: "login_failed",
            title: "Failed login",
            body: `${row.user_name || "Unknown"} · ${row.details || row.action}`,
            created_at: row.created_at || new Date().toISOString(),
            href: "/audit",
          });
        }
      } catch {
        /* ignore */
      }

      items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { success: true, items: items.slice(0, 40), unread: items.length };
    }

    case "audit.getAll": {
      const limit = Math.min(500, num(params.limit, 100));
      let q = admin
        .from("audit_log")
        .select(LIST_COLUMNS.audit_log)
        .order("created_at", { ascending: false })
        .limit(limit);
      q = companyFilter(q, companyId, platform);
      if (params.module) q = q.eq("module", params.module);
      let { data, error } = await q;
      if (error && isMissingColumnError(error)) {
        let q2 = admin.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
        q2 = companyFilter(q2, companyId, platform);
        if (params.module) q2 = q2.eq("module", params.module);
        ({ data, error } = await q2);
      }
      if (error) throw error;
      return data || [];
    }

    case "audit.getLoginHistory":
      return handlePosAction(admin, caller, "audit.getAll", { module: "auth" });

    case "permissions.getMine":
    case "permissions.getMatrix": {
      if (companyId == null || companyId === "") {
        return {};
      }
      const { data, error } = await admin
        .from("company_settings")
        .select("permission_matrix")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error && !isMissingTableError(error)) throw error;
      return data?.permission_matrix || {};
    }

    case "permissions.saveMatrix": {
      if (companyId == null || companyId === "") {
        return { success: false, error: "Company context required.", code: "NO_COMPANY" };
      }
      if (String(caller.role || "") === "cashier" || String(caller.role || "") === "sales") {
        return { success: false, error: "Insufficient permissions to edit roles.", code: "FORBIDDEN" };
      }
      const { data: existing } = await admin
        .from("company_settings")
        .select("settings,permission_matrix")
        .eq("company_id", companyId)
        .maybeSingle();
      const { error } = await admin.from("company_settings").upsert(
        {
          company_id: companyId,
          settings: existing?.settings || {},
          permission_matrix: params.matrix || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" }
      );
      if (error) throw error;
      return { success: true };
    }

    case "subscription.get": {
      const { data, error } = await admin
        .from("company_subscriptions")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error && isMissingTableError(error)) {
        const plan = getPlanByCode("enterprise");
        return {
          plan: plan.name,
          plan_code: plan.code,
          status: "active",
          company_id: companyId,
          limits: plan.limits,
          currency: BILLING_CURRENCY,
        };
      }
      if (error) throw error;
      if (!data) {
        const plan = getPlanByCode("enterprise");
        return { plan_code: plan.code, plan: plan.name, status: "active", company_id: companyId, limits: plan.limits };
      }
      const plan = getPlanByCode(data.plan_code);
      return {
        ...data,
        plan: plan?.name || data.plan_code,
        plan_code: normalizePlanCode(data.plan_code),
        limits: { ...(plan?.limits || {}), ...(data.limits || {}) },
        currency: BILLING_CURRENCY,
      };
    }

    case "subscription.changePlan":
    case "subscription.requestRenewal":
    case "subscription.update": {
      if (!["owner", "platform_owner"].includes(String(caller.role || ""))) {
        return { success: false, error: "Only the Company Owner can change the subscription plan.", code: "FORBIDDEN" };
      }
      if (companyId == null || companyId === "") {
        return { success: false, error: "Company context required.", code: "NO_COMPANY" };
      }
      const requested = normalizePlanCode(params.plan_code || params.plan);
      if (!PAID_PLAN_CODES.includes(requested)) {
        return { success: false, error: "Choose Starter, Business, Professional, or Enterprise." };
      }
      const plan = getPlanByCode(requested);
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      const row = {
        company_id: Number(companyId),
        plan_code: plan.code,
        status: "active",
        billing_cycle: params.billing_cycle || "monthly",
        auto_renewal: params.auto_renewal !== false,
        expires_at: expiresAt,
        limits: plan.limits,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin
        .from("company_subscriptions")
        .upsert(row, { onConflict: "company_id" })
        .select("*")
        .maybeSingle();
      if (error && isMissingTableError(error)) {
        return {
          success: true,
          message: `${plan.name} plan recorded locally. All company data is preserved.`,
          subscription: { ...row, plan: plan.name },
        };
      }
      if (error) throw error;
      try {
        await admin.from("companies").update({ plan_code: plan.code }).eq("id", Number(companyId));
      } catch {
        /* optional column */
      }
      await writeAudit(admin, {
        companyId,
        caller,
        action: "subscription_plan_changed",
        module: "subscription",
        details: { plan_code: plan.code, payment_reference: params.payment_reference || null },
      });
      return {
        success: true,
        message: `${plan.name} plan activated. All company data is preserved.`,
        subscription: { ...(data || row), plan: plan.name, limits: plan.limits },
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}`, code: "UNKNOWN_ACTION" };
  }
}
