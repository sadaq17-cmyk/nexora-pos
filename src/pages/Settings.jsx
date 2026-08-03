import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Banknote, Save, Download, Upload, RefreshCw,
  Cloud, CloudOff, Printer, Shield, Coins, Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import RolesPermissionsPanel from "../components/RolesPermissionsPanel";
import MfaSettingsPanel from "../components/MfaSettingsPanel";
import LoginSecurityPanel from "../components/LoginSecurityPanel";
import CurrenciesSettingsPanel from "../components/CurrenciesSettingsPanel";
import { canAccessCurrencySettings, isOwner, isSuperAdmin } from "../lib/rbac";
import {
  COUNTRIES,
  CURRENCIES,
  getCountry,
  getCurrency,
  getDefaultCurrencyForCountry,
} from "../lib/currency";
import { isPaymentMethodEnabled, PAYMENT_METHODS } from "../lib/paymentMethods";
import { AUTO_ACTION_DEFAULTS, AUTO_ACTION_META, normalizeAutoActions } from "../lib/autoActions";

const BASE_TABS = [
  { id: "store", label: "Store Info" },
  { id: "tax", label: "Tax & VAT" },
  { id: "payment", label: "Payment Methods" },
  { id: "currencies", label: "Currencies", icon: Coins },
  { id: "receipt", label: "Receipt & Barcode" },
  { id: "printer", label: "Printer" },
  { id: "auto_actions", label: "Auto Actions", icon: Zap },
  { id: "security", label: "Security" },
  { id: "permissions", label: "Roles & Permissions" },
  { id: "backup", label: "Backup & Sync" },
];

const VALID_TABS = new Set([
  "login_security",
  "store",
  "tax",
  "payment",
  "currencies",
  "receipt",
  "printer",
  "auto_actions",
  "security",
  "permissions",
  "backup",
]);

function Field({ label, value, onChange, type = "text", className = "" }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-app-text">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-control border border-app bg-app-panel px-3 py-2 text-sm text-app-text outline-none transition duration-200 focus:border-brand focus:ring-2 focus:ring-[var(--focus-ring)]"
      />
    </div>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-app-text">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-control border border-app bg-app-panel px-3 py-2 text-sm text-app-text outline-none transition duration-200 focus:border-brand focus:ring-2 focus:ring-[var(--focus-ring)]"
      />
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-5 w-10 shrink-0 rounded-full transition duration-200"
      style={{ backgroundColor: on ? "var(--brand)" : "var(--app-border)" }}
    >
      <div
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all duration-200"
        style={{ left: on ? "22px" : "2px" }}
      />
    </button>
  );
}

function resolveInitialTab(pathname, searchParams, companyOwner) {
  if (pathname.includes("/settings/login-security")) return "login_security";
  const fromQuery = searchParams.get("tab");
  if (fromQuery && VALID_TABS.has(fromQuery)) {
    if (fromQuery === "login_security" && !companyOwner) return "store";
    if (fromQuery === "security" && companyOwner) return "login_security";
    return fromQuery;
  }
  return companyOwner ? "login_security" : "store";
}

