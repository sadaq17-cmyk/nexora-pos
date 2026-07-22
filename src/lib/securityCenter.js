/**
 * Client-side Login & Security center: active sessions + security activity.
 * Complements Supabase Auth (MFA / signOut scopes). Sessions are device fingerprints
 * tracked in localStorage for the signed-in owner.
 */

const SESSIONS_KEY = "nexora-security-sessions-v1";
const ACTIVITY_KEY = "nexora-security-activity-v1";
const CURRENT_SESSION_KEY = "nexora-security-current-session";

function safeParse(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function loadMap(key) {
  if (typeof window === "undefined") return {};
  return safeParse(window.localStorage.getItem(key), {}) || {};
}

function saveMap(key, map) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseUserAgent(ua = "") {
  const source = String(ua || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "");
  let browser = "Unknown browser";
  if (/Edg\//i.test(source)) browser = "Microsoft Edge";
  else if (/Chrome\//i.test(source) && !/Chromium/i.test(source)) browser = "Chrome";
  else if (/Safari\//i.test(source) && !/Chrome/i.test(source)) browser = "Safari";
  else if (/Firefox\//i.test(source)) browser = "Firefox";
  else if (/OPR\//i.test(source) || /Opera/i.test(source)) browser = "Opera";

  let os = "Unknown OS";
  if (/Windows NT 10/i.test(source)) os = "Windows 10/11";
  else if (/Windows/i.test(source)) os = "Windows";
  else if (/Mac OS X/i.test(source)) os = "macOS";
  else if (/Android/i.test(source)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(source)) os = "iOS";
  else if (/Linux/i.test(source)) os = "Linux";

  let device = "Desktop";
  if (/Mobi|Android.*Mobile|iPhone/i.test(source)) device = "Mobile";
  else if (/iPad|Tablet|Android(?!.*Mobile)/i.test(source)) device = "Tablet";

  return { browser, os, device, userAgent: source.slice(0, 240) };
}

export function resolveLocationLabel() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone || "Unknown";
  } catch {
    return "Unknown";
  }
}

export function getCurrentSessionId() {
  if (typeof window === "undefined") return null;
  try {
    let id = window.sessionStorage.getItem(CURRENT_SESSION_KEY);
    if (!id) {
      id = makeId();
      window.sessionStorage.setItem(CURRENT_SESSION_KEY, id);
    }
    return id;
  } catch {
    return makeId();
  }
}

export function listSessions(userId) {
  if (!userId) return [];
  const map = loadMap(SESSIONS_KEY);
  const rows = Array.isArray(map[userId]) ? map[userId] : [];
  const currentId = getCurrentSessionId();
  return rows
    .map((row) => ({ ...row, current: row.id === currentId }))
    .sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0));
}

export function registerSession(userId, { email } = {}) {
  if (!userId || typeof window === "undefined") return null;
  const id = getCurrentSessionId();
  const now = new Date().toISOString();
  const parsed = parseUserAgent();
  const map = loadMap(SESSIONS_KEY);
  const rows = Array.isArray(map[userId]) ? map[userId] : [];
  const existing = rows.find((row) => row.id === id);
  const next = {
    id,
    userId: String(userId),
    email: email || existing?.email || "",
    device: parsed.device,
    browser: parsed.browser,
    os: parsed.os,
    location: resolveLocationLabel(),
    userAgent: parsed.userAgent,
    createdAt: existing?.createdAt || now,
    lastActive: now,
  };
  const merged = [next, ...rows.filter((row) => row.id !== id)].slice(0, 20);
  map[userId] = merged;
  saveMap(SESSIONS_KEY, map);
  return next;
}

export function touchSession(userId) {
  if (!userId) return;
  const id = getCurrentSessionId();
  const map = loadMap(SESSIONS_KEY);
  const rows = Array.isArray(map[userId]) ? map[userId] : [];
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== id) return row;
    changed = true;
    return { ...row, lastActive: new Date().toISOString() };
  });
  if (!changed) {
    registerSession(userId);
    return;
  }
  map[userId] = next;
  saveMap(SESSIONS_KEY, map);
}

export function revokeSession(userId, sessionId) {
  if (!userId || !sessionId) return { success: false, current: false };
  const currentId = getCurrentSessionId();
  const map = loadMap(SESSIONS_KEY);
  const rows = Array.isArray(map[userId]) ? map[userId] : [];
  map[userId] = rows.filter((row) => row.id !== sessionId);
  saveMap(SESSIONS_KEY, map);
  return { success: true, current: sessionId === currentId };
}

export function revokeOtherSessions(userId) {
  if (!userId) return;
  const currentId = getCurrentSessionId();
  const map = loadMap(SESSIONS_KEY);
  const rows = Array.isArray(map[userId]) ? map[userId] : [];
  map[userId] = rows.filter((row) => row.id === currentId);
  saveMap(SESSIONS_KEY, map);
}

export function clearAllSessions(userId) {
  if (!userId) return;
  const map = loadMap(SESSIONS_KEY);
  delete map[userId];
  saveMap(SESSIONS_KEY, map);
  try {
    window.sessionStorage.removeItem(CURRENT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function recordSecurityActivity({ userId, email, type, detail = "", meta = {} } = {}) {
  if (typeof window === "undefined") return null;
  if (!userId && !email) return null;
  const key = String(userId || email || "").toLowerCase();
  const map = loadMap(ACTIVITY_KEY);
  const rows = Array.isArray(map[key]) ? map[key] : [];
  const entry = {
    id: makeId(),
    userId: userId ? String(userId) : "",
    email: email || "",
    type,
    detail: String(detail || "").slice(0, 240),
    meta,
    at: new Date().toISOString(),
    ...parseUserAgent(),
    location: resolveLocationLabel(),
  };
  map[key] = [entry, ...rows].slice(0, 100);
  // Mirror under both userId and email when available so failed logins (email-only) still show.
  if (userId && email) {
    const emailKey = String(email).toLowerCase();
    if (emailKey !== key) {
      const emailRows = Array.isArray(map[emailKey]) ? map[emailKey] : [];
      map[emailKey] = [entry, ...emailRows].slice(0, 100);
    }
  }
  saveMap(ACTIVITY_KEY, map);
  return entry;
}

export function listSecurityActivity(userId, email) {
  const map = loadMap(ACTIVITY_KEY);
  const byUser = userId ? (map[String(userId)] || []) : [];
  const byEmail = email ? (map[String(email).toLowerCase()] || []) : [];
  const seen = new Set();
  const merged = [];
  for (const row of [...byUser, ...byEmail]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);
}

export const ACTIVITY_LABELS = {
  login: "New login",
  login_failed: "Failed login",
  logout: "Signed out",
  logout_all: "Logged out all devices",
  session_revoked: "Session revoked",
  password_changed: "Password changed",
  email_changed: "Email change requested",
  mfa_enabled: "Two-factor authentication enabled",
  mfa_disabled: "Two-factor authentication disabled",
};

export function activityTone(type) {
  if (type === "login_failed") return "danger";
  if (type === "password_changed" || type === "email_changed") return "warning";
  if (type === "mfa_enabled" || type === "login") return "success";
  if (type === "logout_all" || type === "session_revoked" || type === "mfa_disabled") return "danger";
  return "primary";
}
