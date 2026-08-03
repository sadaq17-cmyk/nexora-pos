import { requireSupabase, supabaseConfigError, supabaseSession } from "./supabaseClient.js";
import { desktopApiHeaders, resolveApiUrl } from "./desktopRuntime.js";

const SESSION_TIMEOUT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 18_000;
/** Retries only for server/network blips — never for client Abort/timeout (avoids ~minute Pending). */
const MAX_RETRIES = 1;

function withTimeout(promise, ms, label = "Operation") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out.`);
      err.name = "TimeoutError";
      err.code = "TIMEOUT";
      reject(err);
    }, Math.max(500, ms));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function getAccessToken() {
  const client = requireSupabase();
  const { data, error } = await withTimeout(client.auth.getSession(), SESSION_TIMEOUT_MS, "Session lookup");
  if (error) throw error;
  if (data?.session?.access_token) return data.session.access_token;
  // Login without "remember me" persists on the sessionStorage-backed client.
  if (supabaseSession && supabaseSession !== client) {
    const alt = await withTimeout(
      supabaseSession.auth.getSession(),
      SESSION_TIMEOUT_MS,
      "Session lookup"
    );
    if (alt.data?.session?.access_token) return alt.data.session.access_token;
  }
  return null;
}

function isClientTimeout(err) {
  return err?.name === "AbortError" || err?.name === "TimeoutError" || err?.code === "TIMEOUT";
}

/** Statuses worth a single retry. Client aborts/timeouts must NOT retry. */
function isRetryableServerError(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(err) {
  if (isClientTimeout(err)) return false;
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Authenticated JSON fetch with timeout, AbortSignal support, and retry on transient errors.
 */
export async function authFetch(path, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries = MAX_RETRIES } = {}) {
  if (supabaseConfigError) {
    return { success: false, error: supabaseConfigError, code: "CONFIG" };
  }
  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    return { success: false, error: err?.message || "Not signed in.", code: "UNAUTHENTICATED" };
  }
  if (!token) {
    return { success: false, error: "Not signed in.", code: "UNAUTHENTICATED" };
  }

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        return { success: false, error: "Request cancelled.", code: "ABORTED" };
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
      const response = await fetch(resolveApiUrl(path), {
        method,
        headers: desktopApiHeaders({
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (attempt < retries && isRetryableServerError(response.status)) {
          attempt += 1;
          await sleep(300 * attempt);
          continue;
        }
        return {
          success: false,
          error: (data && data.error) || `Request failed (${response.status}).`,
          code: data?.code || (response.status === 408 ? "TIMEOUT" : undefined),
          status: response.status,
          retryable: isRetryableServerError(response.status),
        };
      }
      return data && typeof data === "object" ? data : { success: true, data };
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const aborted = isClientTimeout(err);
      if (signal?.aborted) {
        return { success: false, error: "Request cancelled.", code: "ABORTED" };
      }
      if (attempt < retries && isRetryableNetworkError(err)) {
        attempt += 1;
        await sleep(300 * attempt);
        continue;
      }
      return {
        success: false,
        error: aborted
          ? "Request timed out. Check your connection and try again."
          : err?.message || "Network error talking to auth admin API.",
        code: aborted ? "TIMEOUT" : "NETWORK",
        retryable: !aborted,
      };
    }
  }
  return { success: false, error: "Network error.", code: "NETWORK", retryable: true };
}

export async function resolveLoginEmail({ company_id, identifier, scope }) {
  try {
    const response = await fetch(resolveApiUrl("/api/resolve-login-email"), {
      method: "POST",
      headers: desktopApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ company_id, identifier, scope }),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      return {
        success: false,
        error: (data && data.error) || "Unable to resolve login.",
        code: data?.code,
      };
    }
    return { success: true, email: data?.email || null };
  } catch {
    return { success: false, error: "Unable to resolve login.", email: null };
  }
}

export async function bootstrapCompanyOwner(payload) {
  const data = await authFetch("/api/bootstrap-company-owner", {
    method: "POST",
    body: payload,
  });
  if (!data?.success) {
    return {
      success: false,
      error: data?.error || "Unable to provision company owner metadata.",
      code: data?.code,
    };
  }
  return data;
}

/**
 * Public signup — server creates the Auth user without Supabase Auth's
 * confirmation email (avoids "email rate limit exceeded"), then emails a
 * 6-digit OTP via Zoho/Resend. No session token required.
 */
export async function publicSignup(payload) {
  try {
    const response = await fetch(resolveApiUrl("/api/bootstrap-company-owner"), {
      method: "POST",
      headers: desktopApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...payload, action: "public_signup", public_signup: true }),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || data?.success === false) {
      return {
        success: false,
        error: data?.error || "Unable to create your account.",
        code: data?.code || (response.status === 429 ? "RATE_LIMITED" : undefined),
        retry_after: data?.retry_after,
      };
    }
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err?.message || "Unable to create your account.", code: "NETWORK" };
  }
}
