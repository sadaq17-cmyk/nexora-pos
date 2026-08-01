-- 020_payroll_hr_enterprise.sql
-- Additive only (SCHEMA_FREEZE after 014). Enterprise Payroll & HR.
-- company_id NOT NULL + tenant_match RLS on all tables. No drops/renames.

-- ---------------------------------------------------------------------------
-- Company payroll settings (Kenya-oriented defaults, company-configurable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_payroll_settings (
  id                bigserial PRIMARY KEY,
  company_id        bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  currency_code     text NOT NULL DEFAULT 'KES',
  paye_enabled      boolean NOT NULL DEFAULT true,
  nssf_enabled      boolean NOT NULL DEFAULT true,
  nhif_sha_enabled  boolean NOT NULL DEFAULT true,
  pension_enabled   boolean NOT NULL DEFAULT false,
  -- PAYE bands JSON: [{up_to, rate}] cumulative Kenya-style (configurable)
  paye_bands        jsonb NOT NULL DEFAULT '[
    {"up_to": 24000, "rate": 0.10},
    {"up_to": 32333, "rate": 0.25},
    {"up_to": 500000, "rate": 0.30},
    {"up_to": 800000, "rate": 0.325},
    {"up_to": null, "rate": 0.35}
  ]'::jsonb,
  personal_relief   numeric(12, 2) NOT NULL DEFAULT 2400,
  nssf_employee_rate numeric(8, 4) NOT NULL DEFAULT 0.06,
  nssf_employer_rate numeric(8, 4) NOT NULL DEFAULT 0.06,
  nssf_max_base     numeric(12, 2) NOT NULL DEFAULT 72000,
  -- SHA / NHIF: flat bands or percent — company editable
  nhif_sha_bands    jsonb NOT NULL DEFAULT '[
    {"up_to": 5999, "amount": 150},
    {"up_to": 7999, "amount": 300},
    {"up_to": 11999, "amount": 400},
    {"up_to": 14999, "amount": 500},
    {"up_to": 19999, "amount": 600},
    {"up_to": 24999, "amount": 750},
    {"up_to": 29999, "amount": 850},
    {"up_to": 34999, "amount": 900},
    {"up_to": 39999, "amount": 950},
    {"up_to": 44999, "amount": 1000},
    {"up_to": 49999, "amount": 1100},
    {"up_to": 59999, "amount": 1200},
    {"up_to": 69999, "amount": 1300},
    {"up_to": 79999, "amount": 1400},
    {"up_to": 89999, "amount": 1500},
    {"up_to": 99999, "amount": 1600},
    {"up_to": null, "amount": 1700}
  ]'::jsonb,
  pension_employee_rate numeric(8, 4) NOT NULL DEFAULT 0,
  pension_employer_rate numeric(8, 4) NOT NULL DEFAULT 0,
  overtime_rate_mult    numeric(8, 4) NOT NULL DEFAULT 1.5,
  standard_hours_day    numeric(8, 2) NOT NULL DEFAULT 8,
  standard_days_month   numeric(8, 2) NOT NULL DEFAULT 26,
  leave_types           jsonb NOT NULL DEFAULT '[
    {"code":"annual","label":"Annual Leave","days_per_year":21,"paid":true},
    {"code":"sick","label":"Sick Leave","days_per_year":14,"paid":true},
    {"code":"maternity","label":"Maternity Leave","days_per_year":90,"paid":true},
    {"code":"paternity","label":"Paternity Leave","days_per_year":14,"paid":true},
    {"code":"emergency","label":"Emergency Leave","days_per_year":5,"paid":true}
  ]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_payroll_settings_company_uid UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS hr_payroll_settings_company_idx
  ON public.hr_payroll_settings (company_id);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_employees (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id       bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code   text NOT NULL,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text,
  phone           text,
  photo_url       text,
  national_id     text,
  department      text,
  position        text,
  employment_type text NOT NULL DEFAULT 'permanent',
  contract_start  date,
  contract_end    date,
  hire_date       date,
  status          text NOT NULL DEFAULT 'active',
  bank_name       text,
  bank_account    text,
  bank_branch     text,
  payment_method  text NOT NULL DEFAULT 'bank',
  notes           text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_employees_status_check
    CHECK (status IN ('active', 'inactive', 'terminated', 'on_leave', 'probation')),
  CONSTRAINT hr_employees_type_check
    CHECK (employment_type IN ('permanent', 'contract', 'casual', 'intern', 'probation')),
  CONSTRAINT hr_employees_company_code_uid UNIQUE (company_id, employee_code)
);

CREATE INDEX IF NOT EXISTS hr_employees_company_status_idx
  ON public.hr_employees (company_id, status);
CREATE INDEX IF NOT EXISTS hr_employees_company_branch_idx
  ON public.hr_employees (company_id, branch_id);
