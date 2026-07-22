import { useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Branches() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const canCreate = can("branches", "create");

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
            {rows.map((branch) => (
              <div key={branch.id} className="flex items-center justify-between rounded-[8px] border border-app px-3 py-2.5 text-sm">
                <span className="inline-flex items-center gap-2 font-medium">
                  <Building2 size={15} className="text-app-muted" aria-hidden />
                  {branch.name}
                </span>
                <Badge variant={branch.active === false || branch.active === 0 ? "danger" : "success"}>
                  {branch.active === false || branch.active === 0 ? "Inactive" : "Active"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
