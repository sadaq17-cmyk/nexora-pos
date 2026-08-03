/**
 * Enterprise Supplier Management — AP aging, payables, AI insights, purchase requests.
 */
import { normalizeRole } from "./_authHelpers.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function companyFilter(query, companyId) {
  if (companyId == null || companyId === "") return query.eq("company_id", -1);
  return query.eq("company_id", companyId);
}

function daysBetween(fromDate, toDate = new Date()) {
  if (!fromDate) return 0;
  const a = new Date(String(fromDate).slice(0, 10) + "T00:00:00");
  const b = new Date(toDate);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function derivePaymentStatus(purchase, today = new Date()) {
  const balance = num(purchase.balance ?? purchase.amount_due);
  const total = num(purchase.total);
  const paid = num(purchase.amount_paid);
  if (balance <= 0.0001 || (total > 0 && paid >= total - 0.0001)) return "paid";
  const due = purchase.due_date || purchase.payment_due_date;
  if (due) {
    const dueDt = new Date(String(due).slice(0, 10) + "T23:59:59");
    if (dueDt.getTime() < today.getTime() && balance > 0) return "overdue";
  }
  if (paid > 0 && balance > 0) return "partially_paid";
  return "unpaid";
}

async function writeAudit(admin, { companyId, caller, action, module = "suppliers", details = {} }) {
  try {
    await admin.from("audit_log").insert({
      company_id: companyId,
      user_id: caller?.id || null,
      user_name: caller?.name || caller?.username || "",
      action,
      module,
      details,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }
}

async function nextRequestNo(admin, companyId) {
  const year = new Date().getFullYear();
  const prefix = `PR-${year}-`;
  const { data } = await admin
    .from("purchase_requests")
    .select("request_no")
    .eq("company_id", companyId)
    .like("request_no", `${prefix}%`)
    .order("id", { ascending: false })
    .limit(50);
  let max = 0;
  for (const row of data || []) {
    const m = String(row.request_no || "").match(/PR-\d{4}-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function getAging(admin, companyId) {
  let q = admin
    .from("purchases")
    .select("id,supplier_id,po_number,invoice_no,due_date,payment_due_date,balance,amount_paid,total,status,created_at")
    .eq("company_id", companyId)
    .gt("balance", 0)
    .not("status", "in", '("Cancelled","Rejected","Draft")");
  const { data, error } = await q;
  if (error) return { success: false, error: error.message };

  const today = new Date();
  const buckets = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  };
  const bySupplier = new Map();
  const invoices = [];

  for (const p of data || []) {
    const bal = num(p.balance);
    if (bal <= 0) continue;
    const due = p.due_date || p.payment_due_date || p.created_at;
    const overdue = Math.max(0, daysBetween(due, today));
    let bucket = "current";
    if (overdue <= 0) bucket = "current";
    else if (overdue <= 30) bucket = "days_1_30";
    else if (overdue <= 60) bucket = "days_31_60";
    else if (overdue <= 90) bucket = "days_61_90";
    else bucket = "days_90_plus";
    buckets[bucket] += bal;
    const paymentStatus = derivePaymentStatus(p, today);
    invoices.push({
      ...p,
      payment_status: paymentStatus,
      days_overdue: overdue,
      aging_bucket: bucket,
      remaining_balance: bal,
    });
    const sid = Number(p.supplier_id);
    bySupplier.set(sid, (bySupplier.get(sid) || 0) + bal);
  }

  const supplierIds = [...bySupplier.keys()];
  let suppliers = [];
  if (supplierIds.length) {
    const { data: srows } = await admin
      .from("suppliers")
      .select("id,name,code,phone,credit_limit,balance")
      .in("id", supplierIds);
    suppliers = srows || [];
  }

  const topPayables = suppliers
    .map((s) => ({
      ...s,
      outstanding: bySupplier.get(Number(s.id)) || 0,
    }))
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 10);

  return {
    success: true,
    as_of: today.toISOString().slice(0, 10),
    buckets,
    total_payables: Object.values(buckets).reduce((s, v) => s + v, 0),
    overdue_amount: buckets.days_1_30 + buckets.days_31_60 + buckets.days_61_90 + buckets.days_90_plus,
    suppliers_with_balance: bySupplier.size,
    top_payables: topPayables,
    invoices,
  };
}

async function getPayables(admin, companyId, params = {}) {
  let q = admin
    .from("purchases")
    .select("*")
    .eq("company_id", companyId)
    .not("status", "in", '("Cancelled","Rejected","Draft")")
    .order("due_date", { ascending: true });
  if (params.supplier_id) q = q.eq("supplier_id", Number(params.supplier_id));
  if (params.open_only !== false) q = q.gt("balance", 0);
  const { data, error } = await q;
  if (error) return { success: false, error: error.message };
  const today = new Date();
  const invoices = (data || []).map((p) => {
    const due = p.due_date || p.payment_due_date;
    const overdue = due ? Math.max(0, daysBetween(due, today)) : 0;
    return {
      ...p,
      payment_status: derivePaymentStatus(p, today),
      days_overdue: overdue,
      remaining_balance: num(p.balance),
      due_date: due,
    };
  });
  return { success: true, invoices };
}

async function getInsights(admin, companyId) {
  const [{ data: suppliers }, { data: purchases }, { data: products }] = await Promise.all([
    admin.from("suppliers").select("id,name,code,balance,credit_limit,total_ordered,total_paid,delivery_lead_days,status")
      .eq("company_id", companyId),
    admin.from("purchases")
      .select("id,supplier_id,total,status,created_at,ordered_at,received_at,approved_at,balance,amount_paid")
      .eq("company_id", companyId)
      .not("status", "in", '("Cancelled","Rejected")')
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("products")
      .select("id,name,stock,reorder_level,cost,avg_cost")
      .eq("company_id", companyId)
      .limit(500),
  ]);

  const supplierMap = new Map((suppliers || []).map((s) => [Number(s.id), { ...s, pos: [], costs: [], leadDays: [] }]));
  for (const p of purchases || []) {
    const entry = supplierMap.get(Number(p.supplier_id));
    if (!entry) continue;
    entry.pos.push(p);
    entry.costs.push(num(p.total));
    const start = p.ordered_at || p.approved_at || p.created_at;
    const end = p.received_at;
    if (start && end) {
      entry.leadDays.push(Math.max(0, daysBetween(start, new Date(end))));
    } else if (entry.delivery_lead_days) {
      entry.leadDays.push(Number(entry.delivery_lead_days));
    }
  }

  const scored = [...supplierMap.values()]
    .filter((s) => (s.status || "Active") === "Active")
    .map((s) => {
      const avgCost = s.costs.length ? s.costs.reduce((a, b) => a + b, 0) / s.costs.length : null;
      const avgLead = s.leadDays.length ? s.leadDays.reduce((a, b) => a + b, 0) / s.leadDays.length : Number(s.delivery_lead_days) || null;
      const completed = s.pos.filter((p) => ["Received", "PartiallyReceived", "Approved"].includes(String(p.status))).length;
      const reliability = s.pos.length ? completed / s.pos.length : 0;
      const priceTrend = s.costs.length >= 2
        ? (s.costs[0] - s.costs[s.costs.length - 1]) / Math.max(1, s.costs[s.costs.length - 1])
        : 0;
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        balance: num(s.balance),
        credit_limit: num(s.credit_limit),
        order_count: s.pos.length,
        avg_po_value: avgCost,
        avg_delivery_days: avgLead,
        reliability_score: Math.round(reliability * 100),
        price_trend_pct: Math.round(priceTrend * 1000) / 10,
        total_ordered: num(s.total_ordered),
      };
    });

  const byPrice = [...scored].filter((s) => s.avg_po_value != null).sort((a, b) => a.avg_po_value - b.avg_po_value);
  const byDelivery = [...scored].filter((s) => s.avg_delivery_days != null).sort((a, b) => a.avg_delivery_days - b.avg_delivery_days);
  const byReliability = [...scored].sort((a, b) => b.reliability_score - a.reliability_score || b.order_count - a.order_count);

  const lowStock = (products || []).filter((p) => Number(p.stock) <= Number(p.reorder_level || 0));
  const suggestedReorder = lowStock.slice(0, 12).map((p) => {
    const reorder = Number(p.reorder_level || 0);
    const stock = Number(p.stock || 0);
    const suggestedQty = Math.max(reorder * 2 - stock, reorder || 1, 1);
    const suggestedSupplier = byReliability[0] || byPrice[0] || null;
    return {
      product_id: p.id,
      product_name: p.name,
      stock,
      reorder_level: reorder,
      suggested_qty: Math.ceil(suggestedQty),
      unit_cost: num(p.avg_cost != null ? p.avg_cost : p.cost),
      suggested_supplier_id: suggestedSupplier?.id || null,
      suggested_supplier_name: suggestedSupplier?.name || null,
    };
  });

  return {
    success: true,
    best_by_price: byPrice.slice(0, 5),
    best_by_delivery: byDelivery.slice(0, 5),
    most_reliable: byReliability.slice(0, 5),
    price_trends: scored
      .filter((s) => s.order_count >= 2)
      .sort((a, b) => a.price_trend_pct - b.price_trend_pct)
      .slice(0, 8),
    suggested_reorder: suggestedReorder,
    suggested_supplier: byReliability[0] || byPrice[0] || null,
    summary: {
      supplier_count: scored.length,
      low_stock_count: lowStock.length,
    },
  };
}

async function enhanceDashboard(admin, companyId, base = {}) {
  const aging = await getAging(admin, companyId);
  const insights = await getInsights(admin, companyId);
  return {
    ...base,
    success: true,
    total_suppliers: base.total_suppliers,
    outstanding_payables: aging.success ? aging.total_payables : base.outstanding_balance,
    overdue_payables: aging.success ? aging.overdue_amount : 0,
    suppliers_with_balance: aging.success ? aging.suppliers_with_balance : base.outstanding_count,
    top_suppliers: base.top_suppliers || insights.most_reliable?.slice(0, 5) || [],
    aging_buckets: aging.buckets || null,
    insights_preview: {
      best_by_price: insights.best_by_price?.[0] || null,
      most_reliable: insights.most_reliable?.[0] || null,
      suggested_supplier: insights.suggested_supplier || null,
      reorder_alerts: insights.suggested_reorder?.length || 0,
    },
  };
}

async function createPurchaseRequest(admin, caller, companyId, params) {
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) return { success: false, error: "Add at least one line item." };
  const requestNo = params.request_no || (await nextRequestNo(admin, companyId));
  const row = {
    company_id: companyId,
    branch_id: params.branch_id || caller.branch_id || null,
    warehouse_id: params.warehouse_id || null,
    supplier_id: params.supplier_id || null,
    request_no: requestNo,
    status: params.submit ? "Submitted" : "Draft",
    notes: params.notes || "",
    required_date: params.required_date || null,
    requested_by: caller.id || null,
    updated_at: new Date().toISOString(),
  };
  const { data: request, error } = await admin.from("purchase_requests").insert(row).select("*").single();
  if (error) {
    if (/relation .*purchase_requests.* does not exist/i.test(error.message || "")) {
      return { success: false, error: "Apply migration 033 for purchase requests.", code: "SCHEMA" };
    }
    return { success: false, error: error.message };
  }
  const itemRows = items.map((it) => ({
    company_id: companyId,
    request_id: request.id,
    product_id: it.product_id || null,
    description: it.description || it.name || "Item",
    qty: num(it.qty || 1),
    estimated_cost: num(it.estimated_cost ?? it.cost ?? it.price),
  }));
  const { error: itemErr } = await admin.from("purchase_request_items").insert(itemRows);
  if (itemErr) {
    await admin.from("purchase_requests").delete().eq("id", request.id);
    return { success: false, error: itemErr.message };
  }
  await writeAudit(admin, {
    companyId,
    caller,
    action: "purchase_request_create",
    module: "purchases",
    details: { request_id: request.id, request_no: requestNo, status: request.status },
  });
  return { success: true, request, items: itemRows };
}

async function convertRequestToPo(admin, caller, companyId, params, createPurchaseFn) {
  const requestId = Number(params.id || params.request_id);
  let q = admin.from("purchase_requests").select("*").eq("id", requestId);
  q = companyFilter(q, companyId);
  const { data: request } = await q.maybeSingle();
  if (!request) return { success: false, error: "Purchase request not found." };
  if (request.status === "Converted" && request.purchase_id) {
    return { success: true, purchase_id: request.purchase_id, already_converted: true };
  }
  if (!request.supplier_id && !params.supplier_id) {
    return { success: false, error: "Assign a supplier before converting to a Purchase Order." };
  }
  const { data: items } = await admin.from("purchase_request_items").select("*").eq("request_id", request.id);
  if (!items?.length) return { success: false, error: "Request has no lines." };

  const createResult = await createPurchaseFn({
    supplier_id: params.supplier_id || request.supplier_id,
    items: items.map((it) => ({
      product_id: it.product_id,
      qty: it.qty,
      cost: it.estimated_cost,
      discount: 0,
      tax: 0,
    })),
    status: "Pending",
    notes: request.notes ? `From ${request.request_no}: ${request.notes}` : `From ${request.request_no}`,
    branch_id: request.branch_id,
    warehouse_id: request.warehouse_id,
    payment_terms: params.payment_terms,
  });
  if (!createResult?.success && createResult?.id == null) {
    return createResult?.error
      ? createResult
      : { success: false, error: createResult?.error || "Failed to create purchase order." };
  }
  const purchaseId = createResult.id || createResult.purchase?.id;
  await admin
    .from("purchase_requests")
    .update({
      status: "Converted",
      purchase_id: purchaseId,
      supplier_id: params.supplier_id || request.supplier_id,
      approved_by: caller.id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id);
  await writeAudit(admin, {
    companyId,
    caller,
    action: "purchase_request_convert",
    module: "purchases",
    details: { request_id: request.id, request_no: request.request_no, purchase_id: purchaseId },
  });
  return { success: true, request_id: request.id, purchase_id: purchaseId, purchase: createResult };
}

async function listPurchaseRequests(admin, companyId, params = {}) {
  let q = admin
    .from("purchase_requests")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(Number(params.limit) || 100);
  if (params.status) q = q.eq("status", params.status);
  const { data, error } = await q;
  if (error) {
    if (/relation .*purchase_requests.* does not exist/i.test(error.message || "")) {
      return { success: true, requests: [], warning: "SCHEMA" };
    }
    return { success: false, error: error.message };
  }
  return { success: true, requests: data || [] };
}

export async function buildSupplierNotifications(admin, companyId, existingItems = []) {
  const items = [...existingItems];
  try {
    const aging = await getAging(admin, companyId);
    if (aging.success) {
      for (const inv of (aging.invoices || []).filter((i) => i.payment_status === "overdue").slice(0, 6)) {
        items.push({
          id: `ap-overdue-${inv.id}`,
          type: "supplier_overdue",
          title: "Overdue supplier payment",
          body: `${inv.po_number || inv.invoice_no || `#${inv.id}`} · ${inv.days_overdue}d overdue · bal ${num(inv.balance).toFixed(2)}`,
          created_at: new Date().toISOString(),
          href: "/suppliers",
        });
      }
      for (const inv of (aging.invoices || [])
        .filter((i) => i.payment_status === "unpaid" || i.payment_status === "partially_paid")
        .filter((i) => i.due_date && i.days_overdue === 0)
        .filter((i) => {
          const daysUntil = -daysBetween(i.due_date, new Date());
          return daysUntil >= 0 && daysUntil <= 7;
        })
        .slice(0, 5)) {
        items.push({
          id: `ap-due-${inv.id}`,
          type: "supplier_due",
          title: "Invoice due soon",
          body: `${inv.po_number || inv.invoice_no || `#${inv.id}`} due ${String(inv.due_date).slice(0, 10)}`,
          created_at: new Date().toISOString(),
          href: "/purchases",
        });
      }
    }

    const { data: suppliers } = await admin
      .from("suppliers")
      .select("id,name,balance,credit_limit")
      .eq("company_id", companyId)
      .gt("credit_limit", 0);
    for (const s of (suppliers || []).filter((x) => num(x.balance) >= num(x.credit_limit)).slice(0, 5)) {
      items.push({
        id: `sup-limit-${s.id}`,
        type: "supplier_credit_limit",
        title: "Supplier credit limit reached",
        body: `${s.name} balance ${num(s.balance).toFixed(2)} / limit ${num(s.credit_limit).toFixed(2)}`,
        created_at: new Date().toISOString(),
        href: "/suppliers",
      });
    }

    const insights = await getInsights(admin, companyId);
    for (const row of (insights.suggested_reorder || []).slice(0, 5)) {
      items.push({
        id: `reorder-${row.product_id}`,
        type: "low_stock_reorder",
        title: "Low stock reorder",
        body: `${row.product_name} — suggest qty ${row.suggested_qty}${row.suggested_supplier_name ? ` via ${row.suggested_supplier_name}` : ""}`,
        created_at: new Date().toISOString(),
        href: "/purchases",
      });
    }
  } catch {
    /* non-blocking */
  }
  return items;
}

export async function handleSupplierEnterpriseAction(admin, caller, action, params = {}, helpers = {}) {
  const platform = normalizeRole(caller?.role) === "platform_owner";
  const companyId = platform ? params.company_id ?? caller.company_id : caller.company_id;
  if (companyId == null || companyId === "") {
    return { success: false, error: "Company context required.", code: "NO_COMPANY" };
  }

  switch (action) {
    case "suppliers.getAging":
      return getAging(admin, companyId);
    case "suppliers.getPayables":
      return getPayables(admin, companyId, params);
    case "suppliers.getInsights":
      return getInsights(admin, companyId);
    case "suppliers.getEnterpriseDashboard": {
      const base = typeof helpers.getBaseDashboard === "function"
        ? await helpers.getBaseDashboard()
        : {};
      return enhanceDashboard(admin, companyId, base || {});
    }
    case "purchaseRequests.list":
      return listPurchaseRequests(admin, companyId, params);
    case "purchaseRequests.create":
      return createPurchaseRequest(admin, caller, companyId, params);
    case "purchaseRequests.convert": {
      if (typeof helpers.createPurchase !== "function") {
        return { success: false, error: "Purchase create helper unavailable." };
      }
      return convertRequestToPo(admin, caller, companyId, params, helpers.createPurchase);
    }
    case "purchaseRequests.get": {
      let q = admin.from("purchase_requests").select("*").eq("id", params.id);
      q = companyFilter(q, companyId);
      const { data: request } = await q.maybeSingle();
      if (!request) return { success: false, error: "Request not found." };
      const { data: items } = await admin.from("purchase_request_items").select("*").eq("request_id", request.id);
      return { success: true, request, items: items || [] };
    }
    case "purchaseRequests.updateStatus": {
      const status = String(params.status || "");
      if (!["Draft", "Submitted", "Cancelled", "Rejected"].includes(status)) {
        return { success: false, error: "Invalid status." };
      }
      const { error } = await admin
        .from("purchase_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", params.id)
        .eq("company_id", companyId);
      if (error) return { success: false, error: error.message };
      await writeAudit(admin, {
        companyId,
        caller,
        action: "purchase_request_status",
        module: "purchases",
        details: { id: params.id, status },
      });
      return { success: true, status };
    }
    default:
      return null;
  }
}

export { getAging, getInsights, getPayables, derivePaymentStatus };
