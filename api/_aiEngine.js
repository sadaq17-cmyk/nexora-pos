/**
 * Nexora AI Dual Mode — ASSISTANT (staff/customer) + EXECUTIVE (Owner / Super Admin).
 * Server-only. Uses authorized POS handlers + Supabase admin, never fabricates data.
 * Assistant mode never receives financial/security/owner tools (prompt-injection safe).
 */

import {
  createAdminClient,
  isOwner,
  isPlatformOwner,
  isSuperAdmin,
  listAllAuthUsers,
  normalizeRole,
  safeUserFields,
  sameCompany,
  sanitizeText,
} from "./_authHelpers.js";
import { handlePosAction } from "./_posData.js";

const SECRET_KEY_RE =
  /^(password|passwd|pwd|api[_-]?key|secret|token|service[_-]?role|private[_-]?key|authorization|access[_-]?token|refresh[_-]?token|supabase[_-]?key)$/i;

/** Assistant tools → optional module gate (operational only; never financial). */
const ASSISTANT_TOOL_MODULE = Object.freeze({
  products_search: "products",
  barcode_lookup: "products",
  stock_availability: "inventory",
  inventory_low_stock: "inventory",
  orders_today: "pos",
  invoice_lookup: "sales",
  customers_support_lookup: "customers",
  product_recommendations: "products",
  payment_help: null,
  faq_help: null,
  settings_help: null,
});

/** Financial / BI / security tools — Executive only. Never exposed to Assistant mode. */
const EXECUTIVE_ONLY_TOOL_NAMES = Object.freeze([
  "company_overview",
  "users_list",
  "audit_logs",
  "login_history",
  "security_signals",
  "active_sessions_signal",
  "health_probe",
  "branch_comparison",
  "financial_analysis",
  "critical_alerts",
  "smart_recommendations",
  "forecast_outlook",
  "sales_summary",
  "expenses_summary",
  "purchases_summary",
  "reports_summary",
  "suppliers_lookup",
  "supplier_insights",
  "supplier_aging",
  "branches_list",
  "notifications_list",
  "employee_performance",
  "payroll_summary",
  "payroll_anomalies",
  "payroll_forecast",
]);

const LANGUAGE_RULES = [
  "LANGUAGE (mandatory): Detect the language of each user message automatically.",
  "Always reply in the SAME language as the user's latest message (including Somali, Arabic, French, Swahili, etc.).",
  "If the user mixes languages, mirror their mixed style; do NOT force English.",
  "Never translate the user's request into English unless they ask.",
].join("\n");

/** Owner, Super Admin, and Platform Owner may use Executive AI. */
export function canUseExecutiveAi(role) {
  const r = normalizeRole(role);
  return isOwner(r) || isPlatformOwner(r) || isSuperAdmin(r);
}

/** Role → modules with default view access (mirrors rbac defaults for AI gating). */
const ROLE_VIEW_MODULES = Object.freeze({
  platform_owner: ["*"],
  owner: ["*"],
  super_admin: ["*"],
  admin: [
    "dashboard", "pos", "products", "categories", "brands", "inventory", "barcode",
    "purchases", "suppliers", "customers", "sales", "returns", "discounts", "refunds",
    "expenses", "payroll", "reports", "export_reports", "print_reports", "settings", "currencies",
    "users", "roles", "branches", "audit_logs",
  ],
  branch_manager: [
    "dashboard", "pos", "products", "categories", "brands", "inventory", "barcode",
    "purchases", "suppliers", "customers", "sales", "returns", "discounts", "refunds",
    "payroll", "reports", "export_reports", "print_reports", "branches",
  ],
  inventory_manager: [
    "dashboard", "products", "categories", "brands", "inventory", "barcode",
    "suppliers", "purchases", "reports",
  ],
  sales_manager: [
    "dashboard", "pos", "products", "customers", "sales", "returns", "discounts",
    "refunds", "reports", "export_reports", "print_reports", "categories", "inventory",
  ],
  sales: ["customers", "sales"],
  cashier: ["pos", "products", "barcode", "discounts", "payroll"],
  accountant: [
    "dashboard", "purchases", "suppliers", "customers", "sales", "expenses", "payroll",
    "reports", "export_reports", "print_reports", "settings", "audit_logs",
  ],
});

function roleCanView(role, moduleId) {
  if (!moduleId) return true;
  const r = normalizeRole(role);
  const mods = ROLE_VIEW_MODULES[r] || [];
  if (mods.includes("*")) return true;
  return mods.includes(moduleId);
}

function redactSecrets(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redactSecrets(item, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactSecrets(val, depth + 1);
  }
  return out;
}

function truncateJson(value, maxChars = 12000) {
  const safe = redactSecrets(value);
  let text = "";
  try {
    text = JSON.stringify(safe);
  } catch {
    text = String(safe);
  }
  if (text.length <= maxChars) return safe;
  return {
    truncated: true,
    preview: text.slice(0, maxChars),
    note: "Result truncated for context size. Ask a narrower question if needed.",
  };
}

function getLlmConfig() {
  const apiKey = String(
    process.env.OPENAI_API_KEY || process.env.NEXORA_AI_API_KEY || process.env.AI_API_KEY || ""
  ).trim();
  const model = String(
    process.env.OPENAI_MODEL || process.env.NEXORA_AI_MODEL || "gpt-4o-mini"
  ).trim();
  const baseUrl = String(
    process.env.OPENAI_BASE_URL || process.env.NEXORA_AI_BASE_URL || "https://api.openai.com/v1"
  )
    .trim()
    .replace(/\/+$/, "");
  return { apiKey, model, baseUrl };
}

