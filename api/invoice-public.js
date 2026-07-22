import {
  applySecurityHeaders,
  createAdminClient,
  isAllowedOrigin,
  methodNotAllowed,
  jsonError,
  parseBody,
  verifyCallerFromRequest,
} from "./_authHelpers.js";
import { lookupInvoice, upsertInvoice } from "./_invoiceStore.js";

const STATUSES = new Set(["Valid", "Cancelled", "Refunded"]);

function normalizeStatus(value) {
  const key = String(value || "Valid");
  if (STATUSES.has(key)) return key;
  const lower = key.toLowerCase();
  if (lower === "cancelled" || lower === "canceled") return "Cancelled";
  if (lower === "refunded") return "Refunded";
  return "Valid";
}

function publicInvoice(row) {
  if (!row) return null;
  return {
    receipt_no: row.receipt_no,
    invoice_id: row.invoice_id,
    company: row.company_name,
    branch: row.branch_name,
    customer: row.customer_name,
    payment_method: row.payment_method,
    currency_code: row.currency_code,
    currency_symbol: row.currency_symbol,
    total: Number(row.total || 0),
    status: normalizeStatus(row.status),
    items: Array.isArray(row.items) ? row.items : [],
    date: row.sale_date || row.created_at,
  };
}

export default async function handler(req, res) {
  applySecurityHeaders(res);
  if (!isAllowedOrigin(req)) return jsonError(res, 403, "Forbidden origin.", "CSRF_ORIGIN");

  if (req.method === "GET") {
    const id = String(req.query?.id || req.query?.receipt_no || "").trim();
    if (!id) return jsonError(res, 400, "Invoice id is required.");
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id)) {
      return jsonError(res, 400, "Invalid invoice id.");
    }
    try {
      const admin = createAdminClient();
      const { row } = await lookupInvoice(admin, id);
      if (!row) {
        return res.status(404).json({
          success: false,
          error: "Invoice not found. This receipt is not registered in the system.",
          code: "NOT_FOUND",
        });
      }
      return res.status(200).json({ success: true, invoice: publicInvoice(row) });
    } catch (err) {
      if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
      console.error("[invoice-public] GET", err);
      return jsonError(res, 502, "Unable to verify invoice.", "LOOKUP_FAILED");
    }
  }

  if (req.method === "POST") {
    const verified = await verifyCallerFromRequest(req);
    if (verified.error) return jsonError(res, verified.status, verified.error);
    const body = parseBody(req);
    const receiptNo = String(body.receipt_no || "").trim();
    const invoiceId = String(body.invoice_id || receiptNo).trim();
    if (!receiptNo || !invoiceId) return jsonError(res, 400, "receipt_no is required.");

    const payload = {
      receipt_no: receiptNo,
      invoice_id: invoiceId,
      company_name: String(body.company || body.company_name || "").trim(),
      branch_name: String(body.branch || body.branch_name || "").trim(),
      customer_name: String(body.customer || body.customer_name || "Walk-in").trim() || "Walk-in",
      payment_method: String(body.payment_method || "").trim(),
      currency_code: String(body.currency_code || "KES").trim(),
      currency_symbol: String(body.currency_symbol || "").trim(),
      total: Number(body.total || 0),
      status: normalizeStatus(body.status),
      items: Array.isArray(body.items) ? body.items : [],
      sale_date: body.date || body.sale_date || new Date().toISOString(),
      company_id: body.company_id == null || body.company_id === "" ? null : Number(body.company_id),
      updated_at: new Date().toISOString(),
    };

    try {
      const admin = createAdminClient();
      const { row } = await upsertInvoice(admin, payload);
      return res.status(200).json({ success: true, invoice: publicInvoice(row || payload) });
    } catch (err) {
      if (err?.code === "CONFIG") return jsonError(res, 503, err.message, "CONFIG");
      console.error("[invoice-public] POST", err);
      return jsonError(res, 502, err.message || "Unable to register invoice.", "UPSERT_FAILED");
    }
  }

  return methodNotAllowed(res, "GET, POST");
}