CREATE INDEX IF NOT EXISTS hr_employees_user_idx
  ON public.hr_employees (company_id, user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Employee documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_employee_documents (
  id            bigserial PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  doc_type      text NOT NULL DEFAULT 'other',
  title         text NOT NULL,
  file_url      text,
  file_name     text,
  notes         text,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_employee_documents_emp_idx
  ON public.hr_employee_documents (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_attendance (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  branch_id       bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  work_date       date NOT NULL,
  check_in        timestamptz,
  check_out       timestamptz,
  scheduled_start time,
  scheduled_end   time,
  hours_worked    numeric(8, 2) NOT NULL DEFAULT 0,
  overtime_hours  numeric(8, 2) NOT NULL DEFAULT 0,
  late_minutes    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'present',
  leave_request_id bigint,
  notes           text,
  recorded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend')),
  CONSTRAINT hr_attendance_company_emp_date_uid UNIQUE (company_id, employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS hr_attendance_company_date_idx
  ON public.hr_attendance (company_id, work_date DESC);
CREATE INDEX IF NOT EXISTS hr_attendance_emp_idx
  ON public.hr_attendance (company_id, employee_id, work_date DESC);

-- ---------------------------------------------------------------------------
-- Leave requests + balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_leave_requests (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  leave_type      text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  days            numeric(8, 2) NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending',
  approved_by     uuid,
  approved_at     timestamptz,
  rejection_reason text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_leave_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT hr_leave_dates_check CHECK (end_date >= start_date),
  CONSTRAINT hr_leave_days_pos CHECK (days > 0)
);

CREATE INDEX IF NOT EXISTS hr_leave_requests_company_status_idx
  ON public.hr_leave_requests (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_leave_requests_emp_idx
  ON public.hr_leave_requests (company_id, employee_id, start_date DESC);

ALTER TABLE public.hr_attendance
  DROP CONSTRAINT IF EXISTS hr_attendance_leave_fk;
ALTER TABLE public.hr_attendance
  ADD CONSTRAINT hr_attendance_leave_fk
  FOREIGN KEY (leave_request_id) REFERENCES public.hr_leave_requests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.hr_leave_balances (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  leave_type      text NOT NULL,
  year            integer NOT NULL,
  entitled        numeric(8, 2) NOT NULL DEFAULT 0,
  used            numeric(8, 2) NOT NULL DEFAULT 0,
  pending         numeric(8, 2) NOT NULL DEFAULT 0,
  carried_forward numeric(8, 2) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_leave_balances_uid UNIQUE (company_id, employee_id, leave_type, year)
);

CREATE INDEX IF NOT EXISTS hr_leave_balances_emp_idx
  ON public.hr_leave_balances (company_id, employee_id, year);

-- ---------------------------------------------------------------------------
-- Salary structures
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_salary_structures (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  basic_salary    numeric(14, 2) NOT NULL DEFAULT 0,
  -- allowances / deductions as arrays of {code,label,amount|percent,type}
  allowances      jsonb NOT NULL DEFAULT '[]'::jsonb,
  deductions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  overtime_eligible boolean NOT NULL DEFAULT true,
  bonus_eligible  boolean NOT NULL DEFAULT true,
  commission_rate numeric(8, 4) NOT NULL DEFAULT 0,
  currency_code   text NOT NULL DEFAULT 'KES',
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_salary_basic_nonneg CHECK (basic_salary >= 0)
);

CREATE INDEX IF NOT EXISTS hr_salary_structures_emp_idx
  ON public.hr_salary_structures (company_id, employee_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS hr_salary_structures_active_idx
  ON public.hr_salary_structures (company_id, employee_id)
  WHERE active = true;

-- ---------------------------------------------------------------------------
-- Loans / salary advances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_loans_advances (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'advance',
  principal       numeric(14, 2) NOT NULL,
  balance         numeric(14, 2) NOT NULL,
  monthly_deduction numeric(14, 2) NOT NULL DEFAULT 0,
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  status          text NOT NULL DEFAULT 'active',
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_loans_kind_check CHECK (kind IN ('loan', 'advance')),
  CONSTRAINT hr_loans_status_check CHECK (status IN ('active', 'paid', 'cancelled')),
  CONSTRAINT hr_loans_principal_pos CHECK (principal > 0)
);

CREATE INDEX IF NOT EXISTS hr_loans_advances_emp_idx
  ON public.hr_loans_advances (company_id, employee_id, status);

-- ---------------------------------------------------------------------------
-- Payroll runs + payslips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hr_payroll_runs (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id       bigint REFERENCES public.branches(id) ON DELETE SET NULL,
  period_year     integer NOT NULL,
  period_month    integer NOT NULL,
  run_label       text,
  status          text NOT NULL DEFAULT 'draft',
  currency_code   text NOT NULL DEFAULT 'KES',
  employee_count  integer NOT NULL DEFAULT 0,
  gross_total     numeric(16, 2) NOT NULL DEFAULT 0,
  deduction_total numeric(16, 2) NOT NULL DEFAULT 0,
  net_total       numeric(16, 2) NOT NULL DEFAULT 0,
  employer_contrib_total numeric(16, 2) NOT NULL DEFAULT 0,
  previewed_at    timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  locked_by       uuid,
  locked_at       timestamptz,
  journal_posted  boolean NOT NULL DEFAULT false,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_payroll_runs_month_check CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT hr_payroll_runs_status_check
    CHECK (status IN ('draft', 'preview', 'approved', 'locked', 'rolled_back'))
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_runs_period_uid
  ON public.hr_payroll_runs (company_id, period_year, period_month, COALESCE(branch_id, 0));

CREATE INDEX IF NOT EXISTS hr_payroll_runs_company_period_idx
  ON public.hr_payroll_runs (company_id, period_year DESC, period_month DESC);

CREATE TABLE IF NOT EXISTS public.hr_payslips (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payroll_run_id  bigint NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id     bigint NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  employee_code   text,
  employee_name   text,
  department      text,
  position        text,
  branch_id       bigint,
  basic_salary    numeric(14, 2) NOT NULL DEFAULT 0,
  allowances_total numeric(14, 2) NOT NULL DEFAULT 0,
  overtime_pay    numeric(14, 2) NOT NULL DEFAULT 0,
  bonus           numeric(14, 2) NOT NULL DEFAULT 0,
  commission      numeric(14, 2) NOT NULL DEFAULT 0,
  gross_pay       numeric(14, 2) NOT NULL DEFAULT 0,
  paye            numeric(14, 2) NOT NULL DEFAULT 0,
  nssf            numeric(14, 2) NOT NULL DEFAULT 0,
  nhif_sha        numeric(14, 2) NOT NULL DEFAULT 0,
  pension         numeric(14, 2) NOT NULL DEFAULT 0,
  loan_deduction  numeric(14, 2) NOT NULL DEFAULT 0,
  other_deductions numeric(14, 2) NOT NULL DEFAULT 0,
  total_deductions numeric(14, 2) NOT NULL DEFAULT 0,
  net_pay         numeric(14, 2) NOT NULL DEFAULT 0,
  employer_nssf   numeric(14, 2) NOT NULL DEFAULT 0,
  employer_pension numeric(14, 2) NOT NULL DEFAULT 0,
  overtime_hours  numeric(8, 2) NOT NULL DEFAULT 0,
  days_worked     numeric(8, 2) NOT NULL DEFAULT 0,
  days_absent     numeric(8, 2) NOT NULL DEFAULT 0,
  bank_name       text,
  bank_account    text,
  currency_code   text NOT NULL DEFAULT 'KES',
  lines           jsonb NOT NULL DEFAULT '[]'::jsonb,
  qr_payload      text,
  signed_at       timestamptz,
  email_sent_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_payslips_run_emp_uid UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS hr_payslips_company_run_idx
  ON public.hr_payslips (company_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS hr_payslips_emp_idx
  ON public.hr_payslips (company_id, employee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.hr_payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_loans_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payslips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_payroll_settings_tenant ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_tenant ON public.hr_payroll_settings
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_employees_tenant ON public.hr_employees;
CREATE POLICY hr_employees_tenant ON public.hr_employees
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_employee_documents_tenant ON public.hr_employee_documents;
CREATE POLICY hr_employee_documents_tenant ON public.hr_employee_documents
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_attendance_tenant ON public.hr_attendance;
CREATE POLICY hr_attendance_tenant ON public.hr_attendance
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_leave_requests_tenant ON public.hr_leave_requests;
CREATE POLICY hr_leave_requests_tenant ON public.hr_leave_requests
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_leave_balances_tenant ON public.hr_leave_balances;
CREATE POLICY hr_leave_balances_tenant ON public.hr_leave_balances
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_salary_structures_tenant ON public.hr_salary_structures;
CREATE POLICY hr_salary_structures_tenant ON public.hr_salary_structures
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_loans_advances_tenant ON public.hr_loans_advances;
CREATE POLICY hr_loans_advances_tenant ON public.hr_loans_advances
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_payroll_runs_tenant ON public.hr_payroll_runs;
CREATE POLICY hr_payroll_runs_tenant ON public.hr_payroll_runs
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

DROP POLICY IF EXISTS hr_payslips_tenant ON public.hr_payslips;
CREATE POLICY hr_payslips_tenant ON public.hr_payslips
  FOR ALL TO authenticated
  USING (public.tenant_match(company_id))
  WITH CHECK (public.tenant_match(company_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_settings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employees TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employee_documents TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_attendance TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_leave_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_leave_balances TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_salary_structures TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_loans_advances TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_runs TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payslips TO authenticated, service_role;

GRANT USAGE, SELECT ON SEQUENCE public.hr_payroll_settings_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_employees_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_employee_documents_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_attendance_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_leave_requests_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_leave_balances_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_salary_structures_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_loans_advances_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_payroll_runs_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_payslips_id_seq TO authenticated, service_role;

COMMENT ON TABLE public.hr_employees IS 'Company-scoped HR employees (links optional profiles.id).';
COMMENT ON TABLE public.hr_payroll_runs IS 'Monthly payroll runs: draft → preview → approved → locked.';
COMMENT ON TABLE public.hr_payslips IS 'Per-employee payslip lines for a payroll run.';
