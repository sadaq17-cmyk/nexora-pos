/**
 * Customer Statement — print / PDF / Excel / share helpers for Accounts Receivable.
 */

export const ENTRY_TYPE_LABELS = {
  opening: "Opening Balance",
  invoice: "Credit Invoice",
  payment: "Payment",
  credit_note: "Credit Note",
  adjustment: "Adjustment",
};

export function entryTypeLabel(type) {
  return ENTRY_TYPE_LABELS[String(type || "")] || String(type || "—");
}

function fmtDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]
  ));
}

export function buildStatementRows(statement) {
  const ledgerAsc = [...(statement?.ledger || [])].sort((a, b) =>
    String(a.entry_date).localeCompare(String(b.entry_date))
  );
  const openingRow = {
    entry_date: statement?.filters?.start_date || ledgerAsc[0]?.entry_date || null,
    entry_type: "opening",
    reference: "OPENING",
    description: "Opening Balance",
    debit: 0,
    credit: 0,
    running_balance: Number(statement?.opening_balance) || 0,
    isOpening: true,
  };
  return [openingRow, ...ledgerAsc];
}

function summaryRows(statement, money) {
  const s = statement?.summary || {};
  return [
    ["Opening Balance", money(s.opening_balance)],
    ["Total Invoices", money(s.total_invoices)],
    ["Total Payments", money(s.total_payments)],
    ["Total Credit Notes", money(s.total_credit_notes)],
    ["Closing Balance", money(s.closing_balance)],
    ["Outstanding Balance", money(s.outstanding_balance)],
  ];
}

function filterLabel(statement) {
  const f = statement?.filters || {};
  return f.start_date || f.end_date
    ? `Period: ${f.start_date || "…"} to ${f.end_date || "…"}`
    : "Period: All time";
}

function filename(customer, extension) {
  const safe = String(customer?.name || customer?.id || "customer").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return `customer-statement-${safe}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function statementHtml(customer, statement, money) {
  const rows = buildStatementRows(statement);
  const body = rows
    .map((e) => {
      const debit = Number(e.debit) ? money(e.debit) : "";
      const credit = Number(e.credit) ? money(e.credit) : "";
      const rowClass = e.isOpening ? ' class="opening"' : "";
      return `<tr${rowClass}>
        <td>${escapeHtml(fmtDate(e.entry_date))}</td>
        <td>${escapeHtml(e.reference || "—")}</td>
        <td>${escapeHtml(entryTypeLabel(e.entry_type))}</td>
        <td>${escapeHtml(e.description || "")}</td>
        <td class="num">${escapeHtml(debit)}</td>
        <td class="num">${escapeHtml(credit)}</td>
        <td class="num strong">${escapeHtml(money(e.running_balance))}</td>
      </tr>`;
    })
    .join("");
  const summary = summaryRows(statement, money)
    .map(([label, value]) => `<div class="s-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  const account = statement?.account || {};
  return `<h1>Nexora POS Pro</h1>
  <h2>Customer Statement</h2>
  <div class="meta">
    <div><strong>${escapeHtml(customer?.name || "")}</strong></div>
    <div class="muted">${escapeHtml(customer?.phone || "")} ${customer?.email ? `· ${escapeHtml(customer.email)}` : ""}</div>
    <div class="muted">Credit limit: ${escapeHtml(money(account.credit_limit || customer?.credit_limit || 0))} · Available: ${escapeHtml(money(account.available_credit ?? 0))}</div>
    <div class="muted">${escapeHtml(filterLabel(statement))}</div>
    <div class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Reference</th><th>Transaction</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Running Balance</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7">No transactions for this period.</td></tr>'}</tbody>
  </table>
  <h3>Statement Summary</h3>
  <div class="summary">${summary}</div>`;
}

export function printCustomerStatement(customer, statement, money) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1000,height=750");
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups to print this statement.");
  const html = statementHtml(customer, statement, money);
  popup.document.write(`<!doctype html><html><head><title>Customer Statement — ${escapeHtml(customer?.name || "")}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1B2439;padding:32px;max-width:1000px;margin:0 auto}
      h1{color:#2563EB;margin:0;font-size:20px} h2{margin:2px 0 12px;font-size:15px;color:#1B2439}
      h3{margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6B7690}
      .meta{margin-bottom:14px;font-size:12px} .meta .muted{color:#6B7690;margin-top:2px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{text-align:left;border-bottom:1px solid #E4E9F2;padding:7px 8px}
      th{background:#F5F7FB;text-transform:uppercase;font-size:10px;letter-spacing:.04em;color:#6B7690}
      td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
      td.strong{font-weight:600}
      tr.opening td{background:#F5F7FB;font-weight:600}
      .summary{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;font-size:12px;border:1px solid #E4E9F2;border-radius:10px;padding:14px}
      .s-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #E4E9F2}
      .s-row:last-child,.s-row:nth-last-child(2){border-bottom:none;font-weight:700;color:#2563EB}
      @media print{body{padding:0}}
    </style></head><body>${html}<script>window.onload=()=>window.print();<\/script></body></html>`);
  popup.document.close();
  return popup;
}

export async function exportCustomerStatementExcel(customer, statement, money) {
  const XLSX = await import("xlsx");
  const rows = buildStatementRows(statement);
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((e) => ({
      Date: fmtDate(e.entry_date),
      Reference: e.reference || "",
      Transaction: entryTypeLabel(e.entry_type),
      Description: e.description || "",
      Debit: Number(e.debit) || 0,
      Credit: Number(e.credit) || 0,
      "Running Balance": Number(e.running_balance) || 0,
    }))
  );
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Nexora POS Pro — Customer Statement"],
    [`Customer: ${customer?.name || ""}`],
    [filterLabel(statement)],
    [],
    ["Statement Summary"],
    ...summaryRows(statement, money),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(book, sheet, "Statement");
  XLSX.writeFile(book, filename(customer, "xlsx"));
}

