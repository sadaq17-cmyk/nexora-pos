import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Clock,
  CalendarDays,
  Wallet,
  FileSpreadsheet,
  BarChart3,
  Plus,
  Save,
  Check,
  Lock,
  Unlock,
  RotateCcw,
  Download,
  Printer,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useEnterpriseSettings } from "../context/EnterpriseSettingsContext";
import { ListSkeleton } from "@/components/ui/skeleton";
import { downloadPayslipPdf, exportBankTransfer, printPayslip } from "../lib/payslipExport";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "employees", label: "Employees", icon: Users },
  { id: "attendance", label: "Attendance", icon: Clock },
  { id: "leave", label: "Leave", icon: CalendarDays },
  { id: "salary", label: "Salary", icon: Wallet },
  { id: "runs", label: "Payroll Runs", icon: FileSpreadsheet },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Tax Settings", icon: Settings2 },
];

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="nx-kpi">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: color + "1A" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="nx-kpi-value">{value}</div>
      <div className="nx-kpi-label">{label}</div>
    </div>
  );
}

const emptyEmployee = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  department: "",
  position: "",
  employment_type: "permanent",
  hire_date: new Date().toISOString().slice(0, 10),
  bank_name: "",
  bank_account: "",
  basic_salary: "",
  national_id: "",
};

