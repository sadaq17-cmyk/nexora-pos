import { Banknote, CreditCard, Smartphone } from "lucide-react";

export const CARD_BRANDS = Object.freeze([
  { id: "VISA", label: "Visa" },
  { id: "MASTERCARD", label: "Mastercard" },
  { id: "AMEX", label: "Amex" },
]);

/** POS checkout methods — Cash, Card, and M-Pesa only. */
export const PAYMENT_METHODS = Object.freeze([
  { id: "CASH", label: "Cash", icon: Banknote, enabled: true },
  { id: "CARD", label: "Card", icon: CreditCard, enabled: true, brands: CARD_BRANDS },
  { id: "MPESA", label: "M-Pesa", icon: Smartphone, enabled: true },
]);

export const ACTIVE_PAYMENT_METHODS = PAYMENT_METHODS.filter((method) => method.enabled);
export const DEFAULT_PAYMENT_METHOD = "CASH";

const METHOD_ALIASES = {
  CASH: "CASH",
  CARD: "CARD",
  CREDIT_CARD: "CARD",
  DEBIT_CARD: "CARD",
  VISA: "CARD",
  MASTERCARD: "CARD",
  AMEX: "CARD",
  MPESA: "MPESA",
  M_PESA: "MPESA",
  "M-PESA": "MPESA",
  MOBILE_MONEY: "MPESA",
};

export function normalizePaymentMethod(methodId) {
  const key = String(methodId || "").trim().toUpperCase().replace(/\s+/g, "_");
  return METHOD_ALIASES[key] || key;
}

export function isPaymentMethodEnabled(methodId) {
  const normalized = normalizePaymentMethod(methodId);
  return ACTIVE_PAYMENT_METHODS.some((method) => method.id === normalized);
}

export function paymentMethodLabel(methodId) {
  const normalized = normalizePaymentMethod(methodId);
  return ACTIVE_PAYMENT_METHODS.find((method) => method.id === normalized)?.label || normalized || "Unknown";
}

export function normalizeCardBrand(brand) {
  const key = String(brand || "").trim().toUpperCase();
  return CARD_BRANDS.some((entry) => entry.id === key) ? key : "";
}

/**
 * Validates a sale payment payload for checkout (Cash / Card / M-Pesa).
 */
export function validateSalePayment({
  payment_method,
  total,
  cash_tendered,
  card_brand,
  mpesa_reference,
} = {}) {
  const method = normalizePaymentMethod(payment_method);
  if (!isPaymentMethodEnabled(method)) {
    return { success: false, error: "That payment method is not enabled for checkout." };
  }

  const saleTotal = Number(total);
  if (!Number.isFinite(saleTotal) || saleTotal < 0) {
    return { success: false, error: "Sale total is invalid." };
  }

  if (method === "CASH") {
    const tendered = cash_tendered === undefined || cash_tendered === null || cash_tendered === ""
      ? saleTotal
      : Number(cash_tendered);
    if (!Number.isFinite(tendered) || tendered < saleTotal) {
      return { success: false, error: "Cash tendered must cover the sale total." };
    }
    return {
      success: true,
      payment_method: "CASH",
      cash_tendered: tendered,
      change_due: Math.max(0, tendered - saleTotal),
      card_brand: "",
      split_payments: [],
      payment_reference: "",
    };
  }

  if (method === "CARD") {
    const brand = normalizeCardBrand(card_brand);
    if (!brand) {
      return { success: false, error: "Select a card brand (Visa, Mastercard, or Amex)." };
    }
    return {
      success: true,
      payment_method: "CARD",
      cash_tendered: saleTotal,
      change_due: 0,
      card_brand: brand,
      split_payments: [],
      payment_reference: "",
    };
  }

  if (method === "MPESA") {
    return {
      success: true,
      payment_method: "MPESA",
      cash_tendered: saleTotal,
      change_due: 0,
      card_brand: "",
      split_payments: [],
      payment_reference: String(mpesa_reference || "").trim(),
    };
  }

  return { success: false, error: "Unsupported payment method." };
}
