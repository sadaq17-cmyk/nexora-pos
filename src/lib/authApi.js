import { requireSupabase, supabaseConfigError, supabaseSession } from "./supabaseClient";

export async function getAccessToken() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data?.session?.access_token) return data.session.access_token;
  // Login without "remember me" persists on the sessionStorage-backed client.
  if (supabaseSession && supabaseSession !== client) {
    const alt = await supabaseSession.auth.getSession();
    if (alt.data?.session?.access_token) return alt.data.session.access_token;
  }
  return null;
}

const DEFAULT_TIMEOUT_MS = 28_000;
const MAX_RETRIES = 2;

function isTransientNetworkError(err, status) {
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    err?.name === "AbortError" ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  );
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
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
        if (attempt < retries && isTransientNetworkError(null, response.status)) {
          attempt += 1;
          await sleep(300 * attempt);
          continue;
        }
        return {
          success: false,
          error: (data && data.error) || `Request failed (${response.status}).`,
          code: data?.code || (response.status === 408 ? "TIMEOUT" : undefined),
          status: response.status,
          retryable: isTransientNetworkError(null, response.status),
        };
      }
      return data && typeof data === "object" ? data : { success: true, data };
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      const aborted = err?.name === "AbortError";
      if (signal?.aborted) {
        return { success: false, error: "Request cancelled.", code: "ABORTED" };
      }
      if (attempt < retries && isTransientNetworkError(err)) {
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
        retryable: true,
      };
    }
  }
  return { success: false, error: "Network error.", code: "NETWORK", retryable: true };
}

export async function resolveLoginEmail({ company_id, identifier, scope }) {
  try {
    const response = await fetch("/api/resolve-login-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
