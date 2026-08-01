export const DEFAULT_CURRENCY_CODE = "KES";
export const DEFAULT_COUNTRY_CODE = "KE";

/**
 * Enterprise currency catalog.
 * TZS, UGX, RWF, BIF, SSP, UGX-class francs often display with 0 decimals;
 * stored amounts are never auto-converted when company currency changes.
 */
export const CURRENCIES = Object.freeze(
  [
    { code: "KES", name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE", decimals: 2 },
    { code: "UGX", name: "Ugandan Shilling", symbol: "USh", locale: "en-UG", decimals: 0 },
    { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", locale: "sw-TZ", decimals: 0 },
    { code: "RWF", name: "Rwandan Franc", symbol: "FRw", locale: "rw-RW", decimals: 0 },
    { code: "ETB", name: "Ethiopian Birr", symbol: "Br", locale: "am-ET", decimals: 2 },
    { code: "SOS", name: "Somali Shilling", symbol: "Sh.So", locale: "so-SO", decimals: 2 },
    { code: "SSP", name: "South Sudanese Pound", symbol: "£", locale: "en-SS", decimals: 2 },
    { code: "BIF", name: "Burundian Franc", symbol: "FBu", locale: "fr-BI", decimals: 0 },
    { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA", decimals: 2 },
    { code: "CDF", name: "Congolese Franc", symbol: "FC", locale: "fr-CD", decimals: 2 },
    { code: "NGN", name: "Nigerian Naira", symbol: "₦", locale: "en-NG", decimals: 2 },
    { code: "GHS", name: "Ghanaian Cedi", symbol: "GH₵", locale: "en-GH", decimals: 2 },
    { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", locale: "en-ZM", decimals: 2 },
    { code: "BWP", name: "Botswana Pula", symbol: "P", locale: "en-BW", decimals: 2 },
    { code: "NAD", name: "Namibian Dollar", symbol: "N$", locale: "en-NA", decimals: 2 },
    { code: "MWK", name: "Malawian Kwacha", symbol: "MK", locale: "en-MW", decimals: 2 },
    { code: "MZN", name: "Mozambican Metical", symbol: "MT", locale: "pt-MZ", decimals: 2 },
    { code: "EGP", name: "Egyptian Pound", symbol: "E£", locale: "ar-EG", decimals: 2 },
    { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "en-AE", decimals: 2 },
    { code: "SAR", name: "Saudi Riyal", symbol: "﷼", locale: "ar-SA", decimals: 2 },
    { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", locale: "ar-QA", decimals: 2 },
    { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US", decimals: 2 },
    { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB", decimals: 2 },
    { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE", decimals: 2 },
  ].map(Object.freeze)
);

/** Country → default currency for registration / company settings */
export const COUNTRIES = Object.freeze(
  [
    { code: "KE", name: "Kenya", currency: "KES", locale: "en-KE" },
    { code: "UG", name: "Uganda", currency: "UGX", locale: "en-UG" },
    { code: "TZ", name: "Tanzania", currency: "TZS", locale: "sw-TZ" },
    { code: "RW", name: "Rwanda", currency: "RWF", locale: "rw-RW" },
    { code: "ET", name: "Ethiopia", currency: "ETB", locale: "am-ET" },
    { code: "SO", name: "Somalia", currency: "SOS", locale: "so-SO" },
    { code: "SS", name: "South Sudan", currency: "SSP", locale: "en-SS" },
    { code: "BI", name: "Burundi", currency: "BIF", locale: "fr-BI" },
    { code: "ZA", name: "South Africa", currency: "ZAR", locale: "en-ZA" },
    { code: "CD", name: "DR Congo", currency: "CDF", locale: "fr-CD" },
    { code: "NG", name: "Nigeria", currency: "NGN", locale: "en-NG" },
    { code: "GH", name: "Ghana", currency: "GHS", locale: "en-GH" },
    { code: "ZM", name: "Zambia", currency: "ZMW", locale: "en-ZM" },
    { code: "BW", name: "Botswana", currency: "BWP", locale: "en-BW" },
    { code: "NA", name: "Namibia", currency: "NAD", locale: "en-NA" },
    { code: "MW", name: "Malawi", currency: "MWK", locale: "en-MW" },
    { code: "MZ", name: "Mozambique", currency: "MZN", locale: "pt-MZ" },
    { code: "EG", name: "Egypt", currency: "EGP", locale: "ar-EG" },
    { code: "AE", name: "UAE", currency: "AED", locale: "en-AE" },
    { code: "SA", name: "Saudi Arabia", currency: "SAR", locale: "ar-SA" },
    { code: "QA", name: "Qatar", currency: "QAR", locale: "ar-QA" },
    { code: "US", name: "USA", currency: "USD", locale: "en-US" },
    { code: "GB", name: "United Kingdom", currency: "GBP", locale: "en-GB" },
    { code: "EU", name: "Europe", currency: "EUR", locale: "en-IE" },
  ].map(Object.freeze)
);

const currencyMap = new Map(CURRENCIES.map((currency) => [currency.code, currency]));
const countryMap = new Map(COUNTRIES.map((country) => [country.code, country]));
const countryByName = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country]));

export function normalizeCurrencyCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return currencyMap.has(normalized) ? normalized : normalized || DEFAULT_CURRENCY_CODE;
}

export function isSupportedCurrency(code) {
  return currencyMap.has(String(code || "").trim().toUpperCase());
}

export function getCurrency(code = DEFAULT_CURRENCY_CODE) {
  const key = String(code || "").trim().toUpperCase();
  return (
    currencyMap.get(key) || {
      code: key || DEFAULT_CURRENCY_CODE,
      name: key || DEFAULT_CURRENCY_CODE,
      symbol: key || DEFAULT_CURRENCY_CODE,
      locale: "en-US",
      decimals: 2,
    }
  );
}

export function getCountry(codeOrName = DEFAULT_COUNTRY_CODE) {
  const raw = String(codeOrName || "").trim();
  if (!raw) return countryMap.get(DEFAULT_COUNTRY_CODE);
  const byCode = countryMap.get(raw.toUpperCase());
  if (byCode) return byCode;
  return countryByName.get(raw.toLowerCase()) || countryMap.get(DEFAULT_COUNTRY_CODE);
}

export function getDefaultCurrencyForCountry(countryCodeOrName) {
  const country = getCountry(countryCodeOrName);
  return getCurrency(country?.currency || DEFAULT_CURRENCY_CODE);
}

export function resolveCompanyMoneyProfile({
  country,
  country_code,
  currency,
  currency_code,
  currency_symbol,
  locale,
} = {}) {
  const countryRow = getCountry(country_code || country || DEFAULT_COUNTRY_CODE);
  const code = normalizeCurrencyCode(currency_code || currency || countryRow.currency);
  const catalog = getCurrency(code);
  return {
    country: countryRow.name,
    country_code: countryRow.code,
    currency_code: catalog.code,
    currency: catalog.code,
    currency_symbol: currency_symbol || catalog.symbol,
    locale: locale || catalog.locale || countryRow.locale,
    decimals: catalog.decimals,
  };
}

export function getCurrencyLabel(code = DEFAULT_CURRENCY_CODE) {
  const currency = getCurrency(code);
  return `${currency.code} — ${currency.name} (${currency.symbol})`;
}

export function getCountryLabel(codeOrName = DEFAULT_COUNTRY_CODE) {
  const country = getCountry(codeOrName);
  const currency = getCurrency(country.currency);
  return `${country.name} (${currency.code})`;
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
    return `${currency.symbol} ${formatted}`;
  } catch {
    return `${currency.symbol} ${amount.toFixed(currency.decimals)}`;
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
 * Historical transactions are NOT auto-converted when company currency changes.
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
  return (Array.isArray(currencies) ? currencies : []).filter((c) => c && c.is_active !== false);
}

export function getBaseCurrency(currencies = [], fallbackCode = DEFAULT_CURRENCY_CODE) {
  const list = Array.isArray(currencies) ? currencies : [];
  return (
    list.find((c) => c.is_base) ||
    list.find((c) => c.code === fallbackCode) || {
      code: fallbackCode,
      name: getCurrency(fallbackCode).name,
      symbol: getCurrency(fallbackCode).symbol,
      exchange_rate_to_base: 1,
      is_base: true,
      is_active: true,
    }
  );
}

export function getDefaultCurrency(currencies = [], fallbackCode = DEFAULT_CURRENCY_CODE) {
  const list = Array.isArray(currencies) ? currencies : [];
  return list.find((c) => c.is_default && c.is_active !== false) || getBaseCurrency(list, fallbackCode);
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
