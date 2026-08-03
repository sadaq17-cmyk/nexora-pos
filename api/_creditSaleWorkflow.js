/**
 * One-click Credit Sale automation: AR invoice, customer ledger, GL journal,
 * and compensating rollback if a critical post-sale step fails.
 */
import { syncSaleToReceivable } from "./_receivables.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asBool(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

export const DEFAULT_AUTO_ACTIONS = Object.freeze({
  auto_print_receipt: true,
  auto_create_invoice: true,
  auto_create_receivable: true,
  auto_update_inventory: true,
  auto_create_accounting: true,
  auto_update_customer_ledger: true,
  auto_refresh_dashboard: true,
  auto_send_receipt: false,
});

export function normalizeAutoActions(settings = {}) {
  const nested = settings.auto_actions && typeof settings.auto_actions === "object"
    ? settings.auto_actions
    : {};
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_AUTO_ACTIONS)) {
    out[key] = asBool(nested[key] ?? settings[key], def);
  }
  return out;
}

export async function loadAutoActions(admin, companyId) {
  try {
    const { data } = await admin
      .from("company_settings")
      .select("settings")
      .eq("company_id", companyId)
      .maybeSingle();
    return normalizeAutoActions(data?.settings || {});
  } catch {
    return { ...DEFAULT_AUTO_ACTIONS };
  }
}

function isCreditLike(method) {
  const m = String(method || "").toUpperCase();
  return m === "CREDIT" || m === "MIXED" || m === "SPLIT";
}

async function writeAudit(admin, { companyId, caller, action, module = "sales", details = {} }) {
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

async function postCreditJournal(admin, { companyId, caller, saleId, receiptNo, total, cashAmount, creditAmount, customerName }) {
  const credit = Math.max(0, num(creditAmount));
  const cash = Math.max(0, num(cashAmount));
  const lines = [];
  if (credit > 0) {
    lines.push({ account: "Accounts Receivable", debit: credit, credit: 0 });
  }
  if (cash > 0) {
    lines.push({ account: "Cash", debit: cash, credit: 0 });
  }
  lines.push({ account: "Sales Revenue", debit: 0, credit: num(total) });
  if (!lines.length) return [];

  const rows = lines.map((l) => ({
    company_id: companyId,
    account: l.account,
    debit: num(l.debit),
    credit: num(l.credit),
    ref_type: "sale",
    ref_id: saleId != null ? Number(saleId) : null,
    memo: `Credit sale ${receiptNo || saleId}${customerName ? ` — ${customerName}` : ""}`,
    created_by: caller?.id || null,
  }));

  const { data, error } = await admin.from("journal_entries").insert(rows).select("id,account,debit,credit");
  if (error) {
    if (/relation .*journal_entries.* does not exist|column .* does not exist/i.test(error.message || "")) {
      return [];
    }
    throw new Error(error.message || "Failed to post accounting journal entries.");
  }
  await writeAudit(admin, {
    companyId,
    caller,
    action: "journal_post",
    module: "sales",
    details: {
      ref_type: "sale",
      ref_id: saleId,
      receipt_no: receiptNo,
      entries: rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit })),
    },
  });
  return data || [];
}

/**
 * Attempt to reverse a committed sale when a critical automation step fails.
 */
export async function compensateSale(admin, { companyId, caller, saleId, items = [] }) {
  if (!saleId) return;
  try {
    await admin
      .from("sales")
      .update({ status: "Void", payment_method: "VOID" })
      .eq("id", saleId)
      .eq("company_id", companyId);
  } catch {
    try {
      await admin.from("sales").update({ status: "Void" }).eq("id", saleId);
    } catch {
      /* ignore */
    }
  }

  for (const item of items) {
    const pid = Number(item.product_id || item.id);
    const qty = Math.abs(num(item.qty));
    if (!pid || !qty) continue;
    try {
      const { data: product } = await admin.from("products").select("id,stock").eq("id", pid).maybeSingle();
      if (!product) continue;
      await admin.from("products").update({ stock: num(product.stock) + qty }).eq("id", pid);
    } catch {
      /* continue restoring others */
    }
  }

  await writeAudit(admin, {
    companyId,
    caller,
    action: "credit_sale_rollback",
    module: "sales",
    details: { sale_id: saleId, reason: "automation_step_failed", items: items.length },
  });
}

/**
 * Run post-sale automation for Credit / Mixed sales.
 * Returns enrichment for the POS receipt, or { success:false } when critical steps fail
 * (caller should compensate / surface error).
 */
