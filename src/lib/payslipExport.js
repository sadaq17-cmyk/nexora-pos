/**
 * Payslip print / PDF helpers — uses existing jspdf + qrcode.
 */

function moneyFmt(value, currency = "KES") {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function buildPayslipPrintHtml(payslip, company = {}, run = {}) {
  const currency = payslip.currency_code || company.currency || "KES";
  const m = (v) => moneyFmt(v, currency);
  const period =
    run.run_label ||
    (run.period_year && run.period_month
      ? `${run.period_year}-${String(run.period_month).padStart(2, "0")}`
      : payslip.hr_payroll_runs?.run_label || "—");
  const lines = Array.isArray(payslip.lines) ? payslip.lines : [];
  const earnings = lines.filter((l) => l.type === "earning");
  const deductions = lines.filter((l) => l.type === "deduction");
  const logo = company.logo_url || company.logo || "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payslip ${payslip.employee_code || ""}</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;margin:24px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
  .logo{max-height:56px;max-width:160px}
  h1{margin:0;font-size:20px} h2{margin:0 0 4px;font-size:16px}
  .muted{color:#64748b} table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}
  th{font-size:11px;text-transform:uppercase;color:#64748b}
  .right{text-align:right} .tot{font-weight:700;font-size:15px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:12px 0}
  .sig{margin-top:40px;display:flex;justify-content:space-between}
  .sig .line{border-top:1px solid #94a3b8;width:200px;padding-top:6px;font-size:11px;color:#64748b}
  @media print{body{margin:12px}}
</style></head><body>
<div class="head">
  <div>
    ${logo ? `<img class="logo" src="${logo}" alt="logo"/>` : ""}
    <h1>${company.name || "Nexora POS Pro"}</h1>
    <div class="muted">${company.address || ""} ${company.phone || ""}</div>
  </div>
  <div style="text-align:right">
    <h2>PAYSLIP</h2>
    <div>Period: <strong>${period}</strong></div>
    <div class="muted">${payslip.qr_payload || ""}</div>
  </div>
</div>
<div class="grid">
  <div><span class="muted">Employee</span><br/><strong>${payslip.employee_name || ""}</strong> (${payslip.employee_code || ""})</div>
  <div><span class="muted">Department / Position</span><br/>${payslip.department || "—"} / ${payslip.position || "—"}</div>
  <div><span class="muted">Bank</span><br/>${payslip.bank_name || "—"} · ${payslip.bank_account || "—"}</div>
  <div><span class="muted">Days worked / OT hrs</span><br/>${payslip.days_worked ?? "—"} / ${payslip.overtime_hours ?? 0}</div>
</div>
<table>
  <thead><tr><th>Earnings</th><th class="right">Amount</th></tr></thead>
  <tbody>
    ${earnings.map((l) => `<tr><td>${l.label}</td><td class="right">${m(l.amount)}</td></tr>`).join("") || `<tr><td>Gross components</td><td class="right">${m(payslip.gross_pay)}</td></tr>`}
    <tr class="tot"><td>Gross Pay</td><td class="right">${m(payslip.gross_pay)}</td></tr>
  </tbody>
</table>
<table>
  <thead><tr><th>Deductions</th><th class="right">Amount</th></tr></thead>
  <tbody>
    ${deductions.map((l) => `<tr><td>${l.label}</td><td class="right">${m(l.amount)}</td></tr>`).join("")}
    <tr class="tot"><td>Total Deductions</td><td class="right">${m(payslip.total_deductions)}</td></tr>
  </tbody>
</table>
<p class="tot" style="margin-top:16px">Net Pay: ${m(payslip.net_pay)}</p>
<div class="sig">
  <div class="line">Employee signature</div>
  <div class="line">Authorized / digital sign-off${payslip.signed_at ? ` · ${payslip.signed_at}` : ""}</div>
</div>
<script>window.onload=()=>window.print()</script>
</body></html>`;
}

export function printPayslip(payslip, company = {}, run = {}) {
  const html = buildPayslipPrintHtml(payslip, company, run);
  const w = window.open("", "_blank", "noopener,noreferrer,width=800,height=900");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

export async function downloadPayslipPdf(payslip, company = {}, run = {}) {
  const { jsPDF } = await import("jspdf");
  let QRCode = null;
  try {
    QRCode = (await import("qrcode")).default;
  } catch {
    /* optional */
  }
  const currency = payslip.currency_code || "KES";
  const m = (v) => moneyFmt(v, currency);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(company.name || "Nexora POS Pro", 14, y);
  y += 7;
  doc.setFontSize(12);
  doc.text("PAYSLIP", 196, 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const period =
    run.run_label ||
    payslip.hr_payroll_runs?.run_label ||
    `${payslip.hr_payroll_runs?.period_year || ""}-${payslip.hr_payroll_runs?.period_month || ""}`;
  doc.text(`Period: ${period}`, 196, 22, { align: "right" });
  y += 4;
  doc.text(`${payslip.employee_name || ""} (${payslip.employee_code || ""})`, 14, y);
  y += 5;
  doc.text(`${payslip.department || "—"} · ${payslip.position || "—"}`, 14, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text("Earnings", 14, y);
  doc.text("Deductions", 110, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  const lines = Array.isArray(payslip.lines) ? payslip.lines : [];
  const earnings = lines.filter((l) => l.type === "earning");
  const deductions = lines.filter((l) => l.type === "deduction");
  const maxRows = Math.max(earnings.length, deductions.length, 1);
  for (let i = 0; i < maxRows; i++) {
    if (earnings[i]) {
      doc.text(String(earnings[i].label), 14, y);
      doc.text(m(earnings[i].amount), 95, y, { align: "right" });
    }
    if (deductions[i]) {
      doc.text(String(deductions[i].label), 110, y);
      doc.text(m(deductions[i].amount), 196, y, { align: "right" });
    }
    y += 5;
  }
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text(`Gross: ${m(payslip.gross_pay)}`, 14, y);
  doc.text(`Deductions: ${m(payslip.total_deductions)}`, 110, y);
  y += 7;
  doc.setFontSize(12);
  doc.text(`Net Pay: ${m(payslip.net_pay)}`, 14, y);
  y += 10;
  if (QRCode && payslip.qr_payload) {
    try {
      const dataUrl = await QRCode.toDataURL(String(payslip.qr_payload), { margin: 0, width: 120 });
      doc.addImage(dataUrl, "PNG", 160, y, 28, 28);
    } catch {
      /* ignore */
    }
  }
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Authorized digital payslip — Nexora Payroll", 14, 285);
  doc.save(`payslip-${payslip.employee_code || payslip.id}-${period}.pdf`);
  return true;
}

export async function exportBankTransfer(rows, { format = "csv", filename } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const name = filename || `bank-transfer-${new Date().toISOString().slice(0, 10)}`;
  if (format === "excel") {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      list.map((r) => ({
        "Employee Code": r.employee_code,
        "Employee Name": r.employee_name,
        Bank: r.bank_name,
        Account: r.bank_account,
        Amount: r.amount,
        Currency: r.currency,
        Reference: r.reference,
      }))
    );
    XLSX.utils.book_append_sheet(wb, sheet, "Bank Transfer");
    XLSX.writeFile(wb, `${name}.xlsx`);
    return;
  }
  const header = ["Employee Code", "Employee Name", "Bank", "Account", "Amount", "Currency", "Reference"];
  const csv = [
    header.join(","),
    ...list.map((r) =>
      [r.employee_code, r.employee_name, r.bank_name, r.bank_account, r.amount, r.currency, r.reference]
        .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
