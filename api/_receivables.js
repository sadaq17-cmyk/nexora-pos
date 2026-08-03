/**
 * Customer Credit Invoice / Accounts Receivable data plane.
 * Service-role only; company scoped by caller.
 */
import { normalizeRole } from "./_authHelpers.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function companyFilter(query, companyId, platform) {
  if (companyId == null || companyId === "") {
    return query.eq("company_id", -1);
  }
  return query.eq("company_id", companyId);
}

async function writeAudit(admin, { companyId, caller, action, module = "receivables", details = {} }) {
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

function deriveInvoiceStatus(invoice, today = new Date()) {
  const status = String(invoice.status || "").toLowerCase();
  if (status === "void") return "void";
  const balance = num(invoice.balance);
  const total = num(invoice.total);
  const paid = num(invoice.amount_paid);
  if (balance <= 0.0001 || paid >= total - 0.0001) return "paid";
  const due = invoice.due_date ? new Date(String(invoice.due_date).slice(0, 10) + "T23:59:59") : null;
  if (due && due.getTime() < today.getTime() && balance > 0) return "overdue";
  if (paid > 0 && balance > 0) return "partially_paid";
  return "unpaid";
}

function daysOverdue(dueDate, today = new Date()) {
  if (!dueDate) return 0;
  const due = new Date(String(dueDate).slice(0, 10) + "T00:00:00");
  const ms = today.getTime() - due.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86400000);
}