export function resolveAiMode(requestedMode, caller) {
  const role = normalizeRole(caller?.role);
  const ownerCapable = canUseExecutiveAi(role);
  const want = String(requestedMode || "").toLowerCase().trim();
  if (want === "executive" || want === "private" || want === "owner") {
    if (!ownerCapable) {
      return {
        error: "Nexora Executive AI is available to Company Owners and Super Admins only.",
        code: "EXECUTIVE_FORBIDDEN",
        status: 403,
      };
    }
    return { mode: "executive", ownerCapable: true };
  }
  // Owners / Super Admins default to Executive; others always get Assistant.
  if (!want || want === "auto") {
    return { mode: ownerCapable ? "executive" : "assistant", ownerCapable };
  }
  // Explicit public/assistant — never escalate to executive via prompt.
  if (want === "public" || want === "assistant" || want === "staff" || want === "customer") {
    return { mode: "assistant", ownerCapable };
  }
  return { mode: "assistant", ownerCapable };
}

function assistantSystemPrompt(caller) {
  const role = normalizeRole(caller.role);
  return [
    "You are Nexora Assistant AI — the staff and customer helper for Nexora POS Pro.",
    "Capabilities: product search, price lookup, barcode lookup, stock availability, recommendations, order/invoice assistance, payment help, FAQ, and customer support.",
    "HARD BOUNDARIES — you MUST refuse (politely, in the user's language) any request for:",
    "profit, revenue, expenses, P&L, cash flow, financial reports, audit logs, user management, company settings secrets, API keys, security monitoring, or the Owner Executive Dashboard.",
    "You do not have tools for financial or security data. Never invent those figures.",
    "Answer using ONLY verified tool results and general product guidance. Never invent stock levels, prices, or invoice status.",
    "Never reveal passwords, API keys, tokens, service-role keys, env vars, or database credentials.",
    "Never expose data from other companies. All tools are already scoped to the caller's company.",
    `Caller role: ${role}. Respect role permissions — if a tool is denied, explain what access is required.`,
    "Be concise, helpful, and operational. Prefer short bullet answers.",
    "If the user needs owner-only intelligence, say that Nexora Executive AI is Owner / Super Admin only.",
    LANGUAGE_RULES,
  ].join("\n");
}

function executiveSystemPrompt(caller) {
  const role = normalizeRole(caller.role);
  return [
    "You are Nexora Executive AI — a private Owner / Super Admin intelligence layer for Nexora POS Pro.",
    "Capabilities: Executive Dashboard, BI, P&L, revenue, expenses, cash flow, forecasting, inventory/supplier/customer analytics, employee performance, audit logs, user monitoring, security monitoring, company settings guidance, and AI reports.",
    "Answer using ONLY verified tool results. Never fabricate metrics, threats, or user activity.",
    "Never reveal passwords, API keys, tokens, env vars, service-role keys, or database credentials. Redact sensitive values if they appear.",
    "Never expose other companies' data. Scope is the caller's company (or platform context for Platform Owner).",
    `Caller role: ${role}.`,
    "When analyzing screenshots, describe what you see, map UI issues to Nexora POS Pro workflows, and suggest safe troubleshooting steps — do not store or request secrets from the image.",
    "Provide executive-ready summaries with clear action recommendations when data supports them.",
    LANGUAGE_RULES,
  ].join("\n");
}

