import { useEffect, useState } from "react";
import { ArrowLeft, Camera, Save } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ACCOUNT_STATUSES, assignableRoles, isOwner, isPlatformOwner, isUserManagerRole, normalizeRole } from "../lib/rbac";
import { readSecureImageDataUrl } from "../lib/secureImageUpload";

const EMPTY = {
  name: "", username: "", email: "", phone: "", password: "", confirmPassword: "",
  role: "cashier", branch_id: 1, active: 1, profile_photo: "",
  employee_id: "", department: "", position: "", address: "", national_id: "",
  account_status: "active", login_enabled: 1, must_change_password: 0,
};

function initials(name = "") {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "NU";
}

function validate(form, editing) {
  const errors = {};
  if (form.name.trim().length < 2) errors.name = "Enter the user's full name.";
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/i.test(form.username.trim())) errors.username = "Use 3–30 letters, numbers, dots, underscores, or hyphens.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
  if (form.phone && !/^\+?[\d\s().-]{7,20}$/.test(form.phone.trim())) errors.phone = "Enter a valid phone number.";
  if (!editing && form.password.length < 8) errors.password = "Use at least 8 characters.";
  if (!editing && form.password !== form.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

async function compressPhoto(file) {
  const source = await readSecureImageDataUrl(file, { maxBytes: 2 * 1024 * 1024 });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not process the photo."));
    img.src = source;
  });
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const crop = Math.min(image.width, image.height);
  context.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export default function UserForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [branches, setBranches] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const branchRows = await api.branches.getAll();
      setBranches(branchRows);
      if (!editing) {
        const companyScoped = isPlatformOwner(user?.role)
          ? branchRows
          : branchRows.filter((branch) => String(branch.company_id) === String(user?.company_id));
        const defaultBranch = companyScoped[0] || branchRows[0];
        setForm((current) => ({
          ...current,
          company_id: isPlatformOwner(user?.role) ? current.company_id : user?.company_id,
          branch_id: defaultBranch?.id ?? current.branch_id,
        }));
        setLoading(false);
        return;
      }
      const existing = await api.auth.getUser(id);
      if (existing) {
        setForm({
          ...EMPTY,
          ...existing,
          active: existing.active ? 1 : 0,
          login_enabled: existing.login_enabled === false || existing.login_enabled === 0 ? 0 : 1,
          must_change_password: existing.must_change_password ? 1 : 0,
          account_status: existing.account_status || (existing.active ? "active" : "inactive"),
        });
      }
      setLoading(false);
    })();
  }, [editing, id, user?.company_id, user?.role]);

  if (!isUserManagerRole(user?.role)) return <Navigate to="/users" replace />;
  if (loading) return <div className="py-16 text-center text-sm text-app-muted">Loading user…</div>;

  const editingOwner = editing && normalizeRole(form.role) === "owner";
  const canEditOwnerCredentials = isPlatformOwner(user?.role)
    || (isOwner(user?.role) && String(user?.id) === String(id));
  if (editingOwner && !canEditOwnerCredentials) {
    return <Navigate to="/users" replace />;
  }
  const availableRoles = assignableRoles(user?.role);
  const actorCompanyId = isPlatformOwner(user?.role) ? form.company_id : user?.company_id;
  const availableBranches = actorCompanyId == null || actorCompanyId === ""
    ? branches
    : branches.filter((branch) => String(branch.company_id) === String(actorCompanyId));

  const field = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(form, editing);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    const payload = {
      ...form,
      username: form.username.trim().toLowerCase(),
      email: form.email.trim().toLowerCase(),
      company_id: isPlatformOwner(user?.role) ? form.company_id : user?.company_id,
      active: form.account_status === "active" && Number(form.login_enabled) === 1 ? 1 : 0,
      login_enabled: Number(form.login_enabled) === 1,
      must_change_password: Number(form.must_change_password) === 1,
    };
    delete payload.confirmPassword;
    const result = editing
      ? await api.auth_admin.updateUser(id, payload)
      : await api.auth_admin.createUser(payload);
    setSaving(false);
    if (!result.success) {
      setErrors({ form: result.error || "Could not save user." });
      return;
    }
    showToast(editing ? "User updated" : "User created");
    navigate("/users");
  };

  const choosePhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      field("profile_photo", await compressPhoto(file));
    } catch (error) {
      setErrors((current) => ({ ...current, profile_photo: error.message }));
    } finally {
      event.target.value = "";
    }
  };

  const inputClass = "form-control w-full";
  const renderError = (name) => errors[name] && <p className="form-error">{errors[name]}</p>;

  return (
    <div className="mx-auto max-w-5xl animate-fadein">
      <button type="button" onClick={() => navigate("/users")} className="btn btn-ghost mb-4"><ArrowLeft size={16} /> Back to users</button>
      <div className="mb-6">
        <h1 className="page-title">{editing ? "Edit User" : "New User"}</h1>
        <p className="mt-1 text-base text-app-muted">Hierarchy-protected account, HR profile, and access settings.</p>
      </div>
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <section className="card">
          <div className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-2xl font-bold text-brand">
            {form.profile_photo ? <img src={form.profile_photo} alt="Profile preview" className="h-full w-full object-cover" /> : initials(form.name)}
          </div>
          <label className="btn btn-secondary mt-4 w-full cursor-pointer">
            <Camera size={15} /> Choose photo
            <input type="file" accept="image/*" className="sr-only" onChange={choosePhoto} />
          </label>
          {form.profile_photo && <button type="button" onClick={() => field("profile_photo", "")} className="mt-2 w-full text-xs text-danger">Remove photo</button>}
          {renderError("profile_photo")}
          <p className="mt-3 text-sm leading-relaxed text-app-muted">Images up to 2 MB are resized and stored securely.</p>
          {editing && (
            <div className="mt-4 space-y-1 border-t border-app pt-4 text-xs text-app-muted">
              <div>Last login: {form.last_login_at ? new Date(form.last_login_at).toLocaleString() : "Never"}</div>
              <div>Login count: {Number(form.login_count || 0)}</div>
              <div>IP: {form.last_ip || "—"}</div>
              <div>{form.last_device || "—"} · {form.last_browser || "—"} · {form.last_os || "—"}</div>
            </div>
          )}
        </section>

        <section className="card">
          {errors.form && <div className="mb-4 rounded-[12px] border border-app bg-[var(--danger-soft)] px-4 py-3 text-sm text-danger">{errors.form}</div>}
          <h2 className="mb-3 text-sm font-semibold text-app-text">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="form-label" htmlFor="name">Full Name</label><input id="name" autoComplete="name" className={inputClass} value={form.name} onChange={(e) => field("name", e.target.value)} required />{renderError("name")}</div>
            <div><label className="form-label" htmlFor="employee_id">Employee ID</label><input id="employee_id" className={inputClass} value={form.employee_id} onChange={(e) => field("employee_id", e.target.value)} placeholder="Optional badge / HR ID" /></div>
            <div><label className="form-label" htmlFor="username">Username</label><input id="username" autoComplete="username" className={inputClass} value={form.username} onChange={(e) => field("username", e.target.value)} required />{renderError("username")}</div>
            <div><label className="form-label" htmlFor="email">Email Address</label><input id="email" type="email" autoComplete="email" className={inputClass} value={form.email} onChange={(e) => field("email", e.target.value)} required />{renderError("email")}</div>
            <div><label className="form-label" htmlFor="phone">Phone Number <span className="text-app-muted">(optional)</span></label><input id="phone" type="tel" autoComplete="tel" className={inputClass} value={form.phone} onChange={(e) => field("phone", e.target.value)} />{renderError("phone")}</div>
            <div><label className="form-label" htmlFor="national_id">National ID <span className="text-app-muted">(optional)</span></label><input id="national_id" className={inputClass} value={form.national_id} onChange={(e) => field("national_id", e.target.value)} /></div>
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-app-text">Organization</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="form-label" htmlFor="department">Department</label><input id="department" className={inputClass} value={form.department} onChange={(e) => field("department", e.target.value)} placeholder="e.g. Sales, Warehouse" /></div>
            <div><label className="form-label" htmlFor="position">Position</label><input id="position" className={inputClass} value={form.position} onChange={(e) => field("position", e.target.value)} placeholder="e.g. Cashier, Storekeeper" /></div>
            <div className="sm:col-span-2"><label className="form-label" htmlFor="address">Address</label><input id="address" className={inputClass} value={form.address} onChange={(e) => field("address", e.target.value)} /></div>
            <div><label className="form-label" htmlFor="role">Role</label><select id="role" className={inputClass} value={form.role} onChange={(e) => field("role", e.target.value)}>{availableRoles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></div>
            <div><label className="form-label" htmlFor="branch">Branch</label><select id="branch" className={inputClass} value={form.branch_id} onChange={(e) => field("branch_id", Number(e.target.value))}>{availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-app-text">Access &amp; security</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {!editing && <>
              <div><label className="form-label" htmlFor="password">Temporary Password</label><input id="password" type="password" autoComplete="new-password" minLength={8} className={inputClass} value={form.password} onChange={(e) => field("password", e.target.value)} required />{renderError("password")}</div>
              <div><label className="form-label" htmlFor="confirmPassword">Confirm Password</label><input id="confirmPassword" type="password" autoComplete="new-password" className={inputClass} value={form.confirmPassword} onChange={(e) => field("confirmPassword", e.target.value)} required />{renderError("confirmPassword")}</div>
            </>}
            <div>
              <label className="form-label" htmlFor="account_status">Account Status</label>
              <select id="account_status" className={inputClass} value={form.account_status} onChange={(e) => field("account_status", e.target.value)}>
                {ACCOUNT_STATUSES.map((status) => (
                  <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="login_enabled">Login</label>
              <select id="login_enabled" className={inputClass} value={form.login_enabled} onChange={(e) => field("login_enabled", Number(e.target.value))}>
                <option value={1}>Enabled</option>
                <option value={0}>Disabled</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="must_change_password">Force password change</label>
              <select id="must_change_password" className={inputClass} value={form.must_change_password} onChange={(e) => field("must_change_password", Number(e.target.value))}>
                <option value={0}>No</option>
                <option value={1}>Yes — require on next login</option>
              </select>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-app pt-5">
            <button type="button" onClick={() => navigate("/users")} className="btn border border-app">Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary inline-flex items-center gap-2"><Save size={16} /> {saving ? "Saving…" : editing ? "Save Changes" : "Create User"}</button>
          </div>
        </section>
      </form>
    </div>
  );
}
