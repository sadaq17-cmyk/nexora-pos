import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { canDecideApproval, canSubmitApproval, approvalTypeMeta } from "../lib/approvalWorkflow";
import { isPlatformOwner } from "../lib/rbac";

function statusTone(status) {
  if (status === "approved") return "bg-[var(--success-soft)] text-success";
  if (status === "rejected" || status === "cancelled") return "bg-[#FEE2E2] text-[#B91C1C]";
  return "bg-[#FEF3C7] text-[#B45309]";
}

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

export default function Approvals() {
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ type: "plan_change", reason: "", plan_code: "" });

  const canSubmit = canSubmitApproval(user?.role) && can("platform_approvals", "create");
  const canDecide = canDecideApproval(user?.role) && can("platform_approvals", "approve");
  const platformView = isPlatformOwner(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, typeRows] = await Promise.all([
        api.approvals.list(),
        api.approvals.listTypes(),
      ]);
      setRequests(Array.isArray(rows) ? rows : []);
      setTypes(Array.isArray(typeRows) ? typeRows : []);
    } catch (err) {
      if (import.meta.env.DEV) console.error("[Approvals] load failed", err);
      setRequests([]);
      setTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCount = useMemo(
    () => requests.filter((row) => row.status === "pending_platform" || row.status === "pending_owner").length,
    [requests]
  );

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const payload = form.type === "plan_change" && form.plan_code
      ? { plan_code: form.plan_code.trim().toLowerCase() }
      : {};
    const result = await api.approvals.create({
      type: form.type,
      reason: form.reason,
      payload,
    });
    setSubmitting(false);
    if (!result.success) return showToast(result.error || "Could not submit request");
    setForm({ type: "plan_change", reason: "", plan_code: "" });
    await load();
    showToast("Request submitted for Platform Super Admin approval");
  };

  const decide = async (request, decision) => {
    const note = window.prompt(
      decision === "approve" ? "Optional approval note:" : "Optional rejection note:"
    );
    if (note === null) return;
    const result = await api.approvals.decide(request.id, { decision, note });
    if (!result.success) return showToast(result.error || "Decision failed");
    await load();
    showToast(decision === "approve" ? "Request approved" : "Request rejected");
  };

  const cancel = async (request) => {
    if (!window.confirm("Cancel this open approval request?")) return;
    const result = await api.approvals.cancel(request.id);
    if (!result.success) return showToast(result.error || "Could not cancel request");
    await load();
    showToast("Request cancelled");
  };

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Approval Requests</h1>
          <p className="mt-1 text-base text-app-muted">
            {platformView
              ? "Review Owner requests that require Platform Super Admin approval."
              : "Submit sensitive company actions for Platform Super Admin approval."}
          </p>
        </div>
        <div className="rounded-[12px] border border-app bg-app-panel px-4 py-3 text-sm text-app-muted">
          Open: <span className="font-semibold text-app-text">{openCount}</span>
        </div>
      </div>

      {canSubmit && (
        <form onSubmit={submit} className="card mb-6 space-y-4">
          <div className="flex items-center gap-2 text-base font-semibold text-app-text">
            <ClipboardList size={18} className="text-brand" />
            New Owner request
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="form-label">Request type</span>
              <select
                className="form-control w-full"
                value={form.type}
                onChange={(e) => setForm((current) => ({ ...current, type: e.target.value }))}
              >
                {types.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </label>
            {form.type === "plan_change" && (
              <label className="block">
                <span className="form-label">Requested plan code</span>
                <input
                  className="form-control w-full"
                  value={form.plan_code}
                  onChange={(e) => setForm((current) => ({ ...current, plan_code: e.target.value }))}
                  placeholder="starter, business, professional, or enterprise"
                />
              </label>
            )}
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-app-muted">Reason</span>
            <textarea
              className="form-control min-h-[120px] w-full"
              value={form.reason}
              onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))}
              placeholder="Explain why this action needs platform approval"
              required
            />
          </label>
          <p className="text-xs text-app-muted">
            {approvalTypeMeta(form.type)?.description || "Owner approval is recorded, then Platform Super Admin decides."}
          </p>
          <button type="submit" disabled={submitting} className="btn btn-primary disabled:opacity-50">
            {submitting ? "Submitting…" : "Submit for platform approval"}
          </button>
        </form>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Request", "Company", "Status", "Requested", "Decision", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-app-muted">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const open = request.status === "pending_platform" || request.status === "pending_owner";
                return (
                  <tr key={request.id} className="border-t border-app">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-app-text">
                        {approvalTypeMeta(request.type)?.label || request.type}
                      </div>
                      <div className="mt-1 text-xs text-app-muted">{request.reason || "No reason provided"}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>{request.company_name || `Company #${request.company_id}`}</div>
                      <div className="mt-1 text-xs text-app-muted">by {request.requested_by_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusTone(request.status)}`}>
                        {statusLabel(request.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">
                      {request.created_at ? new Date(request.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">
                      {request.decided_by_name ? (
                        <>
                          <div>{request.decided_by_name}</div>
                          <div className="mt-1">{request.decision_note || "No note"}</div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {open && canDecide ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => decide(request, "approve")}
                            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs text-success"
                          >
                            <CheckCircle2 size={12} /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(request, "reject")}
                            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#FBD5D5] px-2 text-xs text-danger"
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </div>
                      ) : open && canSubmit ? (
                        <button
                          type="button"
                          onClick={() => cancel(request)}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-app px-2 text-xs"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="text-xs text-app-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {loading && (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-app-muted">Loading requests…</td></tr>
              )}
              {!loading && requests.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-app-muted">No approval requests yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
