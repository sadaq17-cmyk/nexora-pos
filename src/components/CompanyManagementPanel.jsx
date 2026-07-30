import { useMemo, useState } from "react";
import { Search, Plus, Building2, X } from "lucide-react";
import CompanyAccountForm from "./CompanyAccountForm";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { normalizeRole } from "../lib/rbac";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/supportContact";

const fmt = (value) => (value ? new Date(value).toLocaleString() : "—");
const fmtDate = (value) => (value ? new Date(value).toLocaleDateString() : "—");
const statusLabel = (value) => String(value || "unknown").replace(/_/g, " ");

function displayStatus(company) {
  return company.company_status || company.display_status || company.status || "unknown";
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active") return "bg-emerald-100 text-emerald-800";
  if (s === "suspended" || s === "locked") return "bg-amber-100 text-amber-900";
  if (s === "expired") return "bg-orange-100 text-orange-900";
  if (s === "disabled" || s === "cancelled" || s === "inactive") return "bg-slate-200 text-slate-800";
  if (s === "pending_verification") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-700";
}

function Cell({ children, className = "" }) {
  return <td className={`px-3 py-3 text-sm align-top ${className}`}>{children}</td>;
}

/**
 * Super Owner — Company Management (one row = one isolated tenant).
 * Never mixes operational data across companies; actions always pass company_id.
 */