async function nextInvoiceNo(admin, companyId) {
  const year = new Date().getFullYear();
  const prefix = `CI-${year}-`;
  const { data } = await admin
    .from("customer_invoices")
    .select("invoice_no")
    .eq("company_id", companyId)
    .like("invoice_no", `${prefix}%`)
    .order("id", { ascending: false })
    .limit(50);
  let max = 0;
  for (const row of data || []) {
    const m = String(row.invoice_no || "").match(/CI-\d{4}-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function nextReceiptNo(admin, companyId) {
  const prefix = `RCP-${new Date().getFullYear()}-`;
  const { data } = await admin
    .from("customer_payments")
    .select("receipt_no")
    .eq("company_id", companyId)
    .like("receipt_no", `${prefix}%`)
    .order("id", { ascending: false })
    .limit(50);
  let max = 0;
  for (const row of data || []) {
    const m = String(row.receipt_no || "").match(/RCP-\d{4}-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function nextCreditNoteNo(admin, companyId) {
  const prefix = `CN-${new Date().getFullYear()}-`;
  const { data } = await admin
    .from("customer_credit_notes")
    .select("credit_note_no")
    .eq("company_id", companyId)
    .like("credit_note_no", `${prefix}%`)
    .order("id", { ascending: false })
    .limit(50);
  let max = 0;
  for (const row of data || []) {
    const m = String(row.credit_note_no || "").match(/CN-\d{4}-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function loadCreditPolicy(admin, companyId) {
  try {
    const { data } = await admin.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
    const s = data?.settings && typeof data.settings === "object" ? data.settings : {};
    return {
      block_sales_over_credit_limit: s.block_sales_over_credit_limit !== false,
      warn_credit_limit: s.warn_credit_limit !== false,
      default_payment_terms_days: Number(s.default_payment_terms_days) || 30,
    };
  } catch {
    return { block_sales_over_credit_limit: true, warn_credit_limit: true, default_payment_terms_days: 30 };
  }
}

async function recomputeCustomerBalance(admin, companyId, customerId) {
  const { data: invoices } = await admin
    .from("customer_invoices")
    .select("balance, status")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .neq("status", "void");
  const invBal = (invoices || []).reduce((s, r) => s + Math.max(0, num(r.balance)), 0);
  const { data: customer } = await admin
    .from("customers")
    .select("opening_balance")
    .eq("id", customerId)
    .maybeSingle();
  const opening = num(customer?.opening_balance);
  const balance = Math.max(0, opening + invBal);
  await admin.from("customers").update({ balance }).eq("id", customerId).eq("company_id", companyId);
  return balance;
}

async function refreshInvoiceStatus(admin, invoice) {
  const status = deriveInvoiceStatus(invoice);
  if (status !== invoice.status) {
    await admin.from("customer_invoices").update({ status, updated_at: new Date().toISOString() }).eq("id", invoice.id);
  }
  return status;
}

function accountSnapshot(customer, invoices = []) {
  const creditLimit = num(customer.credit_limit);
  const open = (invoices || []).filter((i) => i.status !== "void" && i.status !== "paid");
  const currentBalance = open.reduce((s, i) => s + Math.max(0, num(i.balance)), 0) + num(customer.opening_balance);
  const overdueBalance = open
    .filter((i) => deriveInvoiceStatus(i) === "overdue")
    .reduce((s, i) => s + Math.max(0, num(i.balance)), 0);
  const available = creditLimit > 0 ? Math.max(0, creditLimit - currentBalance) : null;
  return {
    customer_id: customer.id,
    name: customer.name,
    credit_limit: creditLimit,
    current_balance: currentBalance,
    available_credit: available,
    overdue_balance: overdueBalance,
    payment_terms_days: Number(customer.payment_terms_days) || 30,
    over_limit: creditLimit > 0 && currentBalance > creditLimit,
  };
}

/**
 * Create AR invoice (cash / credit / mixed). Optionally deducts stock when product lines present.
 */
async function createInvoice(admin, caller, companyId, params, { platform }) {
  const customerId = Number(params.customer_id);
  if (!customerId) return { success: false, error: "Customer is required." };
  let cq = admin.from("customers").select("*").eq("id", customerId);
  cq = companyFilter(cq, companyId, platform);
  const { data: customer } = await cq.maybeSingle();
  if (!customer) return { success: false, error: "Customer not found." };

  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length && !(num(params.total) > 0)) {
    return { success: false, error: "Add at least one line item or a total amount." };
  }

  let subtotal = 0;
  const lineRows = [];
  for (const item of items) {
    const qty = num(item.qty || item.quantity || 1);
    const unit = num(item.unit_price ?? item.price);
    const lineTotal = num(item.line_total != null ? item.line_total : qty * unit);
    subtotal += lineTotal;
    lineRows.push({
      company_id: companyId,
      product_id: item.product_id || null,
      description: String(item.description || item.name || "Item").slice(0, 240),
      qty,
      unit_price: unit,
      line_total: lineTotal,
    });
  }
  if (!lineRows.length) {
    subtotal = num(params.total);
    lineRows.push({
      company_id: companyId,
      product_id: null,
      description: String(params.notes || "Credit invoice").slice(0, 240),
      qty: 1,
      unit_price: subtotal,
      line_total: subtotal,
    });
  }

  const tax = num(params.tax);
  const total = num(params.total) > 0 ? num(params.total) : subtotal + tax;
  const paymentType = String(params.payment_type || "credit").toLowerCase();
  if (!["cash", "credit", "mixed"].includes(paymentType)) {
    return { success: false, error: "payment_type must be cash, credit, or mixed." };
  }

  let cashAmount = num(params.cash_amount);
  let creditAmount = num(params.credit_amount);
  if (paymentType === "cash") {
    cashAmount = total;
    creditAmount = 0;
  } else if (paymentType === "credit") {
    cashAmount = 0;
    creditAmount = total;
  } else {
    if (cashAmount <= 0 && creditAmount <= 0) {
      cashAmount = num(params.amount_paid);
      creditAmount = Math.max(0, total - cashAmount);
    }
    if (Math.abs(cashAmount + creditAmount - total) > 0.02) {
      creditAmount = Math.max(0, total - cashAmount);
    }
  }

  const policy = await loadCreditPolicy(admin, companyId);
  const terms = Number(params.payment_terms_days) || Number(customer.payment_terms_days) || policy.default_payment_terms_days;
  const invoiceDate = String(params.invoice_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dueDate = String(params.due_date || new Date(Date.parse(invoiceDate) + terms * 86400000).toISOString().slice(0, 10)).slice(0, 10);

  // Credit limit control (credit portion only)
  if (creditAmount > 0) {
    const { data: openInvs } = await admin
      .from("customer_invoices")
      .select("balance, status, due_date, amount_paid, total")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .neq("status", "void");
    const snap = accountSnapshot(customer, openInvs || []);
    const projected = snap.current_balance + creditAmount;
    const limit = num(customer.credit_limit);
    if (limit > 0 && projected > limit) {
      const msg = `Credit limit exceeded. Limit ${limit.toFixed(2)}, available ${(snap.available_credit ?? 0).toFixed(2)}, requested credit ${creditAmount.toFixed(2)}.`;
      if (policy.block_sales_over_credit_limit) {
        return { success: false, error: msg, code: "CREDIT_LIMIT", warn: true };
      }
    }
  }

  const amountPaid = cashAmount;
  const balance = Math.max(0, total - amountPaid);
  let status = deriveInvoiceStatus({
    balance,
    amount_paid: amountPaid,
    total,
    due_date: dueDate,
    status: balance <= 0 ? "paid" : "unpaid",
  });

  const invoiceNo = params.invoice_no || (await nextInvoiceNo(admin, companyId));
  const insertRow = {
    company_id: companyId,
    customer_id: customerId,
    sale_id: params.sale_id || null,
    branch_id: params.branch_id || caller.branch_id || null,
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    due_date: dueDate,
    subtotal,
    tax,
    total,
    amount_paid: amountPaid,
    balance,
    payment_type: paymentType,
    cash_amount: cashAmount,
    credit_amount: creditAmount,
    status,
    notes: params.notes || "",
    created_by: caller.id || null,
    updated_at: new Date().toISOString(),
  };

  const { data: invoice, error } = await admin.from("customer_invoices").insert(insertRow).select("*").single();
  if (error) {
    if (/relation .*customer_invoices.* does not exist/i.test(error.message || "")) {
      return { success: false, error: "Receivables tables not migrated. Apply migration 032.", code: "SCHEMA" };
    }
    return { success: false, error: error.message || "Unable to create invoice." };
  }

  const itemsInsert = lineRows.map((r) => ({ ...r, invoice_id: invoice.id }));
  const { error: itemErr } = await admin.from("customer_invoice_items").insert(itemsInsert);
  if (itemErr) {
    await admin.from("customer_invoices").delete().eq("id", invoice.id);
    return { success: false, error: itemErr.message || "Unable to save invoice lines." };
  }

  // Cash portion → payment + allocation
  if (cashAmount > 0) {
    const receiptNo = await nextReceiptNo(admin, companyId);
    const { data: payment, error: payErr } = await admin
      .from("customer_payments")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        amount: cashAmount,
        method: params.cash_method || "Cash",
        invoice_id: invoice.id,
        receipt_no: receiptNo,
        created_by: caller.id || null,
        notes: "Invoice cash portion",
      })
      .select("*")
      .single();
    if (!payErr && payment) {
      await admin.from("customer_payment_allocations").insert({
        company_id: companyId,
        payment_id: payment.id,
        invoice_id: invoice.id,
        amount: cashAmount,
      });
    }
  }

  const newBalance = await recomputeCustomerBalance(admin, companyId, customerId);
  await writeAudit(admin, {
    companyId,
    caller,
    action: "credit_invoice_create",
    details: { invoice_id: invoice.id, invoice_no: invoiceNo, total, payment_type: paymentType, customer_id: customerId },
  });

  const warn =
    creditAmount > 0 &&
    num(customer.credit_limit) > 0 &&
    newBalance > num(customer.credit_limit) * 0.9;

  return {
    success: true,
    invoice: { ...invoice, status },
    customer_balance: newBalance,
    warning: warn ? "Customer is near or over credit limit." : null,
  };
}

async function receivePayment(admin, caller, companyId, params, { platform }) {
  const customerId = Number(params.customer_id);
  const amount = num(params.amount);
  if (!customerId || !(amount > 0)) return { success: false, error: "Customer and positive amount are required." };

  let cq = admin.from("customers").select("*").eq("id", customerId);
  cq = companyFilter(cq, companyId, platform);
  const { data: customer } = await cq.maybeSingle();
  if (!customer) return { success: false, error: "Customer not found." };

  let targets = [];
  if (Array.isArray(params.allocations) && params.allocations.length) {
    targets = params.allocations.map((a) => ({ invoice_id: Number(a.invoice_id), amount: num(a.amount) }));
  } else if (params.invoice_id) {
    targets = [{ invoice_id: Number(params.invoice_id), amount }];
  } else {
    // Auto-allocate oldest due first
    const { data: open } = await admin
      .from("customer_invoices")
      .select("*")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .gt("balance", 0)
      .neq("status", "void")
      .order("due_date", { ascending: true });
    let remaining = amount;
    for (const inv of open || []) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, num(inv.balance));
      if (apply > 0) {
        targets.push({ invoice_id: inv.id, amount: apply });
        remaining -= apply;
      }
    }
    if (!targets.length) {
      // Unallocated payment still reduces customer balance
      targets = [];
    }
  }

  const allocSum = targets.reduce((s, t) => s + t.amount, 0);
  if (targets.length && Math.abs(allocSum - amount) > 0.02 && allocSum > amount) {
    return { success: false, error: "Allocation exceeds payment amount." };
  }

  const receiptNo = params.receipt_no || (await nextReceiptNo(admin, companyId));
  const paymentRow = {
    company_id: companyId,
    customer_id: customerId,
    amount,
    method: params.method || "Cash",
    invoice_id: targets[0]?.invoice_id || null,
    receipt_no: receiptNo,
    created_by: caller.id || null,
  };
  if (params.notes) paymentRow.notes = params.notes;
  if (params.reference) paymentRow.reference = params.reference;
  let { data: payment, error: payErr } = await admin
    .from("customer_payments")
    .insert(paymentRow)
    .select("*")
    .single();
  if (payErr && /column .* does not exist/i.test(payErr.message || "")) {
    // Retry without optional columns (notes/reference/created_by) on older schemas.
    delete paymentRow.notes;
    delete paymentRow.reference;
    delete paymentRow.created_by;
    ({ data: payment, error: payErr } = await admin
      .from("customer_payments")
      .insert(paymentRow)
      .select("*")
      .single());
  }
  if (payErr) return { success: false, error: payErr.message || "Payment failed." };

  for (const t of targets) {
    if (!(t.amount > 0) || !t.invoice_id) continue;
    let iq = admin.from("customer_invoices").select("*").eq("id", t.invoice_id);
    iq = companyFilter(iq, companyId, platform);
    const { data: inv } = await iq.maybeSingle();
    if (!inv || Number(inv.customer_id) !== customerId) continue;
    const apply = Math.min(t.amount, num(inv.balance));
    const amountPaid = num(inv.amount_paid) + apply;
    const balance = Math.max(0, num(inv.total) - amountPaid);
    const status = deriveInvoiceStatus({ ...inv, amount_paid: amountPaid, balance });
    await admin
      .from("customer_invoices")
      .update({ amount_paid: amountPaid, balance, status, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    await admin.from("customer_payment_allocations").insert({
      company_id: companyId,
      payment_id: payment.id,
      invoice_id: inv.id,
      amount: apply,
    });
  }

  // If no invoice targets, reduce legacy balance field directly
  if (!targets.length) {
    const balance = Math.max(0, num(customer.balance) - amount);
    await admin.from("customers").update({ balance }).eq("id", customerId);
  }

  const customerBalance = await recomputeCustomerBalance(admin, companyId, customerId);
  await writeAudit(admin, {
    companyId,
    caller,
    action: "customer_payment_receive",
    details: { payment_id: payment.id, receipt_no: receiptNo, amount, customer_id: customerId, allocations: targets },
  });

  return {
    success: true,
    payment,
    receipt_no: receiptNo,
    customer_balance: customerBalance,
    allocations: targets,
  };
}

async function getStatement(admin, companyId, params, { platform }) {
  const customerId = Number(params.id || params.customer_id);
  let cq = admin.from("customers").select("*").eq("id", customerId);
  cq = companyFilter(cq, companyId, platform);
  const { data: customer } = await cq.maybeSingle();
  if (!customer) return { success: false, error: "Customer not found." };

  const [{ data: invoices }, { data: payments }, { data: creditNotes }] = await Promise.all([
    admin.from("customer_invoices").select("*").eq("company_id", companyId).eq("customer_id", customerId).order("invoice_date", { ascending: true }),
    admin.from("customer_payments").select("*").eq("company_id", companyId).eq("customer_id", customerId).order("created_at", { ascending: true }),
    admin.from("customer_credit_notes").select("*").eq("company_id", companyId).eq("customer_id", customerId).order("created_at", { ascending: true }),
  ]);

  const startDate = params.start_date ? String(params.start_date).slice(0, 10) : null;
  const endDate = params.end_date ? String(params.end_date).slice(0, 10) : null;
  const dayKey = (v) => String(v || "").slice(0, 10);

  const entries = [];
  for (const inv of invoices || []) {
    if (inv.status === "void") continue;
    entries.push({
      entry_date: inv.invoice_date || inv.created_at,
      entry_type: "invoice",
      reference: inv.invoice_no,
      description: `Invoice ${inv.invoice_no} (${inv.payment_type})`,
      debit: num(inv.total),
      credit: 0,
      source_id: inv.id,
    });
  }
  for (const p of payments || []) {
    entries.push({
      entry_date: p.payment_date || p.created_at,
      entry_type: "payment",
      reference: p.receipt_no || p.reference || p.method,
      description: `Payment via ${p.method || "Cash"}`,
      debit: 0,
      credit: num(p.amount),
      source_id: p.id,
    });
  }
  for (const cn of creditNotes || []) {
    entries.push({
      entry_date: cn.created_at,
      entry_type: "credit_note",
      reference: cn.credit_note_no,
      description: cn.reason || "Credit note",
      debit: 0,
      credit: num(cn.amount),
      source_id: cn.id,
    });
  }
  entries.sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));

  let running = num(customer.opening_balance);
  let openingBalanceForRange = running;
  const ledger = [];
  for (const entry of entries) {
    const day = dayKey(entry.entry_date);
    const before = startDate && day < startDate;
    running += num(entry.debit) - num(entry.credit);
    if (before) {
      openingBalanceForRange = running;
      continue;
    }
    if (endDate && day > endDate) continue;
    ledger.push({ ...entry, running_balance: running });
  }

  const outstanding = (invoices || [])
    .filter((i) => i.status !== "void" && i.status !== "paid")
    .reduce((s, i) => s + Math.max(0, num(i.balance)), 0);

  return {
    success: true,
    customer,
    account: accountSnapshot(customer, invoices || []),
    invoices: invoices || [],
    payments: payments || [],
    credit_notes: creditNotes || [],
    ledger,
    opening_balance: openingBalanceForRange,
    closing_balance: running,
    summary: {
      opening_balance: openingBalanceForRange,
      total_invoices: (invoices || []).reduce((s, i) => s + (i.status === "void" ? 0 : num(i.total)), 0),
      total_payments: (payments || []).reduce((s, p) => s + num(p.amount), 0),
      total_credit_notes: (creditNotes || []).reduce((s, c) => s + num(c.amount), 0),
      closing_balance: running,
      outstanding_balance: outstanding,
    },
    filters: { start_date: startDate, end_date: endDate },
  };
}

async function getAging(admin, companyId, params = {}) {
  const { data: invoices } = await admin
    .from("customer_invoices")
    .select("id, customer_id, invoice_no, invoice_date, due_date, balance, status, total, amount_paid")
    .eq("company_id", companyId)
    .gt("balance", 0)
    .neq("status", "void");

  const today = new Date();
  const buckets = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  };
  const byCustomer = new Map();
  const rows = [];

  for (const inv of invoices || []) {
    const bal = num(inv.balance);
    if (bal <= 0) continue;
    const overdue = daysOverdue(inv.due_date || inv.invoice_date, today);
    let bucket = "current";
    if (overdue <= 0) bucket = "current";
    else if (overdue <= 30) bucket = "days_1_30";
    else if (overdue <= 60) bucket = "days_31_60";
    else if (overdue <= 90) bucket = "days_61_90";
    else bucket = "days_90_plus";
    buckets[bucket] += bal;
    rows.push({
      ...inv,
      status: deriveInvoiceStatus(inv, today),
      days_overdue: Math.max(0, overdue),
      aging_bucket: bucket,
    });
    const prev = byCustomer.get(Number(inv.customer_id)) || 0;
    byCustomer.set(Number(inv.customer_id), prev + bal);
  }

  const customerIds = [...byCustomer.keys()];
  let customers = [];
  if (customerIds.length) {
    const { data } = await admin.from("customers").select("id, name, phone, credit_limit, balance").in("id", customerIds);
    customers = data || [];
  }

  const topDebtors = customers
    .map((c) => ({
      ...c,
      outstanding: byCustomer.get(Number(c.id)) || 0,
    }))
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, Number(params.top) || 10);

  return {
    success: true,
    as_of: today.toISOString().slice(0, 10),
    buckets,
    total_receivable: Object.values(buckets).reduce((s, v) => s + v, 0),
    overdue_amount: buckets.days_1_30 + buckets.days_31_60 + buckets.days_61_90 + buckets.days_90_plus,
    customers_with_balance: byCustomer.size,
    top_debtors: topDebtors,
    invoices: rows,
  };
}

async function listOutstanding(admin, companyId, params = {}) {
  let q = admin
    .from("customer_invoices")
    .select("*")
    .eq("company_id", companyId)
    .neq("status", "void")
    .order("due_date", { ascending: true });
  if (params.customer_id) q = q.eq("customer_id", Number(params.customer_id));
  if (params.open_only !== false) q = q.gt("balance", 0);
  const { data, error } = await q;
  if (error) return { success: false, error: error.message };
  const today = new Date();
  const invoices = (data || []).map((inv) => {
    const status = deriveInvoiceStatus(inv, today);
    return {
      ...inv,
      status,
      days_overdue: daysOverdue(inv.due_date, today),
      remaining_balance: num(inv.balance),
    };
  });
  return { success: true, invoices };
}

async function createCreditNote(admin, caller, companyId, params, { platform }) {
  const customerId = Number(params.customer_id);
  const amount = num(params.amount);
  if (!customerId || !(amount > 0)) return { success: false, error: "Customer and amount required." };
  const creditNoteNo = params.credit_note_no || (await nextCreditNoteNo(admin, companyId));
  const { data: note, error } = await admin
    .from("customer_credit_notes")
    .insert({
      company_id: companyId,
      customer_id: customerId,
      invoice_id: params.invoice_id || null,
      credit_note_no: creditNoteNo,
      amount,
      reason: params.reason || "",
      created_by: caller.id || null,
    })
    .select("*")
    .single();
  if (error) return { success: false, error: error.message };

  if (params.invoice_id) {
    let iq = admin.from("customer_invoices").select("*").eq("id", params.invoice_id);
    iq = companyFilter(iq, companyId, platform);
    const { data: inv } = await iq.maybeSingle();
    if (inv) {
      const apply = Math.min(amount, num(inv.balance));
      const amountPaid = num(inv.amount_paid) + apply;
      const balance = Math.max(0, num(inv.total) - amountPaid);
      const status = deriveInvoiceStatus({ ...inv, amount_paid: amountPaid, balance });
      await admin
        .from("customer_invoices")
        .update({ amount_paid: amountPaid, balance, status, updated_at: new Date().toISOString() })
        .eq("id", inv.id);
    }
  }

  const customerBalance = await recomputeCustomerBalance(admin, companyId, customerId);
  await writeAudit(admin, {
    companyId,
    caller,
    action: "customer_credit_note",
    details: { credit_note_id: note.id, amount, customer_id: customerId },
  });
  return { success: true, credit_note: note, customer_balance: customerBalance };
}

async function getDashboard(admin, companyId) {
  const aging = await getAging(admin, companyId, {});
  return {
    success: true,
    total_accounts_receivable: aging.total_receivable,
    overdue_amount: aging.overdue_amount,
    customers_with_outstanding: aging.customers_with_balance,
    top_debtors: aging.top_debtors,
    buckets: aging.buckets,
  };
}

async function getAccount(admin, companyId, params, { platform }) {
  const customerId = Number(params.customer_id || params.id);
  let cq = admin.from("customers").select("*").eq("id", customerId);
  cq = companyFilter(cq, companyId, platform);
  const { data: customer } = await cq.maybeSingle();
  if (!customer) return { success: false, error: "Customer not found." };
  const { data: invoices } = await admin
    .from("customer_invoices")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_id", customerId);
  return { success: true, account: accountSnapshot(customer, invoices || []), customer };
}

async function checkCreditLimit(admin, companyId, params, { platform }) {
  const customerId = Number(params.customer_id);
  const addCredit = num(params.credit_amount || params.amount || 0);
  let cq = admin.from("customers").select("*").eq("id", customerId);
  cq = companyFilter(cq, companyId, platform);
  const { data: customer } = await cq.maybeSingle();
  if (!customer) return { success: false, error: "Customer not found." };
  const { data: invoices } = await admin
    .from("customer_invoices")
    .select("balance, status, due_date, amount_paid, total")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .neq("status", "void");
  const snap = accountSnapshot(customer, invoices || []);
  const policy = await loadCreditPolicy(admin, companyId);
  const projected = snap.current_balance + addCredit;
  const limit = num(customer.credit_limit);
  const exceeded = limit > 0 && projected > limit;
  const available = snap.available_credit ?? 0;
  const error = exceeded
    ? `Credit limit exceeded. Limit ${limit.toFixed(2)}, available ${Number(available).toFixed(2)}, requested ${addCredit.toFixed(2)}.`
    : null;
  return {
    success: true,
    ...snap,
    projected_balance: projected,
    exceeded,
    block: exceeded && policy.block_sales_over_credit_limit,
    warn: policy.warn_credit_limit && ((limit > 0 && projected >= limit * 0.9) || exceeded),
    error,
    policy,
  };
}

export async function syncSaleToReceivable(admin, caller, companyId, sale, paymentMeta = {}) {
  const method = String(paymentMeta.payment_method || sale.payment_method || "").toUpperCase();
  const customerId = sale.customer_id;
  if (!customerId) return null;
  const total = num(sale.total);
  let paymentType = "cash";
  let cashAmount = total;
  let creditAmount = 0;
  if (method === "CREDIT") {
    paymentType = "credit";
    cashAmount = 0;
    creditAmount = total;
  } else if (method === "MIXED" || method === "SPLIT") {
    paymentType = "mixed";
    cashAmount = num(paymentMeta.cash_amount);
    creditAmount = num(paymentMeta.credit_amount);
    if (cashAmount + creditAmount <= 0) {
      cashAmount = num(paymentMeta.amount_paid) || 0;
      creditAmount = Math.max(0, total - cashAmount);
    }
  } else {
    return null; // fully paid non-credit sale — no AR invoice
  }
  if (creditAmount <= 0 && paymentType !== "mixed") return null;

  return createInvoice(admin, caller, companyId, {
    customer_id: customerId,
    sale_id: sale.id,
    branch_id: sale.branch_id,
    payment_type: paymentType,
    cash_amount: cashAmount,
    credit_amount: creditAmount,
    total,
    tax: num(sale.tax),
    subtotal: num(sale.subtotal) || total,
    notes: `POS sale ${sale.invoice_no || sale.receipt_no || sale.id}`,
    items: Array.isArray(sale.items)
      ? sale.items.map((it) => ({
          product_id: it.product_id,
          description: it.name || it.description || "Item",
          qty: it.qty || it.quantity,
          unit_price: it.price || it.unit_price,
          line_total: it.line_total || (num(it.qty) * num(it.price)),
        }))
      : [],
  }, { platform: false });
}

export async function handleReceivablesAction(admin, caller, action, params = {}) {
  const platform = normalizeRole(caller?.role) === "platform_owner";
  const companyId = platform ? params.company_id ?? caller.company_id : caller.company_id;
  if (companyId == null || companyId === "") {
    return { success: false, error: "Company context required.", code: "NO_COMPANY" };
  }
  const ctx = { platform };

  switch (action) {
    case "receivables.getDashboard":
      return getDashboard(admin, companyId);
    case "receivables.getAging":
      return getAging(admin, companyId, params);
    case "receivables.listInvoices":
    case "receivables.getOutstanding":
      return listOutstanding(admin, companyId, params);
    case "receivables.getAccount":
      return getAccount(admin, companyId, params, ctx);
    case "receivables.checkCreditLimit":
      return checkCreditLimit(admin, companyId, params, ctx);
    case "receivables.createInvoice":
      return createInvoice(admin, caller, companyId, params, ctx);
    case "receivables.receivePayment":
      return receivePayment(admin, caller, companyId, params, ctx);
    case "receivables.getStatement":
      return getStatement(admin, companyId, params, ctx);
    case "receivables.createCreditNote":
      return createCreditNote(admin, caller, companyId, params, ctx);
    case "receivables.getInvoice": {
      let q = admin.from("customer_invoices").select("*").eq("id", params.id);
      q = companyFilter(q, companyId, platform);
      const { data: invoice } = await q.maybeSingle();
      if (!invoice) return { success: false, error: "Invoice not found." };
      const { data: items } = await admin.from("customer_invoice_items").select("*").eq("invoice_id", invoice.id);
      const { data: allocations } = await admin
        .from("customer_payment_allocations")
        .select("*, customer_payments(*)")
        .eq("invoice_id", invoice.id);
      return {
        success: true,
        invoice: { ...invoice, status: deriveInvoiceStatus(invoice), days_overdue: daysOverdue(invoice.due_date) },
        items: items || [],
        allocations: allocations || [],
      };
    }
    case "receivables.updatePolicy": {
      const role = normalizeRole(caller.role);
      if (!["owner", "super_admin", "admin"].includes(role)) {
        return { success: false, error: "Only Owner or Admin can update credit policy.", code: "FORBIDDEN" };
      }
      const { data: existing } = await admin.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
      const settings = { ...(existing?.settings || {}) };
      if (params.block_sales_over_credit_limit != null) {
        settings.block_sales_over_credit_limit = Boolean(params.block_sales_over_credit_limit);
      }
      if (params.warn_credit_limit != null) settings.warn_credit_limit = Boolean(params.warn_credit_limit);
      if (params.default_payment_terms_days != null) {
        settings.default_payment_terms_days = Number(params.default_payment_terms_days) || 30;
      }
      const { error } = await admin.from("company_settings").upsert(
        { company_id: companyId, settings, updated_at: new Date().toISOString() },
        { onConflict: "company_id" }
      );
      if (error) return { success: false, error: error.message };
      await writeAudit(admin, { companyId, caller, action: "credit_policy_update", details: settings });
      return { success: true, policy: await loadCreditPolicy(admin, companyId) };
    }
    case "receivables.getPolicy":
      return { success: true, policy: await loadCreditPolicy(admin, companyId) };
    default:
      return null;
  }
}