export async function runCreditSaleAutomation(admin, {
  companyId,
  caller,
  sale,
  params = {},
  autoActions,
  postJournalEntriesFn = null,
}) {
  const actions = autoActions || (await loadAutoActions(admin, companyId));
  const method = String(params.payment_method || sale.payment_method || "").toUpperCase();
  const creditLike = isCreditLike(method);
  const total = num(sale.total ?? params.total);
  const cashAmount =
    method === "CREDIT"
      ? 0
      : method === "MIXED" || method === "SPLIT"
        ? num(params.cash_amount)
        : total;
  const creditAmount =
    method === "CREDIT"
      ? total
      : method === "MIXED" || method === "SPLIT"
        ? num(params.credit_amount) || Math.max(0, total - cashAmount)
        : 0;

  const result = {
    success: true,
    auto_actions: actions,
    credit_sale: creditLike,
    invoice: null,
    journal: [],
    paid_amount: cashAmount,
    remaining_balance: creditAmount,
    payment_terms_days: null,
    due_date: null,
    ar_invoice_no: null,
  };

  if (!creditLike) {
    return result;
  }

  if (!params.customer_id && !sale.customer_id) {
    return { success: false, error: "Customer is required for credit sales.", code: "CUSTOMER_REQUIRED" };
  }

  if (actions.auto_create_receivable !== false || actions.auto_update_customer_ledger !== false) {
    const ar = await syncSaleToReceivable(
      admin,
      caller,
      companyId,
      {
        ...sale,
        id: sale.id,
        customer_id: sale.customer_id || params.customer_id,
        items: params.items || sale.items,
        total,
        subtotal: num(sale.subtotal ?? params.subtotal) || total,
        tax: num(sale.vat ?? sale.tax ?? params.vat),
        branch_id: sale.branch_id || params.branch_id,
        invoice_no: sale.invoice_no || sale.receipt_no,
        receipt_no: sale.receipt_no || sale.invoice_no,
      },
      {
        payment_method: method,
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        amount_paid: cashAmount,
      }
    );

    if (ar && ar.success === false) {
      return {
        success: false,
        error: ar.error || "Failed to create Accounts Receivable record.",
        code: ar.code || "AR_FAILED",
        auto_actions: actions,
      };
    }

    if (ar?.invoice) {
      result.invoice = ar.invoice;
      result.ar_invoice_no = ar.invoice.invoice_no;
      result.due_date = ar.invoice.due_date;
      result.paid_amount = num(ar.invoice.amount_paid);
      result.remaining_balance = num(ar.invoice.balance);
      result.payment_terms_days = null;
      try {
        const { data: customer } = await admin
          .from("customers")
          .select("payment_terms_days")
          .eq("id", sale.customer_id || params.customer_id)
          .maybeSingle();
        result.payment_terms_days = Number(customer?.payment_terms_days) || actions.default_payment_terms_days || 30;
      } catch {
        result.payment_terms_days = 30;
      }
    } else if (actions.auto_create_receivable) {
      // Schema missing — do not fail cash-desk entirely if tables absent; surface soft warning
      result.warning = "Receivables tables unavailable; credit sale posted without AR invoice.";
    }
  }

  if (actions.auto_create_accounting !== false && creditAmount + cashAmount > 0) {
    try {
      if (typeof postJournalEntriesFn === "function") {
        result.journal = await postJournalEntriesFn(admin, {
          companyId,
          caller,
          refType: "sale",
          refId: sale.id,
          memo: `Credit sale ${sale.receipt_no || sale.invoice_no || sale.id}`,
          lines: [
            ...(creditAmount > 0
              ? [{ account: "Accounts Receivable", debit: creditAmount, credit: 0 }]
              : []),
            ...(cashAmount > 0 ? [{ account: "Cash", debit: cashAmount, credit: 0 }] : []),
            { account: "Sales Revenue", debit: 0, credit: total },
          ],
        });
      } else {
        result.journal = await postCreditJournal(admin, {
          companyId,
          caller,
          saleId: sale.id,
          receiptNo: sale.receipt_no || sale.invoice_no,
          total,
          cashAmount,
          creditAmount,
          customerName: params.customer_name,
        });
      }
    } catch (journalErr) {
      return {
        success: false,
        error: journalErr?.message || "Failed to create accounting journal entries.",
        code: "JOURNAL_FAILED",
        auto_actions: actions,
        invoice: result.invoice,
      };
    }
  }

  await writeAudit(admin, {
    companyId,
    caller,
    action: "credit_sale_automation_complete",
    module: "sales",
    details: {
      sale_id: sale.id,
      receipt_no: sale.receipt_no || sale.invoice_no,
      ar_invoice_no: result.ar_invoice_no,
      paid_amount: result.paid_amount,
      remaining_balance: result.remaining_balance,
      due_date: result.due_date,
      journal_lines: Array.isArray(result.journal) ? result.journal.length : 0,
      auto_actions: actions,
    },
  });

  return result;
}
