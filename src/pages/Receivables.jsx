import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet, FileText, CreditCard, BarChart3, Settings2, Plus, Printer,
  Mail, FileSpreadsheet, MessageCircle, RefreshCw, AlertTriangle, Search,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ListSkeleton } from "@/components/ui/skeleton";
import {
  printCustomerStatement,
  exportCustomerStatementExcel,
  exportCustomerStatementPdf,
  buildCustomerStatementPdfBase64,
  shareCustomerStatementWhatsApp,
  buildStatementRows,
  printPaymentReceipt,
  entryTypeLabel,
} from "../lib/customerStatementExport";

const TABS = [
  { id: "overview", label: "Overview", icon: Wallet },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "payments", label: "Receive Payment", icon: CreditCard },
  { id: "statement", label: "Statement", icon: FileSpreadsheet },
  { id: "aging", label: "Aging", icon: BarChart3 },
  { id: "policy", label: "Credit Policy", icon: Settings2 },
];

const STATUS_LABEL = {
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

function Kpi({ label, value, tone }) {
  return (
    <div className={`nx-kpi ${tone ? `tone-${tone}` : ""}`}>
      <div className="nx-kpi-value truncate">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "is-ok";
  if (s === "overdue") return "is-danger";
  if (s === "partially_paid") return "is-warn";
  return "";
}

export default function Receivables() {
  const { formatMoney: money } = useEnterpriseSettings();
  const { can, user } = useAuth();
  const { showToast } = useToast();
  const canCreate = can("customers", "create");
  const canEdit = can("customers", "edit");
  const canExport = can("customers", "export") || can("customers", "print") || can("customers", "view");
  const isOwnerLike = ["owner", "super_admin", "admin"].includes(String(user?.role || "").toLowerCase());

  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [dash, setDash] = useState(null);
  const [aging, setAging] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [policy, setPolicy] = useState({
    block_sales_over_credit_limit: true,
    warn_credit_limit: true,
    default_payment_terms_days: 30,
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const [invoiceForm, setInvoiceForm] = useState({
    customer_id: "",
    payment_type: "credit",
    total: "",
    cash_amount: "",
    notes: "",
    due_date: "",
  });
  const [payForm, setPayForm] = useState({
    customer_id: "",
    amount: "",
    method: "Cash",
    invoice_id: "",
    notes: "",
  });
  const [account, setAccount] = useState(null);
  const [statementCustomerId, setStatementCustomerId] = useState("");
  const [statement, setStatement] = useState(null);
  const [lastPayment, setLastPayment] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a, inv, cust, pol] = await Promise.all([
        api.receivables.getDashboard().catch(() => null),
        api.receivables.getAging().catch(() => null),
        api.receivables.getOutstanding({ open_only: false }).catch(() => ({ invoices: [] })),
        api.customers.getAll().catch(() => []),
        api.receivables.getPolicy().catch(() => null),
      ]);
      setDash(d?.success ? d : null);
      setAging(a?.success ? a : null);
      setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : []);
      setCustomers(Array.isArray(cust) ? cust : []);
      if (pol?.policy) setPolicy(pol.policy);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filteredInvoices = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const cust = customers.find((c) => Number(c.id) === Number(inv.customer_id));
      return (
        String(inv.invoice_no || "").toLowerCase().includes(q) ||
        String(cust?.name || "").toLowerCase().includes(q) ||
        String(inv.status || "").toLowerCase().includes(q)
      );
    });
  }, [invoices, customers, debouncedSearch]);

  const openInvoicesForCustomer = useMemo(() => {
    const id = Number(payForm.customer_id);
    if (!id) return [];
    return invoices.filter((i) => Number(i.customer_id) === id && Number(i.balance) > 0);
  }, [invoices, payForm.customer_id]);

  const loadAccount = async (customerId) => {
    if (!customerId) {
      setAccount(null);
      return;
    }
    const res = await api.receivables.getAccount({ customer_id: customerId });
    if (res?.success) setAccount(res.account);
    else setAccount(null);
  };

  const createInvoice = async (e) => {
    e.preventDefault();
    if (!canCreate) return showToast("You do not have permission to create invoices.");
    setBusy("invoice");
    try {
      const total = Number(invoiceForm.total);
      const payload = {
        customer_id: Number(invoiceForm.customer_id),
        payment_type: invoiceForm.payment_type,
        total,
        notes: invoiceForm.notes,
        due_date: invoiceForm.due_date || undefined,
        cash_amount: invoiceForm.payment_type === "mixed" ? Number(invoiceForm.cash_amount || 0) : undefined,
        credit_amount:
          invoiceForm.payment_type === "mixed"
            ? Math.max(0, total - Number(invoiceForm.cash_amount || 0))
            : undefined,
      };
      if (invoiceForm.payment_type !== "cash") {
        const limit = await api.receivables.checkCreditLimit({
          customer_id: payload.customer_id,
          credit_amount: invoiceForm.payment_type === "credit" ? total : payload.credit_amount,
        });
        if (limit?.warn && !limit?.block) {
          showToast(limit.error || "Warning: near or over credit limit.");
        }
        if (limit?.block) {
          showToast(limit.error || "Credit limit exceeded — sale blocked.");
          return;
        }
      }
      const result = await api.receivables.createInvoice(payload);
      if (!result?.success) {
        showToast(result?.error || "Could not create invoice");
        return;
      }
      if (result.warning) showToast(result.warning);
      else showToast(`Invoice ${result.invoice?.invoice_no} created`);
      setInvoiceForm({ customer_id: "", payment_type: "credit", total: "", cash_amount: "", notes: "", due_date: "" });
      await reload();
    } finally {
      setBusy("");
    }
  };

  const receivePayment = async (e) => {
    e.preventDefault();
    if (!canEdit) return showToast("You do not have permission to receive payments.");
    setBusy("payment");
    try {
      const result = await api.receivables.receivePayment({
        customer_id: Number(payForm.customer_id),
        amount: Number(payForm.amount),
        method: payForm.method,
        invoice_id: payForm.invoice_id ? Number(payForm.invoice_id) : undefined,
        notes: payForm.notes,
      });
      if (!result?.success) {
        showToast(result?.error || "Payment failed");
        return;
      }
      setLastPayment(result);
      showToast(`Payment ${result.receipt_no} recorded`);
      setPayForm((f) => ({ ...f, amount: "", invoice_id: "", notes: "" }));
      await reload();
      await loadAccount(payForm.customer_id);
    } finally {
      setBusy("");
    }
  };

  const loadStatement = async () => {
    if (!statementCustomerId) return;
    setBusy("statement");
    try {
      const res = await api.receivables.getStatement({ id: Number(statementCustomerId) });
      if (!res?.success) {
        showToast(res?.error || "Could not load statement");
        setStatement(null);
        return;
      }
      setStatement(res);
    } finally {
      setBusy("");
    }
  };

  const savePolicy = async (e) => {
    e.preventDefault();
    if (!isOwnerLike) return showToast("Only Owner/Admin can update credit policy.");
    setBusy("policy");
    try {
      const res = await api.receivables.updatePolicy(policy);
      if (!res?.success) showToast(res?.error || "Could not save policy");
      else {
        setPolicy(res.policy || policy);
        showToast("Credit policy saved");
      }
    } finally {
      setBusy("");
    }
  };

  const customerName = (id) => customers.find((c) => Number(c.id) === Number(id))?.name || `#${id}`;

  if (loading) {
    return (
      <div className="animate-fadein nx-ledger p-4">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="animate-fadein nx-ledger">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Accounts Receivable</h1>
          <p className="text-sm text-app-muted">Customer credit invoices, payments, statements &amp; aging</p>
        </div>
        <button type="button" className="nx-btn nx-btn-ghost" onClick={reload} disabled={!!busy}>
          <RefreshCw size={14} aria-hidden /> Refresh
        </button>
      </div>

      <div className="nx-dash-kpi-row mb-4" role="region" aria-label="AR KPIs">
        <Kpi label="Total Receivable" value={money(dash?.total_accounts_receivable || 0)} />
        <Kpi label="Overdue Amount" value={money(dash?.overdue_amount || 0)} tone="danger" />
        <Kpi label="Customers with Balance" value={dash?.customers_with_outstanding || 0} />
        <Kpi label="Top Debtor" value={dash?.top_debtors?.[0]?.name || "—"} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Receivables sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`nx-chip ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="nx-panel">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-app-muted">Top Debtors</h2>
            <div className="table-container">
              <table className="w-full min-w-[320px]">
                <thead>
                  <tr><th>Customer</th><th className="text-right">Outstanding</th><th className="text-right">Limit</th></tr>
                </thead>
                <tbody>
                  {(dash?.top_debtors || []).length === 0 ? (
                    <tr><td colSpan={3} className="text-app-muted">No outstanding balances.</td></tr>
                  ) : (
                    (dash.top_debtors || []).map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td className="text-right font-mono">{money(d.outstanding)}</td>
                        <td className="text-right font-mono">{money(d.credit_limit)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="nx-panel">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-app-muted">Aging Snapshot</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Current", aging?.buckets?.current],
                ["1–30 Days", aging?.buckets?.days_1_30],
                ["31–60 Days", aging?.buckets?.days_31_60],
                ["61–90 Days", aging?.buckets?.days_61_90],
                ["90+ Days", aging?.buckets?.days_90_plus],
              ].map(([label, value]) => (
                <Kpi key={label} label={label} value={money(value || 0)} />
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "invoices" && (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          {canCreate && (
            <form className="nx-panel space-y-3" onSubmit={createInvoice}>
              <h2 className="text-sm font-semibold">Create Credit Invoice</h2>
              <label className="block text-sm">
                <span className="text-app-muted">Customer</span>
                <select
                  required
                  className="nx-input mt-1 w-full"
                  value={invoiceForm.customer_id}
                  onChange={(e) => {
                    setInvoiceForm((f) => ({ ...f, customer_id: e.target.value }));
                    loadAccount(e.target.value);
                  }}
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              {account && (
                <div className="rounded-lg border border-app-border bg-app-surface/40 p-3 text-xs">
                  <div>Balance: <strong>{money(account.current_balance)}</strong></div>
                  <div>Limit: <strong>{money(account.credit_limit)}</strong></div>
                  <div>Available: <strong>{money(account.available_credit ?? 0)}</strong></div>
                  <div>Overdue: <strong>{money(account.overdue_balance)}</strong></div>
                  {account.over_limit && (
                    <div className="mt-1 flex items-center gap-1 text-red-600">
                      <AlertTriangle size={12} /> Over credit limit
                    </div>
                  )}
                </div>
              )}
              <label className="block text-sm">
                <span className="text-app-muted">Payment type</span>
                <select
                  className="nx-input mt-1 w-full"
                  value={invoiceForm.payment_type}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, payment_type: e.target.value }))}
                >
                  <option value="cash">Cash</option>
                  <option value="credit">Credit</option>
                  <option value="mixed">Mixed (Cash + Credit)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Total</span>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="nx-input mt-1 w-full"
                  value={invoiceForm.total}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, total: e.target.value }))}
                />
              </label>
              {invoiceForm.payment_type === "mixed" && (
                <label className="block text-sm">
                  <span className="text-app-muted">Cash amount</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    className="nx-input mt-1 w-full"
                    value={invoiceForm.cash_amount}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, cash_amount: e.target.value }))}
                  />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-app-muted">Due date (optional)</span>
                <input
                  type="date"
                  className="nx-input mt-1 w-full"
                  value={invoiceForm.due_date}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Notes</span>
                <input
                  className="nx-input mt-1 w-full"
                  value={invoiceForm.notes}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <button type="submit" className="nx-btn nx-btn-primary w-full" disabled={busy === "invoice"}>
                <Plus size={14} /> {busy === "invoice" ? "Creating…" : "Create Invoice"}
              </button>
            </form>
          )}

          <section className="nx-panel">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">Outstanding Invoices</h2>
              <div className="relative ml-auto min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-app-muted" />
                <input
                  className="nx-input w-full pl-7"
                  placeholder="Search invoice or customer"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="table-container overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Invoice Date</th>
                    <th>Due Date</th>
                    <th className="text-right">Days Overdue</th>
                    <th className="text-right">Remaining</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length === 0 ? (
                    <tr><td colSpan={7} className="text-app-muted">No invoices yet.</td></tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono">{inv.invoice_no}</td>
                        <td>{customerName(inv.customer_id)}</td>
                        <td>{String(inv.invoice_date || "").slice(0, 10)}</td>
                        <td>{String(inv.due_date || "").slice(0, 10)}</td>
                        <td className="text-right">{inv.days_overdue || 0}</td>
                        <td className="text-right font-mono">{money(inv.remaining_balance ?? inv.balance)}</td>
                        <td>
                          <span className={`nx-chip ${statusClass(inv.status)}`}>
                            {STATUS_LABEL[inv.status] || inv.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "payments" && (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <form className="nx-panel space-y-3" onSubmit={receivePayment}>
            <h2 className="text-sm font-semibold">Receive Payment</h2>
            <label className="block text-sm">
              <span className="text-app-muted">Customer</span>
              <select
                required
                className="nx-input mt-1 w-full"
                value={payForm.customer_id}
                onChange={(e) => {
                  setPayForm((f) => ({ ...f, customer_id: e.target.value, invoice_id: "" }));
                  loadAccount(e.target.value);
                }}
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            {account && (
              <div className="rounded-lg border border-app-border p-3 text-xs">
                Current balance: <strong>{money(account.current_balance)}</strong>
                {" · "}Overdue: <strong>{money(account.overdue_balance)}</strong>
              </div>
            )}
            <label className="block text-sm">
              <span className="text-app-muted">Allocate to invoice (optional)</span>
              <select
                className="nx-input mt-1 w-full"
                value={payForm.invoice_id}
                onChange={(e) => setPayForm((f) => ({ ...f, invoice_id: e.target.value }))}
              >
                <option value="">Auto (oldest due first)</option>
                {openInvoicesForCustomer.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_no} — bal {money(inv.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-app-muted">Amount (full or partial)</span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                className="nx-input mt-1 w-full"
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="text-app-muted">Method</span>
              <select
                className="nx-input mt-1 w-full"
                value={payForm.method}
                onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
              >
                {["Cash", "M-Pesa", "Card", "Bank Transfer"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-app-muted">Notes</span>
              <input
                className="nx-input mt-1 w-full"
                value={payForm.notes}
                onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <button type="submit" className="nx-btn nx-btn-primary w-full" disabled={!canEdit || busy === "payment"}>
              {busy === "payment" ? "Recording…" : "Record Payment"}
            </button>
            {lastPayment?.payment && (
              <button
                type="button"
                className="nx-btn nx-btn-ghost w-full"
                onClick={() => {
                  try {
                    printPaymentReceipt(
                      lastPayment.payment,
                      customers.find((c) => Number(c.id) === Number(payForm.customer_id)),
                      money,
                      (lastPayment.allocations || []).map((a) => ({
                        ...a,
                        invoice_no: invoices.find((i) => Number(i.id) === Number(a.invoice_id))?.invoice_no,
                      }))
                    );
                  } catch (err) {
                    showToast(err?.message || "Print failed");
                  }
                }}
              >
                <Printer size={14} /> Print Receipt
              </button>
            )}
          </form>
          <section className="nx-panel">
            <h2 className="mb-3 text-sm font-semibold">Open invoices for selected customer</h2>
            <div className="table-container overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoicesForCustomer.length === 0 ? (
                    <tr><td colSpan={4} className="text-app-muted">Select a customer with open invoices.</td></tr>
                  ) : (
                    openInvoicesForCustomer.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-mono">{inv.invoice_no}</td>
                        <td>{String(inv.due_date || "").slice(0, 10)}</td>
                        <td className="text-right font-mono">{money(inv.balance)}</td>
                        <td>{STATUS_LABEL[inv.status] || inv.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "statement" && (
        <section className="nx-panel space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[220px] flex-1 text-sm">
              <span className="text-app-muted">Customer</span>
              <select
                className="nx-input mt-1 w-full"
                value={statementCustomerId}
                onChange={(e) => setStatementCustomerId(e.target.value)}
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="nx-btn nx-btn-primary" onClick={loadStatement} disabled={!statementCustomerId || busy === "statement"}>
              {busy === "statement" ? "Loading…" : "Load Statement"}
            </button>
          </div>
          {statement?.success && (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="nx-chip" onClick={() => { try { printCustomerStatement(statement.customer, statement, money); } catch (err) { showToast(err.message); } }}>
                  <Printer size={13} /> Print
                </button>
                {canExport && (
                  <>
                    <button type="button" className="nx-chip" onClick={async () => { try { await exportCustomerStatementPdf(statement.customer, statement, money); } catch { showToast("PDF failed"); } }}>
                      PDF
                    </button>
                    <button type="button" className="nx-chip" onClick={async () => { try { await exportCustomerStatementExcel(statement.customer, statement, money); } catch { showToast("Excel failed"); } }}>
                      <FileSpreadsheet size={13} /> Excel
                    </button>
                    <button
                      type="button"
                      className="nx-chip"
                      onClick={async () => {
                        try {
                          const { base64, filename } = await buildCustomerStatementPdfBase64(statement.customer, statement, money);
                          const to = statement.customer?.email;
                          if (!to) return showToast("Customer has no email on file.");
                          const res = await api.receivables.emailStatement({
                            customer_id: statement.customer.id,
                            to,
                            pdf_base64: base64,
                            filename,
                          });
                          showToast(res?.success ? "Statement emailed" : (res?.error || "Email failed"));
                        } catch {
                          showToast("Email failed");
                        }
                      }}
                    >
                      <Mail size={13} /> Email
                    </button>
                    <button type="button" className="nx-chip" onClick={() => shareCustomerStatementWhatsApp(statement.customer, statement, money)}>
                      <MessageCircle size={13} /> WhatsApp
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi label="Opening" value={money(statement.summary?.opening_balance)} />
                <Kpi label="Invoices" value={money(statement.summary?.total_invoices)} />
                <Kpi label="Payments" value={money(statement.summary?.total_payments)} />
                <Kpi label="Credit Notes" value={money(statement.summary?.total_credit_notes)} />
                <Kpi label="Closing" value={money(statement.summary?.closing_balance)} />
                <Kpi label="Outstanding" value={money(statement.summary?.outstanding_balance)} />
              </div>
              <div className="table-container overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildStatementRows(statement).map((row, idx) => (
                      <tr key={`${row.reference}-${idx}`} className={row.isOpening ? "font-semibold" : ""}>
                        <td>{String(row.entry_date || "").slice(0, 10)}</td>
                        <td className="font-mono">{row.reference}</td>
                        <td>{entryTypeLabel(row.entry_type)}</td>
                        <td>{row.description}</td>
                        <td className="text-right font-mono">{Number(row.debit) ? money(row.debit) : ""}</td>
                        <td className="text-right font-mono">{Number(row.credit) ? money(row.credit) : ""}</td>
                        <td className="text-right font-mono">{money(row.running_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "aging" && (
        <section className="nx-panel space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Current", aging?.buckets?.current],
              ["1–30 Days", aging?.buckets?.days_1_30],
              ["31–60 Days", aging?.buckets?.days_31_60],
              ["61–90 Days", aging?.buckets?.days_61_90],
              ["90+ Days", aging?.buckets?.days_90_plus],
            ].map(([label, value]) => (
              <Kpi key={label} label={label} value={money(value || 0)} />
            ))}
          </div>
          <div className="table-container overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due</th>
                  <th className="text-right">Days Overdue</th>
                  <th>Bucket</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(aging?.invoices || []).length === 0 ? (
                  <tr><td colSpan={7} className="text-app-muted">No aged receivables.</td></tr>
                ) : (
                  (aging.invoices || []).map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono">{inv.invoice_no}</td>
                      <td>{customerName(inv.customer_id)}</td>
                      <td>{String(inv.due_date || "").slice(0, 10)}</td>
                      <td className="text-right">{inv.days_overdue || 0}</td>
                      <td>{String(inv.aging_bucket || "").replace(/_/g, " ")}</td>
                      <td className="text-right font-mono">{money(inv.balance)}</td>
                      <td>{STATUS_LABEL[inv.status] || inv.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "policy" && (
        <form className="nx-panel max-w-lg space-y-3" onSubmit={savePolicy}>
          <h2 className="text-sm font-semibold">Credit Limit Control</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!policy.warn_credit_limit}
              disabled={!isOwnerLike}
              onChange={(e) => setPolicy((p) => ({ ...p, warn_credit_limit: e.target.checked }))}
            />
            Warn when credit limit is reached / near limit
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!policy.block_sales_over_credit_limit}
              disabled={!isOwnerLike}
              onChange={(e) => setPolicy((p) => ({ ...p, block_sales_over_credit_limit: e.target.checked }))}
            />
            Block sales when credit limit is exceeded
          </label>
          <label className="block text-sm">
            <span className="text-app-muted">Default payment terms (days)</span>
            <input
              type="number"
              min="0"
              className="nx-input mt-1 w-full"
              disabled={!isOwnerLike}
              value={policy.default_payment_terms_days}
              onChange={(e) => setPolicy((p) => ({ ...p, default_payment_terms_days: Number(e.target.value) || 30 }))}
            />
          </label>
          {isOwnerLike && (
            <button type="submit" className="nx-btn nx-btn-primary" disabled={busy === "policy"}>
              {busy === "policy" ? "Saving…" : "Save Policy"}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
