/**
 * Company Auto Actions — toggles that drive one-click Credit Sale automation.
 * Stored in company_settings.settings (JSON). Defaults are all ON except optional send.
 */

export const AUTO_ACTION_DEFAULTS = Object.freeze({
  auto_print_receipt: true,
  auto_create_invoice: true,
  auto_create_receivable: true,
  auto_update_inventory: true,
  auto_create_accounting: true,
  auto_update_customer_ledger: true,
  auto_refresh_dashboard: true,
  auto_send_receipt: false,
});

export const AUTO_ACTION_META = Object.freeze([
  {
    key: "auto_print_receipt",
    label: "Auto Print Receipt",
    description: "Print immediately after Complete Sale when a receipt printer is available; otherwise open a PDF preview.",
  },
  {
    key: "auto_create_invoice",
    label: "Auto Create Invoice",
    description: "Create the sales invoice / public verification record with the receipt.",
  },
  {
    key: "auto_create_receivable",
    label: "Auto Create Receivable",
    description: "Post an Accounts Receivable credit invoice for Credit and Mixed payments.",
  },
  {
    key: "auto_update_inventory",
    label: "Auto Update Inventory",
    description: "Reduce stock quantities when the sale completes (required for credit sales).",
  },
  {
    key: "auto_create_accounting",
    label: "Auto Create Accounting Entries",
    description: "Post Accounts Receivable / Sales Revenue journal lines for credit sales.",
  },
  {
    key: "auto_update_customer_ledger",
    label: "Auto Update Customer Ledger",
    description: "Refresh the customer balance and statement ledger after the receivable posts.",
  },
  {
    key: "auto_refresh_dashboard",
    label: "Auto Refresh Dashboard",
    description: "Invalidate cached KPIs so dashboard AR and sales figures update immediately.",
  },
  {
    key: "auto_send_receipt",
    label: "Auto Send Receipt (optional)",
    description: "SMS the customer a receipt/invoice confirmation when a phone number is on file.",
  },
]);

function asBool(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

/** Merge company settings (or a nested auto_actions object) into a normalized flag map. */
export function normalizeAutoActions(settings = {}) {
  const nested = settings.auto_actions && typeof settings.auto_actions === "object"
    ? settings.auto_actions
    : {};
  const out = {};
  for (const [key, def] of Object.entries(AUTO_ACTION_DEFAULTS)) {
    out[key] = asBool(nested[key] ?? settings[key], def);
  }
  return out;
}

export function isAutoActionEnabled(settings, key) {
  return Boolean(normalizeAutoActions(settings)[key]);
}
