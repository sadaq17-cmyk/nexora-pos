/**
 * Supplier Statement — bank-statement-style print / PDF / Excel / email helpers.
 * Mirrors the conventions in reportExport.js and Suppliers.jsx (jsPDF + xlsx, no server render).
 */

export const ENTRY_TYPE_LABELS = {
  opening: "Opening Balance",
  purchase: "Purchase Invoice",
  payment: "Payment",
  purchase_return: "Purchase Return",
  debit_note: "Debit Note",
  credit_note: "Credit Note",
  adjustment: "Manual Adjustment",
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

/** Builds the full row list including a synthetic Opening Balance row, oldest-first. */
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
    ["Total Purchases", money(s.total_purchases)],
    ["Total Payments", money(s.total_payments)],
    ["Total Returns", money(s.total_returns)],
    ["Total Debit Notes", money(s.total_debit_notes)],
    ["Total Credit Notes", money(s.total_credit_notes)],
    ["Closing Balance", money(s.closing_balance)],
    ["Outstanding Balance", money(s.outstanding_balance)],
  ];
}

function filterLabel(statement, extra = {}) {
  const f = statement?.filters || {};
  const range = f.start_date || f.end_date
    ? `${f.start_date || "…"} to ${f.end_date || "…"}`
    : "All time";
  const branch = extra.branchName || "All branches";
  return `Period: ${range} · Branch: ${branch}`;
}

function filename(supplier, extension) {
  const safe = String(supplier?.code || supplier?.name || supplier?.id || "supplier").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return `supplier-statement-${safe}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function statementHtml(supplier, statement, money, extra = {}) {
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
  return `<h1>Nexora POS Pro</h1>
  <h2>Supplier Statement</h2>
  <div class="meta">
    <div><strong>${escapeHtml(supplier?.name || "")}</strong> ${supplier?.code ? `(${escapeHtml(supplier.code)})` : ""}</div>
    <div class="muted">${escapeHtml(supplier?.address || "")}</div>
    <div class="muted">${supplier?.tax_number ? `Tax PIN: ${escapeHtml(supplier.tax_number)} · ` : ""}${escapeHtml(supplier?.payment_terms || "")}</div>
    <div class="muted">${escapeHtml(filterLabel(statement, extra))}</div>
    <div class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Reference No</th><th>Transaction</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Running Balance</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7">No transactions for this period.</td></tr>'}</tbody>
  </table>
  <h3>Statement Summary</h3>
  <div class="summary">${summary}</div>`;
}

export function printSupplierStatement(supplier, statement, money, extra = {}) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1000,height=750");
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups to print this statement.");
  const html = statementHtml(supplier, statement, money, extra);
  popup.document.write(`<!doctype html><html><head><title>Supplier Statement — ${escapeHtml(supplier?.name || "")}</title>
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

export async function exportSupplierStatementExcel(supplier, statement, money) {
  const XLSX = await import("xlsx");
  const rows = buildStatementRows(statement);
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((e) => ({
      Date: fmtDate(e.entry_date),
      "Reference No": e.reference || "",
      Transaction: entryTypeLabel(e.entry_type),
      Description: e.description || "",
      Debit: Number(e.debit) || 0,
      Credit: Number(e.credit) || 0,
      "Running Balance": Number(e.running_balance) || 0,
    }))
  );
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Nexora POS Pro — Supplier Statement"],
    [`Supplier: ${supplier?.name || ""} ${supplier?.code ? `(${supplier.code})` : ""}`],
    [filterLabel(statement)],
    [],
    ["Statement Summary"],
    ...summaryRows(statement, money),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(book, sheet, "Statement");
  XLSX.writeFile(book, filename(supplier, "xlsx"));
}

async function buildStatementPdfDoc(supplier, statement, money) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const rows = buildStatementRows(statement);

  doc.setFontSize(16);
  doc.setTextColor(37, 99, 235);
  doc.text("Nexora POS Pro", 14, 16);
  doc.setFontSize(11);
  doc.setTextColor(27, 36, 57);
  doc.text("Supplier Statement", 14, 23);
  doc.setFontSize(9);
  doc.setTextColor(90, 102, 125);
  doc.text(`${supplier?.name || ""}${supplier?.code ? ` (${supplier.code})` : ""}`, 14, 31);
  doc.text(filterLabel(statement), 14, 36);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 41);

  let y = 50;
  doc.setFontSize(8);
  doc.setTextColor(107, 118, 144);
  const cols = { date: 14, ref: 38, type: 66, desc: 100, debit: 148, credit: 170, balance: 192 };
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

  doc.setFontSize(8);
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
    doc.setDrawColor(228, 233, 242);
    doc.line(14, y + 2, 90, y + 2);
    y += 6;
  }

  return doc;
}

export async function exportSupplierStatementPdf(supplier, statement, money) {
  const doc = await buildStatementPdfDoc(supplier, statement, money);
  doc.save(filename(supplier, "pdf"));
}

/** Returns { base64, filename } for emailing — no download side effect. */
export async function buildSupplierStatementPdfBase64(supplier, statement, money) {
  const doc = await buildStatementPdfDoc(supplier, statement, money);
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.split(",")[1] || "";
  return { base64, filename: filename(supplier, "pdf") };
}