export default function Settings() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const companyOwner = isOwner(user?.role);
  const superAdmin = isSuperAdmin(user?.role) || companyOwner;
  const currencyAccess = canAccessCurrencySettings(user?.role);

  const [tab, setTab] = useState(() => resolveInitialTab(location.pathname, searchParams, companyOwner));
  const [settings, setSettings] = useState({});
  const [printers, setPrinters] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ configured: false, pendingCount: 0 });
  const [backupHistory, setBackupHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const TABS = useMemo(() => {
    let tabs = BASE_TABS;
    if (!currencyAccess) {
      tabs = tabs.filter((item) => item.id !== "currencies");
    }
    if (companyOwner) {
      return [
        { id: "login_security", label: "Login & Security", icon: Shield },
        ...tabs.filter((item) => item.id !== "security"),
      ];
    }
    return tabs;
  }, [companyOwner, currencyAccess]);

  useEffect(() => {
    const next = resolveInitialTab(location.pathname, searchParams, companyOwner);
    if (next === "currencies" && !currencyAccess) {
      setTab("store");
      navigate("/settings?tab=store", { replace: true });
      return;
    }
    setTab(next);
  }, [location.pathname, searchParams, companyOwner, currencyAccess, navigate]);

  useEffect(() => {
    if (tab === "login_security" && !companyOwner) {
      setTab("store");
      navigate("/settings?tab=store", { replace: true });
    }
  }, [tab, companyOwner, navigate]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    if (nextTab === "login_security") {
      navigate("/settings/login-security", { replace: false });
      return;
    }
    navigate(`/settings?tab=${nextTab}`, { replace: false });
  };

  const load = async () => {
    try {
      const [s, sy, bh] = await Promise.all([
        api.settings.getAll(),
        api.sync.getStatus(),
        api.backup.getHistory(),
      ]);
      setSettings(s);
      setSyncStatus(sy);
      setBackupHistory(bh);
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Settings] load failed", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab !== "printer") return;
    (async () => {
      if (typeof window !== "undefined" && window.nexoraDesktop?.getPrinters) {
        const listed = await window.nexoraDesktop.getPrinters().catch(() => []);
        if (Array.isArray(listed) && listed.length) {
          setPrinters(listed);
          return;
        }
      }
      setPrinters(await api.settings.getPrinters().catch(() => []));
    })();
  }, [tab]);

  const set = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const setMany = (patch) => setSettings((s) => ({ ...s, ...patch }));

  const saveSettings = async (keys) => {
    const updates = Object.fromEntries(keys.map((k) => [k, settings[k]]));
    if (updates.currency || updates.currency_code) {
      const currency = getCurrency(updates.currency_code || updates.currency);
      updates.currency = currency.code;
      updates.currency_code = currency.code;
      updates.currency_symbol = currency.symbol;
      updates.locale = updates.locale || currency.locale;
      updates.base_currency_code = updates.base_currency_code || currency.code;
    }
    if (updates.country || updates.country_code) {
      const country = getCountry(updates.country_code || updates.country);
      updates.country = country.name;
      updates.country_code = country.code;
    }
    const result = await api.settings.update(updates);
    if (result.success) {
      const applied = { ...updates };
      window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: { settings: applied } }));
      await load();
    }
    showToast(result.success ? "Settings saved" : result.error || "Could not save settings");
  };

  const toggleBool = async (key) => {
    const next = settings[key] === "true" ? "false" : "true";
    set(key, next);
    const result = await api.settings.update({ [key]: next });
    showToast(result.success ? "Settings saved" : result.error || "Could not save");
  };

  const doBackup = async () => {
    const result = await api.backup.export();
    if (result.canceled) return;
    showToast(result.success ? `Backup saved to ${result.filePath}` : result.error || "Backup failed");
  };

  const doRestore = async () => {
    if (!confirm("Restoring will replace all current data and restart the app. Continue?")) return;
    const result = await api.backup.restore();
    if (result.canceled) return;
    if (!result.success) showToast(result.error || "Restore failed");
  };

  const runSyncNow = async () => {
    setSyncing(true);
    const result = await api.sync.triggerNow();
    setSyncing(false);
    if (result.reason === "not_configured") showToast("Add a Firebase service account to enable sync");
    else if (result.success) {
      showToast(
        `Pushed ${result.push?.synced ?? 0} change(s), pulled updates for ${Object.keys(result.pull || {}).length} collection(s)`
      );
    } else showToast(result.error || "Sync failed");
    setSyncStatus(await api.sync.getStatus());
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-app-muted">Loading settings…</div>;
  }

  const saveBtn = "btn btn-primary";

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="nx-page-lead">
            Configure store details, security, receipts, and team access.
          </p>
        </div>
      </div>

      <div className="nx-settings-tabs mb-5 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`nx-settings-tab whitespace-nowrap ${tab === t.id ? "is-active" : ""}`}
            >
              {Icon ? <Icon size={14} className="mr-1.5 inline-block align-[-2px]" /> : null}
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "login_security" && companyOwner ? (
        <LoginSecurityPanel />
      ) : tab === "currencies" && currencyAccess ? (
        <div className="card max-w-5xl p-6">
          <CurrenciesSettingsPanel />
        </div>
      ) : (
        <div
          className={`card p-6 ${
            tab === "permissions" ? "max-w-none" : "max-w-2xl"
          }`}
        >
          {tab === "store" && (
            <>
              <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Store Name" value={settings.store_name || ""} onChange={(v) => set("store_name", v)} />
                <Field label="Phone Number" value={settings.store_phone || ""} onChange={(v) => set("store_phone", v)} />
                <Field label="Address" value={settings.store_address || ""} onChange={(v) => set("store_address", v)} className="sm:col-span-2" />
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-app-text">Country</label>
                  <select
                    disabled={!superAdmin && !companyOwner}
                    value={settings.country_code || getCountry(settings.country || "Kenya").code}
                    onChange={(e) => {
                      const country = getCountry(e.target.value);
                      const currency = getDefaultCurrencyForCountry(country.code);
                      setMany({
                        country: country.name,
                        country_code: country.code,
                        currency: currency.code,
                        currency_code: currency.code,
                        currency_symbol: currency.symbol,
                        locale: currency.locale || country.locale,
                        base_currency_code: currency.code,
                        report_currency: settings.report_currency || currency.code,
                      });
                    }}
                    className="w-full rounded-control border border-app bg-app-panel px-3 py-2 text-sm disabled:opacity-60"
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-app-text">Currency</label>
                  <select
                    disabled={!superAdmin && !companyOwner}
                    value={settings.currency_code || settings.currency || "KES"}
                    onChange={(e) => {
                      const currency = getCurrency(e.target.value);
                      setMany({
                        currency: currency.code,
                        currency_code: currency.code,
                        currency_symbol: currency.symbol,
                        locale: currency.locale || settings.locale,
                        base_currency_code: currency.code,
                      });
                    }}
                    className="w-full rounded-control border border-app bg-app-panel px-3 py-2 text-sm disabled:opacity-60"
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.code} — {currency.name} ({currency.symbol})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-app-muted">
                    Changes display formatting only. Historical amounts are not converted.
                  </p>
                  {currencyAccess && (
                    <p className="mt-1 text-[11px] text-app-muted">
                      Prefer{" "}
                      <button type="button" className="text-brand underline" onClick={() => selectTab("currencies")}>
                        Currencies
                      </button>{" "}
                      for FX rates and multi-currency policy.
                    </p>
                  )}
                  {!superAdmin && !companyOwner && (
                    <p className="mt-1 text-[11px] text-app-muted">Only Owner can change country or currency.</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  saveSettings(
                    superAdmin || companyOwner
                      ? [
                          "store_name",
                          "store_phone",
                          "store_address",
                          "country",
                          "country_code",
                          "currency",
                          "currency_code",
                          "currency_symbol",
                          "locale",
                          "base_currency_code",
                          "report_currency",
                        ]
                      : ["store_name", "store_phone", "store_address"]
                  )
                }
                className={saveBtn}
              >
                <Save size={15} /> Save Changes
              </button>
            </>
          )}

          {tab === "tax" && (
            <>
              <div className="mb-4 flex items-center justify-between rounded-card border border-app p-4">
                <div>
                  <div className="text-sm font-semibold text-app-text">Enable VAT globally</div>
                  <div className="text-xs text-app-muted">When enabled, cashiers may apply VAT per sale.</div>
                </div>
                <Toggle
                  on={settings.vat_enabled === "true"}
                  onClick={() =>
                    superAdmin && set("vat_enabled", settings.vat_enabled === "true" ? "false" : "true")
                  }
                />
              </div>
              <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={!superAdmin ? "pointer-events-none opacity-60" : ""}>
                  <Field
                    label="VAT Rate (%)"
                    type="number"
                    value={settings.vat_rate || "0"}
                    onChange={(v) => set("vat_rate", v)}
                  />
                </div>
                <Field label="Tax PIN" value={settings.tax_pin || ""} onChange={(v) => set("tax_pin", v)} />
              </div>
              {!superAdmin && (
                <p className="mb-3 text-xs text-app-muted">VAT status and percentage are restricted to Super Admin.</p>
              )}
              <button
                type="button"
                onClick={() => saveSettings(superAdmin ? ["vat_enabled", "vat_rate", "tax_pin"] : ["tax_pin"])}
                className={saveBtn}
              >
                <Save size={15} /> Save Changes
              </button>
            </>
          )}

          {tab === "payment" && (
            <div className="space-y-3">
              {[
                { id: "CASH", label: "Cash", hint: "Bills and coins at the till" },
                { id: "CARD", label: "Card", hint: "Visa, Mastercard, Amex" },
                { id: "MPESA", label: "M-Pesa", hint: "Mobile money STK / reference" },
              ].map((method) => {
                const Icon = PAYMENT_METHODS.find((entry) => entry.id === method.id)?.icon || Banknote;
                const enabled = isPaymentMethodEnabled(method.id);
                return (
                  <div key={method.id} className="flex items-center justify-between rounded-control border border-app p-3">
                    <div className="flex items-center gap-2.5">
                      <Icon size={16} className="text-brand" />
                      <div>
                        <span className="text-sm font-medium text-app-text">{method.label}</span>
                        <div className="text-xs text-app-muted">{method.hint}</div>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${enabled ? "bg-[var(--success-soft)] text-success" : "bg-[#F1F3F8] text-app-muted"}`}>
                      {enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "security" && !companyOwner && <MfaSettingsPanel />}

          {tab === "receipt" && (
            <div className="space-y-5">
              <TextArea
                label="Receipt header message"
                value={settings.receipt_header || ""}
                onChange={(v) => set("receipt_header", v)}
              />
              <TextArea
                label="Receipt footer message"
                value={settings.receipt_footer || ""}
                onChange={(v) => set("receipt_footer", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Barcode prefix"
                  value={settings.barcode_prefix || ""}
                  onChange={(v) => set("barcode_prefix", v)}
                />
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-app-text">Barcode format</label>
                  <select
                    value={settings.barcode_format || "EAN-13"}
                    onChange={(e) => set("barcode_format", e.target.value)}
                    className="w-full rounded-control border border-app px-3 py-2 text-sm"
                  >
                    {["EAN-13", "UPC-A", "CODE-128"].map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  saveSettings(["receipt_header", "receipt_footer", "barcode_prefix", "barcode_format"])
                }
                className={saveBtn}
              >
                <Save size={15} /> Save Changes
              </button>
            </div>
          )}

          {tab === "printer" && (
            <div className="space-y-4">
              <div className="mb-1 flex items-center gap-2 text-sm text-app-muted">
                <Printer size={15} /> Detected printers on this machine
              </div>
              <select
                value={settings.printer_name || ""}
                onChange={(e) => set("printer_name", e.target.value)}
                className="w-full rounded-control border border-app px-3 py-2 text-sm"
              >
                <option value="">System default</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              {printers.length === 0 && (
                <p className="text-xs text-app-muted">
                  No printers detected — this list populates once running inside the desktop app.
                </p>
              )}
              <button type="button" onClick={() => saveSettings(["printer_name"])} className={saveBtn}>
                <Save size={15} /> Save Changes
              </button>
            </div>
          )}

          {tab === "auto_actions" && (
            <div className="space-y-4">
              <div className="mb-1 flex items-center gap-2 text-sm text-app-muted">
                <Zap size={15} /> One-click Credit Sale automation
              </div>
              <p className="text-xs text-app-muted">
                When the cashier selects Credit and clicks Complete Sale, these steps run automatically —
                no extra confirmations.
              </p>
              {AUTO_ACTION_META.map((item) => {
                const flags = normalizeAutoActions(settings);
                const on = flags[item.key];
                return (
                  <div
                    key={item.key}
                    className="flex items-start justify-between gap-3 rounded-control border border-app p-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-app-text">{item.label}</div>
                      <div className="mt-0.5 text-xs text-app-muted">{item.description}</div>
                    </div>
                    <Toggle
                      on={on}
                      onClick={() => {
                        const next = { ...normalizeAutoActions(settings), [item.key]: !on };
                        setMany({
                          auto_actions: next,
                          ...Object.fromEntries(
                            Object.keys(AUTO_ACTION_DEFAULTS).map((k) => [k, next[k] ? "true" : "false"])
                          ),
                        });
                      }}
                    />
                  </div>
                );
              })}
              <button
                type="button"
                onClick={async () => {
                  const flags = normalizeAutoActions(settings);
                  const payload = {
                    auto_actions: flags,
                    ...Object.fromEntries(
                      Object.keys(AUTO_ACTION_DEFAULTS).map((k) => [k, flags[k] ? "true" : "false"])
                    ),
                  };
                  const result = await api.settings.update(payload);
                  if (result.success) {
                    window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: { settings: payload } }));
                    showToast("Auto Actions saved");
                    await load();
                  } else {
                    showToast(result.error || "Could not save Auto Actions");
                  }
                }}
                className={saveBtn}
              >
                <Save size={15} /> Save Auto Actions
              </button>
            </div>
          )}

          {tab === "permissions" && (
            <div className="-m-2 sm:-m-1">
              <RolesPermissionsPanel embedded />
            </div>
          )}

          {tab === "backup" && (
            <div className="space-y-6">
              <div>
                <h4 className="mb-1 text-sm font-semibold text-app-text">Manual Backup &amp; Restore</h4>
                <p className="mb-3 text-xs text-app-muted">
                  Export a JSON archive of company catalog, sales, purchases, and settings. Full database restore is managed in Supabase.
                </p>
                <div className="flex gap-2">
                  {can("backup", "export") && (
                    <button type="button" onClick={doBackup} className="btn btn-secondary">
                      <Download size={15} /> Backup Now
                    </button>
                  )}
                  {can("restore", "create") && (
                    <button type="button" onClick={doRestore} className="btn btn-secondary">
                      <Upload size={15} /> Restore from File
                    </button>
                  )}
                  {!can("backup", "export") && (
                    <p className="text-sm text-app-muted">You do not have permission to export backups.</p>
                  )}
                </div>
              </div>

              <div className="border-t border-app pt-4">
                <h4 className="mb-1 text-sm font-semibold text-app-text">Automatic Scheduled Backups</h4>
                <p className="mb-3 text-xs text-app-muted">
                  Runs locally in the background — no dialog, saved to the app&apos;s backups folder. Last 14 kept.
                </p>
                <div className="mb-2 flex items-center justify-between rounded-control border border-app p-3">
                  <span className="text-sm font-medium text-app-text">Enable automatic backups</span>
                  <Toggle
                    on={settings.auto_backup_enabled === "true"}
                    onClick={() => toggleBool("auto_backup_enabled")}
                  />
                </div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-app-muted">Every</span>
                  <input
                    type="number"
                    value={settings.auto_backup_interval_hours || "24"}
                    onChange={(e) => set("auto_backup_interval_hours", e.target.value)}
                    className="w-16 rounded-control border border-app px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-app-muted">hours</span>
                  <button
                    type="button"
                    onClick={() => saveSettings(["auto_backup_interval_hours"])}
                    className="text-xs font-medium text-brand"
                  >
                    Save
                  </button>
                </div>
                {backupHistory.length > 0 && (
                  <div className="space-y-1 text-xs text-app-muted">
                    {backupHistory.slice(0, 5).map((b) => (
                      <div key={b.fileName} className="flex justify-between">
                        <span className="font-mono">{b.fileName}</span>
                        <span>{new Date(b.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-app pt-4">
                <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-app-text">
                  {syncStatus.configured ? (
                    <Cloud size={15} className="text-success" />
                  ) : (
                    <CloudOff size={15} className="text-app-muted" />
                  )}
                  Firebase Two-Way Sync
                </h4>
                <p className="mb-3 text-xs text-app-muted">
                  {syncStatus.configured
                    ? `Connected. ${syncStatus.pendingCount} change(s) queued to push.`
                    : "Not configured — add a service account to enable cloud sync. The app works fully offline either way, and queues changes until you connect one."}
                </p>
                <div className="mb-3 flex items-center justify-between rounded-control border border-app p-3">
                  <span className="text-sm font-medium text-app-text">Enable background auto-sync</span>
                  <Toggle
                    on={settings.firebase_sync_enabled === "true"}
                    onClick={() => toggleBool("firebase_sync_enabled")}
                  />
                </div>
                <button type="button" onClick={runSyncNow} disabled={syncing} className={`${saveBtn} disabled:opacity-50`}>
                  <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />{" "}
                  {syncing ? "Syncing…" : "Sync Now"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