const ASSISTANT_TOOLS = [
  {
    type: "function",
    function: {
      name: "products_search",
      description: "Search products by name, SKU, or barcode fragment. Returns name, price, stock, barcode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "barcode_lookup",
      description: "Look up a product by exact barcode.",
      parameters: {
        type: "object",
        properties: { barcode: { type: "string" } },
        required: ["barcode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stock_availability",
      description: "Check stock availability for products matching a query, or list low-stock items.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          low_stock_only: { type: "boolean" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inventory_low_stock",
      description: "List low-stock / reorder products (operational stock check).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "orders_today",
      description: "List today's recent orders/invoices for operational assistance (no company revenue totals).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invoice_lookup",
      description: "Find an order/invoice by invoice or receipt number.",
      parameters: {
        type: "object",
        properties: { invoice: { type: "string" } },
        required: ["invoice"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "customers_support_lookup",
      description: "Customer support lookup by name/phone/email (no account balances or credit data).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "product_recommendations",
      description: "Suggest products based on stock availability and catalog (operational recommendations).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "payment_help",
      description: "Explain how payments work in Nexora POS Pro (cash, card, credit) — FAQ only, no financial reports.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "faq_help",
      description: "Answer common Nexora POS Pro FAQ / how-to questions (no secrets).",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "settings_help",
      description: "Explain where staff configure day-to-day POS options (receipts, barcode) — never returns API keys or owner secrets.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
];

const EXECUTIVE_EXTRA_TOOLS = [
  {
    type: "function",
    function: {
      name: "company_overview",
      description: "Company profile, subscription/plan signals, and high-level counts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "users_list",
      description: "List company users with roles, status, last login (no passwords).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_logs",
      description: "Recent audit log entries for the company.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" }, module: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "login_history",
      description: "Login / auth-related audit history and last_sign_in signals.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security_signals",
      description: "Failed logins, locked/suspended accounts, force-logout flags.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "active_sessions_signal",
      description: "Recent activity / last login proxies for active session monitoring (server-side).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "health_probe",
      description: "Database / schema health probe and API readiness signals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "branch_comparison",
      description: "Compare branches by sales volume where data exists.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "financial_analysis",
      description: "Sales, purchases, expenses, P&L, and cash-flow oriented snapshot.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "forecast_outlook",
      description: "Simple sales outlook / forecast signals from recent trends (not a guarantee).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "employee_performance",
      description: "Employee / cashier sales activity signals from recent sales (no passwords).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "payroll_summary",
      description: "Company payroll & HR dashboard: headcount, salary expense trend, pending leave, latest run (Owner/Executive only).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "payroll_anomalies",
      description: "Best-effort payroll anomalies: high overtime cost, pending leave backlog, draft/preview runs awaiting action.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "payroll_forecast",
      description: "Simple salary cost outlook from recent payroll runs (not a guarantee).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "critical_alerts",
      description: "Critical operational and security alerts for the company.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "smart_recommendations",
      description: "Data-backed recommendations from inventory, sales, and security signals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "sales_summary",
      description: "Today's and month-to-date sales revenue summary.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "expenses_summary",
      description: "Expense summary for the company.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "purchases_summary",
      description: "Purchase dashboard / summary.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reports_summary",
      description: "High-level sales + profit/report summaries.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "suppliers_lookup",
      description: "List suppliers for supplier analytics.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_insights",
      description:
        "AI supplier insights: best by price, delivery time, reliability, price trends, suggested reorder qty and supplier.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_aging",
      description: "Accounts payable aging buckets and overdue supplier invoices.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "customers_lookup",
      description: "Customer analytics lookup including balances where available.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "branches_list",
      description: "List company branches.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "notifications_list",
      description: "Operational notifications / alerts.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

const EXECUTIVE_TOOLS = [...EXECUTIVE_EXTRA_TOOLS, ...ASSISTANT_TOOLS];

function settingsHelp(topic = "") {
  const t = String(topic || "").toLowerCase();
  const catalog = [
    { keys: ["receipt", "invoice"], text: "Receipt/invoice branding is under Settings → Store / Receipts. Owners configure store name, phone, and footer notes." },
    { keys: ["user", "role", "permission", "rbac"], text: "Users: Users page. Roles & permissions: Roles page (Owner/Admin). Cashiers cannot manage roles." },
    { keys: ["backup", "restore"], text: "Backup & Restore is Owner-only under Settings (Backup tab) / governance." },
    { keys: ["mfa", "2fa", "security", "login"], text: "Login & Security (Owner): Settings → Login & Security. Other roles use Change password / MFA panel in Settings." },
    { keys: ["currency"], text: "Currencies: Settings → Currencies. Base currency changes are Owner-only." },
    { keys: ["branch"], text: "Branches: Branches page (permission: branches.view)." },
    { keys: ["subscription", "plan", "billing"], text: "Subscription/Plan is Owner-only via the Plan nav item." },
    { keys: ["inventory", "stock"], text: "Inventory module covers low stock, transfers, adjustments, and counts." },
    { keys: ["pos", "sale", "checkout"], text: "POS Terminal is under Sales. Held sales and checkout require pos permissions." },
    { keys: ["barcode", "scan"], text: "Use the Barcode module or POS search field to scan. Product barcodes are set on the Products page." },
  ];
  const hit = catalog.find((row) => row.keys.some((k) => t.includes(k)));
  return {
    topic: topic || "general",
    guidance: hit?.text || "Use the left navigation for modules you can access. Ask about a specific area (receipts, barcode, inventory, POS checkout) for directed help.",
    note: "Help never returns secrets, API keys, or credential stores.",
  };
}

function paymentHelp(topic = "") {
  const t = String(topic || "").toLowerCase();
  const tips = [
    { keys: ["cash", "change"], text: "On POS, select Cash, enter amount tendered, and confirm. Change is calculated automatically." },
    { keys: ["card", "visa", "mastercard"], text: "Select Card on checkout, complete the card terminal capture outside Nexora if needed, then confirm the sale." },
    { keys: ["credit", "account", "customer"], text: "Credit / on-account sales require a customer on the receipt. Owners/managers configure credit policies." },
    { keys: ["refund", "return"], text: "Returns/refunds are handled from Sales History when your role has returns permission." },
    { keys: ["split", "partial"], text: "If split tender is enabled in your store workflow, capture each method then complete the sale." },
  ];
  const hit = tips.find((row) => row.keys.some((k) => t.includes(k)));
  return {
    topic: topic || "general",
    guidance:
      hit?.text ||
      "Nexora POS Pro supports cash, card, and credit checkout from the receipt panel. Ask about cash, card, credit, or refunds for specific steps.",
    note: "Payment help is instructional only — it never reveals revenue totals or payment gateway secrets.",
  };
}

function mapProductOps(p) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    stock: p.stock ?? p.quantity,
    price: p.price ?? p.selling_price,
    active: p.active,
  };
}

function mapOrderOps(sale) {
  const items = Array.isArray(sale.items) ? sale.items : sale.items_json || [];
  return {
    id: sale.id,
    invoice_no: sale.invoice_no || sale.receipt_no,
    receipt_no: sale.receipt_no || sale.invoice_no,
    created_at: sale.created_at,
    payment_method: sale.payment_method,
    status: sale.status,
    item_count: items.length || sale.item_count || null,
    // Per-order total for invoice assistance only — not company revenue aggregates.
    order_total: sale.total,
  };
}

async function listCompanyUsers(admin, caller) {
  const all = await listAllAuthUsers(admin);
  let rows = all.map(safeUserFields);
  if (!isPlatformOwner(caller.role)) {
    rows = rows.filter((user) => sameCompany(user.company_id, caller.company_id));
  }
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    role: u.role,
    active: u.active,
    account_status: u.account_status,
    login_enabled: u.login_enabled,
    branch_id: u.branch_id,
    last_login_at: u.last_login_at,
    last_activity_at: u.last_activity_at,
    failed_login_count: u.failed_login_count,
    locked_until: u.locked_until,
    force_logout_at: u.force_logout_at,
    email_verified: u.email_verified,
  }));
}

function denyExecutiveTool(name) {
  return {
    success: false,
    error: `Tool "${name}" requires Nexora Executive AI (Owner / Super Admin).`,
    code: "EXECUTIVE_ONLY",
  };
}

async function executeTool(admin, caller, mode, name, rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 25));
  const isAssistant = mode === "assistant" || mode === "public";

  // Hard gate: Assistant mode cannot run financial/security/owner tools even if injected.
  if (isAssistant && EXECUTIVE_ONLY_TOOL_NAMES.includes(name)) {
    return denyExecutiveTool(name);
  }

  if (isAssistant) {
    const moduleId = ASSISTANT_TOOL_MODULE[name];
    if (moduleId === undefined && !["faq_help", "payment_help", "settings_help"].includes(name)) {
      return { success: false, error: `Unknown or forbidden assistant tool: ${name}`, code: "FORBIDDEN" };
    }
    if (moduleId) {
      const allowed =
        roleCanView(caller.role, moduleId) ||
        (moduleId === "sales" && roleCanView(caller.role, "pos")) ||
        (moduleId === "inventory" && roleCanView(caller.role, "products"));
      if (!allowed) {
        return {
          success: false,
          error: `Your role (${normalizeRole(caller.role)}) cannot access ${moduleId}.`,
          code: "FORBIDDEN",
        };
      }
    }
  }

  switch (name) {
    case "products_search": {
      const rows = await handlePosAction(admin, caller, "products.getAll", {});
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      const q = String(args.query || "").trim().toLowerCase();
      const filtered = q
        ? list.filter((p) =>
            [p.name, p.sku, p.barcode, p.code].some((v) => String(v || "").toLowerCase().includes(q))
          )
        : list;
      return {
        success: true,
        count: filtered.length,
        items: filtered.slice(0, limit).map(mapProductOps),
      };
    }
    case "barcode_lookup": {
      const barcode = String(args.barcode || "").trim();
      if (!barcode) return { success: false, error: "barcode is required.", code: "BAD_REQUEST" };
      const product = await handlePosAction(admin, caller, "products.getByBarcode", { barcode }).catch(() => null);
      if (!product) {
        const rows = await handlePosAction(admin, caller, "products.getAll", {});
        const list = Array.isArray(rows) ? rows : rows?.items || [];
        const hit = list.find((p) => String(p.barcode || "").trim() === barcode);
        return hit
          ? { success: true, product: mapProductOps(hit) }
          : { success: false, error: "No product found for that barcode.", code: "NOT_FOUND" };
      }
      return { success: true, product: mapProductOps(product) };
    }
    case "stock_availability": {
      if (args.low_stock_only) {
        const rows = await handlePosAction(admin, caller, "inventory.getLowStock", {});
        const list = Array.isArray(rows) ? rows : rows?.items || [];
        return { success: true, low_stock: true, items: list.slice(0, limit).map(mapProductOps) };
      }
      const rows = await handlePosAction(admin, caller, "products.getAll", {});
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      const q = String(args.query || "").trim().toLowerCase();
      const filtered = q
        ? list.filter((p) =>
            [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(q))
          )
        : list;
      return {
        success: true,
        items: filtered.slice(0, limit).map((p) => ({
          ...mapProductOps(p),
          available: Number(p.stock ?? p.quantity ?? 0) > 0,
        })),
      };
    }
    case "inventory_low_stock": {
      const rows = await handlePosAction(admin, caller, "inventory.getLowStock", {});
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      return { success: true, items: list.slice(0, limit).map(mapProductOps) };
    }
    case "orders_today": {
      const rows = await handlePosAction(admin, caller, "sales.getRecent", { limit: Math.min(limit, 40) });
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      const todayStr = new Date().toDateString();
      const today = list.filter((s) => new Date(s.created_at).toDateString() === todayStr);
      return {
        success: true,
        note: "Operational order list only — not a revenue or P&L report.",
        count: today.length,
        orders: today.slice(0, limit).map(mapOrderOps),
      };
    }
    case "invoice_lookup": {
      const needle = String(args.invoice || "").trim().toLowerCase();
      if (!needle) return { success: false, error: "invoice is required.", code: "BAD_REQUEST" };
      const rows = await handlePosAction(admin, caller, "sales.getRecent", { limit: 100 });
      const list = Array.isArray(rows) ? rows : rows?.items || [];
      const hit = list.find((s) =>
        [s.invoice_no, s.receipt_no, String(s.id)].some((v) => String(v || "").toLowerCase().includes(needle))
      );
      if (!hit) return { success: false, error: "Invoice not found in recent sales.", code: "NOT_FOUND" };
      return { success: true, order: mapOrderOps(hit) };
    }
    case "customers_support_lookup": {
      const rows = await handlePosAction(admin, caller, "customers.getAll", {});
      const list = Array.isArray(rows) ? rows : [];
      const q = String(args.query || "").trim().toLowerCase();
      const filtered = q
        ? list.filter((c) =>
            [c.name, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q))
          )
        : list;
      return {
        success: true,
        count: filtered.length,
        items: filtered.slice(0, limit).map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
        })),
      };
    }
    case "product_recommendations": {
      const rows = await handlePosAction(admin, caller, "products.getAll", {});
      const list = (Array.isArray(rows) ? rows : rows?.items || []).filter((p) => p.active !== false);
      const q = String(args.query || "").trim().toLowerCase();
      let pool = q
        ? list.filter((p) =>
            [p.name, p.sku, p.brand, p.category].some((v) => String(v || "").toLowerCase().includes(q))
          )
        : list.filter((p) => Number(p.stock ?? p.quantity ?? 0) > 0);
      if (!pool.length) pool = list.slice(0, limit);
      return {
        success: true,
        recommendations: pool.slice(0, limit).map(mapProductOps),
        note: "Operational product suggestions from catalog/stock — not financial forecasts.",
      };
    }
    case "payment_help":
      return { success: true, ...paymentHelp(args.topic) };
    case "faq_help":
      return { success: true, ...settingsHelp(args.topic) };
    case "settings_help":
      return { success: true, ...settingsHelp(args.topic) };

    case "sales_summary":
      return handlePosAction(admin, caller, "sales.getSummary", {});
    case "customers_lookup": {
      const rows = await handlePosAction(admin, caller, "customers.getAll", {});
      const list = Array.isArray(rows) ? rows : [];
      const q = String(args.query || "").trim().toLowerCase();
      const filtered = q
        ? list.filter((c) =>
            [c.name, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q))
          )
        : list;
      return {
        success: true,
        count: filtered.length,
        items: filtered.slice(0, limit).map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          balance: c.balance,
        })),
      };
    }
    case "suppliers_lookup": {
      const rows = await handlePosAction(admin, caller, "suppliers.getAll", {}).catch(() => []);
      const list = Array.isArray(rows) ? rows : [];
      return {
        success: true,
        items: list.slice(0, limit).map((s) => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          balance: s.balance,
        })),
      };
    }
    case "supplier_insights":
      return handlePosAction(admin, caller, "suppliers.getInsights", {});
    case "supplier_aging":
      return handlePosAction(admin, caller, "suppliers.getAging", {});
    case "purchases_summary":
      return handlePosAction(admin, caller, "purchases.getDashboard", {});
    case "expenses_summary":
      return handlePosAction(admin, caller, "expenses.getSummary", {});
    case "reports_summary": {
      const [sales, profit, low] = await Promise.all([
        handlePosAction(admin, caller, "sales.getSummary", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "reports.getProfitSummary", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "reports.getLowStockReport", {}).catch(() => null),
      ]);
      return { success: true, sales, profit, low_stock_report: truncateJson(low, 4000) };
    }
    case "branches_list":
      return handlePosAction(admin, caller, "branches.getAll", {});
    case "notifications_list":
      return handlePosAction(admin, caller, "notifications.list", {}).catch(() => ({ items: [], unread: 0 }));

    case "company_overview": {
      const company = await handlePosAction(admin, caller, "companies.getById", {});
      const [sales, inventory, users, branches] = await Promise.all([
        handlePosAction(admin, caller, "sales.getSummary", {}).catch(() => null),
        handlePosAction(admin, caller, "inventory.getStats", {}).catch(() => null),
        listCompanyUsers(admin, caller).catch(() => []),
        handlePosAction(admin, caller, "branches.getAll", {}).catch(() => []),
      ]);
      return {
        success: true,
        company: redactSecrets({
          id: company?.id,
          name: company?.name,
          code: company?.code,
          status: company?.status,
          currency: company?.currency,
          plan_code: company?.plan_code,
          trial_ends_at: company?.trial_ends_at,
        }),
        sales,
        inventory,
        user_count: users.length,
        branch_count: Array.isArray(branches) ? branches.length : 0,
      };
    }
    case "users_list":
      return { success: true, users: await listCompanyUsers(admin, caller) };
    case "audit_logs": {
      const rows = await handlePosAction(admin, caller, "audit.getAll", {
        limit,
        module: args.module || undefined,
      });
      return { success: true, items: Array.isArray(rows) ? rows.slice(0, limit) : rows };
    }
    case "login_history": {
      const [authLogs, users] = await Promise.all([
        handlePosAction(admin, caller, "audit.getLoginHistory", {}).catch(() => []),
        listCompanyUsers(admin, caller),
      ]);
      return {
        success: true,
        audit_auth: Array.isArray(authLogs) ? authLogs.slice(0, limit) : authLogs,
        user_last_logins: users
          .map((u) => ({
            name: u.name,
            email: u.email,
            role: u.role,
            last_login_at: u.last_login_at,
            last_activity_at: u.last_activity_at,
            account_status: u.account_status,
          }))
          .sort((a, b) => String(b.last_login_at || "").localeCompare(String(a.last_login_at || "")))
          .slice(0, limit),
      };
    }
    case "security_signals": {
      const users = await listCompanyUsers(admin, caller);
      const locked = users.filter(
        (u) =>
          u.account_status === "locked" ||
          (u.locked_until && new Date(u.locked_until).getTime() > Date.now())
      );
      const suspended = users.filter((u) => u.account_status === "suspended" || !u.active);
      const highFails = users.filter((u) => Number(u.failed_login_count || 0) >= 3);
      const forceLogout = users.filter((u) => !!u.force_logout_at);
      const authLogs = await handlePosAction(admin, caller, "audit.getLoginHistory", {}).catch(() => []);
      const failed = (Array.isArray(authLogs) ? authLogs : []).filter((row) =>
        /fail|denied|lock/i.test(String(row.action || "") + String(row.details || ""))
      );
      return {
        success: true,
        locked_accounts: locked,
        suspended_or_inactive: suspended,
        elevated_failed_logins: highFails,
        force_logout_flags: forceLogout,
        recent_failed_auth_events: failed.slice(0, 20),
      };
    }
    case "active_sessions_signal": {
      const users = await listCompanyUsers(admin, caller);
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recent = users
        .filter((u) => u.last_activity_at || u.last_login_at)
        .map((u) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          last_activity_at: u.last_activity_at || u.last_login_at,
          account_status: u.account_status,
        }))
        .filter((u) => new Date(u.last_activity_at).getTime() >= dayAgo)
        .sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at)));
      return {
        success: true,
        note: "Server-side session proxy from last_login/last_activity (device session store is client-local).",
        active_last_24h: recent,
      };
    }
    case "health_probe": {
      const probe = await handlePosAction(admin, caller, "health.probe", {});
      return {
        success: true,
        api: "ok",
        timestamp: new Date().toISOString(),
        checks: probe?.checks || probe,
      };
    }
    case "branch_comparison": {
      const [branches, salesRecent] = await Promise.all([
        handlePosAction(admin, caller, "branches.getAll", {}).catch(() => []),
        handlePosAction(admin, caller, "sales.getRecent", { limit: 200 }).catch(() => []),
      ]);
      const branchList = Array.isArray(branches) ? branches : [];
      const sales = Array.isArray(salesRecent) ? salesRecent : salesRecent?.items || [];
      const byBranch = {};
      for (const sale of sales) {
        const key = String(sale.branch_id ?? "unknown");
        if (!byBranch[key]) byBranch[key] = { branch_id: sale.branch_id, count: 0, total: 0 };
        byBranch[key].count += 1;
        byBranch[key].total += Number(sale.total || 0);
      }
      const comparison = branchList.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        active: b.active,
        sales_count: byBranch[String(b.id)]?.count || 0,
        sales_total: byBranch[String(b.id)]?.total || 0,
      }));
      return { success: true, comparison, sample_sales: sales.length };
    }
    case "financial_analysis": {
      const [sales, purchases, expenses, profit] = await Promise.all([
        handlePosAction(admin, caller, "sales.getSummary", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "purchases.getDashboard", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "expenses.getSummary", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "reports.getProfitLoss", {}).catch(() =>
          handlePosAction(admin, caller, "reports.getProfitSummary", {}).catch((e) => ({ error: e.message }))
        ),
      ]);
      const revenue = Number(sales?.today_total || 0) + Number(sales?.month_total || 0);
      const expenseTotal = Number(expenses?.total || expenses?.month_total || 0);
      return {
        success: true,
        sales,
        purchases,
        expenses,
        profit,
        cash_flow_signal: {
          note: "Indicative signal from available summaries — not a full accounting cash-flow statement.",
          revenue_proxy: revenue,
          expense_proxy: expenseTotal,
        },
      };
    }
    case "forecast_outlook": {
      const [summary, trend] = await Promise.all([
        handlePosAction(admin, caller, "sales.getSummary", {}).catch((e) => ({ error: e.message })),
        handlePosAction(admin, caller, "sales.getWeeklyTrend", {}).catch((e) => ({ error: e.message })),
      ]);
      const points = Array.isArray(trend) ? trend : [];
      const avg =
        points.length > 0
          ? points.reduce((sum, row) => sum + Number(row[1] ?? row.total ?? 0), 0) / points.length
          : Number(summary?.today_total || 0);
      return {
        success: true,
        summary,
        weekly_trend: trend,
        outlook: {
          note: "Simple average-based outlook — not a guarantee.",
          suggested_next_day_sales_proxy: Math.round(avg * 100) / 100,
          data_points: points.length,
        },
      };
    }
    case "payroll_summary": {
      return handlePosAction(admin, caller, "payroll.getDashboard", {}).catch((err) => ({
        success: false,
        error: err?.message || String(err),
      }));
    }
    case "payroll_anomalies": {
      const dash = await handlePosAction(admin, caller, "payroll.getDashboard", {}).catch(() => null);
      const runs = await handlePosAction(admin, caller, "payroll.listRuns", { limit: 12 }).catch(() => []);
      const list = Array.isArray(runs) ? runs : [];
      const anomalies = [];
      if (dash?.pending_leave > 5) {
        anomalies.push({ type: "leave_backlog", message: `${dash.pending_leave} leave requests pending approval` });
      }
      if (Number(dash?.overtime_cost_latest || 0) > 0 && Number(dash?.latest_run?.net_total || 0) > 0) {
        const ratio = Number(dash.overtime_cost_latest) / Math.max(1, Number(dash.latest_run.net_total));
        if (ratio > 0.15) {
          anomalies.push({
            type: "high_overtime",
            message: `Overtime cost is ${(ratio * 100).toFixed(1)}% of latest net payroll`,
            overtime_cost: dash.overtime_cost_latest,
          });
        }
      }
      for (const run of list) {
        if (run.status === "preview" || run.status === "draft") {
          anomalies.push({ type: "run_pending", message: `Payroll ${run.run_label} is ${run.status}`, run_id: run.id });
        }
      }
      if (dash?.active_employees === 0) {
        anomalies.push({ type: "no_employees", message: "No active employees on payroll" });
      }
      return { success: true, anomalies, dashboard: dash };
    }
    case "payroll_forecast": {
      const dash = await handlePosAction(admin, caller, "payroll.getDashboard", {}).catch(() => null);
      const trend = Array.isArray(dash?.salary_expense_trend) ? dash.salary_expense_trend : [];
      const nets = trend.map((t) => Number(t.net || 0)).filter((n) => n > 0);
      const avg = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : 0;
      return {
        success: true,
        note: "Simple average-based salary cost outlook — not a guarantee.",
        recent_runs: trend.slice(0, 6),
        suggested_next_month_net: Math.round(avg * 100) / 100,
        data_points: nets.length,
      };
    }
    case "employee_performance": {
      const [users, sales] = await Promise.all([
        listCompanyUsers(admin, caller),
        handlePosAction(admin, caller, "sales.getRecent", { limit: 200 }).catch(() => []),
      ]);
      const list = Array.isArray(sales) ? sales : sales?.items || [];
      const byUser = {};
      for (const sale of list) {
        const key = String(sale.user_id || "unknown");
        if (!byUser[key]) byUser[key] = { user_id: sale.user_id, count: 0, total: 0 };
        byUser[key].count += 1;
        byUser[key].total += Number(sale.total || 0);
      }
      const userMap = Object.fromEntries(users.map((u) => [String(u.id), u]));
      const performance = Object.values(byUser)
        .map((row) => ({
          ...row,
          name: userMap[String(row.user_id)]?.name || null,
          role: userMap[String(row.user_id)]?.role || null,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
      return { success: true, sample_sales: list.length, performance };
    }
    case "critical_alerts": {
      const [notifications, lowStock, security] = await Promise.all([
        handlePosAction(admin, caller, "notifications.list", {}).catch(() => ({ items: [] })),
        handlePosAction(admin, caller, "inventory.getLowStock", {}).catch(() => []),
        executeTool(admin, caller, "executive", "security_signals", {}),
      ]);
      const low = Array.isArray(lowStock) ? lowStock : lowStock?.items || [];
      return {
        success: true,
        notifications: notifications?.items?.slice?.(0, 20) || notifications,
        low_stock_count: low.length,
        low_stock_sample: low.slice(0, 10),
        security,
      };
    }
    case "smart_recommendations": {
      const [lowStock, sales, security, health] = await Promise.all([
        handlePosAction(admin, caller, "inventory.getLowStock", {}).catch(() => []),
        handlePosAction(admin, caller, "sales.getSummary", {}).catch(() => null),
        executeTool(admin, caller, "executive", "security_signals", {}),
        handlePosAction(admin, caller, "health.probe", {}).catch(() => null),
      ]);
      const low = Array.isArray(lowStock) ? lowStock : lowStock?.items || [];
      const recommendations = [];
      if (low.length > 0) {
        recommendations.push({
          priority: "high",
          area: "inventory",
          title: "Reorder low-stock items",
          detail: `${low.length} product(s) are at or below reorder level.`,
        });
      }
      if (security?.locked_accounts?.length) {
        recommendations.push({
          priority: "high",
          area: "security",
          title: "Review locked accounts",
          detail: `${security.locked_accounts.length} account(s) are locked.`,
        });
      }
      if (security?.elevated_failed_logins?.length) {
        recommendations.push({
          priority: "medium",
          area: "security",
          title: "Investigate failed login spikes",
          detail: `${security.elevated_failed_logins.length} user(s) have elevated failed login counts.`,
        });
      }
      if (sales && Number(sales.today_count || 0) === 0) {
        recommendations.push({
          priority: "low",
          area: "sales",
          title: "No sales recorded today yet",
          detail: "Confirm registers are open and staff are signed in if trading has started.",
        });
      }
      const checks = health?.checks || {};
      const failedTables = Object.entries(checks)
        .filter(([, v]) => v && v.ok === false)
        .map(([k]) => k);
      if (failedTables.length) {
        recommendations.push({
          priority: "high",
          area: "health",
          title: "Schema/health issues detected",
          detail: `Failed checks: ${failedTables.join(", ")}`,
        });
      }
      if (!recommendations.length) {
        recommendations.push({
          priority: "info",
          area: "ops",
          title: "No critical recommendations",
          detail: "Current inventory, security, and health signals look stable.",
        });
      }
      return { success: true, recommendations, sales };
    }
    default:
      return { success: false, error: `Unknown tool: ${name}`, code: "UNKNOWN_TOOL" };
  }
}

async function writeAiAudit(admin, caller, { mode, messagePreview, toolsUsed }) {
  if (mode !== "executive") return;
  const companyId = isPlatformOwner(caller.role) ? caller.company_id : caller.company_id;
  const payload = {
    user_id: caller.id || null,
    user_name: caller.name || caller.username || caller.email || null,
    action: "executive_ai.query",
    module: "nexora_executive_ai",
    details: JSON.stringify({
      mode,
      tools: toolsUsed || [],
      message_preview: sanitizeText(messagePreview || "", 240),
    }),
    company_id: companyId,
  };
  try {
    const { error } = await admin.from("audit_log").insert(payload);
    if (error) {
      delete payload.company_id;
      await admin.from("audit_log").insert(payload);
    }
  } catch (err) {
    console.warn("[nexora-ai] audit_log write failed", err?.message || err);
  }
}

async function callOpenAi({ apiKey, baseUrl, model, messages, tools, stream = false }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
      stream,
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      detail = await response.text();
    }
    const err = new Error(detail || `LLM request failed (${response.status})`);
    err.status = response.status;
    err.code = response.status === 401 ? "LLM_AUTH" : "LLM_ERROR";
    throw err;
  }
  if (stream) return response;
  return response.json();
}

