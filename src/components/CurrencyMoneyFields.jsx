import { useMemo } from "react";
import {
  convertToBase,
  formatMoney,
  getActiveCurrencies,
  getBaseCurrency,
  getDefaultCurrency,
  isMultiCurrencyEnabled,
} from "../lib/currency";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";

/**
 * Shared FX fields for payment / expense forms.
 * Controlled via `value` / `onChange` object:
 * { payment_currency, exchange_rate, original_amount, payment_date, reference }
 */
export default function CurrencyMoneyFields({
  value = {},
  onChange,
  amountLabel = "Amount",
  showReference = true,
  showDate = true,
  disabled = false,
  invoiceCurrency = null,
}) {
  const { settings, currency, activeCurrencies, multiCurrencyEnabled } = useEnterpriseSettings();
  const enabled = multiCurrencyEnabled ?? isMultiCurrencyEnabled(settings);
  const list = getActiveCurrencies(activeCurrencies?.length ? activeCurrencies : [currency]);
  const base = getBaseCurrency(list, currency?.code || settings.currency || "KES");
  const defaultCur = getDefaultCurrency(list, base.code);

  const paymentCurrency = value.payment_currency || defaultCur.code || base.code;
  const rate =
    value.exchange_rate != null && value.exchange_rate !== ""
      ? Number(value.exchange_rate)
      : Number(list.find((c) => c.code === paymentCurrency)?.exchange_rate_to_base ?? (paymentCurrency === base.code ? 1 : 1));
  const original = Number(value.original_amount || value.amount || 0);
  const baseAmount = convertToBase(original, rate || 1);

  const patch = (partial) => onChange?.({ ...value, ...partial });

  const currencyOptions = useMemo(() => {
    if (!enabled) return [{ code: base.code, name: base.name || base.code, symbol: base.symbol, exchange_rate_to_base: 1 }];
    return list.length ? list : [{ code: base.code, name: base.name, symbol: base.symbol, exchange_rate_to_base: 1 }];
  }, [enabled, list, base]);

  if (!enabled) {
    return (
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text">
            {amountLabel} ({base.code} {base.symbol || currency?.symbol})
          </span>
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            disabled={disabled}
            value={value.original_amount ?? value.amount ?? ""}
            onChange={(e) =>
              patch({
                original_amount: e.target.value,
                amount: e.target.value,
                payment_currency: base.code,
                exchange_rate: 1,
              })
            }
            className="form-control w-full"
          />
        </label>
        {showReference && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-app-text">Reference</span>
            <input
              disabled={disabled}
              value={value.reference || ""}
              onChange={(e) => patch({ reference: e.target.value })}
              className="form-control w-full"
              placeholder="Cheque / M-Pesa / wire ref"
            />
          </label>
        )}
        {showDate && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-app-text">Payment date</span>
            <input
              type="date"
              disabled={disabled}
              value={value.payment_date || new Date().toISOString().slice(0, 10)}
              onChange={(e) => patch({ payment_date: e.target.value })}
              className="form-control w-full"
            />
          </label>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text">Payment currency</span>
          <select
            disabled={disabled}
            className="form-control w-full"
            value={paymentCurrency}
            onChange={(e) => {
              const code = e.target.value;
              const row = currencyOptions.find((c) => c.code === code);
              patch({
                payment_currency: code,
                exchange_rate: code === base.code ? 1 : Number(row?.exchange_rate_to_base || 1),
              });
            }}
          >
            {currencyOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name || c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text">Exchange rate → {base.code}</span>
          <input
            type="number"
            step="any"
            min="0.00000001"
            disabled={disabled || paymentCurrency === base.code}
            className="form-control w-full font-mono"
            value={paymentCurrency === base.code ? 1 : rate}
            onChange={(e) => patch({ exchange_rate: e.target.value })}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-app-text">
          {amountLabel} (original)
        </span>
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          disabled={disabled}
          value={value.original_amount ?? value.amount ?? ""}
          onChange={(e) =>
            patch({
              original_amount: e.target.value,
              amount: e.target.value,
            })
          }
          className="form-control w-full"
        />
      </label>
      <div className="rounded-xl bg-app-panel-muted px-3 py-2 text-xs text-app-muted">
        Base equivalent:{" "}
        <span className="font-mono font-semibold text-app-text">{formatMoney(baseAmount, base.code)}</span>
        {invoiceCurrency && invoiceCurrency !== paymentCurrency ? (
          <span className="ml-2">(invoice {invoiceCurrency})</span>
        ) : null}
      </div>
      {showReference && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text">Reference</span>
          <input
            disabled={disabled}
            value={value.reference || ""}
            onChange={(e) => patch({ reference: e.target.value })}
            className="form-control w-full"
            placeholder="Cheque / M-Pesa / wire ref"
          />
        </label>
      )}
      {showDate && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-app-text">Payment date</span>
          <input
            type="date"
            disabled={disabled}
            value={value.payment_date || new Date().toISOString().slice(0, 10)}
            onChange={(e) => patch({ payment_date: e.target.value })}
            className="form-control w-full"
          />
        </label>
      )}
    </div>
  );
}
