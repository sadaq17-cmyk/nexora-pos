import { useState } from "react";
import { Building2, Save, UserRound } from "lucide-react";
import { api } from "../lib/api";
import { CURRENCIES, getCurrencyLabel } from "../lib/currency";
import { readSecureImageDataUrl } from "../lib/secureImageUpload";

const EMPTY = {
  company_name: "", business_type: "", country: "", currency: "KES",
  time_zone: "Africa/Nairobi", company_email: "", company_phone: "",
  company_address: "", subscription_plan: "Enterprise",
  subscription_expiry: "2027-12-31", status: "active", company_logo: "",
  name: "", username: "", email: "", phone: "", password: "",
  confirm_password: "", profile_photo: "", branch_name: "Main Branch",
  branch_code: "", branch_address: "",
};

async function imageData(file) {
  return readSecureImageDataUrl(file, { maxBytes: 2 * 1024 * 1024 });
}

export default function CompanyAccountForm({ plans = [], onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const inputClass = "form-control min-h-11 w-full rounded-xl border px-3 py-2 text-sm";

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirm_password) return setError("Owner passwords do not match.");
    setSaving(true);
    const result = await api.owner.createCompanyAccount(form);
    setSaving(false);
    if (!result.success) return setError(result.error || "Company creation failed.");
    setForm(EMPTY);
    onCreated?.(result);
  };

  const upload = async (key, file) => {
    try { set(key, await imageData(file)); } catch (uploadError) { setError(uploadError.message); }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <section className="card p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-2"><Building2 className="text-brand" size={19} /><div><h2 className="font-semibold">Company Account</h2><p className="text-xs text-app-muted">Tenant identity, contact, locale, and subscription. No user credentials are stored here.</p></div></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div><label>Company Name</label><input required className={inputClass} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} /></div>
          <div><label>Business Type</label><input required className={inputClass} value={form.business_type} onChange={(e) => set("business_type", e.target.value)} /></div>
          <div><label>Country</label><input required className={inputClass} value={form.country} onChange={(e) => set("country", e.target.value)} /></div>
          <div><label>Currency</label><select className={inputClass} value={form.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{getCurrencyLabel(currency.code)}</option>)}</select></div>
          <div><label>Time Zone</label><input required className={inputClass} value={form.time_zone} onChange={(e) => set("time_zone", e.target.value)} /></div>
          <div><label>Company Email</label><input required type="email" className={inputClass} value={form.company_email} onChange={(e) => set("company_email", e.target.value)} /></div>
          <div><label>Company Phone</label><input required type="tel" className={inputClass} value={form.company_phone} onChange={(e) => set("company_phone", e.target.value)} /></div>
          <div className="md:col-span-2"><label>Company Address</label><input required className={inputClass} value={form.company_address} onChange={(e) => set("company_address", e.target.value)} /></div>
          <div><label>Subscription Plan</label><select className={inputClass} value={form.subscription_plan} onChange={(e) => set("subscription_plan", e.target.value)}>{(plans.length ? plans : [{ name: "Starter" }, { name: "Professional" }, { name: "Enterprise" }]).filter((plan) => plan.active !== false).map((plan) => <option key={plan.name}>{plan.name}</option>)}</select></div>
          <div><label>Subscription Expiry</label><input required type="date" className={inputClass} value={form.subscription_expiry} onChange={(e) => set("subscription_expiry", e.target.value)} /></div>
          <div><label>Company Status</label><select className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div><label>Company Logo <span className="text-app-muted">(optional)</span></label><input type="file" accept="image/*" className={inputClass} onChange={(e) => upload("company_logo", e.target.files?.[0])} /></div>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-2"><UserRound className="text-brand" size={19} /><div><h2 className="font-semibold">First Owner User</h2><p className="text-xs text-app-muted">A separate company-scoped user assigned to the default Main Branch.</p></div></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div><label>Full Name</label><input required className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label>Username</label><input required className={inputClass} value={form.username} onChange={(e) => set("username", e.target.value)} /></div>
          <div><label>Owner Email</label><input required type="email" className={inputClass} value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div><label>Owner Phone</label><input required type="tel" className={inputClass} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><label>Password</label><input required minLength={8} type="password" className={inputClass} value={form.password} onChange={(e) => set("password", e.target.value)} /></div>
          <div><label>Confirm Password</label><input required minLength={8} type="password" className={inputClass} value={form.confirm_password} onChange={(e) => set("confirm_password", e.target.value)} /></div>
          <div><label>Profile Photo <span className="text-app-muted">(optional)</span></label><input type="file" accept="image/*" className={inputClass} onChange={(e) => upload("profile_photo", e.target.files?.[0])} /></div>
          <div><label>Default Branch Name</label><input required className={inputClass} value={form.branch_name} onChange={(e) => set("branch_name", e.target.value)} /></div>
          <div><label>Branch Code</label><input className={inputClass} value={form.branch_code} onChange={(e) => set("branch_code", e.target.value)} /></div>
          <div className="md:col-span-2"><label>Branch Address</label><input className={inputClass} value={form.branch_address} onChange={(e) => set("branch_address", e.target.value)} /></div>
        </div>
      </section>
      <div className="flex justify-end"><button disabled={saving} className="btn btn-primary inline-flex items-center gap-2"><Save size={16} />{saving ? "Creating atomically…" : "Create Company & Owner"}</button></div>
    </form>
  );
}
