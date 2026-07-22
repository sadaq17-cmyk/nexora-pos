import ReceiptQrCode from "./ReceiptQrCode";
import ReceiptBarcode from "./ReceiptBarcode";
import { buildInvoiceQrPayload, resolveReceiptNumber } from "../lib/receiptCodes";
import { paymentMethodLabel } from "../lib/paymentMethods";

/**
 * Current POS receipt template — layout/typography preserved.
 * Only addition: functional SVG QR + CODE128 barcode (no redesign).
 */
export default function ReceiptDocument({
  receipt,
  settings,
  formatMoneyForCurrency,
  print = false,
}) {
  const money = (value) => formatMoneyForCurrency(value, receipt.currency_code);
  const receiptNo = resolveReceiptNumber(receipt);
  const qrValue = buildInvoiceQrPayload({
    invoiceId: receipt.id || receiptNo,
    receiptNo,
  });

  return (
    <div className={print ? "" : "p-6"} style={print ? undefined : { fontFamily: "var(--font-mono)" }}>
      <div className="mb-4 text-center">
        <div className="font-bold">{settings.store_name || "Nexora POS Enterprise"}</div>
        <div className="text-xs text-app-muted">{settings.store_address}</div>
        {settings.store_phone && <div className="text-xs text-app-muted">{settings.store_phone}</div>}
      </div>
      <div className="mb-3 border-y border-dashed border-app py-2 text-xs">
        <div>Receipt: {receiptNo}</div>
        <div>Date: {receipt.time}</div>
        <div>Cashier: {receipt.cashier_name} (@{receipt.cashier_username})</div>
        <div>Branch: {receipt.branch_name}</div>
        <div>Customer: {receipt.customer}</div>
        <div>Currency: {receipt.currency_code} {receipt.currency_symbol}</div>
        {receipt.vat_enabled && settings.tax_pin && <div>Tax PIN: {settings.tax_pin}</div>}
      </div>
      <div className="space-y-2">
        {receipt.items.map((item) => (
          <div key={`${item.id}-${item.name}`} className="flex justify-between gap-3 text-xs">
            <span>
              {item.qty} × {item.name}
              <span className="block text-[10px] text-app-muted">@ {money(item.price)}</span>
            </span>
            <span>{money(item.price * item.qty)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-1 border-t border-dashed border-app pt-3 text-xs">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(receipt.subtotal)}</span></div>
        <div className="flex justify-between"><span>Discount</span><span>-{money(receipt.discountAmt)}</span></div>
        {receipt.vat_enabled && <div className="flex justify-between"><span>VAT ({receipt.vat_rate}%)</span><span>{money(receipt.vat)}</span></div>}
        <div className="flex justify-between pt-1 text-base font-bold"><span>TOTAL</span><span>{money(receipt.total)}</span></div>
        <div className="flex justify-between"><span>Payment</span><span>{paymentMethodLabel(receipt.payment || receipt.payment_method)}</span></div>
        {receipt.card_brand && <div className="flex justify-between"><span>Card</span><span>{receipt.card_brand}</span></div>}
        {(receipt.payment === "CASH" || receipt.payment_method === "CASH") && (
          <>
            <div className="flex justify-between"><span>Cash tendered</span><span>{money(receipt.cash_tendered)}</span></div>
            <div className="flex justify-between"><span>Change</span><span>{money(receipt.change_due)}</span></div>
          </>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-dashed border-app pt-3">
        <ReceiptQrCode value={qrValue} size={print ? 88 : 96} />
        <ReceiptBarcode value={receiptNo} height={print ? 36 : 40} width={print ? 1.1 : 1.2} />
      </div>

      <div className="mt-4 text-center text-xs text-app-muted">
        {settings.receipt_footer || settings.receipt_header || "Thank you for shopping with us!"}
      </div>
    </div>
  );
}
