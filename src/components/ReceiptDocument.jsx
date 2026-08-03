import ReceiptQrCode from "./ReceiptQrCode";
import ReceiptBarcode from "./ReceiptBarcode";
import { buildInvoiceQrPayload, resolveReceiptNumber } from "../lib/receiptCodes";
import { paymentMethodLabel } from "../lib/paymentMethods";

/**
 * POS receipt template — includes credit sale fields when present.
 */
export default function ReceiptDocument({
  receipt,
  settings,
  formatMoneyForCurrency,
  print = false,
}) {
  const money = (value) => formatMoneyForCurrency(value, receipt.currency_code);
  const receiptNo = resolveReceiptNumber(receipt);
  const invoiceNo = receipt.ar_invoice_no || receipt.invoice_no || receiptNo;
  const method = String(receipt.payment || receipt.payment_method || "").toUpperCase();
  const isCredit = method === "CREDIT" || method === "MIXED" || method === "SPLIT";
  const paidAmount = receipt.paid_amount != null
    ? Number(receipt.paid_amount)
    : isCredit
      ? Number(receipt.cash_amount || 0)
      : Number(receipt.total || 0);
  const remaining = receipt.remaining_balance != null
    ? Number(receipt.remaining_balance)
    : isCredit
      ? Math.max(0, Number(receipt.total || 0) - paidAmount)
      : 0;
  const qrValue = buildInvoiceQrPayload({
    invoiceId: receipt.id || receiptNo,
    receiptNo,
  });

  return (
    <div className={print ? "" : "p-6"} style={print ? undefined : { fontFamily: "var(--font-mono)" }}>
      <div className="mb-4 text-center">
        <div className="font-bold">{settings.store_name || "Store"}</div>
        <div className="text-xs text-app-muted">{settings.store_address}</div>
        {settings.store_phone && <div className="text-xs text-app-muted">{settings.store_phone}</div>}
        {settings.tax_pin && <div className="text-xs text-app-muted">Tax PIN: {settings.tax_pin}</div>}
      </div>
      <div className="mb-3 border-y border-dashed border-app py-2 text-xs">
        <div>Receipt: {receiptNo}</div>
        {invoiceNo && invoiceNo !== receiptNo && <div>Invoice: {invoiceNo}</div>}
        {isCredit && invoiceNo === receiptNo && <div>Invoice: {invoiceNo}</div>}
        <div>Date: {receipt.time}</div>
        <div>Cashier: {receipt.cashier_name} (@{receipt.cashier_username})</div>
        <div>Branch: {receipt.branch_name}</div>
        <div>Customer: {receipt.customer}</div>
        <div>Currency: {receipt.currency_code} {receipt.currency_symbol}</div>
      </div>
      <div className="space-y-2">
        {(receipt.items || []).map((item) => (
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
        <div className="flex justify-between"><span>Payment</span><span>{paymentMethodLabel(method)}</span></div>
        {receipt.card_brand && <div className="flex justify-between"><span>Card</span><span>{receipt.card_brand}</span></div>}
        {(method === "CASH") && (
          <>
            <div className="flex justify-between"><span>Cash tendered</span><span>{money(receipt.cash_tendered)}</span></div>
            <div className="flex justify-between"><span>Change</span><span>{money(receipt.change_due)}</span></div>
          </>
        )}
        {isCredit && (
          <>
            <div className="flex justify-between"><span>Paid Amount</span><span>{money(paidAmount)}</span></div>
            <div className="flex justify-between font-semibold"><span>Remaining Balance</span><span>{money(remaining)}</span></div>
            {receipt.payment_terms_days != null && (
              <div className="flex justify-between"><span>Payment Terms</span><span>Net {receipt.payment_terms_days} days</span></div>
            )}
            {receipt.due_date && (
              <div className="flex justify-between"><span>Due Date</span><span>{String(receipt.due_date).slice(0, 10)}</span></div>
            )}
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
