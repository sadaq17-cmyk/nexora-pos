const safeName = (value) => String(value || "all").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();

function contextLines(analytics, labels) {
  return [
    `Date range: ${analytics.range.start_date} to ${analytics.range.end_date}`,
    `Branch: ${labels.branch || "All branches"}`,
    `Cashier: ${labels.cashier || "All cashiers"}`,
    `Reporting currency: ${labels.currency || "Configured base currency"} (display only; no FX conversion)`,
  ];
}

function metricRows(analytics, money) {
  const s = analytics.summary;
  return [
    ["Sales revenue", money(s.revenue)],
    ["Transactions", s.transactions],
    ["Cash sales", money(s.cashSales)],
    ["Discounts", money(s.discounts)],
    ["VAT", money(s.vat)],
    ["Returns", money(s.returns)],
    ["Refunds", money(s.refunds)],
    ["COGS", money(s.cogs)],
    ["Gross profit", money(s.grossProfit)],
    ["Expenses", money(s.expenses)],
    ["Net profit", money(s.netProfit)],
    ["Profit margin", `${s.profitMargin.toFixed(2)}%`],
  ];
}

function filename(analytics, extension) {
  return `nexora-report-${safeName(analytics.range.start_date)}-${safeName(analytics.range.end_date)}.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportCsv(analytics, money, labels = {}) {
  const rows = [
    ["Nexora POS Pro Analytics Report"],
    ...contextLines(analytics, labels).map((line) => [line]),
    [],
    ["Metric", "Value"],
    ...metricRows(analytics, money),
    [],
    ["Invoice", "Date", "Cashier", "Payment", `Total (${labels.currency || "currency"})`, "Discount", "VAT", "Returns", "Refunds"],
    ...analytics.sales.map((sale) => [
      sale.invoice_no, sale.created_at, sale.cashier, sale.payment_method, money(sale.total),
      money(sale.discount), money(sale.vat), money(sale.returns), money(sale.refunds),
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  download(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), filename(analytics, "csv"));
}

export async function exportExcel(analytics, money, labels = {}) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    ["Nexora POS Pro Analytics Report"],
    ...contextLines(analytics, labels).map((line) => [line]),
    [],
    ["Metric", "Value"],
    ...metricRows(analytics, money),
  ]);
  const transactions = XLSX.utils.json_to_sheet(analytics.sales.map((sale) => ({
    Invoice: sale.invoice_no,
    Date: sale.created_at,
    Cashier: sale.cashier,
    Payment: sale.payment_method,
    [`Total (${labels.currency || "currency"})`]: money(sale.total),
    Discount: money(sale.discount),
    VAT: money(sale.vat),
    Returns: money(sale.returns),
    Refunds: money(sale.refunds),
  })));
  const daily = XLSX.utils.json_to_sheet(analytics.dailyComparison.map((row) => ({
    ...row,
    sales: money(row.sales),
    profit: money(row.profit),
    expenses: money(row.expenses),
  })));
  const products = XLSX.utils.json_to_sheet(analytics.topProducts.map((row) => ({
    ...row,
    revenue: money(row.revenue),
    profit: money(row.profit),
  })));
  XLSX.utils.book_append_sheet(workbook, summary, "Summary");
  XLSX.utils.book_append_sheet(workbook, transactions, "Transactions");
  XLSX.utils.book_append_sheet(workbook, daily, "Daily Comparison");
  XLSX.utils.book_append_sheet(workbook, products, "Top Products");
  XLSX.writeFile(workbook, filename(analytics, "xlsx"));
}

export async function exportPdf(analytics, money, labels = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.setTextColor(37, 99, 235);
  doc.text("Nexora POS Pro", 14, 18);
  doc.setFontSize(12);
  doc.setTextColor(27, 36, 57);
  doc.text("Reports & Analytics", 14, 26);
  doc.setFontSize(9);
  doc.setTextColor(90, 102, 125);
  contextLines(analytics, labels).forEach((line, index) => doc.text(line, 14, 34 + index * 5));
  let y = 55;
  doc.setFontSize(10);
  for (const [label, value] of metricRows(analytics, money)) {
    doc.setTextColor(90, 102, 125);
    doc.text(String(label), 14, y);
    doc.setTextColor(27, 36, 57);
    doc.text(String(value), 105, y, { align: "right" });
    doc.setDrawColor(228, 233, 242);
    doc.line(14, y + 2, 105, y + 2);
    y += 7;
  }
  y += 5;
  doc.setFontSize(11);
  doc.text("Top selling products", 14, y);
  y += 7;
  doc.setFontSize(9);
  analytics.topProducts.slice(0, 8).forEach((row, index) => {
    doc.text(`${index + 1}. ${row.name} (${row.units} units)`, 14, y);
    doc.text(money(row.revenue), 105, y, { align: "right" });
    y += 6;
  });
  doc.save(filename(analytics, "pdf"));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

export function printReport(analytics, money, labels = {}) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1000,height=750");
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups to print this report.");
  const metrics = metricRows(analytics, money).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const sales = analytics.sales.slice(0, 100).map((sale) => `<tr><td>${escapeHtml(sale.invoice_no)}</td><td>${escapeHtml(new Date(sale.created_at).toLocaleString())}</td><td>${escapeHtml(sale.cashier)}</td><td>${escapeHtml(sale.payment_method)}</td><td>${escapeHtml(money(sale.total))}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><title>Nexora POS Pro Analytics Report</title><style>body{font-family:Arial,sans-serif;color:#1B2439;padding:32px}h1{color:#2563EB;margin:0}p{color:#6B7690}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0}.metrics div{border:1px solid #E4E9F2;border-radius:12px;padding:12px}.metrics span{display:block;color:#6B7690;font-size:12px}.metrics strong{display:block;margin-top:5px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #E4E9F2;padding:8px}@media print{body{padding:0}}</style></head><body><h1>Nexora POS Pro</h1><h2>Reports &amp; Analytics</h2><p>${contextLines(analytics, labels).map(escapeHtml).join("<br>")}</p><div class="metrics">${metrics}</div><h3>Transactions</h3><table><thead><tr><th>Invoice</th><th>Date</th><th>Cashier</th><th>Payment</th><th>Total</th></tr></thead><tbody>${sales || '<tr><td colspan="5">No transactions for this period.</td></tr>'}</tbody></table><script>window.onload=()=>window.print();<\/script></body></html>`);
  popup.document.close();
}
