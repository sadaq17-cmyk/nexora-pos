import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, FileText, Plus, Printer } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { downloadPayslipPdf, printPayslip } from "../lib/payslipExport";

export default function PayrollSelfService() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const { formatMoney: money, settings: enterpriseSettings } = useEnterpriseSettings();
  const companyInfo = {
    name: enterpriseSettings?.store_name || enterpriseSettings?.company_name || "Nexora POS Pro",
    address: enterpriseSettings?.store_address || "",
    phone: enterpriseSettings?.store_phone || "",
    logo_url: enterpriseSettings?.logo_url || "",
  };
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "annual",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: "",
  });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const overview = await api.payroll.selfOverview();
      setData(overview);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const requestLeave = async (e) => {
    e.preventDefault();
    setBusy(true);
    const result = await api.payroll.requestLeave(leaveForm);
    setBusy(false);
    if (result.success) {
      showToast("Leave request submitted");
      await load();
    } else showToast(result.error || "Could not submit leave");
  };

  if (loading) return <ListSkeleton rows={6} />;

  if (!data?.linked) {
    return (
      <div className="animate-fadein">
        <div className="nx-page-header">
          <div>
            <h1 className="page-title">My HR</h1>
            <p className="mt-1 text-app-muted">{data?.message || "Not linked to an employee record."}</p>
          </div>
          {can("payroll", "edit") && (
            <Link to="/payroll" className="btn btn-primary">
              Open Payroll
            </Link>
          )}
        </div>
      </div>
    );
  }

  const emp = data.employee;

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">My HR Portal</h1>
          <p className="mt-1 text-app-muted">
            {emp.first_name} {emp.last_name} · {emp.employee_code} · {emp.department || "—"} / {emp.position || "—"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const r = await api.payroll.checkIn({});
              showToast(r.success ? "Checked in" : r.error || "Failed");
              if (r.success) await load();
            }}
          >
            <Clock size={14} /> Check In
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const r = await api.payroll.checkOut({});
              showToast(r.success ? "Checked out" : r.error || "Failed");
              if (r.success) await load();
            }}
          >
            Check Out
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="table-container p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <CalendarDays size={16} /> Leave balances
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-app-muted text-left">
                <th className="py-1">Type</th>
                <th>Entitled</th>
                <th>Used</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {(data.leave_balances || []).map((b) => (
                <tr key={b.id} className="border-t border-app-border">
                  <td className="py-2 capitalize">{b.leave_type}</td>
                  <td>{b.entitled}</td>
                  <td>{b.used}</td>
                  <td>{b.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={requestLeave} className="table-container p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus size={16} /> Request leave
          </h2>
          <label className="text-sm block">
            Type
            <select
              className="input mt-1 w-full"
              value={leaveForm.leave_type}
              onChange={(e) => setLeaveForm((f) => ({ ...f, leave_type: e.target.value }))}
            >
              {["annual", "sick", "maternity", "paternity", "emergency"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Start
              <input
                className="input mt-1 w-full"
                type="date"
                required
                value={leaveForm.start_date}
                onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              End
              <input
                className="input mt-1 w-full"
                type="date"
                required
                value={leaveForm.end_date}
                onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </label>
          </div>
          <label className="text-sm block">
            Reason
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Submit request
          </button>
        </form>
      </div>

      <div className="table-container mb-5">
        <h2 className="px-4 pt-4 font-semibold flex items-center gap-2">
          <FileText size={16} /> My payslips
        </h2>
        <table className="w-full">
          <thead>
            <tr className="bg-app-panel-muted">
              {["Period", "Gross", "Net", "Actions"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.payslips || []).map((p) => (
              <tr key={p.id} className="border-t border-app-border">
                <td className="px-4 py-2.5">{p.hr_payroll_runs?.run_label || p.payroll_run_id}</td>
                <td className="px-4 py-2.5">{money(p.gross_pay)}</td>
                <td className="px-4 py-2.5 font-medium">{money(p.net_pay)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.25rem 0.5rem" }}
                      onClick={() => printPayslip(p, companyInfo, p.hr_payroll_runs || {})}
                    >
                      <Printer size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: "0.25rem 0.5rem" }}
                      onClick={async () => {
                        await downloadPayslipPdf(p, companyInfo, p.hr_payroll_runs || {});
                        showToast("PDF downloaded");
                      }}
                    >
                      PDF
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!data.payslips?.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-app-muted">
                  No payslips yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="table-container">
          <h2 className="px-4 pt-4 font-semibold">Leave history</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Type", "Dates", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2 text-xs uppercase text-app-muted text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.leave_requests || []).map((l) => (
                <tr key={l.id} className="border-t border-app-border">
                  <td className="px-4 py-2 capitalize">{l.leave_type}</td>
                  <td className="px-4 py-2">
                    {l.start_date} → {l.end_date}
                  </td>
                  <td className="px-4 py-2 capitalize">{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-container">
          <h2 className="px-4 pt-4 font-semibold">Recent attendance</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Date", "Hours", "OT", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2 text-xs uppercase text-app-muted text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.attendance || []).map((a) => (
                <tr key={a.id} className="border-t border-app-border">
                  <td className="px-4 py-2">{a.work_date}</td>
                  <td className="px-4 py-2">{a.hours_worked}</td>
                  <td className="px-4 py-2">{a.overtime_hours}</td>
                  <td className="px-4 py-2 capitalize">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
