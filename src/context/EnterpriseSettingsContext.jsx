import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  adminCanEditRates,
  convertFromBase,
  convertToBase,
  formatCurrency,
  getActiveCurrencies,
  getBaseCurrency,
  getCurrency,
  isMultiCurrencyEnabled,
  normalizeCurrencyCode,
} from "../lib/currency";
import { useAuth } from "./AuthContext";

const DEFAULT_SETTINGS = {
  currency: "KES",
  currency_symbol: "KSh",
  vat_enabled: "false",
  vat_rate: "0",
  store_name: "Nexora POS Enterprise",
  store_address: "",
  store_phone: "",
  tax_pin: "",
  receipt_header: "",
  receipt_footer: "",
  enable_multi_currency: "true",
  admin_can_edit_rates: "false",
  report_currency: "KES",
  base_currency_code: "KES",
  active_currencies: [],
};

const EnterpriseSettingsContext = createContext(null);

export function EnterpriseSettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const next = api.settings.getPublic
      ? await api.settings.getPublic()
      : await api.settings.getAll();
    setSettings((current) => ({ ...current, ...(next || {}) }));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    const listener = (event) => {
      const updates = event.detail?.settings;
      if (updates && typeof updates === "object") {
        setSettings((current) => ({ ...current, ...updates }));
      } else {
        refreshSettings();
      }
    };
    window.addEventListener("nexora:settings-updated", listener);
    return () => window.removeEventListener("nexora:settings-updated", listener);
  }, [refreshSettings]);

  const currencyCode = normalizeCurrencyCode(settings.base_currency_code || settings.currency);
  const currency = getCurrency(currencyCode);
  const activeCurrencies = useMemo(
    () => getActiveCurrencies(settings.active_currencies || []),
    [settings.active_currencies]
  );
  const baseCurrency = useMemo(
    () => getBaseCurrency(activeCurrencies, currencyCode),
    [activeCurrencies, currencyCode]
  );
  const multiCurrencyEnabled = isMultiCurrencyEnabled(settings);
  const canAdminEditRates = adminCanEditRates(settings);
  const reportCurrencyCode = normalizeCurrencyCode(settings.report_currency || currencyCode);

  const formatMoney = useCallback(
    (value, options) => formatCurrency(value, currencyCode, options),
    [currencyCode]
  );
  const formatMoneyForCurrency = useCallback(
    (value, code, options) => formatCurrency(value, code || currencyCode, options),
    [currencyCode]
  );
  const formatReportMoney = useCallback(
    (baseValue, options) => {
      if (reportCurrencyCode === currencyCode) {
        return formatCurrency(baseValue, currencyCode, options);
      }
      const rateRow = activeCurrencies.find((c) => c.code === reportCurrencyCode);
      const rate = Number(rateRow?.exchange_rate_to_base || 1);
      const converted = convertFromBase(baseValue, rate || 1);
      return formatCurrency(converted, reportCurrencyCode, options);
    },
    [reportCurrencyCode, currencyCode, activeCurrencies]
  );

  const value = useMemo(
    () => ({
      settings,
      loading,
      currency,
      baseCurrency,
      activeCurrencies,
      multiCurrencyEnabled,
      canAdminEditRates,
      reportCurrencyCode,
      formatMoney,
      formatMoneyForCurrency,
      formatReportMoney,
      convertToBase,
      convertFromBase,
      vatEnabled: settings.vat_enabled === "true",
      vatRate: Math.max(0, Math.min(100, Number(settings.vat_rate || 0))),
      refreshSettings,
    }),
    [
      settings,
      loading,
      currency,
      baseCurrency,
      activeCurrencies,
      multiCurrencyEnabled,
      canAdminEditRates,
      reportCurrencyCode,
      formatMoney,
      formatMoneyForCurrency,
      formatReportMoney,
      refreshSettings,
    ]
  );

  return (
    <EnterpriseSettingsContext.Provider value={value}>
      {children}
    </EnterpriseSettingsContext.Provider>
  );
}

export function useEnterpriseSettings() {
  const context = useContext(EnterpriseSettingsContext);
  if (!context) throw new Error("useEnterpriseSettings must be used inside EnterpriseSettingsProvider");
  return context;
}