export default function Payroll() {
  const { can, user } = useAuth();
  const { showToast } = useToast();
  const { formatMoney: money, settings: enterpriseSettings } = useEnterpriseSettings();
  const companyInfo = {
    name: enterpriseSettings?.store_name || enterpriseSettings?.company_name || user?.company_name || "Nexora POS Pro",
    address: enterpriseSettings?.store_address || "",
    phone: enterpriseSettings?.store_phone || "",
    logo_url: enterpriseSettings?.logo_url || enterpriseSettings?.store_logo || "",
    currency: enterpriseSettings?.base_currency_code || enterpriseSettings?.currency || "KES",
  };
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leave, setLeave] = useState([]);
  const [structures, setStructures] = useState([]);
  const [runs, setRuns] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [reports, setReports] = useState(null);
  const [settings, setSettings] = useState(null);
  const [empModal, setEmpModal] = useState(false);
  const [empForm, setEmpForm] = useState(emptyEmployee);
  const [salaryModal, setSalaryModal] = useState(false);
  const [salaryForm, setSalaryForm] = useState({ employee_id: "", basic_salary: "", allowances: "", housing: "", transport: "" });
  const [runForm, setRunForm] = useState({
    period_year: new Date().getFullYear(),
    period_month: new Date().getMonth() + 1,
  });
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [busy, setBusy] = useState(false);

  const isManager = can("payroll", "approve") || can("payroll", "edit");

  const loadCore = async () => {
    setLoading(true);
    try {
      const [d, e, s] = await Promise.all([
        api.payroll.getDashboard().catch(() => null),
        api.payroll.listEmployees().catch(() => []),
        api.payroll.getSettings().catch(() => null),
      ]);
      setDash(d?.success === false ? null : d);
      setEmployees(Array.isArray(e) ? e : []);
      setSettings(s?.success === false ? null : s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCore();
  }, []);

  useEffect(() => {
    const loadTab = async () => {
      if (tab === "attendance") {
        setAttendance(await api.payroll.listAttendance({ limit: 200 }).catch(() => []));
      } else if (tab === "leave") {
        setLeave(await api.payroll.listLeave({ limit: 200 }).catch(() => []));
      } else if (tab === "salary") {
        setStructures(await api.payroll.listSalaryStructures({ active_only: true }).catch(() => []));
      } else if (tab === "runs") {
        const r = await api.payroll.listRuns().catch(() => []);
        setRuns(Array.isArray(r) ? r : []);
      } else if (tab === "reports") {
        setReports(await api.payroll.getReports({ year: new Date().getFullYear() }).catch(() => null));
      } else if (tab === "overview") {
        setDash(await api.payroll.getDashboard().catch(() => null));
      }
    };
    loadTab();
  }, [tab]);

  useEffect(() => {
    if (!selectedRunId) {
      setPayslips([]);
      return;
    }
    api.payroll.listPayslips({ run_id: selectedRunId }).then((rows) => setPayslips(Array.isArray(rows) ? rows : []));
  }, [selectedRunId]);

  const createEmployee = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    const result = await api.payroll.createEmployee({
      ...empForm,
      basic_salary: empForm.basic_salary ? Number(empForm.basic_salary) : undefined,
    });
    setBusy(false);
    if (result.success) {
      showToast("Employee created");
      setEmpModal(false);
      setEmpForm(emptyEmployee);
      await loadCore();
    } else showToast(result.error || "Could not create employee");
  };

  const saveSalary = async (ev) => {
    ev.preventDefault();
    if (!salaryForm.employee_id) {
      showToast("Select an employee");
      return;
    }
    const allowances = [];
    if (Number(salaryForm.housing) > 0) allowances.push({ code: "HSE", label: "Housing", amount: Number(salaryForm.housing) });
    if (Number(salaryForm.transport) > 0) allowances.push({ code: "TRN", label: "Transport", amount: Number(salaryForm.transport) });
    if (salaryForm.allowances) {
      try {
        const extra = JSON.parse(salaryForm.allowances);
        if (Array.isArray(extra)) allowances.push(...extra);
      } catch {
        /* ignore */
      }
    }
    setBusy(true);
    const result = await api.payroll.upsertSalaryStructure({
      employee_id: Number(salaryForm.employee_id),
      basic_salary: Number(salaryForm.basic_salary) || 0,
      allowances,
    });
    setBusy(false);
    if (result.success) {
      showToast("Salary structure saved");
      setSalaryModal(false);
      setStructures(await api.payroll.listSalaryStructures({ active_only: true }).catch(() => []));
    } else showToast(result.error || "Could not save salary");
  };

  const createRun = async () => {
    setBusy(true);
    const result = await api.payroll.createRun(runForm);
    setBusy(false);
    if (result.success) {
      showToast("Payroll run created");
      setRuns(await api.payroll.listRuns().catch(() => []));
      setSelectedRunId(result.run?.id);
    } else showToast(result.error || "Could not create run");
  };

  const runAction = async (fn, okMsg) => {
    if (!selectedRunId) {
      showToast("Select a payroll run");
      return;
    }
    setBusy(true);
    const result = await fn(selectedRunId);
    setBusy(false);
    if (result?.success) {
      showToast(okMsg);
      setRuns(await api.payroll.listRuns().catch(() => []));
      setPayslips(await api.payroll.listPayslips({ run_id: selectedRunId }).catch(() => []));
      setDash(await api.payroll.getDashboard().catch(() => null));
    } else showToast(result?.error || "Action failed");
  };

  const bankExport = async (format) => {
    if (!selectedRunId) {
      showToast("Select a payroll run");
      return;
    }
    const result = await api.payroll.bankExport(selectedRunId);
    if (!result?.success) {
      showToast(result?.error || "Export failed");
      return;
    }
    await exportBankTransfer(result.rows, { format });
    showToast(format === "excel" ? "Excel exported" : "CSV exported");
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    const result = await api.payroll.updateSettings({
      personal_relief: Number(settings.personal_relief),
      nssf_employee_rate: Number(settings.nssf_employee_rate),
      nssf_employer_rate: Number(settings.nssf_employer_rate),
      nssf_max_base: Number(settings.nssf_max_base),
      overtime_rate_mult: Number(settings.overtime_rate_mult),
      standard_hours_day: Number(settings.standard_hours_day),
      standard_days_month: Number(settings.standard_days_month),
      paye_enabled: !!settings.paye_enabled,
      nssf_enabled: !!settings.nssf_enabled,
      nhif_sha_enabled: !!settings.nhif_sha_enabled,
      pension_enabled: !!settings.pension_enabled,
      pension_employee_rate: Number(settings.pension_employee_rate),
      pension_employer_rate: Number(settings.pension_employer_rate),
    });
    setBusy(false);
    if (result.success) {
      showToast("Payroll settings saved");
      setSettings(result.settings);
    } else showToast(result.error || "Could not save settings");
  };

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId), [runs, selectedRunId]);

  return (
    <div className="animate-fadein">
      <div className="nx-page-header">
        <div>
          <h1 className="page-title">Payroll & HR</h1>
          <p className="mt-1 text-base text-app-muted">
            Employees, attendance, leave, salary structures, and monthly payroll — company scoped.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/payroll/self" className="btn btn-secondary">
            My HR Portal
          </Link>
          {can("payroll", "create") && isManager && (
            <button type="button" className="btn btn-primary" onClick={() => setEmpModal(true)}>
              <Plus size={15} /> Add Employee
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "0.4rem 0.75rem" }}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading && tab === "overview" ? (
        <ListSkeleton rows={4} />
      ) : null}

      {tab === "overview" && dash && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <StatCard icon={Users} label="Active Employees" value={dash.active_employees ?? 0} color="#2563EB" />
            <StatCard icon={CalendarDays} label="Pending Leave" value={dash.pending_leave ?? 0} color="#D97706" />
            <StatCard
              icon={Wallet}
              label="Latest Net Payroll"
              value={money(dash.latest_run?.net_total || 0)}
              color="#059669"
            />
            <StatCard icon={Clock} label="OT Cost (latest)" value={money(dash.overtime_cost_latest || 0)} color="#DC2626" />
          </div>
          {!!dash.insights?.length && (
            <div className="table-container p-4 mb-5">
              <h3 className="font-semibold mb-2">Insights</h3>
              <ul className="list-disc pl-5 text-sm text-app-muted space-y-1">
                {dash.insights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="table-container">
            <table className="w-full">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Period", "Gross", "Net", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(dash.salary_expense_trend || []).map((row) => (
                  <tr key={row.label} className="border-t border-app-border">
                    <td className="px-4 py-2.5">{row.label}</td>
                    <td className="px-4 py-2.5">{money(row.gross)}</td>
                    <td className="px-4 py-2.5">{money(row.net)}</td>
                    <td className="px-4 py-2.5 capitalize">{row.status}</td>
                  </tr>
                ))}
                {!dash.salary_expense_trend?.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-app-muted text-center">
                      No payroll runs yet — create one under Payroll Runs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "employees" && (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Code", "Name", "Department", "Position", "Status", "Bank"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-app-border">
                  <td className="px-4 py-2.5 font-medium">{e.employee_code}</td>
                  <td className="px-4 py-2.5">
                    {e.first_name} {e.last_name}
                  </td>
                  <td className="px-4 py-2.5">{e.department || "—"}</td>
                  <td className="px-4 py-2.5">{e.position || "—"}</td>
                  <td className="px-4 py-2.5 capitalize">{e.status}</td>
                  <td className="px-4 py-2.5 text-sm text-app-muted">
                    {e.bank_name || "—"} {e.bank_account ? `· ${e.bank_account}` : ""}
                  </td>
                </tr>
              ))}
              {!employees.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-app-muted">
                    No employees yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "attendance" && (
        <div className="table-container">
          <div className="p-3 flex flex-wrap gap-2 border-b border-app-border">
            {can("payroll", "create") && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const r = await api.payroll.checkIn({});
                    showToast(r.success ? "Checked in" : r.error || "Check-in failed");
                    if (r.success) setAttendance(await api.payroll.listAttendance({ limit: 200 }));
                  }}
                >
                  Check In
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const r = await api.payroll.checkOut({});
                    showToast(r.success ? "Checked out" : r.error || "Check-out failed");
                    if (r.success) setAttendance(await api.payroll.listAttendance({ limit: 200 }));
                  }}
                >
                  Check Out
                </button>
              </>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Date", "Employee", "In", "Out", "Hours", "OT", "Late", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={a.id} className="border-t border-app-border">
                  <td className="px-4 py-2.5">{a.work_date}</td>
                  <td className="px-4 py-2.5">
                    {a.hr_employees
                      ? `${a.hr_employees.first_name} ${a.hr_employees.last_name}`
                      : a.employee_id}
                  </td>
                  <td className="px-4 py-2.5 text-sm">{a.check_in ? new Date(a.check_in).toLocaleTimeString() : "—"}</td>
                  <td className="px-4 py-2.5 text-sm">{a.check_out ? new Date(a.check_out).toLocaleTimeString() : "—"}</td>
                  <td className="px-4 py-2.5">{a.hours_worked}</td>
                  <td className="px-4 py-2.5">{a.overtime_hours}</td>
                  <td className="px-4 py-2.5">{a.late_minutes}m</td>
                  <td className="px-4 py-2.5 capitalize">{a.status}</td>
                </tr>
              ))}
              {!attendance.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-app-muted">
                    No attendance records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "leave" && (
        <div className="table-container">
          <table className="w-full">
            <thead>
              <tr className="bg-app-panel-muted">
                {["Employee", "Type", "Dates", "Days", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leave.map((l) => (
                <tr key={l.id} className="border-t border-app-border">
                  <td className="px-4 py-2.5">
                    {l.hr_employees ? `${l.hr_employees.first_name} ${l.hr_employees.last_name}` : l.employee_id}
                  </td>
                  <td className="px-4 py-2.5 capitalize">{l.leave_type}</td>
                  <td className="px-4 py-2.5 text-sm">
                    {l.start_date} → {l.end_date}
                  </td>
                  <td className="px-4 py-2.5">{l.days}</td>
                  <td className="px-4 py-2.5 capitalize">{l.status}</td>
                  <td className="px-4 py-2.5">
                    {l.status === "pending" && can("payroll", "approve") && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "0.25rem 0.5rem" }}
                          onClick={async () => {
                            const r = await api.payroll.approveLeave(l.id);
                            showToast(r.success ? "Leave approved" : r.error || "Failed");
                            if (r.success) setLeave(await api.payroll.listLeave({ limit: 200 }));
                          }}
                        >
                          <Check size={14} /> Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0.25rem 0.5rem" }}
                          onClick={async () => {
                            const r = await api.payroll.rejectLeave(l.id, "Rejected by manager");
                            showToast(r.success ? "Leave rejected" : r.error || "Failed");
                            if (r.success) setLeave(await api.payroll.listLeave({ limit: 200 }));
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!leave.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-app-muted">
                    No leave requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "salary" && (
        <>
          {can("payroll", "edit") && (
            <div className="mb-4">
              <button type="button" className="btn btn-primary" onClick={() => setSalaryModal(true)}>
                <Plus size={15} /> Set Salary Structure
              </button>
            </div>
          )}
          <div className="table-container">
            <table className="w-full">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Employee", "Basic", "Allowances", "Effective", "Currency"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {structures.map((s) => (
                  <tr key={s.id} className="border-t border-app-border">
                    <td className="px-4 py-2.5">
                      {s.hr_employees
                        ? `${s.hr_employees.employee_code} · ${s.hr_employees.first_name} ${s.hr_employees.last_name}`
                        : s.employee_id}
                    </td>
                    <td className="px-4 py-2.5">{money(s.basic_salary)}</td>
                    <td className="px-4 py-2.5 text-sm">
                      {(Array.isArray(s.allowances) ? s.allowances : []).map((a) => a.label).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5">{s.effective_from}</td>
                    <td className="px-4 py-2.5">{s.currency_code}</td>
                  </tr>
                ))}
                {!structures.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-app-muted">
                      No salary structures.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "runs" && (
        <div className="space-y-4">
          {can("payroll", "create") && isManager && (
            <div className="table-container p-4 flex flex-wrap gap-3 items-end">
              <label className="text-sm">
                Year
                <input
                  className="input mt-1"
                  type="number"
                  value={runForm.period_year}
                  onChange={(e) => setRunForm((f) => ({ ...f, period_year: Number(e.target.value) }))}
                />
              </label>
              <label className="text-sm">
                Month
                <input
                  className="input mt-1"
                  type="number"
                  min={1}
                  max={12}
                  value={runForm.period_month}
                  onChange={(e) => setRunForm((f) => ({ ...f, period_month: Number(e.target.value) }))}
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={createRun}>
                <Plus size={15} /> Create Run
              </button>
            </div>
          )}

          <div className="table-container">
            <table className="w-full">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Period", "Employees", "Gross", "Net", "Status", ""].map((h) => (
                    <th key={h || "sel"} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-t border-app-border ${selectedRunId === r.id ? "bg-app-panel-muted" : ""}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{r.run_label}</td>
                    <td className="px-4 py-2.5">{r.employee_count}</td>
                    <td className="px-4 py-2.5">{money(r.gross_total)}</td>
                    <td className="px-4 py-2.5">{money(r.net_total)}</td>
                    <td className="px-4 py-2.5 capitalize">{r.status}</td>
                    <td className="px-4 py-2.5">
                      <button type="button" className="btn btn-secondary" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setSelectedRunId(r.id)}>
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-app-muted">
                      No payroll runs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedRun && (
            <div className="table-container p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {can("payroll", "create") && (
                  <>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => runAction(api.payroll.previewRun, "Preview generated")}>
                      <RefreshCw size={14} /> Preview / Calculate
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => runAction(api.payroll.regenerateRun, "Regenerated")}>
                      Regenerate
                    </button>
                  </>
                )}
                {can("payroll", "approve") && (
                  <>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => runAction(api.payroll.approveRun, "Approved & journal posted")}>
                      <Check size={14} /> Approve
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => runAction(api.payroll.lockRun, "Locked")}>
                      <Lock size={14} /> Lock
                    </button>
                  </>
                )}
                {can("payroll", "approve") && (
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => runAction(api.payroll.unlockRun, "Unlocked")}>
                    <Unlock size={14} /> Unlock
                  </button>
                )}
                {can("payroll", "delete") && (
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => runAction(api.payroll.rollbackRun, "Rolled back")}>
                    <RotateCcw size={14} /> Rollback
                  </button>
                )}
                {can("payroll", "export") && (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={() => bankExport("csv")}>
                      <Download size={14} /> Bank CSV
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => bankExport("excel")}>
                      <Download size={14} /> Bank Excel
                    </button>
                  </>
                )}
              </div>

              <table className="w-full">
                <thead>
                  <tr className="bg-app-panel-muted">
                    {["Employee", "Gross", "PAYE", "NSSF", "SHA", "Net", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="border-t border-app-border">
                      <td className="px-4 py-2.5">
                        {p.employee_name}
                        <div className="text-xs text-app-muted">{p.employee_code}</div>
                      </td>
                      <td className="px-4 py-2.5">{money(p.gross_pay)}</td>
                      <td className="px-4 py-2.5">{money(p.paye)}</td>
                      <td className="px-4 py-2.5">{money(p.nssf)}</td>
                      <td className="px-4 py-2.5">{money(p.nhif_sha)}</td>
                      <td className="px-4 py-2.5 font-medium">{money(p.net_pay)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-2">
                          {can("payroll", "print") && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: "0.25rem 0.5rem" }}
                                onClick={() => printPayslip(p, companyInfo, selectedRun)}
                              >
                                <Printer size={14} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: "0.25rem 0.5rem" }}
                                onClick={async () => {
                                  await downloadPayslipPdf(p, companyInfo, selectedRun);
                                  showToast("PDF downloaded");
                                }}
                              >
                                PDF
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!payslips.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-app-muted">
                        Preview the run to generate payslips.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "reports" && reports && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <StatCard icon={Wallet} label="Year Gross" value={money(reports.yearly?.gross || 0)} color="#2563EB" />
            <StatCard icon={Wallet} label="Year Net" value={money(reports.yearly?.net || 0)} color="#059669" />
            <StatCard icon={Wallet} label="Year Deductions" value={money(reports.yearly?.deductions || 0)} color="#DC2626" />
            <StatCard icon={Wallet} label="Employer Contrib." value={money(reports.yearly?.employer || 0)} color="#D97706" />
          </div>
          <div className="table-container">
            <h3 className="px-4 pt-4 font-semibold">Monthly</h3>
            <table className="w-full">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Period", "Employees", "Gross", "Net", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(reports.monthly || []).map((m) => (
                  <tr key={m.period} className="border-t border-app-border">
                    <td className="px-4 py-2.5">{m.period}</td>
                    <td className="px-4 py-2.5">{m.employees}</td>
                    <td className="px-4 py-2.5">{money(m.gross)}</td>
                    <td className="px-4 py-2.5">{money(m.net)}</td>
                    <td className="px-4 py-2.5 capitalize">{m.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-container">
            <h3 className="px-4 pt-4 font-semibold">By Department</h3>
            <table className="w-full">
              <thead>
                <tr className="bg-app-panel-muted">
                  {["Department", "Payslips", "Gross", "Net"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs uppercase text-app-muted text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(reports.by_department || []).map((d) => (
                  <tr key={d.department} className="border-t border-app-border">
                    <td className="px-4 py-2.5">{d.department}</td>
                    <td className="px-4 py-2.5">{d.count}</td>
                    <td className="px-4 py-2.5">{money(d.gross)}</td>
                    <td className="px-4 py-2.5">{money(d.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "settings" && settings && can("payroll", "edit") && (
        <div className="table-container p-4 max-w-2xl space-y-3">
          <p className="text-sm text-app-muted">Kenya-oriented defaults — adjust rates per company policy.</p>
          {[
            ["personal_relief", "PAYE personal relief"],
            ["nssf_employee_rate", "NSSF employee rate"],
            ["nssf_employer_rate", "NSSF employer rate"],
            ["nssf_max_base", "NSSF max base"],
            ["overtime_rate_mult", "Overtime multiplier"],
            ["standard_hours_day", "Standard hours / day"],
            ["standard_days_month", "Standard days / month"],
            ["pension_employee_rate", "Pension employee rate"],
            ["pension_employer_rate", "Pension employer rate"],
          ].map(([key, label]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                className="input mt-1 w-full"
                type="number"
                step="any"
                value={settings[key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-4 text-sm">
            {["paye_enabled", "nssf_enabled", "nhif_sha_enabled", "pension_enabled"].map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!settings[key]}
                  onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
                />
                {key.replace("_enabled", "").toUpperCase()}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={saveSettings}>
            <Save size={15} /> Save Settings
          </button>
        </div>
      )}

      {tab === "settings" && !can("payroll", "edit") && (
        <p className="text-app-muted">You do not have permission to edit payroll tax settings.</p>
      )}

      {empModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={createEmployee} className="bg-app-panel rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Add Employee</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">First name<input required className="input mt-1 w-full" value={empForm.first_name} onChange={(e) => setEmpForm((f) => ({ ...f, first_name: e.target.value }))} /></label>
              <label className="text-sm">Last name<input required className="input mt-1 w-full" value={empForm.last_name} onChange={(e) => setEmpForm((f) => ({ ...f, last_name: e.target.value }))} /></label>
            </div>
            <label className="text-sm block">Email<input className="input mt-1 w-full" type="email" value={empForm.email} onChange={(e) => setEmpForm((f) => ({ ...f, email: e.target.value }))} /></label>
            <label className="text-sm block">Phone<input className="input mt-1 w-full" value={empForm.phone} onChange={(e) => setEmpForm((f) => ({ ...f, phone: e.target.value }))} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Department<input className="input mt-1 w-full" value={empForm.department} onChange={(e) => setEmpForm((f) => ({ ...f, department: e.target.value }))} /></label>
              <label className="text-sm">Position<input className="input mt-1 w-full" value={empForm.position} onChange={(e) => setEmpForm((f) => ({ ...f, position: e.target.value }))} /></label>
            </div>
            <label className="text-sm block">National ID<input className="input mt-1 w-full" value={empForm.national_id} onChange={(e) => setEmpForm((f) => ({ ...f, national_id: e.target.value }))} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Bank<input className="input mt-1 w-full" value={empForm.bank_name} onChange={(e) => setEmpForm((f) => ({ ...f, bank_name: e.target.value }))} /></label>
              <label className="text-sm">Account<input className="input mt-1 w-full" value={empForm.bank_account} onChange={(e) => setEmpForm((f) => ({ ...f, bank_account: e.target.value }))} /></label>
            </div>
            <label className="text-sm block">Basic salary<input className="input mt-1 w-full" type="number" value={empForm.basic_salary} onChange={(e) => setEmpForm((f) => ({ ...f, basic_salary: e.target.value }))} /></label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEmpModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}><Save size={15} /> Save</button>
            </div>
          </form>
        </div>
      )}

      {salaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveSalary} className="bg-app-panel rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="text-lg font-semibold">Salary Structure</h2>
            <label className="text-sm block">
              Employee
              <select
                className="input mt-1 w-full"
                required
                value={salaryForm.employee_id}
                onChange={(e) => setSalaryForm((f) => ({ ...f, employee_id: e.target.value }))}
              >
                <option value="">Select…</option>
                {employees.filter((e) => e.status === "active").map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} · {e.first_name} {e.last_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm block">Basic<input className="input mt-1 w-full" type="number" required value={salaryForm.basic_salary} onChange={(e) => setSalaryForm((f) => ({ ...f, basic_salary: e.target.value }))} /></label>
            <label className="text-sm block">Housing allowance<input className="input mt-1 w-full" type="number" value={salaryForm.housing} onChange={(e) => setSalaryForm((f) => ({ ...f, housing: e.target.value }))} /></label>
            <label className="text-sm block">Transport allowance<input className="input mt-1 w-full" type="number" value={salaryForm.transport} onChange={(e) => setSalaryForm((f) => ({ ...f, transport: e.target.value }))} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setSalaryModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