async function buildStatementPdfDoc(customer, statement, money) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const rows = buildStatementRows(statement);

  doc.setFontSize(16);
  doc.setTextColor(37, 99, 235);
  doc.text("Nexora POS Pro", 14, 16);
  doc.setFontSize(11);
  doc.setTextColor(27, 36, 57);
  doc.text("Customer Statement", 14, 23);
  doc.setFontSize(9);
  doc.setTextColor(90, 102, 125);
  doc.text(String(customer?.name || ""), 14, 31);
  doc.text(filterLabel(statement), 14, 36);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 41);

  let y = 50;
  doc.setFontSize(8);
  const cols = { date: 14, ref: 38, type: 66, desc: 100, debit: 148, credit: 170, balance: 192 };
  doc.setTextColor(107, 118, 144);
  doc.text("Date", cols.date, y);
  doc.text("Ref", cols.ref, y);
  doc.text("Transaction", cols.type, y);
  doc.text("Description", cols.desc, y);
  doc.text("Debit", cols.debit, y, { align: "right" });
  doc.text("Credit", cols.credit, y, { align: "right" });
  doc.text("Balance", cols.balance, y, { align: "right" });
  y += 3;
  doc.setDrawColor(228, 233, 242);
  doc.line(14, y, 196, y);
  y += 5;

  for (const e of rows) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.setTextColor(27, 36, 57);
    if (e.isOpening) doc.setFont(undefined, "bold");
    doc.text(fmtDate(e.entry_date), cols.date, y);
    doc.text(String(e.reference || "—").slice(0, 14), cols.ref, y);
    doc.text(entryTypeLabel(e.entry_type).slice(0, 18), cols.type, y);
    doc.text(String(e.description || "").slice(0, 24), cols.desc, y);
    doc.text(Number(e.debit) ? money(e.debit) : "", cols.debit, y, { align: "right" });
    doc.text(Number(e.credit) ? money(e.credit) : "", cols.credit, y, { align: "right" });
    doc.text(money(e.running_balance), cols.balance, y, { align: "right" });
    if (e.isOpening) doc.setFont(undefined, "normal");
    y += 6;
  }

  y += 6;
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(10);
  doc.setTextColor(27, 36, 57);
  doc.text("Statement Summary", 14, y);
  y += 7;
  doc.setFontSize(9);
  for (const [label, value] of summaryRows(statement, money)) {
    doc.setTextColor(90, 102, 125);
    doc.text(label, 14, y);
    doc.setTextColor(27, 36, 57);
    doc.text(String(value), 90, y, { align: "right" });
    y += 6;
  }
  return doc;
}

export async function exportCustomerStatementPdf(customer, statement, money) {
  const doc = await buildStatementPdfDoc(customer, statement, money);
  doc.save(filename(customer, "pdf"));
}

export async function buildCustomerStatementPdfBase64(customer, statement, money) {
  const doc = await buildStatementPdfDoc(customer, statement, money);
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.split(",")[1] || "";
  return { base64, filename: filename(customer, "pdf") };
}

export function shareCustomerStatementWhatsApp(customer, statement, money) {
  const s = statement?.summary || {};
  const phone = String(customer?.phone || "").replace(/\D/g, "");
  const text = [
    `*Customer Statement — ${customer?.name || ""}*`,
    filterLabel(statement),
    `Opening: ${money(s.opening_balance)}`,
    `Invoices: ${money(s.total_invoices)}`,
    `Payments: ${money(s.total_payments)}`,
    `Credit notes: ${money(s.total_credit_notes)}`,
    `Closing: ${money(s.closing_balance)}`,
    `Outstanding: ${money(s.outstanding_balance)}`,
  ].join("\n");
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function printPaymentReceipt(payment, customer, money, allocations = []) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=420,height=640");
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups to print the receipt.");
  const lines = (allocations || [])
    .map((a) => `<tr><td>${escapeHtml(a.invoice_no || a.invoice_id || "")}</td><td class="num">${escapeHtml(money(a.amount))}</td></tr>`)
    .join("");
  popup.document.write(`<!doctype html><html><head><title>Receipt ${escapeHtml(payment?.receipt_no || "")}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;padding:20px;max-width:360px;margin:0 auto;color:#1B2439}
      h1{font-size:16px;margin:0;color:#2563EB} h2{font-size:13px;margin:4px 0 12px}
      .muted{color:#6B7690;font-size:12px} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
      td{padding:4px 0;border-bottom:1px dashed #E4E9F2} td.num{text-align:right}
      .total{font-weight:700;font-size:14px;margin-top:12px;display:flex;justify-content:space-between}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>Nexora POS Pro</h1>
    <h2>Payment Receipt</h2>
    <div class="muted">${escapeHtml(payment?.receipt_no || "")}</div>
    <div><strong>${escapeHtml(customer?.name || "")}</strong></div>
    <div class="muted">${escapeHtml(new Date(payment?.created_at || Date.now()).toLocaleString())}</div>
    <div class="muted">Method: ${escapeHtml(payment?.method || "Cash")}</div>
    ${lines ? `<table><tbody>${lines}</tbody></table>` : ""}
    <div class="total"><span>Amount Paid</span><span>${escapeHtml(money(payment?.amount))}</span></div>
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  popup.document.close();
}
