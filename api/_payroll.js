/**
 * Enterprise Payroll & HR — company-scoped actions (migration 020).
 * Imported by _posData.js. Never import from src/.
 */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || "");
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/i.test(msg)
  );
}

function isMissingColumnError(error) {
  const msg = String(error?.message || "");
  return error?.code === "42703" || /column .* does not exist/i.test(msg);
}

function companyFilter(query, companyId, platform) {
  if (platform && (companyId == null || companyId === "")) return query;
  if (companyId == null || companyId === "") return query.eq("company_id", -1);
  return query.eq("company_id", companyId);
}

function normalizeRole(role) {
  const key = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases = {
    company_owner: "owner",
    companyowner: "owner",
    platformowner: "platform_owner",
    superadmin: "super_admin",
    manager: "branch_manager",
    hr_manager: "admin",
    hrmanager: "admin",
    payroll_officer: "accountant",
    payrollofficer: "accountant",
    employee: "cashier",
    staff: "cashier",
  };
  return aliases[key.replace(/_/g, "")] || aliases[key] || key;
}

function isOwnerLike(role) {
  const r = normalizeRole(role);
  return r === "owner" || r === "platform_owner" || r === "super_admin";
}

function isPayrollManager(role) {
  const r = normalizeRole(role);
  return isOwnerLike(r) || r === "admin" || r === "accountant";
}

function isPayrollApprover(role) {
  const r = normalizeRole(role);
  return isPayrollManager(r) || r === "branch_manager";
}

const DEFAULT_PAYROLL_ACTIONS = Object.freeze({
  platform_owner: { view: true, create: true, edit: true, delete: true, approve: true, print: true, export: true },
  owner: { view: true, create: true, edit: true, delete: true, approve: true, print: true, export: true },
  super_admin: { view: true, create: true, edit: true, delete: true, approve: true, print: true, export: true },
  admin: { view: true, create: true, edit: true, delete: true, approve: true, print: true, export: true },
  accountant: { view: true, create: true, edit: true, delete: false, approve: true, print: true, export: true },
  branch_manager: { view: true, create: true, edit: true, delete: false, approve: true, print: true, export: false },
  cashier: { view: true, create: true, edit: false, delete: false, approve: false, print: true, export: false },
  sales: { view: false, create: false, edit: false, delete: false, approve: false, print: false, export: false },
  inventory_manager: { view: false, create: false, edit: false, delete: false, approve: false, print: false, export: false },
  sales_manager: { view: false, create: false, edit: false, delete: false, approve: false, print: false, export: false },
});

async function loadPermissionMatrix(admin, companyId) {
  if (companyId == null || companyId === "") return {};
  const { data, error } = await admin
    .from("company_settings")
    .select("permission_matrix")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && !isMissingTableError(error)) return {};
  return data?.permission_matrix && typeof data.permission_matrix === "object"
    ? data.permission_matrix
    : {};
}

function canPayrollAction(role, action, matrix = {}) {
  const r = normalizeRole(role);
  if (r === "platform_owner" || r === "owner" || r === "super_admin") return true;
  const fromMatrix = matrix?.[r]?.payroll?.[action];
  if (typeof fromMatrix === "boolean") return fromMatrix;
  return !!DEFAULT_PAYROLL_ACTIONS[r]?.[action];
}

async function writeAudit(admin, { companyId, caller, action, module = "payroll", details }) {
  const payload = {
    user_id: caller?.id || null,
    user_name: caller?.name || caller?.username || null,
    action,
    module,
    details: typeof details === "string" ? details : JSON.stringify(details || {}),
    company_id: companyId,
  };
  const { error } = await admin.from("audit_log").insert(payload);
  if (error && isMissingColumnError(error)) {
    delete payload.company_id;
    await admin.from("audit_log").insert(payload);
  }
}

async function postJournalEntries(admin, { companyId, caller, refType, refId, memo, lines }) {
  if (companyId == null || !Array.isArray(lines) || !lines.length) return [];
  const rows = lines
    .filter((l) => l && l.account && (num(l.debit) > 0 || num(l.credit) > 0))
    .map((l) => ({
      company_id: companyId,
      account: String(l.account),
      debit: num(l.debit),
      credit: num(l.credit),
      ref_type: refType,
      ref_id: refId != null ? Number(refId) : null,
      memo: memo || l.memo || null,
      created_by: caller?.id || null,
    }));
  if (!rows.length) return [];
  const { data, error } = await admin.from("journal_entries").insert(rows).select("id,account,debit,credit");
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return [];
    return [];
  }
  await writeAudit(admin, {
    companyId,
    caller,
    action: "journal_post",
    module: "payroll",
    details: { ref_type: refType, ref_id: refId, memo, count: rows.length },
  });
  return data || [];
}

function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

function calcPaye(taxable, bands, relief) {
  let remaining = Math.max(0, num(taxable));
  let tax = 0;
  let prev = 0;
  const list = Array.isArray(bands) && bands.length ? bands : [];
  for (const band of list) {
    const upTo = band.up_to == null ? Infinity : num(band.up_to);
    const rate = num(band.rate);
    const slice = Math.min(remaining, Math.max(0, upTo - prev));
    if (slice <= 0 && upTo !== Infinity) {
      prev = upTo;
      continue;
    }
    tax += slice * rate;
    remaining -= slice;
    prev = upTo === Infinity ? prev : upTo;
    if (remaining <= 0) break;
  }
  return Math.max(0, round2(tax - num(relief)));
}

function calcNhifSha(gross, bands) {
  const g = num(gross);
  const list = Array.isArray(bands) && bands.length ? bands : [];
  for (const band of list) {
    const upTo = band.up_to == null ? Infinity : num(band.up_to);
    if (g <= upTo) return round2(num(band.amount));
  }
  return list.length ? round2(num(list[list.length - 1].amount)) : 0;
}

function sumComponentAmounts(list, base) {
  let total = 0;
  for (const item of Array.isArray(list) ? list : []) {
    if (item.percent != null && num(item.percent) > 0) total += base * (num(item.percent) / 100);
    else total += num(item.amount);
  }
  return round2(total);
}

async function ensureSettings(admin, companyId) {
  let q = admin.from("hr_payroll_settings").select("*").eq("company_id", companyId).maybeSingle();
  let { data, error } = await q;
  if (error && isMissingTableError(error)) return null;
  if (data) return data;
  const { data: created, error: insErr } = await admin
    .from("hr_payroll_settings")
    .insert({ company_id: companyId })
    .select("*")
    .single();
  if (insErr) {
    if (isMissingTableError(insErr)) return null;
    // race: fetch again
    const retry = await admin.from("hr_payroll_settings").select("*").eq("company_id", companyId).maybeSingle();
    return retry.data || null;
  }
  return created;
}

