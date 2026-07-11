import { useState, useEffect } from "react";
import {
  Banknote, CreditCard, Smartphone, Save, Download, Upload, RefreshCw,
  UserPlus, X, Cloud, CloudOff, Printer, Barcode, ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const TABS = [
  { id: "store", label: "Store Info" }, { id: "tax", label: "Tax & VAT" },
  { id: "payment", label: "Payment Methods" }, { id: "receipt", label: "Receipt & Barcode" },
  { id: "printer", label: "Printer" }, { id: "users", label: "Users & Roles" },
  { id: "permissions", label: "Permissions" }, { id: "backup", label: "Backup & Sync" },
];

const ROLES = ["manager", "cashier", "accountant"];

function Field({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block text-[#1B2439]">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" />
    </div>
  );
}
function TextArea({ label, value, onChange }) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block text-[#1B2439]">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" />
    </div>
  );
}
function Toggle({ on, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-10 h-5 rounded-full relative shrink-0" style={{ backgroundColor: on ? "#2563EB" : "#E4E9F2" }}>
      <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}

export default function Settings() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState("store");
  const [settings, setSettings] = useState({});
  const [users, setUsers] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ configured: false, pendingCount: 0 });
  const [backupHistory, setBackupHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "cashier" });
  const [syncing, setSyncing] = useState(false);
  const [permRole, setPermRole] = useState("manager");
  const [permMatrix, setPermMatrix] = useState({ matrix: {}, modules: [], actions: [] });

  const load = async () => {
    const [s, u, sy, bh, pm] = await Promise.all([
      api.settings.getAll(), api.auth.listUsers(), api.sync.getStatus(), api.backup.getHistory(), api.permissions.getMatrix(),
    ]);
    setSettings(s); setUsers(u); setSyncStatus(sy); setBackupHistory(bh); setPermMatrix(pm);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === "printer") api.settings.getPrinters().then(setPrinters); }, [tab]);

  const set = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  const saveSettings = async (keys) => {
    const updates = Object.fromEntries(keys.map((k) => [k, settings[k]]));
    const result = await api.settings.update(updates);
    showToast(result.success ? "Settings saved" : result.error || "Could not save settings");
  };

  const toggleBool = async (key) => {
    const next = settings[key] === "true" ? "false" : "true";
    set(key, next);
    const result = await api.settings.update({ [key]: next });
    showToast(result.success ? "Settings saved" : result.error || "Could not save");
  };

  const createUser = async (e) => {
    e.preventDefault();
    const result = await api.auth_admin.createUser(newUser);
    if (result.success) {
      showToast("User created");
      setUserModalOpen(false);
      setNewUser({ name: "", email: "", password: "", role: "cashier" });
      await load();
    } else showToast(result.error || "Could not create user");
  };

  const toggleUserActive = async (u) => {
    const result = await api.auth_admin.setUserActive(u.id, !u.active);
    if (result.success) { showToast(u.active ? "User deactivated" : "User activated"); await load(); }
    else showToast(result.error || "Could not update user");
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
    else if (result.success) showToast(`Pushed ${result.push?.synced ?? 0} change(s), pulled updates for ${Object.keys(result.pull || {}).length} collection(s)`);
    else showToast(result.error || "Sync failed");
    setSyncStatus(await api.sync.getStatus());
  };

  const togglePermission = async (role, module, action) => {
    const current = !!permMatrix.matrix?.[role]?.[module]?.[action];
    const next = !current;
    setPermMatrix((pm) => ({
      ...pm,
      matrix: { ...pm.matrix, [role]: { ...pm.matrix[role], [module]: { ...pm.matrix[role]?.[module], [action]: next } } },
    }));
    const result = await api.permissions.update({ role, module, action, allowed: next });
    if (!result.success) showToast(result.error || "Could not update permission");
  };

  if (loading) return <div className="text-center py-16 text-sm text-[#6B7690]">Loading settings…</div>;

  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">Settings</h1>
      <p className="text-sm text-[#6B7690] mb-5">Configure your store, tax rules, receipts, and team access.</p>

      <div className="flex gap-1.5 mb-5 border-b border-[#E4E9F2] overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="px-3.5 py-2.5 text-sm font-medium relative -mb-px whitespace-nowrap"
            style={{ color: tab === t.id ? "#2563EB" : "#6B7690", borderBottom: tab === t.id ? "2px solid #2563EB" : "2px solid transparent" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#E4E9F2] rounded-2xl p-6 shadow-sm max-w-2xl">
        {tab === "store" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <Field label="Store Name" value={settings.store_name || ""} onChange={(v) => set("store_name", v)} />
              <Field label="Phone Number" value={settings.store_phone || ""} onChange={(v) => set("store_phone", v)} />
              <Field label="Address" value={settings.store_address || ""} onChange={(v) => set("store_address", v)} />
              <Field label="Currency" value={settings.currency || ""} onChange={(v) => set("currency", v)} />
            </div>
            <button onClick={() => saveSettings(["store_name", "store_phone", "store_address", "currency"])} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#2563EB] hover:brightness-110">
              <Save size={15} /> Save Changes
            </button>
          </>
        )}

        {tab === "tax" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <Field label="VAT Rate (%)" value={settings.vat_rate || ""} onChange={(v) => set("vat_rate", v)} />
              <Field label="Tax PIN" value={settings.tax_pin || ""} onChange={(v) => set("tax_pin", v)} />
            </div>
            <button onClick={() => saveSettings(["vat_rate", "tax_pin"])} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#2563EB] hover:brightness-110">
              <Save size={15} /> Save Changes
            </button>
          </>
        )}

        {tab === "payment" && (
          <div className="space-y-3">
            {[["payment_cash", "Cash", Banknote], ["payment_card", "Card Payments", CreditCard], ["payment_mpesa", "M-Pesa", Smartphone]].map(([key, label, Icon]) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-lg border border-[#E4E9F2]">
                <div className="flex items-center gap-2.5">
                  <Icon size={16} className="text-[#2563EB]" /><span className="text-sm font-medium text-[#1B2439]">{label}</span>
                </div>
                <Toggle on={settings[key] === "true"} onClick={() => toggleBool(key)} />
              </div>
            ))}
          </div>
        )}

        {tab === "receipt" && (
          <div className="space-y-5">
            <TextArea label="Receipt header message" value={settings.receipt_header || ""} onChange={(v) => set("receipt_header", v)} />
            <TextArea label="Receipt footer message" value={settings.receipt_footer || ""} onChange={(v) => set("receipt_footer", v)} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Barcode prefix" value={settings.barcode_prefix || ""} onChange={(v) => set("barcode_prefix", v)} />
              <div>
                <label className="text-xs font-medium mb-1.5 block text-[#1B2439]">Barcode format</label>
                <select value={settings.barcode_format || "EAN-13"} onChange={(e) => set("barcode_format", e.target.value)} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
                  {["EAN-13", "UPC-A", "CODE-128"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <button onClick={() => saveSettings(["receipt_header", "receipt_footer", "barcode_prefix", "barcode_format"])} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#2563EB] hover:brightness-110">
              <Save size={15} /> Save Changes
            </button>
          </div>
        )}

        {tab === "printer" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-[#6B7690] mb-1"><Printer size={15} /> Detected printers on this machine</div>
            <select value={settings.printer_name || ""} onChange={(e) => set("printer_name", e.target.value)} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
              <option value="">System default</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
            </select>
            {printers.length === 0 && <p className="text-xs text-[#6B7690]">No printers detected — this list populates once running inside the desktop app.</p>}
            <button onClick={() => saveSettings(["printer_name"])} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#2563EB] hover:brightness-110">
              <Save size={15} /> Save Changes
            </button>
          </div>
        )}

        {tab === "users" && (
          <>
            <div className="flex justify-end mb-3">
              {can("users", "create") && (
                <button onClick={() => setUserModalOpen(true)} className="flex items-center gap-1.5 text-xs font-medium text-[#2563EB]">
                  <UserPlus size={14} /> Add user
                </button>
              )}
            </div>
            <table className="w-full">
              <thead><tr><th className="text-left text-xs uppercase tracking-wide text-[#6B7690] pb-2">Name</th><th className="text-left text-xs uppercase tracking-wide text-[#6B7690] pb-2">Role</th><th className="text-left text-xs uppercase tracking-wide text-[#6B7690] pb-2">Status</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-[#E4E9F2]">
                    <td className="py-2.5 text-sm font-medium text-[#1B2439]">{u.name}<div className="text-xs text-[#6B7690] font-normal">{u.email}</div></td>
                    <td className="py-2.5 text-sm capitalize text-[#1B2439]">{u.role}</td>
                    <td className="py-2.5"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${u.active ? "text-[#12A150] bg-[#E8FAEF]" : "text-[#6B7690] bg-[#F1F3F8]"}`}>{u.active ? "Active" : "Inactive"}</span></td>
                    <td className="py-2.5 text-right">
                      {can("users", "edit") && u.id !== user.id && (
                        <button onClick={() => toggleUserActive(u)} className="text-xs font-medium text-[#2563EB]">{u.active ? "Deactivate" : "Activate"}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-sm text-[#6B7690]">No users found.</td></tr>}
              </tbody>
            </table>
          </>
        )}

        {tab === "permissions" && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={16} className="text-[#2563EB]" />
              <span className="text-sm text-[#6B7690]">Role:</span>
              <select value={permRole} onChange={(e) => setPermRole(e.target.value)} className="border border-[#E4E9F2] rounded-lg px-2.5 py-1.5 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
              <span className="text-xs text-[#6B7690] ml-auto">Admin always has full access</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left text-xs uppercase tracking-wide text-[#6B7690] pb-2 pr-3">Module</th>
                    {permMatrix.actions.map((a) => <th key={a} className="text-center text-xs uppercase tracking-wide text-[#6B7690] pb-2 px-2 capitalize">{a}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {permMatrix.modules.map((m) => (
                    <tr key={m} className="border-t border-[#F1F3F8]">
                      <td className="py-2 pr-3 font-medium text-[#1B2439] capitalize">{m}</td>
                      {permMatrix.actions.map((a) => (
                        <td key={a} className="text-center py-2 px-2">
                          <input
                            type="checkbox"
                            checked={!!permMatrix.matrix?.[permRole]?.[m]?.[a]}
                            onChange={() => togglePermission(permRole, m, a)}
                            className="w-4 h-4 accent-[#2563EB]"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "backup" && (
          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold text-[#1B2439] mb-1">Manual Backup & Restore</h4>
              <p className="text-xs text-[#6B7690] mb-3">Export a full copy of your database, or restore from a previous backup file.</p>
              <div className="flex gap-2">
                <button onClick={doBackup} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E4E9F2] text-sm font-medium text-[#1B2439]">
                  <Download size={15} /> Backup Now
                </button>
                <button onClick={doRestore} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E4E9F2] text-sm font-medium text-[#1B2439]">
                  <Upload size={15} /> Restore from File
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E4E9F2]">
              <h4 className="text-sm font-semibold text-[#1B2439] mb-1">Automatic Scheduled Backups</h4>
              <p className="text-xs text-[#6B7690] mb-3">Runs locally in the background — no dialog, saved to the app's backups folder. Last 14 kept.</p>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[#E4E9F2] mb-2">
                <span className="text-sm font-medium text-[#1B2439]">Enable automatic backups</span>
                <Toggle on={settings.auto_backup_enabled === "true"} onClick={() => toggleBool("auto_backup_enabled")} />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-[#6B7690]">Every</span>
                <input type="number" value={settings.auto_backup_interval_hours || "24"} onChange={(e) => set("auto_backup_interval_hours", e.target.value)} className="w-16 border border-[#E4E9F2] rounded-lg px-2 py-1 text-xs" />
                <span className="text-xs text-[#6B7690]">hours</span>
                <button onClick={() => saveSettings(["auto_backup_interval_hours"])} className="text-xs font-medium text-[#2563EB]">Save</button>
              </div>
              {backupHistory.length > 0 && (
                <div className="text-xs text-[#6B7690] space-y-1">
                  {backupHistory.slice(0, 5).map((b) => (
                    <div key={b.fileName} className="flex justify-between"><span className="font-mono">{b.fileName}</span><span>{new Date(b.createdAt).toLocaleString()}</span></div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[#E4E9F2]">
              <h4 className="text-sm font-semibold text-[#1B2439] mb-1 flex items-center gap-1.5">
                {syncStatus.configured ? <Cloud size={15} className="text-[#12A150]" /> : <CloudOff size={15} className="text-[#6B7690]" />}
                Firebase Two-Way Sync
              </h4>
              <p className="text-xs text-[#6B7690] mb-3">
                {syncStatus.configured
                  ? `Connected. ${syncStatus.pendingCount} change(s) queued to push.`
                  : "Not configured — add a service account to enable cloud sync. The app works fully offline either way, and queues changes until you connect one."}
              </p>
              <div className="flex items-center justify-between p-3 rounded-lg border border-[#E4E9F2] mb-3">
                <span className="text-sm font-medium text-[#1B2439]">Enable background auto-sync</span>
                <Toggle on={settings.firebase_sync_enabled === "true"} onClick={() => toggleBool("firebase_sync_enabled")} />
              </div>
              <button onClick={runSyncNow} disabled={syncing} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium bg-[#2563EB] hover:brightness-110 disabled:opacity-50">
                <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync Now"}
              </button>
            </div>
          </div>
        )}
      </div>

      {userModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setUserModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1B2439]">Add User</h3>
              <button onClick={() => setUserModalOpen(false)} className="text-[#6B7690]"><X size={18} /></button>
            </div>
            <form onSubmit={createUser} className="space-y-3">
              <input required placeholder="Full name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input required type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <input required type="password" placeholder="Temporary password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm" />
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full border border-[#E4E9F2] rounded-lg px-3 py-2 text-sm">
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="accountant">Accountant</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-white text-sm font-semibold bg-[#2563EB] hover:brightness-110">
                <Save size={15} /> Create User
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
