import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { buildInvoiceQrPayload, resolveReceiptNumber } from "./receiptCodes";
import { paymentMethodLabel } from "./paymentMethods";

function drawQrVector(doc, payload, x, y, sizeMm) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "Q" });
  const size = qr.modules.size;
  const cell = sizeMm / size;
  doc.setFillColor(15, 23, 42);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) {
        doc.rect(x + col * cell, y + row * cell, cell, cell, "F");
      }
    }
  }
  return sizeMm;
}

function drawCode128Vector(doc, value, x, y, maxWidthMm, heightMm = 12) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, String(value), {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    height: 40,
    width: 1.2,
    background: "#ffffff",
    lineColor: "#000000",
  });
  const rects = [...svg.querySelectorAll("rect")];
  if (!rects.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const bars = rects.map((rect) => {
    const rx = Number(rect.getAttribute("x") || 0);
    const ry = Number(rect.getAttribute("y") || 0);
    const rw = Number(rect.getAttribute("width") || 0);
    const rh = Number(rect.getAttribute("height") || 0);
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx + rw);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry + rh);
    return { x: rx, y: ry, w: rw, h: rh, fill: rect.getAttribute("fill") };
  });
  const srcW = Math.max(1, maxX - minX);
  const scale = maxWidthMm / srcW;
  doc.setFillColor(15, 23, 42);
  bars.forEach((bar) => {
    if (bar.fill === "#ffffff" || bar.fill === "#FFFFFF" || bar.fill === "white") return;
    if (bar.w <= 0 || bar.h <= 0) return;
    // Only draw dark bars (skip full background rects)
    if (bar.w >= srcW * 0.95) return;
    doc.rect(x + (bar.x - minX) * scale, y + (bar.y - minY) * (heightMm / Math.max(1, maxY - minY)), bar.w * scale, heightMm, "F");
  });
  return maxWidthMm;
}

/**
 * Build a thermal-friendly PDF with vector QR + CODE128 (no rasterization).
 */
export async function downloadReceiptPdf(receipt, settings, formatMoneyForCurrency) {
  const { jsPDF } = await import("jspdf");
  const receiptNo = resolveReceiptNumber(receipt);
  const qrPayload = buildInvoiceQrPayload({
    invoiceId: receipt.id || receiptNo,
    receiptNo,
  });
  const money = (value) => formatMoneyForCurrency(value, receipt.currency_code);
  const doc = new jsPDF({ unit: "mm", format: [80, Math.max(180, 110 + (receipt.items?.length || 0) * 7)] });
  let y = 8;
  const line = (left, right = "", bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 8);
    doc.text(String(left), 5, y);
    if (right) doc.text(String(right), 75, y, { align: "right" });
    y += 5;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(settings.store_name || "Nexora POS Pro", 40, y, { align: "center" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  if (settings.store_address) {
    doc.text(String(settings.store_address), 40, y, { align: "center" });
    y += 4;
  }
  line(`Receipt: ${receiptNo}`);
  line(`Date: ${receipt.time}`);
  line(`Cashier: ${receipt.cashier_name} (@${receipt.cashier_username})`);
  line(`Branch: ${receipt.branch_name}`);
  line(`Customer: ${receipt.customer}`);
  line(`Currency: ${receipt.currency_code} ${receipt.currency_symbol}`);
  doc.line(5, y - 1, 75, y - 1);
  y += 3;
  (receipt.items || []).forEach((item) => {
    line(`${item.qty} x ${item.name}`, money(item.price * item.qty));
  });
  doc.line(5, y - 1, 75, y - 1);
  y += 3;
  line("Subtotal", money(receipt.subtotal));
  line("Discount", `-${money(receipt.discountAmt)}`);
  if (receipt.vat_enabled) line(`VAT (${receipt.vat_rate}%)`, money(receipt.vat));
  line("TOTAL", money(receipt.total), true);
  line("Payment", paymentMethodLabel(receipt.payment || receipt.payment_method));
  if ((receipt.payment || receipt.payment_method) === "CASH") {
    line("Cash tendered", money(receipt.cash_tendered));
    line("Change", money(receipt.change_due));
  }

  y += 2;
  const qrSize = 28;
  const qrX = (80 - qrSize) / 2;
  drawQrVector(doc, qrPayload, qrX, y, qrSize);
  y += qrSize + 4;
  doc.setFontSize(7);
  doc.text("Scan to verify invoice", 40, y, { align: "center" });
  y += 4;
  drawCode128Vector(doc, receiptNo, 8, y, 64, 12);
  y += 16;
  doc.setFontSize(8);
  doc.text(receiptNo, 40, y, { align: "center" });
  y += 6;
  doc.setFontSize(7);
  const footer = settings.receipt_footer || settings.receipt_header || "Thank you for shopping with us!";
  doc.text(String(footer), 40, y, { align: "center", maxWidth: 70 });

  doc.save(`${receiptNo}.pdf`);
  return { success: true, receipt_no: receiptNo };
}
