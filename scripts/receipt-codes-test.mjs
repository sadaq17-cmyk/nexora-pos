/**
 * Verifies QR generation + receipt number rules (Node).
 * Run: node scripts/receipt-codes-test.mjs
 */
import QRCode from "qrcode";
import {
  buildInvoiceQrPayload,
  formatReceiptNumber,
  resolveReceiptNumber,
} from "../src/lib/receiptCodes.js";

const receiptNo = formatReceiptNumber(4567, new Date("2025-06-01T12:00:00.000Z"));
if (receiptNo !== "NX-2025-0004567") {
  throw new Error(`Unexpected receipt number: ${receiptNo}`);
}

const onlineUrl = buildInvoiceQrPayload({
  invoiceId: "4567",
  receiptNo,
  online: true,
});
if (!onlineUrl.startsWith("https://www.nexorapospro.com/invoice/4567")) {
  throw new Error(`Unexpected online QR payload: ${onlineUrl}`);
}

const offlinePayload = buildInvoiceQrPayload({
  invoiceId: "4567",
  receiptNo,
  online: false,
});
if (offlinePayload !== receiptNo) {
  throw new Error(`Offline QR must encode receipt number exactly. Got: ${offlinePayload}`);
}

const svg = await QRCode.toString(onlineUrl, {
  type: "svg",
  errorCorrectionLevel: "Q",
  margin: 1,
  width: 128,
});
if (!svg.includes("<svg")) {
  throw new Error("QR SVG markup was not generated.");
}

const qr = QRCode.create(onlineUrl, { errorCorrectionLevel: "Q" });
if (!qr.modules?.size || qr.modules.size < 21) {
  throw new Error("QR module matrix was not generated.");
}

const resolved = resolveReceiptNumber({ receipt_no: receiptNo, id: 1 });
if (resolved !== receiptNo) {
  throw new Error("resolveReceiptNumber mismatch.");
}

console.log("PASS receipt QR + receipt-number tests");
console.log({
  receiptNo,
  onlineUrl,
  offlinePayload,
  qrSvgBytes: svg.length,
  qrModules: qr.modules.size,
});