function normalizeHistory(messages = []) {
  const cleaned = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = msg?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = sanitizeText(msg?.content || "", 8000);
    if (!content && !msg?.image_base64) continue;
    cleaned.push({ role, content, image_base64: msg.image_base64 || null });
  }
  return cleaned.slice(-16);
}

function buildUserContent(text, imageBase64) {
  const parts = [];
  if (text) parts.push({ type: "text", text });
  if (imageBase64) {
    const raw = String(imageBase64);
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    // Cap payload roughly (~4MB base64 guard)
    if (dataUrl.length > 5_500_000) {
      parts.push({
        type: "text",
        text: "[Screenshot omitted: image too large. Please attach a smaller PNG/JPEG under ~4MB.]",
      });
    } else {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.length ? parts : text || "";
}

/**
 * Run a full tool-calling chat turn.
 */
export async function runNexoraAiChat({
  caller,
  mode,
  messages,
  image_base64,
  stream = false,
}) {
  const llm = getLlmConfig();
  if (!llm.apiKey) {
    return {
      success: false,
      error:
        "Nexora AI is not configured. Set OPENAI_API_KEY (or NEXORA_AI_API_KEY) in the server environment.",
      code: "AI_NOT_CONFIGURED",
      status: 503,
    };
  }

  const admin = createAdminClient();
  const resolvedMode = mode === "executive" ? "executive" : "assistant";
  // Defense-in-depth: never run executive tools without owner-capable role.
  if (resolvedMode === "executive" && !canUseExecutiveAi(caller?.role)) {
    return {
      success: false,
      error: "Nexora Executive AI is available to Company Owners and Super Admins only.",
      code: "EXECUTIVE_FORBIDDEN",
      status: 403,
    };
  }
  const tools = resolvedMode === "executive" ? EXECUTIVE_TOOLS : ASSISTANT_TOOLS;
  const system = resolvedMode === "executive" ? executiveSystemPrompt(caller) : assistantSystemPrompt(caller);

  const history = normalizeHistory(messages);
  if (!history.length && !image_base64) {
    return { success: false, error: "messages are required.", code: "BAD_REQUEST", status: 400 };
  }

  // Attach image to last user message if provided at top-level
  if (image_base64 && history.length) {
    const last = history[history.length - 1];
    if (last.role === "user") last.image_base64 = image_base64;
  } else if (image_base64) {
    history.push({ role: "user", content: "Please analyze this screenshot from Nexora POS Pro.", image_base64 });
  }

  const openaiMessages = [
    { role: "system", content: system },
    ...history.map((m) => ({
      role: m.role,
      content: buildUserContent(m.content, m.image_base64),
    })),
  ];

  const toolsUsed = [];
  let rounds = 0;
  const maxRounds = 5;

  while (rounds < maxRounds) {
    rounds += 1;
    const completion = await callOpenAi({
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
      messages: openaiMessages,
      tools,
      stream: false,
    });

    const choice = completion?.choices?.[0]?.message;
    if (!choice) {
      return { success: false, error: "Empty LLM response.", code: "LLM_EMPTY", status: 502 };
    }

    const toolCalls = choice.tool_calls || [];
    if (!toolCalls.length) {
      const answer = String(choice.content || "").trim();
      await writeAiAudit(admin, caller, {
        mode: resolvedMode,
        messagePreview: history[history.length - 1]?.content,
        toolsUsed,
      });
      return {
        success: true,
        mode: resolvedMode,
        brand: resolvedMode === "executive" ? "Nexora Executive AI" : "Nexora Assistant AI",
        reply: answer || "I could not produce an answer from the available data.",
        tools_used: toolsUsed,
        model: llm.model,
      };
    }

    openaiMessages.push({
      role: "assistant",
      content: choice.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call?.function?.name;
      let parsed = {};
      try {
        parsed = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsed = {};
      }
      let result;
      if (resolvedMode !== "executive" && EXECUTIVE_ONLY_TOOL_NAMES.includes(toolName)) {
        result = denyExecutiveTool(toolName);
      } else {
        try {
          result = await executeTool(admin, caller, resolvedMode, toolName, parsed);
        } catch (err) {
          result = { success: false, error: err?.message || "Tool failed.", code: "TOOL_ERROR" };
        }
      }
      toolsUsed.push(toolName);
      openaiMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(truncateJson(result)),
      });
    }
  }

  await writeAiAudit(admin, caller, {
    mode: resolvedMode,
    messagePreview: history[history.length - 1]?.content,
    toolsUsed,
  });

  return {
    success: true,
    mode: resolvedMode,
    brand: resolvedMode === "executive" ? "Nexora Executive AI" : "Nexora Assistant AI",
    reply:
      "I gathered data with tools but reached the reasoning limit. Please ask a more specific question, or try again.",
    tools_used: toolsUsed,
    model: llm.model,
  };
}

export function getAiMeta(caller) {
  const role = normalizeRole(caller?.role);
  const ownerCapable = canUseExecutiveAi(role);
  const llm = getLlmConfig();
  return {
    success: true,
    configured: Boolean(llm.apiKey),
    model: llm.apiKey ? llm.model : null,
    role,
    owner_capable: ownerCapable,
    default_mode: ownerCapable ? "executive" : "assistant",
    brands: {
      assistant: "Nexora Assistant AI",
      public: "Nexora Assistant AI",
      executive: "Nexora Executive AI",
    },
    language: {
      auto_detect: true,
      reply_in_user_language: true,
    },
    executive_sections: ownerCapable
      ? [
          "Executive Dashboard",
          "Business Intelligence",
          "Inventory",
          "Suppliers",
          "Customers",
          "Finance",
          "Reports",
          "Audit Logs",
          "User Monitoring",
          "Security",
          "Forecast",
          "Settings",
        ]
      : [],
    assistant_actions: ownerCapable
      ? []
      : [
          "Search Product",
          "Check Stock",
          "Today's Orders",
          "Track Invoice",
          "Payment Help",
          "Barcode Search",
        ],
  };
}