async function nextEmployeeCode(admin, companyId) {
  let q = admin
    .from("hr_employees")
    .select("employee_code")
    .eq("company_id", companyId)
    .order("id", { ascending: false })
    .limit(200);
  const { data } = await q;
  let max = 0;
  for (const row of data || []) {
    const m = String(row.employee_code || "").match(/EMP-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `EMP-${String(max + 1).padStart(5, "0")}`;
}

async function getEmployeeForUser(admin, companyId, userId) {
  if (!userId) return null;
  const { data } = await admin
    .from("hr_employees")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data || null;
}

async function ensureLeaveBalances(admin, companyId, employeeId, settings) {
  const year = new Date().getFullYear();
  const types = Array.isArray(settings?.leave_types) ? settings.leave_types : [];
  for (const t of types) {
    const code = t.code || t.label;
    if (!code) continue;
    const { data: existing } = await admin
      .from("hr_leave_balances")
      .select("id")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .eq("leave_type", code)
      .eq("year", year)
      .maybeSingle();
    if (existing) continue;
    await admin.from("hr_leave_balances").insert({
      company_id: companyId,
      employee_id: employeeId,
      leave_type: code,
      year,
      entitled: num(t.days_per_year),
      used: 0,
      pending: 0,
    });
  }
}

function daysInclusive(start, end) {
  const a = new Date(String(start).slice(0, 10) + "T00:00:00Z");
  const b = new Date(String(end).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

function periodBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Compute one employee payslip for a period.
 */
async function computePayslip(admin, { companyId, employee, structure, settings, year, month, bonus = 0, commission = 0 }) {
  const { start, end } = periodBounds(year, month);
  const basic = num(structure?.basic_salary);
  const allowancesTotal = sumComponentAmounts(structure?.allowances, basic);
  const customDeductions = sumComponentAmounts(structure?.deductions, basic);

  let attQ = admin
    .from("hr_attendance")
    .select("hours_worked,overtime_hours,late_minutes,status,work_date")
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .gte("work_date", start)
    .lte("work_date", end);
  const { data: attendance } = await attQ;
  const rows = attendance || [];
  const overtimeHours = rows.reduce((s, r) => s + num(r.overtime_hours), 0);
  const daysWorked = rows.filter((r) => ["present", "late", "half_day"].includes(r.status)).length;
  const daysAbsent = rows.filter((r) => r.status === "absent").length;
  const stdDays = num(settings?.standard_days_month, 26) || 26;
  const stdHours = num(settings?.standard_hours_day, 8) || 8;
  const hourly = basic / (stdDays * stdHours || 1);
  const otMult = num(settings?.overtime_rate_mult, 1.5) || 1.5;
  const overtimePay = structure?.overtime_eligible === false ? 0 : round2(overtimeHours * hourly * otMult);
  const bonusAmt = structure?.bonus_eligible === false ? 0 : round2(bonus);
  const commissionAmt = round2(commission || basic * num(structure?.commission_rate));

  const gross = round2(basic + allowancesTotal + overtimePay + bonusAmt + commissionAmt);

  let paye = 0;
  let nssf = 0;
  let nhif = 0;
  let pension = 0;
  let employerNssf = 0;
  let employerPension = 0;

  if (settings?.nssf_enabled !== false) {
    const base = Math.min(gross, num(settings.nssf_max_base, 72000));
    nssf = round2(base * num(settings.nssf_employee_rate, 0.06));
    employerNssf = round2(base * num(settings.nssf_employer_rate, 0.06));
  }
  if (settings?.pension_enabled) {
    pension = round2(gross * num(settings.pension_employee_rate));
    employerPension = round2(gross * num(settings.pension_employer_rate));
  }
  const taxable = Math.max(0, gross - nssf - pension);
  if (settings?.paye_enabled !== false) {
    paye = calcPaye(taxable, settings.paye_bands, settings.personal_relief);
  }
  if (settings?.nhif_sha_enabled !== false) {
    nhif = calcNhifSha(gross, settings.nhif_sha_bands);
  }

  const { data: loans } = await admin
    .from("hr_loans_advances")
    .select("*")
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .eq("status", "active");
  let loanDeduction = 0;
  const loanUpdates = [];
  for (const loan of loans || []) {
    const deduct = Math.min(num(loan.monthly_deduction) || num(loan.balance), num(loan.balance));
    if (deduct > 0) {
      loanDeduction += deduct;
      loanUpdates.push({ id: loan.id, deduct, newBalance: round2(num(loan.balance) - deduct) });
    }
  }
  loanDeduction = round2(loanDeduction);

  const totalDeductions = round2(paye + nssf + nhif + pension + loanDeduction + customDeductions);
  const net = round2(gross - totalDeductions);

  const lines = [
    { code: "BASIC", label: "Basic Salary", type: "earning", amount: basic },
    { code: "ALLOW", label: "Allowances", type: "earning", amount: allowancesTotal },
    { code: "OT", label: "Overtime", type: "earning", amount: overtimePay },
    { code: "BONUS", label: "Bonus", type: "earning", amount: bonusAmt },
    { code: "COMM", label: "Commission", type: "earning", amount: commissionAmt },
    { code: "PAYE", label: "PAYE", type: "deduction", amount: paye },
    { code: "NSSF", label: "NSSF", type: "deduction", amount: nssf },
    { code: "SHA", label: "NHIF/SHA", type: "deduction", amount: nhif },
    { code: "PENSION", label: "Pension", type: "deduction", amount: pension },
    { code: "LOAN", label: "Loans/Advances", type: "deduction", amount: loanDeduction },
    { code: "OTHER", label: "Other Deductions", type: "deduction", amount: customDeductions },
  ].filter((l) => num(l.amount) !== 0);

  return {
    employee,
    structure,
    loanUpdates,
    payslip: {
      employee_id: employee.id,
      employee_code: employee.employee_code,
      employee_name: `${employee.first_name} ${employee.last_name}`.trim(),
      department: employee.department,
      position: employee.position,
      branch_id: employee.branch_id,
      basic_salary: basic,
      allowances_total: allowancesTotal,
      overtime_pay: overtimePay,
      bonus: bonusAmt,
      commission: commissionAmt,
      gross_pay: gross,
      paye,
      nssf,
      nhif_sha: nhif,
      pension,
      loan_deduction: loanDeduction,
      other_deductions: customDeductions,
      total_deductions: totalDeductions,
      net_pay: net,
      employer_nssf: employerNssf,
      employer_pension: employerPension,
      overtime_hours: round2(overtimeHours),
      days_worked: daysWorked,
      days_absent: daysAbsent,
      bank_name: employee.bank_name,
      bank_account: employee.bank_account,
      currency_code: structure?.currency_code || settings?.currency_code || "KES",
      lines,
      qr_payload: `NEXORA-PAYSLIP|${employee.employee_code}|${year}-${String(month).padStart(2, "0")}|${net}`,
    },
  };
}

async function getActiveStructure(admin, companyId, employeeId, asOfDate) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("hr_salary_structures")
    .select("*")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("active", true)
    .lte("effective_from", asOf)
    .order("effective_from", { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

/**
 * Main payroll action router. Returns null if action is not payroll.*.
 */
export async function handlePayrollAction(admin, caller, action, params = {}, helpers = {}) {
  if (!String(action || "").startsWith("payroll.")) return null;

  const platform = caller.role === "platform_owner";
  const companyId = platform ? params.company_id ?? caller.company_id : caller.company_id;
  if (companyId == null || companyId === "") {
    return { success: false, error: "company_id required for payroll.", code: "NO_COMPANY" };
  }

  const matrix = await loadPermissionMatrix(admin, companyId);
  const deny = (need) => ({
    success: false,
    error: `Permission denied: payroll.${need}`,
    code: "FORBIDDEN",
  });

  try {
    switch (action) {
      case "payroll.getSettings": {
        if (!canPayrollAction(caller.role, "view", matrix) && !isPayrollManager(caller.role)) return deny("view");
        const settings = await ensureSettings(admin, companyId);
        if (!settings) return { success: false, error: "Payroll tables not migrated.", code: "NO_SCHEMA" };
        return settings;
      }

      case "payroll.updateSettings": {
        if (!canPayrollAction(caller.role, "edit", matrix) || !isPayrollManager(caller.role)) return deny("edit");
        await ensureSettings(admin, companyId);
        const allowed = [
          "currency_code", "paye_enabled", "nssf_enabled", "nhif_sha_enabled", "pension_enabled",
          "paye_bands", "personal_relief", "nssf_employee_rate", "nssf_employer_rate", "nssf_max_base",
          "nhif_sha_bands", "pension_employee_rate", "pension_employer_rate", "overtime_rate_mult",
          "standard_hours_day", "standard_days_month", "leave_types",
        ];
        const patch = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (params[key] !== undefined) patch[key] = params[key];
        }
        const { data, error } = await admin
          .from("hr_payroll_settings")
          .update(patch)
          .eq("company_id", companyId)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "update_settings", details: { keys: Object.keys(patch) } });
        return { success: true, settings: data };
      }

      case "payroll.listEmployees": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        // Self-only for cashiers unless manager
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          return self ? [self] : [];
        }
        let q = admin.from("hr_employees").select("*").order("employee_code", { ascending: true });
        q = companyFilter(q, companyId, false);
        if (params.status) q = q.eq("status", params.status);
        if (params.branch_id) q = q.eq("branch_id", params.branch_id);
        if (params.department) q = q.eq("department", params.department);
        if (params.q) {
          const term = `%${String(params.q).trim()}%`;
          q = q.or(`first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},email.ilike.${term}`);
        }
        const { data, error } = await q.limit(Number(params.limit) || 500);
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.getEmployee": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        const id = Number(params.id);
        if (!id) return { success: false, error: "id required" };
        const { data, error } = await admin
          .from("hr_employees")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return { success: false, error: "Employee not found" };
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          if (data.user_id !== caller.id) return deny("view");
        }
        const [{ data: docs }, { data: salary }, { data: balances }] = await Promise.all([
          admin.from("hr_employee_documents").select("*").eq("company_id", companyId).eq("employee_id", id).order("created_at", { ascending: false }),
          admin.from("hr_salary_structures").select("*").eq("company_id", companyId).eq("employee_id", id).order("effective_from", { ascending: false }),
          admin.from("hr_leave_balances").select("*").eq("company_id", companyId).eq("employee_id", id),
        ]);
        return { ...data, documents: docs || [], salary_structures: salary || [], leave_balances: balances || [] };
      }

      case "payroll.createEmployee": {
        if (!canPayrollAction(caller.role, "create", matrix) || !isPayrollManager(caller.role)) return deny("create");
        const first = String(params.first_name || "").trim();
        const last = String(params.last_name || "").trim();
        if (!first || !last) return { success: false, error: "first_name and last_name required" };
        const code = String(params.employee_code || "").trim() || (await nextEmployeeCode(admin, companyId));
        const row = {
          company_id: companyId,
          branch_id: params.branch_id != null ? Number(params.branch_id) : caller.branch_id || null,
          user_id: params.user_id || null,
          employee_code: code,
          first_name: first,
          last_name: last,
          email: params.email || null,
          phone: params.phone || null,
          photo_url: params.photo_url || null,
          national_id: params.national_id || null,
          department: params.department || null,
          position: params.position || null,
          employment_type: params.employment_type || "permanent",
          contract_start: params.contract_start || null,
          contract_end: params.contract_end || null,
          hire_date: params.hire_date || new Date().toISOString().slice(0, 10),
          status: params.status || "active",
          bank_name: params.bank_name || null,
          bank_account: params.bank_account || null,
          bank_branch: params.bank_branch || null,
          payment_method: params.payment_method || "bank",
          notes: params.notes || null,
          created_by: caller.id,
        };
        const { data, error } = await admin.from("hr_employees").insert(row).select("*").single();
        if (error) throw error;
        const settings = await ensureSettings(admin, companyId);
        if (settings) await ensureLeaveBalances(admin, companyId, data.id, settings);
        if (params.basic_salary != null && num(params.basic_salary) > 0) {
          await admin.from("hr_salary_structures").insert({
            company_id: companyId,
            employee_id: data.id,
            basic_salary: num(params.basic_salary),
            allowances: params.allowances || [],
            deductions: params.deductions || [],
            currency_code: params.currency_code || settings?.currency_code || "KES",
            created_by: caller.id,
          });
        }
        await writeAudit(admin, { companyId, caller, action: "create_employee", details: { id: data.id, code } });
        return { success: true, employee: data };
      }

      case "payroll.updateEmployee": {
        if (!canPayrollAction(caller.role, "edit", matrix) || !isPayrollManager(caller.role)) return deny("edit");
        const id = Number(params.id);
        if (!id) return { success: false, error: "id required" };
        const allowed = [
          "branch_id", "user_id", "first_name", "last_name", "email", "phone", "photo_url",
          "national_id", "department", "position", "employment_type", "contract_start", "contract_end",
          "hire_date", "status", "bank_name", "bank_account", "bank_branch", "payment_method", "notes",
        ];
        const patch = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (params[key] !== undefined) patch[key] = params[key];
        }
        const { data, error } = await admin
          .from("hr_employees")
          .update(patch)
          .eq("company_id", companyId)
          .eq("id", id)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "update_employee", details: { id } });
        return { success: true, employee: data };
      }

      case "payroll.deleteEmployee": {
        if (!canPayrollAction(caller.role, "delete", matrix) || !isOwnerLike(caller.role) && normalizeRole(caller.role) !== "admin") {
          return deny("delete");
        }
        const id = Number(params.id);
        const { error } = await admin
          .from("hr_employees")
          .update({ status: "terminated", updated_at: new Date().toISOString() })
          .eq("company_id", companyId)
          .eq("id", id);
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "terminate_employee", details: { id } });
        return { success: true };
      }

      case "payroll.addDocument": {
        if (!canPayrollAction(caller.role, "edit", matrix) || !isPayrollManager(caller.role)) return deny("edit");
        const employeeId = Number(params.employee_id);
        if (!employeeId || !params.title) return { success: false, error: "employee_id and title required" };
        const { data, error } = await admin
          .from("hr_employee_documents")
          .insert({
            company_id: companyId,
            employee_id: employeeId,
            doc_type: params.doc_type || "other",
            title: String(params.title).slice(0, 200),
            file_url: params.file_url || null,
            file_name: params.file_name || null,
            notes: params.notes || null,
            uploaded_by: caller.id,
          })
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "add_document", details: { employee_id: employeeId, id: data.id } });
        return { success: true, document: data };
      }

      case "payroll.listAttendance": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        let q = admin
          .from("hr_attendance")
          .select("*, hr_employees(employee_code,first_name,last_name,department)")
          .eq("company_id", companyId)
          .order("work_date", { ascending: false })
          .limit(Number(params.limit) || 500);
        if (params.employee_id) q = q.eq("employee_id", Number(params.employee_id));
        if (params.from) q = q.gte("work_date", params.from);
        if (params.to) q = q.lte("work_date", params.to);
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self) return [];
          q = q.eq("employee_id", self.id);
        }
        const { data, error } = await q;
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.checkIn":
      case "payroll.checkOut":
      case "payroll.recordAttendance": {
        if (!canPayrollAction(caller.role, "create", matrix)) return deny("create");
        let employeeId = Number(params.employee_id);
        if (!employeeId) {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          employeeId = self?.id;
        }
        if (!employeeId) return { success: false, error: "employee_id required (or link your user to an employee)" };
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self || self.id !== employeeId) return deny("create");
        }
        const workDate = String(params.work_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const settings = await ensureSettings(admin, companyId);
        const now = new Date().toISOString();

        const { data: existing } = await admin
          .from("hr_attendance")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("work_date", workDate)
          .maybeSingle();

        let patch = {
          company_id: companyId,
          employee_id: employeeId,
          branch_id: params.branch_id != null ? Number(params.branch_id) : caller.branch_id || null,
          work_date: workDate,
          updated_at: now,
          recorded_by: caller.id,
        };

        if (action === "payroll.checkIn" || (action === "payroll.recordAttendance" && params.check_in)) {
          patch.check_in = params.check_in || now;
          patch.status = params.status || "present";
          const sched = params.scheduled_start || "08:00";
          patch.scheduled_start = sched;
          try {
            const cin = new Date(patch.check_in);
            const [hh, mm] = String(sched).split(":").map(Number);
            const schedDt = new Date(workDate + "T00:00:00");
            schedDt.setHours(hh || 8, mm || 0, 0, 0);
            const late = Math.max(0, Math.floor((cin - schedDt) / 60000));
            patch.late_minutes = late;
            if (late > 15) patch.status = "late";
          } catch {
            /* ignore */
          }
        }
        if (action === "payroll.checkOut" || (action === "payroll.recordAttendance" && params.check_out)) {
          patch.check_out = params.check_out || now;
          const cin = new Date((existing?.check_in || patch.check_in || now));
          const cout = new Date(patch.check_out);
          const hours = Math.max(0, (cout - cin) / 3600000);
          const std = num(settings?.standard_hours_day, 8);
          patch.hours_worked = round2(Math.min(hours, std + 12));
          patch.overtime_hours = round2(Math.max(0, hours - std));
        }
        if (params.status) patch.status = params.status;
        if (params.notes != null) patch.notes = params.notes;
        if (params.hours_worked != null) patch.hours_worked = num(params.hours_worked);
        if (params.overtime_hours != null) patch.overtime_hours = num(params.overtime_hours);
        if (params.leave_request_id) patch.leave_request_id = Number(params.leave_request_id);

        let data;
        if (existing) {
          const { data: updated, error } = await admin
            .from("hr_attendance")
            .update(patch)
            .eq("id", existing.id)
            .select("*")
            .single();
          if (error) throw error;
          data = updated;
        } else {
          const { data: inserted, error } = await admin.from("hr_attendance").insert(patch).select("*").single();
          if (error) throw error;
          data = inserted;
        }
        await writeAudit(admin, {
          companyId,
          caller,
          action: action.replace("payroll.", ""),
          details: { employee_id: employeeId, work_date: workDate, id: data.id },
        });
        return { success: true, attendance: data };
      }

      case "payroll.listLeave": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        let q = admin
          .from("hr_leave_requests")
          .select("*, hr_employees(employee_code,first_name,last_name,department)")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(Number(params.limit) || 300);
        if (params.status) q = q.eq("status", params.status);
        if (params.employee_id) q = q.eq("employee_id", Number(params.employee_id));
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self) return [];
          q = q.eq("employee_id", self.id);
        }
        const { data, error } = await q;
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.requestLeave": {
        if (!canPayrollAction(caller.role, "create", matrix)) return deny("create");
        let employeeId = Number(params.employee_id);
        if (!employeeId) {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          employeeId = self?.id;
        }
        if (!employeeId) return { success: false, error: "employee_id required" };
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self || self.id !== employeeId) return deny("create");
        }
        const leaveType = String(params.leave_type || "annual");
        const start = params.start_date;
        const end = params.end_date || start;
        if (!start) return { success: false, error: "start_date required" };
        const days = num(params.days) || daysInclusive(start, end);
        if (days <= 0) return { success: false, error: "Invalid leave dates" };

        const settings = await ensureSettings(admin, companyId);
        await ensureLeaveBalances(admin, companyId, employeeId, settings);
        const year = new Date(start).getFullYear();
        const { data: bal } = await admin
          .from("hr_leave_balances")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("leave_type", leaveType)
          .eq("year", year)
          .maybeSingle();
        if (bal) {
          const available = num(bal.entitled) + num(bal.carried_forward) - num(bal.used) - num(bal.pending);
          if (days > available) {
            return { success: false, error: `Insufficient leave balance (${available} days available)` };
          }
        }

        const { data, error } = await admin
          .from("hr_leave_requests")
          .insert({
            company_id: companyId,
            employee_id: employeeId,
            leave_type: leaveType,
            start_date: start,
            end_date: end,
            days,
            reason: params.reason || null,
            status: "pending",
            created_by: caller.id,
          })
          .select("*")
          .single();
        if (error) throw error;
        if (bal) {
          await admin
            .from("hr_leave_balances")
            .update({ pending: num(bal.pending) + days, updated_at: new Date().toISOString() })
            .eq("id", bal.id);
        }
        await writeAudit(admin, { companyId, caller, action: "request_leave", details: { id: data.id, employee_id: employeeId, days } });
        return { success: true, leave: data };
      }

      case "payroll.approveLeave":
      case "payroll.rejectLeave": {
        if (!canPayrollAction(caller.role, "approve", matrix) || !isPayrollApprover(caller.role)) return deny("approve");
        const id = Number(params.id);
        if (!id) return { success: false, error: "id required" };
        const { data: leave, error: fetchErr } = await admin
          .from("hr_leave_requests")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", id)
          .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!leave || leave.status !== "pending") return { success: false, error: "Leave not pending" };

        const approved = action === "payroll.approveLeave";
        const { data, error } = await admin
          .from("hr_leave_requests")
          .update({
            status: approved ? "approved" : "rejected",
            approved_by: caller.id,
            approved_at: new Date().toISOString(),
            rejection_reason: approved ? null : params.reason || "Rejected",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("*")
          .single();
        if (error) throw error;

        const year = new Date(leave.start_date).getFullYear();
        const { data: bal } = await admin
          .from("hr_leave_balances")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", leave.employee_id)
          .eq("leave_type", leave.leave_type)
          .eq("year", year)
          .maybeSingle();
        if (bal) {
          const pending = Math.max(0, num(bal.pending) - num(leave.days));
          const used = approved ? num(bal.used) + num(leave.days) : num(bal.used);
          await admin
            .from("hr_leave_balances")
            .update({ pending, used, updated_at: new Date().toISOString() })
            .eq("id", bal.id);
        }

        if (approved) {
          // Mark attendance on_leave for range
          const days = daysInclusive(leave.start_date, leave.end_date);
          for (let i = 0; i < days; i++) {
            const d = new Date(leave.start_date + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() + i);
            const workDate = d.toISOString().slice(0, 10);
            const { data: existing } = await admin
              .from("hr_attendance")
              .select("id")
              .eq("company_id", companyId)
              .eq("employee_id", leave.employee_id)
              .eq("work_date", workDate)
              .maybeSingle();
            const row = {
              company_id: companyId,
              employee_id: leave.employee_id,
              work_date: workDate,
              status: "on_leave",
              leave_request_id: leave.id,
              updated_at: new Date().toISOString(),
              recorded_by: caller.id,
            };
            if (existing) {
              await admin.from("hr_attendance").update(row).eq("id", existing.id);
            } else {
              await admin.from("hr_attendance").insert(row);
            }
          }
        }

        await writeAudit(admin, {
          companyId,
          caller,
          action: approved ? "approve_leave" : "reject_leave",
          details: { id, employee_id: leave.employee_id },
        });
        return { success: true, leave: data };
      }

      case "payroll.getLeaveBalances": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        let employeeId = Number(params.employee_id);
        if (!employeeId) {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          employeeId = self?.id;
        }
        if (!employeeId) return [];
        const settings = await ensureSettings(admin, companyId);
        await ensureLeaveBalances(admin, companyId, employeeId, settings);
        const year = Number(params.year) || new Date().getFullYear();
        const { data, error } = await admin
          .from("hr_leave_balances")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("year", year);
        if (error) throw error;
        return data || [];
      }

      case "payroll.listSalaryStructures": {
        if (!canPayrollAction(caller.role, "view", matrix) || !isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          return deny("view");
        }
        let q = admin
          .from("hr_salary_structures")
          .select("*, hr_employees(employee_code,first_name,last_name,department,status)")
          .eq("company_id", companyId)
          .order("effective_from", { ascending: false })
          .limit(Number(params.limit) || 500);
        if (params.employee_id) q = q.eq("employee_id", Number(params.employee_id));
        if (params.active_only) q = q.eq("active", true);
        const { data, error } = await q;
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.upsertSalaryStructure": {
        if (!canPayrollAction(caller.role, "edit", matrix) || !isPayrollManager(caller.role)) return deny("edit");
        const employeeId = Number(params.employee_id);
        if (!employeeId) return { success: false, error: "employee_id required" };
        if (params.deactivate_others !== false) {
          await admin
            .from("hr_salary_structures")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .eq("employee_id", employeeId)
            .eq("active", true);
        }
        const row = {
          company_id: companyId,
          employee_id: employeeId,
          effective_from: params.effective_from || new Date().toISOString().slice(0, 10),
          effective_to: params.effective_to || null,
          basic_salary: num(params.basic_salary),
          allowances: Array.isArray(params.allowances) ? params.allowances : [],
          deductions: Array.isArray(params.deductions) ? params.deductions : [],
          overtime_eligible: params.overtime_eligible !== false,
          bonus_eligible: params.bonus_eligible !== false,
          commission_rate: num(params.commission_rate),
          currency_code: params.currency_code || "KES",
          notes: params.notes || null,
          active: true,
          created_by: caller.id,
          updated_at: new Date().toISOString(),
        };
        if (params.id) {
          const { data, error } = await admin
            .from("hr_salary_structures")
            .update(row)
            .eq("company_id", companyId)
            .eq("id", Number(params.id))
            .select("*")
            .single();
          if (error) throw error;
          await writeAudit(admin, { companyId, caller, action: "update_salary", details: { id: data.id, employee_id: employeeId } });
          return { success: true, structure: data };
        }
        const { data, error } = await admin.from("hr_salary_structures").insert(row).select("*").single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "create_salary", details: { id: data.id, employee_id: employeeId } });
        return { success: true, structure: data };
      }

      case "payroll.listLoans": {
        if (!canPayrollAction(caller.role, "view", matrix) || !isPayrollManager(caller.role)) return deny("view");
        let q = admin
          .from("hr_loans_advances")
          .select("*, hr_employees(employee_code,first_name,last_name)")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });
        if (params.employee_id) q = q.eq("employee_id", Number(params.employee_id));
        if (params.status) q = q.eq("status", params.status);
        const { data, error } = await q.limit(300);
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.createLoan": {
        if (!canPayrollAction(caller.role, "create", matrix) || !isPayrollManager(caller.role)) return deny("create");
        const employeeId = Number(params.employee_id);
        const principal = num(params.principal);
        if (!employeeId || principal <= 0) return { success: false, error: "employee_id and principal required" };
        const { data, error } = await admin
          .from("hr_loans_advances")
          .insert({
            company_id: companyId,
            employee_id: employeeId,
            kind: params.kind === "loan" ? "loan" : "advance",
            principal,
            balance: principal,
            monthly_deduction: num(params.monthly_deduction) || round2(principal / Math.max(1, num(params.months, 1))),
            start_date: params.start_date || new Date().toISOString().slice(0, 10),
            status: "active",
            notes: params.notes || null,
            created_by: caller.id,
          })
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "create_loan", details: { id: data.id, employee_id: employeeId } });
        return { success: true, loan: data };
      }

      case "payroll.listRuns": {
        if (!canPayrollAction(caller.role, "view", matrix) || (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager")) {
          return deny("view");
        }
        let q = admin
          .from("hr_payroll_runs")
          .select("*")
          .eq("company_id", companyId)
          .order("period_year", { ascending: false })
          .order("period_month", { ascending: false })
          .limit(Number(params.limit) || 48);
        const { data, error } = await q;
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.createRun": {
        if (!canPayrollAction(caller.role, "create", matrix) || !isPayrollManager(caller.role)) return deny("create");
        const year = Number(params.period_year) || new Date().getFullYear();
        const month = Number(params.period_month) || new Date().getMonth() + 1;
        const settings = await ensureSettings(admin, companyId);
        const row = {
          company_id: companyId,
          branch_id: params.branch_id != null ? Number(params.branch_id) : null,
          period_year: year,
          period_month: month,
          run_label: params.run_label || `${year}-${String(month).padStart(2, "0")}`,
          status: "draft",
          currency_code: settings?.currency_code || "KES",
          created_by: caller.id,
        };
        const { data, error } = await admin.from("hr_payroll_runs").insert(row).select("*").single();
        if (error) {
          if (error.code === "23505") return { success: false, error: "Payroll run already exists for this period" };
          throw error;
        }
        await writeAudit(admin, { companyId, caller, action: "create_run", details: { id: data.id, year, month } });
        return { success: true, run: data };
      }

      case "payroll.previewRun":
      case "payroll.regenerateRun": {
        if (!canPayrollAction(caller.role, "create", matrix) || !isPayrollManager(caller.role)) return deny("create");
        const runId = Number(params.id || params.run_id);
        if (!runId) return { success: false, error: "run id required" };
        const { data: run, error: runErr } = await admin
          .from("hr_payroll_runs")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", runId)
          .maybeSingle();
        if (runErr) throw runErr;
        if (!run) return { success: false, error: "Run not found" };
        if (run.status === "locked") return { success: false, error: "Run is locked — unlock or rollback first" };
        if (action === "payroll.regenerateRun" && run.status === "approved") {
          // allow regenerate only if not locked
        }

        const settings = await ensureSettings(admin, companyId);
        let empQ = admin.from("hr_employees").select("*").eq("company_id", companyId).eq("status", "active");
        if (run.branch_id) empQ = empQ.eq("branch_id", run.branch_id);
        const { data: employees } = await empQ;
        const bonuses = params.bonuses && typeof params.bonuses === "object" ? params.bonuses : {};
        const commissions = params.commissions && typeof params.commissions === "object" ? params.commissions : {};

        await admin.from("hr_payslips").delete().eq("payroll_run_id", runId).eq("company_id", companyId);

        const payslips = [];
        let grossTotal = 0;
        let dedTotal = 0;
        let netTotal = 0;
        let employerTotal = 0;

        for (const emp of employees || []) {
          const structure = await getActiveStructure(
            admin,
            companyId,
            emp.id,
            `${run.period_year}-${String(run.period_month).padStart(2, "0")}-28`
          );
          if (!structure) continue;
          const computed = await computePayslip(admin, {
            companyId,
            employee: emp,
            structure,
            settings,
            year: run.period_year,
            month: run.period_month,
            bonus: num(bonuses[emp.id]),
            commission: num(commissions[emp.id]),
          });
          const ps = { ...computed.payslip, company_id: companyId, payroll_run_id: runId };
          const { data: inserted, error: insErr } = await admin.from("hr_payslips").insert(ps).select("*").single();
          if (insErr) throw insErr;
          payslips.push(inserted);
          grossTotal += num(ps.gross_pay);
          dedTotal += num(ps.total_deductions);
          netTotal += num(ps.net_pay);
          employerTotal += num(ps.employer_nssf) + num(ps.employer_pension);
        }

        const { data: updated, error: upErr } = await admin
          .from("hr_payroll_runs")
          .update({
            status: "preview",
            employee_count: payslips.length,
            gross_total: round2(grossTotal),
            deduction_total: round2(dedTotal),
            net_total: round2(netTotal),
            employer_contrib_total: round2(employerTotal),
            previewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("*")
          .single();
        if (upErr) throw upErr;
        await writeAudit(admin, {
          companyId,
          caller,
          action: action === "payroll.regenerateRun" ? "regenerate_run" : "preview_run",
          details: { id: runId, employees: payslips.length, net_total: netTotal },
        });
        return { success: true, run: updated, payslips };
      }

      case "payroll.approveRun": {
        if (!canPayrollAction(caller.role, "approve", matrix) || !isPayrollManager(caller.role)) return deny("approve");
        const runId = Number(params.id);
        const { data: run } = await admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).eq("id", runId).maybeSingle();
        if (!run || !["preview", "draft"].includes(run.status)) {
          return { success: false, error: "Run must be in preview before approval" };
        }
        // Apply loan deductions
        const { data: slips } = await admin.from("hr_payslips").select("*").eq("payroll_run_id", runId).eq("company_id", companyId);
        for (const slip of slips || []) {
          if (num(slip.loan_deduction) <= 0) continue;
          const { data: loans } = await admin
            .from("hr_loans_advances")
            .select("*")
            .eq("company_id", companyId)
            .eq("employee_id", slip.employee_id)
            .eq("status", "active");
          let remaining = num(slip.loan_deduction);
          for (const loan of loans || []) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, num(loan.balance));
            const newBal = round2(num(loan.balance) - take);
            await admin
              .from("hr_loans_advances")
              .update({
                balance: newBal,
                status: newBal <= 0 ? "paid" : "active",
                updated_at: new Date().toISOString(),
              })
              .eq("id", loan.id);
            remaining = round2(remaining - take);
          }
        }

        // Post journal
        const journalLines = [
          { account: "Salary Expense", debit: num(run.gross_total), credit: 0 },
          { account: "Employer Contributions", debit: num(run.employer_contrib_total), credit: 0 },
          { account: "PAYE Payable", debit: 0, credit: (slips || []).reduce((s, p) => s + num(p.paye), 0) },
          { account: "NSSF Payable", debit: 0, credit: (slips || []).reduce((s, p) => s + num(p.nssf) + num(p.employer_nssf), 0) },
          { account: "SHA/NHIF Payable", debit: 0, credit: (slips || []).reduce((s, p) => s + num(p.nhif_sha), 0) },
          { account: "Net Salaries Payable", debit: 0, credit: num(run.net_total) },
        ];
        // Balance residual into Net Salaries Payable
        const deb = journalLines.reduce((s, l) => s + num(l.debit), 0);
        const cred = journalLines.reduce((s, l) => s + num(l.credit), 0);
        if (Math.abs(deb - cred) > 0.01) {
          journalLines.push({
            account: "Payroll Clearing",
            debit: deb > cred ? 0 : round2(cred - deb),
            credit: deb > cred ? round2(deb - cred) : 0,
          });
        }
        await postJournalEntries(admin, {
          companyId,
          caller,
          refType: "payroll_run",
          refId: runId,
          memo: `Payroll ${run.run_label}`,
          lines: journalLines,
        });

        // Create expense entry under Payroll category (best-effort)
        try {
          await admin.from("expenses").insert({
            company_id: companyId,
            name: `Payroll ${run.run_label}`,
            category: "Payroll",
            amount: num(run.net_total) + num(run.employer_contrib_total),
            expense_date: `${run.period_year}-${String(run.period_month).padStart(2, "0")}-28`,
            notes: `Auto from payroll run #${runId}`,
            created_by: caller.id,
          });
        } catch {
          /* non-fatal */
        }

        const { data, error } = await admin
          .from("hr_payroll_runs")
          .update({
            status: "approved",
            approved_by: caller.id,
            approved_at: new Date().toISOString(),
            journal_posted: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "approve_run", details: { id: runId, net_total: run.net_total } });
        return { success: true, run: data };
      }

      case "payroll.lockRun": {
        if (!canPayrollAction(caller.role, "approve", matrix) || !isPayrollManager(caller.role)) return deny("approve");
        const runId = Number(params.id);
        const { data: run } = await admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).eq("id", runId).maybeSingle();
        if (!run || run.status !== "approved") return { success: false, error: "Only approved runs can be locked" };
        const { data, error } = await admin
          .from("hr_payroll_runs")
          .update({
            status: "locked",
            locked_by: caller.id,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "lock_run", details: { id: runId } });
        return { success: true, run: data };
      }

      case "payroll.unlockRun": {
        if (!isOwnerLike(caller.role)) return deny("approve");
        const runId = Number(params.id);
        const { data: run } = await admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).eq("id", runId).maybeSingle();
        if (!run || run.status !== "locked") return { success: false, error: "Run is not locked" };
        const { data, error } = await admin
          .from("hr_payroll_runs")
          .update({
            status: "approved",
            locked_by: null,
            locked_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "unlock_run", details: { id: runId } });
        return { success: true, run: data };
      }

      case "payroll.rollbackRun": {
        if (!isOwnerLike(caller.role) && normalizeRole(caller.role) !== "admin") return deny("delete");
        const runId = Number(params.id);
        const { data: run } = await admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).eq("id", runId).maybeSingle();
        if (!run) return { success: false, error: "Run not found" };
        if (run.status === "locked") return { success: false, error: "Unlock before rollback" };
        await admin.from("hr_payslips").delete().eq("payroll_run_id", runId).eq("company_id", companyId);
        const { data, error } = await admin
          .from("hr_payroll_runs")
          .update({
            status: "rolled_back",
            employee_count: 0,
            gross_total: 0,
            deduction_total: 0,
            net_total: 0,
            employer_contrib_total: 0,
            journal_posted: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .select("*")
          .single();
        if (error) throw error;
        await writeAudit(admin, { companyId, caller, action: "rollback_run", details: { id: runId } });
        return { success: true, run: data };
      }

      case "payroll.listPayslips": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        let q = admin
          .from("hr_payslips")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(Number(params.limit) || 500);
        if (params.run_id) q = q.eq("payroll_run_id", Number(params.run_id));
        if (params.employee_id) q = q.eq("employee_id", Number(params.employee_id));
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self) return [];
          q = q.eq("employee_id", self.id);
        }
        const { data, error } = await q;
        if (error) {
          if (isMissingTableError(error)) return [];
          throw error;
        }
        return data || [];
      }

      case "payroll.getPayslip": {
        if (!canPayrollAction(caller.role, "view", matrix)) return deny("view");
        const id = Number(params.id);
        const { data, error } = await admin
          .from("hr_payslips")
          .select("*, hr_payroll_runs(period_year,period_month,run_label,status)")
          .eq("company_id", companyId)
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return { success: false, error: "Payslip not found" };
        if (!isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          const self = await getEmployeeForUser(admin, companyId, caller.id);
          if (!self || self.id !== data.employee_id) return deny("view");
        }
        return data;
      }

      case "payroll.bankExport": {
        if (!canPayrollAction(caller.role, "export", matrix) || !isPayrollManager(caller.role)) return deny("export");
        const runId = Number(params.run_id || params.id);
        const { data: slips, error } = await admin
          .from("hr_payslips")
          .select("*")
          .eq("company_id", companyId)
          .eq("payroll_run_id", runId);
        if (error) throw error;
        const rows = (slips || []).map((s) => ({
          employee_code: s.employee_code,
          employee_name: s.employee_name,
          bank_name: s.bank_name || "",
          bank_account: s.bank_account || "",
          amount: s.net_pay,
          currency: s.currency_code,
          reference: `PAY-${runId}-${s.employee_code}`,
        }));
        await writeAudit(admin, { companyId, caller, action: "bank_export", details: { run_id: runId, count: rows.length } });
        return { success: true, rows };
      }

      case "payroll.getDashboard": {
        if (!canPayrollAction(caller.role, "view", matrix) || !isPayrollManager(caller.role) && normalizeRole(caller.role) !== "branch_manager") {
          // Owner dashboard widgets — allow owners always
          if (!isOwnerLike(caller.role)) return deny("view");
        }
        const settings = await ensureSettings(admin, companyId);
        if (!settings) return { success: false, code: "NO_SCHEMA", error: "Payroll schema missing" };

        const [
          { data: employees },
          { data: runs },
          leaveCountRes,
          { data: attendanceToday },
        ] = await Promise.all([
          admin.from("hr_employees").select("id,status,department,branch_id").eq("company_id", companyId),
          admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).order("period_year", { ascending: false }).order("period_month", { ascending: false }).limit(12),
          admin.from("hr_leave_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending"),
          admin.from("hr_attendance").select("id,status").eq("company_id", companyId).eq("work_date", new Date().toISOString().slice(0, 10)),
        ]);

        const active = (employees || []).filter((e) => e.status === "active").length;
        const trend = (runs || []).map((r) => ({
          label: r.run_label || `${r.period_year}-${r.period_month}`,
          gross: num(r.gross_total),
          net: num(r.net_total),
          overtime_cost: 0,
          status: r.status,
        }));

        // Overtime cost from latest payslips
        let overtimeCost = 0;
        if (runs?.[0]) {
          const { data: slips } = await admin
            .from("hr_payslips")
            .select("overtime_pay")
            .eq("company_id", companyId)
            .eq("payroll_run_id", runs[0].id);
          overtimeCost = round2((slips || []).reduce((s, p) => s + num(p.overtime_pay), 0));
        }

        const byDept = {};
        for (const e of employees || []) {
          const d = e.department || "Unassigned";
          byDept[d] = (byDept[d] || 0) + 1;
        }

        return {
          success: true,
          active_employees: active,
          total_employees: (employees || []).length,
          pending_leave: Number(leaveCountRes?.count || 0),
          present_today: (attendanceToday || []).filter((a) => ["present", "late", "half_day"].includes(a.status)).length,
          absent_today: (attendanceToday || []).filter((a) => a.status === "absent").length,
          latest_run: runs?.[0] || null,
          salary_expense_trend: trend,
          overtime_cost_latest: overtimeCost,
          headcount_by_department: Object.entries(byDept).map(([department, count]) => ({ department, count })),
          insights: [
            active === 0 ? "No active employees — add staff to begin payroll." : null,
            overtimeCost > 0 ? `Latest run overtime cost: ${overtimeCost}` : null,
            (runs || []).some((r) => r.status === "preview") ? "A payroll run awaits approval." : null,
          ].filter(Boolean),
        };
      }

      case "payroll.getReports": {
        if (!canPayrollAction(caller.role, "view", matrix) || !isPayrollManager(caller.role)) return deny("view");
        const year = Number(params.year) || new Date().getFullYear();
        const month = params.month != null ? Number(params.month) : null;

        let runQ = admin.from("hr_payroll_runs").select("*").eq("company_id", companyId).eq("period_year", year);
        if (month) runQ = runQ.eq("period_month", month);
        const { data: runs } = await runQ.order("period_month", { ascending: true });

        const runIds = (runs || []).map((r) => r.id);
        let slips = [];
        if (runIds.length) {
          const { data } = await admin.from("hr_payslips").select("*").eq("company_id", companyId).in("payroll_run_id", runIds);
          slips = data || [];
        }

        const byDept = {};
        const byBranch = {};
        const byEmployee = {};
        for (const s of slips) {
          const d = s.department || "Unassigned";
          byDept[d] = byDept[d] || { department: d, gross: 0, net: 0, count: 0 };
          byDept[d].gross += num(s.gross_pay);
          byDept[d].net += num(s.net_pay);
          byDept[d].count += 1;
          const b = s.branch_id || 0;
          byBranch[b] = byBranch[b] || { branch_id: b, gross: 0, net: 0, count: 0 };
          byBranch[b].gross += num(s.gross_pay);
          byBranch[b].net += num(s.net_pay);
          byBranch[b].count += 1;
          byEmployee[s.employee_id] = byEmployee[s.employee_id] || {
            employee_id: s.employee_id,
            employee_code: s.employee_code,
            employee_name: s.employee_name,
            gross: 0,
            net: 0,
            runs: 0,
          };
          byEmployee[s.employee_id].gross += num(s.gross_pay);
          byEmployee[s.employee_id].net += num(s.net_pay);
          byEmployee[s.employee_id].runs += 1;
        }

        const monthly = (runs || []).map((r) => ({
          period: r.run_label,
          year: r.period_year,
          month: r.period_month,
          status: r.status,
          employees: r.employee_count,
          gross: num(r.gross_total),
          deductions: num(r.deduction_total),
          net: num(r.net_total),
          employer: num(r.employer_contrib_total),
        }));

        await writeAudit(admin, { companyId, caller, action: "view_reports", details: { year, month } });
        return {
          success: true,
          year,
          month,
          monthly,
          yearly: {
            gross: monthly.reduce((s, m) => s + m.gross, 0),
            net: monthly.reduce((s, m) => s + m.net, 0),
            deductions: monthly.reduce((s, m) => s + m.deductions, 0),
            employer: monthly.reduce((s, m) => s + m.employer, 0),
          },
          by_department: Object.values(byDept),
          by_branch: Object.values(byBranch),
          by_employee: Object.values(byEmployee),
          journal: {
            ref_type: "payroll_run",
            runs: (runs || []).filter((r) => r.journal_posted).map((r) => ({ id: r.id, label: r.run_label, net: r.net_total })),
          },
        };
      }

      case "payroll.selfOverview": {
        // Employee self-service — any authenticated company user linked to an employee
        const self = await getEmployeeForUser(admin, companyId, caller.id);
        if (!self) {
          return {
            success: true,
            linked: false,
            message: "Your user account is not linked to an HR employee record. Ask HR to link your profile.",
          };
        }
        const settings = await ensureSettings(admin, companyId);
        await ensureLeaveBalances(admin, companyId, self.id, settings);
        const year = new Date().getFullYear();
        const [{ data: balances }, { data: leave }, { data: payslips }, { data: attendance }] = await Promise.all([
          admin.from("hr_leave_balances").select("*").eq("company_id", companyId).eq("employee_id", self.id).eq("year", year),
          admin.from("hr_leave_requests").select("*").eq("company_id", companyId).eq("employee_id", self.id).order("created_at", { ascending: false }).limit(20),
          admin.from("hr_payslips").select("*, hr_payroll_runs(period_year,period_month,run_label,status)").eq("company_id", companyId).eq("employee_id", self.id).order("created_at", { ascending: false }).limit(24),
          admin.from("hr_attendance").select("*").eq("company_id", companyId).eq("employee_id", self.id).order("work_date", { ascending: false }).limit(40),
        ]);
        return {
          success: true,
          linked: true,
          employee: self,
          leave_balances: balances || [],
          leave_requests: leave || [],
          payslips: payslips || [],
          attendance: attendance || [],
        };
      }

      default:
        return { success: false, error: `Unknown payroll action: ${action}`, code: "UNKNOWN_ACTION" };
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      return { success: false, error: "Payroll schema not applied. Run migration 020.", code: "NO_SCHEMA" };
    }
    console.error("[payroll]", action, err);
    return { success: false, error: err.message || String(err), code: "PAYROLL_ERROR" };
  }
}

export { canPayrollAction, DEFAULT_PAYROLL_ACTIONS };
