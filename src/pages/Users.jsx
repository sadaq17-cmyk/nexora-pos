import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Edit3, LockKeyhole, Plus, Power, Trash2, Ban, Unlock,
  LogOut, KeyRound, Search, ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { canManageRole, isPlatformOwner, isUserManagerRole, roleLabel } from "../lib/rbac";

function initials(name = "") {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function date(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function statusMeta(member) {
  const status = String(member.account_status || (member.active ? "active" : "inactive")).toLowerCase();
  if (status === "suspended") return { label: "Suspended", className: "bg-[#FEF3C7] text-[#B45309]" };
  if (status === "locked") return { label: "Locked", className: "bg-[#FEE2E2] text-[#B91C1C]" };
  if (status === "inactive" || !member.active) return { label: "Inactive", className: "bg-[#F1F3F8] text-app-muted" };
  return { label: "Active", className: "bg-[#E8FAEF] text-success" };
}

export default function Users() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const accountManager = isUserManagerRole(user?.role);
  const allowOwnerPeer = isPlatformOwner(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await api.auth.listUsers();
    setUsers(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (promise, successMessage) => {
    const result = await promise;
    if (!result?.success) return showToast(result?.error || "Action failed");
    await load();
    showToast(successMessage);
  };

  const control = async (target, action, label) => {
    if (!window.confirm(`${label} ${target.name}?`)) return;
    const prev = users;
    // Optimistic status flips for activate/deactivate/suspend/unlock
    if (["activate", "deactivate", "suspend", "unlock"].includes(action)) {
      setUsers((rows) =>
        rows.map((row) => {
          if (String(row.id) !== String(target.id)) return row;
          if (action === "activate") return { ...row, active: true, account_status: "active" };
          if (action === "deactivate") return { ...row, active: false, account_status: "inactive" };
          if (action === "suspend") return { ...row, active: false, account_status: "suspended" };
          if (action === "unlock") return { ...row, account_status: row.active ? "active" : "inactive" };
          return row;
        })
      );
    }
    const result = await api.auth_admin.updateUser(target.id, { action });
    if (!result?.success) {
      setUsers(prev);
      return showToast(result?.error || "Action failed");
    }
    showToast(`${label} applied`);
    load();
  };

  const resetPassword = async (target) => {
    const password = window.prompt(`Enter a new password (8+ chars, upper/lower/number/special) for ${target.name}:`);
    if (password === null) return;
    const confirmation = window.prompt("Confirm the new password:");
    if (confirmation !== password) return showToast("Passwords do not match");
    await act(api.auth_admin.resetPassword(target.id, password), "Password reset — user must change on next login");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((member) => {
      const status = String(member.account_status || (member.active ? "active" : "inactive")).toLowerCase();
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (roleFilter !== "all" && String(member.role) !== roleFilter) return false;
      if (!q) return true;
      return [
        member.name, member.username, member.email, member.phone,
        member.employee_id, member.department, member.position, roleLabel(member.role),
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [users, query, statusFilter, roleFilter]);

  const roleOptions = useMemo(() => {
    const set = new Set(users.map((row) => row.role).filter(Boolean));
    return [...set].sort();
  }, [users]);

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="mt-1 text-base text-app-muted">
            Enterprise staff directory — profiles, roles, status, and security controls.
          </p>
        </div>
        {accountManager && can("users", "create") && (
          <Link to="/users/new" className="btn btn-primary"><Plus size={16} /> New User</Link>
        )}
      </div>

      {!accountManager && (
        <div className="mb-5 rounded-[12px] border border-app bg-app-panel px-4 py-3 text-sm text-app-muted">
          User records are view-only. Account changes require Owner or Admin authority.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, employee ID…"
            className="form-control w-full pl-9"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-control w-auto">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="locked">Locked</option>
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="form-control w-auto">
          <option value="all">All roles</option>
          {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select>
        <span className="text-xs text-app-muted">{filtered.length} of {users.length}</span>
      </div>

      <div className="table-container">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px]">
            <thead>
              <tr className="bg-app-panel-muted">
                {["User", "Employee", "Contact", "Role / Branch", "Status", "Activity", "Device", "Sales", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-app-muted">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => {
                const status = statusMeta(member);
                const canAct = accountManager && member.id !== user.id && canManageRole(user.role, member.role, { allowOwnerPeer });
                return (
                  <tr key={member.id} className="border-t border-app align-top hover:bg-app">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-xs font-bold text-brand">
                          {member.profile_photo
                            ? <img src={member.profile_photo} alt="" className="h-full w-full object-cover" />
                            : initials(member.name)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-app-text">{member.name}</div>
                          <div className="text-xs text-app-muted">@{member.username}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-app-muted">ID {String(member.id).slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium">{member.employee_id || "—"}</div>
                      <div className="mt-1 text-xs text-app-muted">{member.department || "No dept"} · {member.position || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{member.email}</div>
                      <div className="mt-1 text-xs text-app-muted">{member.phone || "No phone"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{roleLabel(member.role)}</div>
                      <div className="mt-1 text-xs text-app-muted">{member.branch_name || "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                      {member.login_enabled === 0 || member.login_enabled === false ? (
                        <div className="mt-1 text-[10px] text-danger">Login disabled</div>
                      ) : null}
                      {member.must_change_password ? (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#B45309]"><ShieldAlert size={10} /> Force pwd</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">
                      <div>Login: {date(member.last_login_at)}</div>
                      <div className="mt-1">Active: {date(member.last_activity_at)}</div>
                      <div className="mt-1">Count: {Number(member.login_count || 0)}</div>
                      <div className="mt-1">Created: {date(member.created_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">
                      <div>{member.last_device || "—"}</div>
                      <div className="mt-1">{member.last_browser || "—"} · {member.last_os || "—"}</div>
                      <div className="mt-1 font-mono">{member.last_ip || "No IP"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-semibold">{money(member.total_revenue)}</div>
                      <div className="mt-1 text-xs text-app-muted">{member.total_sales || 0} txns</div>
                    </td>
                    <td className="px-4 py-3">
                      {canAct ? (
                        <div className="flex max-w-[320px] flex-wrap gap-1.5">
                          <Link to={`/users/${member.id}/edit`} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                            <Edit3 size={12} /> Edit
                          </Link>
                          {can("users", "edit") && (
                            <>
                              <button type="button" onClick={() => resetPassword(member)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <LockKeyhole size={12} /> Password
                              </button>
                              <button type="button" onClick={() => control(member, member.active ? "deactivate" : "activate", member.active ? "Deactivate" : "Activate")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <Power size={12} /> {member.active ? "Deactivate" : "Activate"}
                              </button>
                              <button type="button" onClick={() => control(member, "suspend", "Suspend")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <Ban size={12} /> Suspend
                              </button>
                              <button type="button" onClick={() => control(member, "unlock", "Unlock")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <Unlock size={12} /> Unlock
                              </button>
                              <button type="button" onClick={() => control(member, "force_logout", "Force logout")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <LogOut size={12} /> Force logout
                              </button>
                              <button type="button" onClick={() => control(member, "force_password_change", "Force password change")} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs">
                                <KeyRound size={12} /> Force pwd
                              </button>
                              <button
                                type="button"
                                onClick={() => control(
                                  member,
                                  member.login_enabled === false || member.login_enabled === 0 ? "enable_login" : "disable_login",
                                  member.login_enabled === false || member.login_enabled === 0 ? "Enable login" : "Disable login"
                                )}
                                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs"
                              >
                                {member.login_enabled === false || member.login_enabled === 0 ? "Enable login" : "Disable login"}
                              </button>
                            </>
                          )}
                          {can("users", "delete") && (
                            <button
                              type="button"
                              disabled={member.id === user.id}
                              onClick={() => window.confirm(`Permanently delete ${member.name}? Historical sale snapshots will remain.`) && act(api.auth_admin.deleteUser(member.id), "User deleted")}
                              className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FBD5D5] px-2 text-xs text-danger disabled:opacity-40"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-app-muted">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {loading && <tr><td colSpan={9} className="py-12 text-center text-sm text-app-muted">Loading users…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-sm text-app-muted">No users match your filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
