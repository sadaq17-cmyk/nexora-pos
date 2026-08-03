import { createClient } from "@supabase/supabase-js";
import { prefersHashRouter } from "./desktopRuntime.js";

const viteEnv = (typeof import.meta !== "undefined" && import.meta.env) || {};
const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = viteEnv.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

let client = null;
let sessionClient = null;
let configError = null;

function buildClient(storage) {
  const desktop = prefersHashRouter();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // HashRouter + file:// must not treat URL hash as an auth callback.
      detectSessionInUrl: !desktop,
      storage,
      storageKey: "nexora-supabase-auth",
    },
  });
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  configError =
    "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment variables (see SUPABASE_SETUP.md).";
  if (import.meta.env.DEV) console.error(`[supabaseClient] ${configError}`);
} else {
  try {
    const persistentStorage = typeof window !== "undefined" ? window.localStorage : undefined;
    const ephemeralStorage = typeof window !== "undefined" ? window.sessionStorage : undefined;
    client = buildClient(persistentStorage);
    sessionClient = ephemeralStorage ? buildClient(ephemeralStorage) : client;
  } catch (err) {
    client = null;
    sessionClient = null;
    configError =
      err?.message
      || "Supabase client failed to initialize. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    if (import.meta.env.DEV) console.error(`[supabaseClient] ${configError}`);
  }
}

/**
 * Supabase Auth client (localStorage-backed session). Supabase's own session
 * persistence is expected infrastructure — NOT the removed app-owned
 * nexora_session mock key.
 */
export const supabase = client;
export const supabaseConfigError = configError;
export const supabaseSession = sessionClient;

export function requireSupabase() {
  if (!supabase) throw new Error(configError || "Supabase client is not configured.");
  return supabase;
}

export function getAuthClient(rememberMe = true) {
  if (!supabase) throw new Error(configError || "Supabase client is not configured.");
  if (rememberMe) return supabase;
  return supabaseSession || supabase;
}
