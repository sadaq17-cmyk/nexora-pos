import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Plus,
  Trash2,
  RotateCcw,
  Search,
  Lock,
  Check,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { MODULES, ACTIONS, isOwner, isSuperAdmin } from "../lib/rbac";

const ACTION_LABELS = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  print: "Print",
  export: "Export",
};

/** Module-specific action labels (purchases.approve = Receive). */
const MODULE_ACTION_LABELS = {
  purchases: { approve: "Receive" },
};

function actionLabel(action, moduleId) {
  return MODULE_ACTION_LABELS[moduleId]?.[action] || ACTION_LABELS[action] || action;
}

export default function RolesPermissionsPanel({ embedded = false }) {
  const { user, can, refreshPermissions } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState("admin");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("All");
  const [data, setData] = useState({
    matrix: {},
    modules: [],
    actions: ACTIONS,
    roles: [],
    meta: {},
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [newRole, setNewRole] = useState({ label: "", description: "", cloneFrom: "cashier" });

  const load = async () => {
    try {
      const matrixPayload = await api.permissions.getMatrix();
      setData(matrixPayload);
      if (!matrixPayload.roles?.some((role) => role.id === selectedRole)) {
        setSelectedRole(matrixPayload.roles?.[0]?.id || "admin");
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[RolesPermissions] load failed", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => ["All", ...new Set(MODULES.map((module) => module.group))], []);

  const filteredModules = useMemo(() => {
    return MODULES.filter((module) => {
      const matchesGroup = groupFilter === "All" || module.group === groupFilter;
      const matchesSearch =
        !search.trim() ||
        module.label.toLowerCase().includes(search.toLowerCase()) ||
        module.id.includes(search.toLowerCase());
      return matchesGroup && matchesSearch;
    });
  }, [groupFilter, search]);

  const selectedMeta = data.roles?.find((role) => role.id === selectedRole);
  const canEdit = !!data.meta?.canEditPermissions && can("roles", "edit");
  const privileged = isOwner(user?.role) || isSuperAdmin(user?.role);
  const canCreate = privileged && !!data.meta?.canCreateRoles;
  const canDelete = privileged && !!data.meta?.canDeleteRoles;
  const lockedSuper = selectedRole === "owner" || (selectedRole === "super_admin" && !isOwner(user?.role));

  const toggle = async (module, action) => {
    if (!canEdit || lockedSuper) {
      showToast("You do not have permission to edit this role.");
      return;
    }
    const next = !data.matrix?.[selectedRole]?.[module]?.[action];
    setData((current) => ({
      ...current,
      matrix: {
        ...current.matrix,
        [selectedRole]: {
          ...current.matrix[selectedRole],
          [module]: {
            ...current.matrix[selectedRole]?.[module],
            [action]: next,
          },
        },
      },
    }));
    const result = await api.permissions.update({
      role: selectedRole,
      module,
      action,
      allowed: next,
    });
    if (!result.success) {
      showToast(result.error || "Could not update permission");
      await load();
      return;
    }
    await refreshPermissions?.();
  };

  const setRow = async (module, enabled) => {
    if (!canEdit || lockedSuper) return;
    for (const action of ACTIONS) {
      const current = !!data.matrix?.[selectedRole]?.[module]?.[action];
      if (current === enabled) continue;
      await api.permissions.update({ role: selectedRole, module, action, allowed: enabled });
    }
    await load();
    await refreshPermissions?.();
    showToast(enabled ? "Module granted" : "Module cleared");
  };

  const createRole = async (event) => {
    event.preventDefault();
    const result = await api.permissions.createRole(newRole);
    if (!result.success) {
      showToast(result.error || "Could not create role");
      return;
    }
    showToast("Role created");
    setCreateOpen(false);
    setNewRole({ label: "", description: "", cloneFrom: "cashier" });
    await load();
    setSelectedRole(result.id);
  };

  const deleteRole = async () => {
    if (!selectedMeta || selectedMeta.system) return;
    if (!confirm(`Delete role “${selectedMeta.label}”? This cannot be undone.`)) return;
    const result = await api.permissions.deleteRole(selectedRole);
    if (!result.success) {
      showToast(result.error || "Could not delete role");
      return;
    }
    showToast("Role deleted");
    setSelectedRole("cashier");
    await load();
  };

  const resetRole = async () => {
    if (!confirm(`Reset “${selectedMeta?.label}” to default permissions?`)) return;
    const result = await api.permissions.resetDefaults(selectedRole);
    if (!result.success) {
      showToast(result.error || "Could not reset role");
      return;
    }
    showToast("Defaults restored");
    await load();
    await refreshPermissions?.();
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-app-muted">Loading roles & permissions…</div>;
  }

  return (
    <div className={embedded ? "" : "animate-fadein"}>
      {!embedded && (
        <div className="nx-page-header">
          <div>
            <h1 className="page-title">Roles & Permissions</h1>
            <p className="mt-1 text-base text-app-muted">
              Configure fine-grained access for every role across Nexora POS Pro.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <aside className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-app-text">
              <ShieldCheck size={16} className="text-brand" />
              Roles
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                <Plus size={13} /> New
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {data.roles.map((role) => {
              const active = role.id === selectedRole;
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRole(role.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    active ? "border-brand bg-brand/10" : "border-transparent hover:bg-app"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color || "#64748B" }} />
                    <span className="text-sm font-medium text-app-text">{role.label}</span>
                    {role.system && <Lock size={11} className="ml-auto text-app-muted" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{role.description}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="card !p-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-app p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-app-text">{selectedMeta?.label || "Role"}</h3>
                {selectedMeta?.system && (
                  <span className="rounded-full bg-app px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-app-muted">
                    System
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-app-muted">{selectedMeta?.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(privileged || user?.role === "admin") && selectedMeta?.system && !lockedSuper && (
                <button
                  type="button"
                  onClick={resetRole}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-app px-3 py-1.5 text-xs font-medium text-app-text"
                >
                  <RotateCcw size={13} /> Reset defaults
                </button>
              )}
              {canDelete && selectedMeta && !selectedMeta.system && (
                <button
                  type="button"
                  onClick={deleteRole}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
                >
                  <Trash2 size={13} /> Delete role
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-b border-app p-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search permissions…"
                className="w-full rounded-lg border border-app bg-app px-9 py-2 text-sm text-app-text outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setGroupFilter(group)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    groupFilter === group ? "bg-brand text-white" : "bg-app text-app-muted"
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>

          {!canEdit && (
            <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You can view the matrix, but only Admin or Super Admin can change permissions.
            </div>
          )}
          {lockedSuper && (
            <div className="mx-4 mt-4 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
              Super Admin permissions are locked for your role.
            </div>
          )}

          <div className="overflow-x-auto p-2 sm:p-4">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-app-panel px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-app-muted">
                    Permission
                  </th>
                  {ACTIONS.map((action) => (
                    <th key={action} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-app-muted">
                      {ACTION_LABELS[action]}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-app-muted">All</th>
                </tr>
              </thead>
              <tbody>
                {filteredModules.map((module) => {
                  const row = data.matrix?.[selectedRole]?.[module.id] || {};
                  const allOn = ACTIONS.every((action) => row[action]);
                  return (
                    <tr key={module.id} className="border-t border-app/80">
                      <td className="sticky left-0 bg-app-panel px-3 py-2.5">
                        <div className="font-medium text-app-text">{module.label}</div>
                        <div className="text-[11px] text-app-muted">{module.group}</div>
                      </td>
                      {ACTIONS.map((action) => {
                        const checked = !!row[action];
                        return (
                          <td key={action} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              disabled={!canEdit || lockedSuper}
                              onClick={() => toggle(module.id, action)}
                              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                checked
                                  ? "border-brand bg-brand text-white"
                                  : "border-app bg-app text-app-muted hover:border-brand/40"
                              }`}
                              title={`${actionLabel(action, module.id)} ${module.label}`}
                            >
                              {checked ? <Check size={14} /> : <X size={12} />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          disabled={!canEdit || lockedSuper}
                          onClick={() => setRow(module.id, !allOn)}
                          className="rounded-lg border border-app px-2 py-1 text-[11px] font-medium text-app-muted hover:text-brand disabled:opacity-40"
                        >
                          {allOn ? "Clear" : "Grant"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredModules.length === 0 && (
              <div className="py-10 text-center text-sm text-app-muted">No permissions match your filters.</div>
            )}
          </div>
        </section>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="nx-modal max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-app-text">Create custom role</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-app-muted">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={createRole} className="space-y-3">
              <input
                required
                placeholder="Role name"
                value={newRole.label}
                onChange={(e) => setNewRole((current) => ({ ...current, label: e.target.value }))}
                className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app-text"
              />
              <textarea
                placeholder="Short description"
                rows={3}
                value={newRole.description}
                onChange={(e) => setNewRole((current) => ({ ...current, description: e.target.value }))}
                className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app-text"
              />
              <div>
                <label className="mb-1.5 block text-xs font-medium text-app-muted">Clone permissions from</label>
                <select
                  value={newRole.cloneFrom}
                  onChange={(e) => setNewRole((current) => ({ ...current, cloneFrom: e.target.value }))}
                  className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app-text"
                >
                  {data.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-app-muted">Only Super Admin can create or delete roles.</p>
              <button type="submit" className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white">
                Create role
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