export default function CompanyManagementPanel({
  companies,
  users,
  status,
  setStatus,
  search,
  setSearch,
  showCreate,
  setShowCreate,
  plans,
  load,
  act,
  showToast,
}) {
  const { impersonate, user: actor } = useAuth();
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyKind, setHistoryKind] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isSuperOwner = normalizeRole(actor?.role) === "platform_owner";

  const rows = useMemo(
    () =>
      (companies || []).map((company) => {
        const owner =
          users.find((member) => String(member.id) === String(company.owner_user_id))
          || users.find(
            (member) =>
              Number(member.company_id) === Number(company.id)
              && normalizeRole(member.role) === "owner"
          );
        return { company, owner };
      }),
    [companies, users]
  );

  const openHistory = async (company, kind) => {
    setHistoryKind(kind);
    setHistoryLoading(true);
    setHistory({ company, rows: [] });
    try {
      const result = await api.owner.getCompanyHistory(company.id);
      if (!result?.success) {
        showToast(result?.error || "Unable to load history");
        setHistory(null);
        return;
      }
      const list =
        kind === "payment"
          ? result.payment_history || []
          : result.subscription_history || [];
      setHistory({ company, rows: list, current: result.current_subscription });
    } finally {
      setHistoryLoading(false);
    }
  };

  const viewCompany = (company, owner) => {
    setSelected({ company, owner });
  };

  const editCompany = (company) => {
    const name = prompt("Company name", company.name);
    if (name == null) return;
    const email = prompt("Company email", company.email || company.owner_email || "");
    if (email == null) return;
    const phone = prompt("Company phone", company.phone || company.owner_phone || "");
    if (phone == null) return;
    const country = prompt("Country", company.country || "");
    if (country == null) return;
    act(api.owner.updateCompany(company.id, { name, email, phone, country }), "Company updated");
  };

  const markPaid = (company) => {
    const days = prompt(`Mark ${company.name} as paid. Paid period (days):`, "30");
    if (days == null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return showToast("Enter a positive number of days");
    const planHint = (plans || []).map((p) => p.code).join(", ");
    const plan = prompt(`Plan code (optional — ${planHint})`, company.plan_code || "starter");
    act(
      api.owner.markPaid(company.id, { days: n, plan_code: plan || undefined }),
      `${company.name} marked as paid`
    );
  };

  const extendSubscription = (company) => {
    const days = prompt("Extend subscription by how many days?", "30");
    if (days == null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return showToast("Enter a positive number of days");
    act(api.owner.extendSubscription(company.id, n), `Subscription extended by ${n} days`);
  };

  const extendTrial = (company) => {
    const days = prompt("Extend free trial by how many days?", "7");
    if (days == null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return showToast("Enter a positive number of days");
    act(api.owner.extendTrial(company.id, n), `Trial extended by ${n} days`);
  };

  const loginAsOwner = async (company, ownerHint) => {
    if (!isSuperOwner) return showToast("Only the Platform Super Owner can login as a company owner.");
    const owner =
      ownerHint
      || users.find((member) => String(member.id) === String(company.owner_user_id))
      || users.find(
        (member) =>
          Number(member.company_id) === Number(company.id)
          && normalizeRole(member.role) === "owner"
      );
    if (!owner?.id) return showToast("No company owner account found to impersonate");
    if (!confirm(`Log in as ${owner.name || owner.email} (${company.name})?\nYou will enter only that company's workspace.`)) {
      return;
    }
    if (api.owner?.recordAudit) {
      await api.owner.recordAudit("impersonate_owner", {
        target_user_id: owner.id,
        company_id: company.id,
      });
    }
    const result = await impersonate(owner.id);
    if (!result.success) return showToast(result.error || "Impersonation failed");
    showToast(`Now viewing as ${owner.name || owner.email}`);
    window.location.assign("/dashboard");
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2 font-semibold text-app">
            <Building2 size={18} className="text-brand" />
            Company Management
          </div>
          <p className="mt-1 text-sm text-app-muted">
            Super Owner console — each company is an isolated tenant. Actions never cross company boundaries.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary inline-flex items-center gap-2"
          onClick={() => setShowCreate((value) => !value)}
        >
          <Plus size={15} />
          Create company
        </button>
      </div>

      <div className="card flex flex-wrap gap-3 p-4">
        <div className="relative min-w-64 flex-1">
          <Search size={15} className="absolute left-3 top-3 text-app-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies, owners, email…"
            className="form-control min-h-10 w-full rounded-xl border pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="form-control min-h-10 rounded-xl border px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="expired">Expired</option>
          <option value="disabled">Disabled</option>
          <option value="pending_verification">Pending verification</option>
        </select>
      </div>

      {showCreate && (
        <CompanyAccountForm
          plans={plans}
          onCreated={(result) => {
            showToast(`Company ${result.company_code} created`);
            setShowCreate(false);
            load();
          }}
        />
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1400px]">
          <thead>
            <tr className="bg-app">
              {[
                "Company Name",
                "Owner Name",
                "Email",
                "Phone",
                "Country",
                "Plan",
                "Free Trial Status",
                "Trial Days Remaining",
                "Subscription Status",
                "Paid Until",
                "Registration Date",
                "Last Login",
                "Total Branches",
                "Total Users",
                "Company Status",
                "Quick Actions",
              ].map((heading) => (
                <th key={heading} className="px-3 py-3 text-left text-xs uppercase tracking-wide text-app-muted">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="p-10 text-center text-sm text-app-muted">
                  No companies match this filter.
                </td>
              </tr>
            )}
            {rows.map(({ company, owner }) => {
              const ds = displayStatus(company);
              return (
                <tr key={company.id} className="border-t border-app">
                  <Cell>
                    <strong>{company.name}</strong>
                    <div className="text-xs text-app-muted font-mono">{company.code}</div>
                  </Cell>
                  <Cell>{company.owner_name || owner?.name || "—"}</Cell>
                  <Cell className="text-xs">{company.owner_email || owner?.email || company.email || "—"}</Cell>
                  <Cell className="text-xs">{company.owner_phone || owner?.phone || company.phone || "—"}</Cell>
                  <Cell>{company.country || "—"}</Cell>
                  <Cell>{company.subscription_plan || "—"}</Cell>
                  <Cell>{company.free_trial_status || "—"}</Cell>
                  <Cell>{company.trial_days ?? 0}</Cell>
                  <Cell className="capitalize">{statusLabel(company.subscription_status || "—")}</Cell>
                  <Cell className="text-xs">{fmtDate(company.paid_until || company.expires_at)}</Cell>
                  <Cell className="text-xs">{fmtDate(company.registration_date || company.created_at)}</Cell>
                  <Cell className="text-xs">{fmt(company.last_login_at || owner?.last_login_at)}</Cell>
                  <Cell>{company.branch_count ?? 0}</Cell>
                  <Cell>{company.user_count ?? 0}</Cell>
                  <Cell>
                    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${statusBadgeClass(ds)}`}>
                      {statusLabel(ds)}
                    </span>
                  </Cell>
                  <Cell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      <ActionBtn onClick={() => viewCompany(company, owner)}>View Company</ActionBtn>
                      <ActionBtn onClick={() => editCompany(company)}>Edit Company</ActionBtn>
                      <ActionBtn onClick={() => markPaid(company)}>Mark as Paid</ActionBtn>
                      <ActionBtn onClick={() => extendSubscription(company)}>Extend Subscription</ActionBtn>
                      <ActionBtn onClick={() => extendTrial(company)}>Extend Trial</ActionBtn>
                      <ActionBtn
                        onClick={() =>
                          confirm(`Activate ${company.name}?`)
                          && act(api.owner.activateCompany(company.id), "Company activated")
                        }
                      >
                        Activate
                      </ActionBtn>
                      <ActionBtn
                        onClick={() =>
                          confirm(`Suspend ${company.name}? Staff will be blocked from signing in.`)
                          && act(api.owner.suspendCompany(company.id), "Company suspended")
                        }
                      >
                        Suspend
                      </ActionBtn>
                      <ActionBtn
                        onClick={() =>
                          confirm(`Deactivate ${company.name}?`)
                          && act(api.owner.deactivateCompany(company.id), "Company deactivated")
                        }
                      >
                        Deactivate
                      </ActionBtn>
                      <ActionBtn onClick={() => openHistory(company, "payment")}>View Payment History</ActionBtn>
                      <ActionBtn onClick={() => openHistory(company, "subscription")}>
                        View Subscription History
                      </ActionBtn>
                      {isSuperOwner && (
                        <ActionBtn
                          emphasis
                          dataTestId="login-as-owner"
                          onClick={() => loginAsOwner(company, owner)}
                        >
                          Login as Company Owner
                        </ActionBtn>
                      )}
                    </div>
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <DetailModal title={`Company · ${selected.company.name}`} onClose={() => setSelected(null)}>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            {[
              ["Company Name", selected.company.name],
              ["Company Code", selected.company.code],
              ["Owner Name", selected.company.owner_name || selected.owner?.name || "—"],
              ["Email", selected.company.owner_email || selected.owner?.email || selected.company.email || "—"],
              ["Phone", selected.company.owner_phone || selected.owner?.phone || selected.company.phone || "—"],
              ["Country", selected.company.country || "—"],
              ["Plan", selected.company.subscription_plan || "—"],
              ["Free Trial Status", selected.company.free_trial_status || "—"],
              ["Trial Days Remaining", selected.company.trial_days ?? 0],
              ["Subscription Status", statusLabel(selected.company.subscription_status || "—")],
              ["Paid Until", fmtDate(selected.company.paid_until || selected.company.expires_at)],
              ["Registration Date", fmt(selected.company.registration_date || selected.company.created_at)],
              ["Last Login", fmt(selected.company.last_login_at || selected.owner?.last_login_at)],
              ["Total Branches", selected.company.branch_count ?? 0],
              ["Total Users", selected.company.user_count ?? 0],
              ["Company Status", statusLabel(displayStatus(selected.company))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-app px-3 py-2">
                <dt className="text-xs uppercase text-app-muted">{label}</dt>
                <dd className="mt-1 font-medium text-app">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-app-muted">
            Tenant isolation: all metrics and actions for this panel are scoped to company_id={selected.company.id}.
          </p>
        </DetailModal>
      )}

      {history && (
        <DetailModal
          title={`${historyKind === "payment" ? "Payment" : "Subscription"} history · ${history.company.name}`}
          onClose={() => {
            setHistory(null);
            setHistoryKind(null);
          }}
        >
          {historyLoading && <p className="text-sm text-app-muted">Loading…</p>}
          {!historyLoading && history.current && historyKind === "subscription" && (
            <div className="mb-4 rounded-xl border border-app px-3 py-2 text-sm">
              Current: <strong className="capitalize">{statusLabel(history.current.status)}</strong>
              {" · "}
              {history.current.plan_code}
              {" · Paid until "}
              {fmtDate(history.current.expires_at)}
            </div>
          )}
          {!historyLoading && (history.rows || []).length === 0 && (
            <p className="text-sm text-app-muted">
              No {historyKind} history recorded yet for this company.
              {historyKind === "payment" ? " Use Mark as Paid to create the first payment audit event." : ""}
            </p>
          )}
          {!historyLoading && (history.rows || []).length > 0 && (
            <div className="space-y-2">
              {history.rows.map((row) => (
                <div key={row.id || `${row.created_at}-${row.action}`} className="rounded-xl border border-app px-3 py-2 text-sm">
                  <div className="font-medium capitalize">{statusLabel(row.action)}</div>
                  <div className="text-xs text-app-muted">
                    {fmt(row.created_at)} · {row.user_name || "Platform"}
                  </div>
                  {row.details && (
                    <pre className="mt-1 overflow-x-auto text-xs text-app-muted">
                      {typeof row.details === "string" ? row.details : JSON.stringify(row.details)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </DetailModal>
      )}

      <p className="text-xs text-app-muted">
        Platform support: <a className="text-brand underline" href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
      </p>
    </div>
  );
}

function ActionBtn({ children, onClick, emphasis = false, dataTestId }) {
  return (
    <button
      type="button"
      data-testid={dataTestId}
      className={`rounded-lg border px-2 py-1 text-xs ${
        emphasis ? "border-brand text-brand" : "border-app text-app"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DetailModal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
      <div className="card w-full max-w-3xl p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="rounded-lg border border-app p-1.5" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
