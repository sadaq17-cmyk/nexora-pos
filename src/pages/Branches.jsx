import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRealtimeRefresh } from "../hooks/useRealtimeRefresh";

export default function Branches() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", code: "", address: "", active: true });
  const [busyId, setBusyId] = useState(null);
  const canCreate = can("branches", "create");
  const canEdit = can("branches", "edit") || canCreate;
  const canDelete = can("branches", "delete") || canCreate;

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.branches.getAll().catch(() => []);
      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ERP real-time: branch changes ripple into sales, purchases, and reports.
  useRealtimeRefresh(["branches"], load);

  const createBranch = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await api.branches.create({ name: name.trim(), active: true });
      if (result?.success === false) {
        showToast(result.error || "Could not create branch");
        return;
      }
      setName("");
      showToast("Branch created");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (branch) => {
    setEditingId(branch.id);
    setEditForm({
      name: branch.name || "",
      code: branch.code || "",
      address: branch.address || "",
      active: branch.active !== false && branch.active !== 0,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: "", code: "", address: "", active: true });
  };

  const saveEdit = async (id) => {
    if (!editForm.name.trim()) {
      showToast("Branch name is required");
      return;
    }
    setBusyId(id);
    try {
      const result = await api.branches.update({
        id,
        name: editForm.name.trim(),
        code: editForm.code.trim(),
        address: editForm.address.trim(),
        active: editForm.active,
      });
      if (result?.success === false) {
        showToast(result.error || "Could not update branch");
        return;
      }
      showToast("Branch updated");
      cancelEdit();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (branch) => {
    const nextActive = !(branch.active !== false && branch.active !== 0);
    setBusyId(branch.id);
    try {
      const result = await api.branches.update({ id: branch.id, active: nextActive });
      if (result?.success === false) {
        showToast(result.error || "Could not update branch");
        return;
      }
      showToast(nextActive ? "Branch activated" : "Branch deactivated");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const deleteBranch = async (branch) => {
    if (!window.confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) return;
    setBusyId(branch.id);
    try {
      const result = await api.branches.delete(branch.id);
      if (result?.success === false) {
        showToast(result.error || "Could not delete branch");
        return;
      }
      showToast("Branch deleted");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-fadein space-y-4">
      {canCreate && (
        <form onSubmit={createBranch} className="nx-ledger-module flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-app-muted" htmlFor="branch-name">
              New branch
            </label>
            <input
              id="branch-name"
              className="form-control w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Branch name"
            />
          </div>
          <Button type="submit" disabled={saving || !name.trim()}>
            <Plus size={16} aria-hidden /> Add branch
          </Button>
        </form>
      )}

      <section className="nx-ledger-module">
        <div className="nx-ledger-module-head">
          <h2 className="nx-ledger-module-title">Branches</h2>
          <span className="nx-ledger-module-meta">{rows.length} total</span>
        </div>
        {loading ? (
          <div className="nx-dash-empty min-h-[100px]">Loading branches…</div>
        ) : rows.length === 0 ? (
          <div className="nx-dash-empty min-h-[100px]">No branches yet.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((branch) => {
              const isEditing = editingId === branch.id;
              const isBusy = busyId === branch.id;
              const isActive = branch.active !== false && branch.active !== 0;
              if (isEditing) {
                return (
                  <div key={branch.id} className="rounded-[8px] border border-app px-3 py-2.5 text-sm space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <input
                        className="form-control flex-1 min-w-[160px]"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Branch name"
                        aria-label="Branch name"
                      />
                      <input
                        className="form-control w-28"
                        value={editForm.code}
                        onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
                        placeholder="Code"
                        aria-label="Branch code"
                      />
                      <input
                        className="form-control flex-1 min-w-[160px]"
                        value={editForm.address}
                        onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                        placeholder="Address (optional)"
                        aria-label="Branch address"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-app-muted">
                        <input
                          type="checkbox"
                          checked={editForm.active}
                          onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                        />
                        Active
                      </label>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isBusy}>
                          <X size={14} aria-hidden /> Cancel
                        </Button>
                        <Button type="button" size="sm" onClick={() => saveEdit(branch.id)} disabled={isBusy}>
                          <Save size={14} aria-hidden /> Save
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={branch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-app px-3 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Building2 size={15} className="text-app-muted" aria-hidden />
                    {branch.name}
                    {branch.address ? <span className="font-normal text-app-muted">— {branch.address}</span> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={isActive ? "success" : "danger"}
                      role={canEdit ? "button" : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      onClick={canEdit ? () => toggleActive(branch) : undefined}
                      onKeyDown={canEdit ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleActive(branch); } } : undefined}
                      title={canEdit ? "Click to toggle active status" : undefined}
                      style={canEdit ? { cursor: "pointer" } : undefined}
                    >
                      {isActive ? "Active" : "Inactive"}
                    </Badge>
                    {canEdit && (
                      <button
                        type="button"
                        className="rounded-lg border border-app p-1.5 text-app-muted hover:text-app-fg"
                        onClick={() => startEdit(branch)}
                        disabled={isBusy}
                        aria-label={`Edit ${branch.name}`}
                        title="Edit branch"
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                        onClick={() => deleteBranch(branch)}
                        disabled={isBusy}
                        aria-label={`Delete ${branch.name}`}
                        title="Delete branch"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
