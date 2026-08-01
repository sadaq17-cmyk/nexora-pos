import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ReceiptText, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import Seo from "../../components/public/Seo";

const STATUS_STYLES = {
  Valid: { icon: CheckCircle2, className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  Refunded: { icon: AlertTriangle, className: "text-amber-800 bg-amber-50 border-amber-200" },
  Cancelled: { icon: XCircle, className: "text-red-700 bg-red-50 border-red-200" },
};

function money(total, code, symbol) {
  const amount = Number(total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${code || ""} ${symbol || ""} ${amount}`.replace(/\s+/g, " ").trim();
}

export default function InvoiceVerify() {
  const { invoiceId = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      const result = await api.platformPublic.verifyInvoice(invoiceId);
      if (!active) return;
      if (!result?.success || !result.invoice) {
        setInvoice(null);
        setError(result?.error || "Invoice not found.");
      } else {
        setInvoice(result.invoice);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [invoiceId]);

  const status = invoice?.status || "Cancelled";
  const StatusIcon = STATUS_STYLES[status]?.icon || XCircle;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Seo
        title={`Invoice ${invoiceId || ""} | Nexora POS Pro`}
        description="Verify a Nexora POS Pro receipt."
      />
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0f766e] text-white">
          <ReceiptText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Invoice verification</h1>
          <p className="text-sm text-slate-500">Official receipt lookup · fake invoices are rejected</p>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Verifying invoice…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <XCircle size={18} /> Verification failed
          </div>
          <p>{error}</p>
          <p className="mt-3 text-xs text-red-700/80">
            Only invoices stored in the Nexora database can be verified. Placeholder or altered QR codes will not validate.
          </p>
        </div>
      )}

      {!loading && invoice && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${STATUS_STYLES[status]?.className || ""}`}>
            <StatusIcon size={14} />
            Invoice Status: {status}
          </div>

          <dl className="grid gap-3 text-sm">
            <Row label="Receipt number" value={invoice.receipt_no} mono />
            <Row label="Company" value={invoice.company || "—"} />
            <Row label="Branch" value={invoice.branch || "—"} />
            <Row label="Customer" value={invoice.customer || "Walk-in"} />
            <Row label="Payment method" value={invoice.payment_method || "—"} />
            <Row label="Total" value={money(invoice.total, invoice.currency_code, invoice.currency_symbol)} mono />
            <Row label="Date" value={invoice.date ? new Date(invoice.date).toLocaleString() : "—"} />
          </dl>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Items</div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {(invoice.items || []).length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-500">No line items on file.</div>
              ) : (
                invoice.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="text-slate-800">
                      {item.qty} × {item.name}
                    </span>
                    <span className="font-mono text-slate-700">
                      {money(Number(item.price || 0) * Number(item.qty || 0), invoice.currency_code, invoice.currency_symbol)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 text-center text-sm">
        <Link to="/" className="font-semibold text-[#0f766e] hover:underline">
          Back to Nexora POS Pro
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
