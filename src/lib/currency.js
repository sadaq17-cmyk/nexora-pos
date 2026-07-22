export const DEFAULT_CURRENCY_CODE = "KES";

// TZS, UGX, and RWF use zero display decimals by policy; stored amounts are not rounded or converted.
export const CURRENCIES = Object.freeze([
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE", decimals: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US", decimals: 2 },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh.So", locale: "so-SO", decimals: 2 },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", locale: "am-ET", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "en-AE", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", locale: "ar-SA", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB", decimals: 2 },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", locale: "sw-TZ", decimals: 0 },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", locale: "en-UG", decimals: 0 },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", locale: "rw-RW", decimals: 0 },
  { code: "CDF", name: "Congolese Franc", symbol: "FC", locale: "en-CD", decimals: 2 },
].map(Object.freeze));

const currencyMap = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export function normalizeCurrencyCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return currencyMap.has(normalized) ? normalized : (normalized || DEFAULT_CURRENCY_CODE);
}

export function isSupportedCurrency(code) {
  return currencyMap.has(String(code || "").trim().toUpperCase());
}

export function getCurrency(code = DEFAULT_CURRENCY_CODE) {
  const key = String(code || "").trim().toUpperCase();
  return currencyMap.get(key) || {
    code: key || DEFAULT_CURRENCY_CODE,
    name: key || DEFAULT_CURRENCY_CODE,
    symbol: key || DEFAULT_CURRENCY_CODE,
    locale: "en-US",
    decimals: 2,
  };
}

export function getCurrencyLabel(code = DEFAULT_CURRENCY_CODE) {
  const currency = getCurrency(code);
  return `${currency.code} — ${currency.name} (${currency.symbol})`;
}

export function formatCurrency(value, code = DEFAULT_CURRENCY_CODE, options = {}) {
  const currency = getCurrency(code);
  const parsed = typeof value === "string" && value.trim() === "" ? 0 : Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const {
    minimumFractionDigits: requestedMinimum,
    maximumFractionDigits: requestedMaximum,
    ...numberOptions
  } = options || {};
  const maximumFractionDigits = requestedMaximum ?? currency.decimals;
  const minimumFractionDigits = requestedMinimum ?? Math.min(currency.decimals, maximumFractionDigits);

  try {
    const formatted = new Intl.NumberFormat(currency.locale, {
      minimumFractionDigits,
      maximumFractionDigits,
      ...numberOptions,
    }).format(amount);
    return `${currency.code} ${currency.symbol} ${formatted}`;
  } catch {
    return `${currency.code} ${currency.symbol} ${amount.toFixed(currency.decimals)}`;
  }
}

/** Alias used across enterprise UI */
export const formatMoney = formatCurrency;

export function roundMoney(value, decimals = 2) {
  const d = Math.max(0, Math.min(6, Number(decimals) || 2));
  const f = 10 ** d;
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  return Math.round((amount + Number.EPSILON) * f) / f;
}

/**
 * Convert amount in a currency to base using that currency's exchange_rate_to_base.
 * rateToBase means: 1 unit of currency = rateToBase units of base.
 */
export function convertToBase(amount, rateToBase = 1, decimals = 2) {
  const rate = Number(rateToBase);
  if (!Number.isFinite(rate) || rate <= 0) return roundMoney(amount, decimals);
  return roundMoney(Number(amount || 0) * rate, decimals);
}

/** Convert a base-currency amount into another currency. */
export function convertFromBase(baseAmount, rateToBase = 1, decimals = 2) {
  const rate = Number(rateToBase);
  if (!Number.isFinite(rate) || rate <= 0) return roundMoney(baseAmount, decimals);
  return roundMoney(Number(baseAmount || 0) / rate, decimals);
}

export function getActiveCurrencies(currencies = []) {
  return (currencies || []).filter((c) => c && c.is_active !== false);
}

export function getBaseCurrency(currencies = [], fallbackCode = DEFAULT_CURRENCY_CODE) {
  const list = currencies || [];
  return list.find((c) => c.is_base) || list.find((c) => c.code === fallbackCode) || {
    code: fallbackCode,
    name: getCurrency(fallbackCode).name,
    symbol: getCurrency(fallbackCode).symbol,
    exchange_rate_to_base: 1,
    is_base: true,
    is_active: true,
  };
}

export function getDefaultCurrency(currencies = [], fallbackCode = DEFAULT_CURRENCY_CODE) {
  const list = currencies || [];
  return list.find((c) => c.is_default && c.is_active !== false)
    || getBaseCurrency(list, fallbackCode);
}

/**
 * FX gain/loss when settling an invoice amount with a payment in possibly different currencies.
 * Both amounts are converted to base via their rates. Positive = gain (payment covers less base).
 */
export function computeFxGainLoss({
  invoiceAmount,
  invoiceRateToBase = 1,
  paymentAmount,
  paymentRateToBase = 1,
  decimals = 2,
} = {}) {
  const invoiceBase = convertToBase(invoiceAmount, invoiceRateToBase, decimals);
  const paymentBase = convertToBase(paymentAmount, paymentRateToBase, decimals);
  return roundMoney(invoiceBase - paymentBase, decimals);
}

export function isMultiCurrencyEnabled(settings = {}) {
  const raw = settings.enable_multi_currency;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  return false;
}

export function adminCanEditRates(settings = {}) {
  const raw = settings.admin_can_edit_rates;
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}
