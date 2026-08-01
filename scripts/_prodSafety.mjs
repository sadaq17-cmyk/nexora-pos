/**
 * Shared safety guard for every E2E / write-capable script in this folder.
 *
 * INCIDENT CONTEXT: scripts/final-e2e-verification.mjs (and others) defaulted
 * to running directly against the live production app + production Supabase
 * project. Every run created real rows ("E2E Branch …", "E2E Product …",
 * "E2E Customer …", "E2E Supplier …", test sales) in the ONE real tenant
 * ("Nexora POS Enterprise", company_id=1) — which is why the Branch dropdown,
 * product list, and customer/supplier lists filled up with test junk. That
 * data has been cleaned up; this guard exists so it can never happen again
 * silently.
 *
 * Usage (at the very top of any script that creates/updates/deletes data):
 *
 *   import { assertNotProduction } from "./_prodSafety.mjs";
 *   const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
 *   assertNotProduction(BASE, { scriptName: "my-script.mjs" });
 *
 * A run is only allowed against a production-looking host when the operator
 * explicitly sets ALLOW_PROD_E2E_WRITES=I_UNDERSTAND_THIS_WRITES_REAL_DATA.
 * There is deliberately no shorter/weaker opt-in — this must be a conscious,
 * typed decision every time, never a flag left on in an env file.
 */

const PRODUCTION_HOSTS = [
  "nexorapospro.com",
  "www.nexorapospro.com",
];

// The one live production Supabase project. Scripts that connect straight to
// Supabase with SUPABASE_SERVICE_ROLE_KEY (bypassing the app's /api layer
// entirely) are the most dangerous — this is the project ref from
// supabase/config.toml.
const PRODUCTION_SUPABASE_PROJECT_REF = "ohrpezhlnjwiilojdqbo";

const OVERRIDE_VALUE = "I_UNDERSTAND_THIS_WRITES_REAL_DATA";

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Throws (and exits the process) if `baseUrl` resolves to a known production
 * host, unless ALLOW_PROD_E2E_WRITES is explicitly set to the exact override
 * value. Safe to call for read-only scripts too — it costs nothing and
 * documents intent.
 */
export function assertNotProduction(baseUrl, { scriptName = "this script" } = {}) {
  const host = hostOf(baseUrl);
  const isProd = PRODUCTION_HOSTS.includes(host);
  if (!isProd) return;

  const override = String(process.env.ALLOW_PROD_E2E_WRITES || "").trim();
  if (override === OVERRIDE_VALUE) {
    console.warn(
      `[prod-safety] ${scriptName}: ALLOW_PROD_E2E_WRITES override present — ` +
        `running against PRODUCTION host "${host}". This will create/modify real data.`
    );
    return;
  }

  console.error(
    [
      "",
      `BLOCKED: ${scriptName} is configured to run against a PRODUCTION host ("${host}").`,
      "",
      "E2E / verification scripts must run against a staging environment, not production.",
      "Set E2E_BASE_URL (and, if applicable, E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY /",
      "E2E_SUPABASE_SERVICE_ROLE_KEY) to a separate staging project + deployment.",
      "",
      "If you have deliberately decided this specific run must hit production",
      `(e.g. a one-off read-only smoke test), set:`,
      `  ALLOW_PROD_E2E_WRITES=${OVERRIDE_VALUE}`,
      "and re-run. Do not leave that variable set in any shared env file.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

/**
 * Same as `assertNotProduction`, but for scripts that connect directly to
 * Supabase (service-role key) rather than going through the app's HTTP API.
 */
export function assertNotProductionSupabase(supabaseUrl, { scriptName = "this script" } = {}) {
  const host = hostOf(supabaseUrl);
  const isProd = host.startsWith(PRODUCTION_SUPABASE_PROJECT_REF);
  if (!isProd) return;

  const override = String(process.env.ALLOW_PROD_E2E_WRITES || "").trim();
  if (override === OVERRIDE_VALUE) {
    console.warn(
      `[prod-safety] ${scriptName}: ALLOW_PROD_E2E_WRITES override present — ` +
        `connecting directly to the PRODUCTION Supabase project ("${host}"). This will create/modify real data.`
    );
    return;
  }

  console.error(
    [
      "",
      `BLOCKED: ${scriptName} is configured to connect directly to the PRODUCTION Supabase project ("${host}").`,
      "",
      "Scripts that use SUPABASE_SERVICE_ROLE_KEY bypass every application-level",
      "safeguard, so this is the single most dangerous way to accidentally write",
      "test data into production. Point SUPABASE_URL / VITE_SUPABASE_URL /",
      "SUPABASE_SERVICE_ROLE_KEY at a separate staging Supabase project instead.",
      "",
      `If this specific run must target production, set:`,
      `  ALLOW_PROD_E2E_WRITES=${OVERRIDE_VALUE}`,
      "and re-run. Do not leave that variable set in any shared env file.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

export { PRODUCTION_HOSTS, PRODUCTION_SUPABASE_PROJECT_REF };
