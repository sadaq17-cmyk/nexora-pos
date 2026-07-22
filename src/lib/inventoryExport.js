/** Client helpers for Inventory Management exports and status labels */

export function productLifecycle(p) {
  if (p?.deleted_at) return "Deleted";
  if (p?.archived_at) return "Archived";
  if (Number(p?.stock) <= 0) return "Out";
  if (Number(p?.stock) <= Number(p?.reorder_level || 0)) return "Low";
  if (Number(p?.max_stock) > 0 && Number(p?.stock) >= Number(p?.max_stock)) return "Overstock";
  return "In stock";
}

export function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadExcel(filename, sheets) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows?.length ? rows : [{ note: "No data" }]);
    XLSX.utils.book_append_sheet(book, ws, String(name).slice(0, 31));
  }
  XLSX.writeFile(book, filename);
}

export async function downloadPdf(title, lines = []) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(10);
  let y = 64;
  for (const line of lines.slice(0, 60)) {
    doc.text(String(line).slice(0, 110), 40, y);
    y += 14;
    if (y > 780) break;
  }
  doc.save(`${title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function parseProductImportRows(workbookOrCsvText) {
  // Accept either xlsx workbook rows or CSV-parsed objects
  if (!Array.isArray(workbookOrCsvText)) return [];
  return workbookOrCsvText
    .map((row) => ({
      name: row.name || row.Name || row.product || row.Product || "",
      barcode: row.barcode || row.Barcode || "",
      sku: row.sku || row.SKU || "",
      price: row.price || row.Price || row.selling_price || 0,
      cost: row.cost || row.Cost || 0,
      wholesale_price: row.wholesale_price || row.wholesale || 0,
      discount_percent: row.discount_percent || row.discount || 0,
      stock: row.stock || row.Stock || row.qty || 0,
      reorder_level: row.reorder_level || row.reorder || 10,
      max_stock: row.max_stock || row.overstock || 0,
      unit: row.unit || row.Unit || "pcs",
      tax_rate: row.tax_rate || row.tax || 0,
      tax_inclusive: row.tax_inclusive || false,
      expiry_date: row.expiry_date || row.expiry || null,
      stock_preference: row.stock_preference || "none",
    }))
    .filter((r) => String(r.name || "").trim());
}
