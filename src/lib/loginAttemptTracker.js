/**
 * Login lockout tracker with localStorage persistence across reloads.
 * 5 failures within 15 minutes → 15 minute lock.
 */

const STORAGE_KEY = "nexora-login-attempts-v1";
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function loadStore() {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed || {}));
  } catch {
    return new Map();
  }
}

function saveStore(map) {
  if (typeof window === "undefined") return;
  try {
    const obj = Object.fromEntries(map.entries());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* ignore quota */
  }
}

const attempts = loadStore();

export function getLockoutStatus(companyKey, identifier) {
  const key = `${String(companyKey || "").trim().toLowerCase()}:${String(identifier || "").trim().toLowerCase()}`;
  const now = Date.now();
  const attempt = attempts.get(key) || { failures: [], locked_until: 0 };
  if (attempt.locked_until > now) {
    const seconds = Math.ceil((attempt.locked_until - now) / 1000);
    return {
      locked: true,
      key,
      seconds,
      error: `Account locked after repeated failed logins. Try again in ${seconds} seconds.`,
      code: "LOCKED",
    };
  }
  return { locked: false, key };
}

export function recordLoginFailure(key) {
  const now = Date.now();
  const attempt = attempts.get(key) || { failures: [], locked_until: 0 };
  attempt.failures = (attempt.failures || []).filter((time) => now - time < WINDOW_MS);
  attempt.failures.push(now);
  if (attempt.failures.length >= MAX_FAILURES) {
    attempt.locked_until = now + LOCK_MS;
    attempt.failures = [];
  }
  attempts.set(key, attempt);
  saveStore(attempts);
  if (attempt.locked_until > now) {
    const seconds = Math.ceil((attempt.locked_until - now) / 1000);
    return {
      locked: true,
      seconds,
      error: `Account locked after repeated failed logins. Try again in ${seconds} seconds.`,
      code: "LOCKED",
    };
  }
  return { locked: false };
}

export function clearLoginAttempts(key) {
  attempts.delete(key);
  saveStore(attempts);
}

export function __resetLoginAttemptTrackerForTests() {
  attempts.clear();
  saveStore(attempts);
}

export function __loginAttemptTrackerSize() {
  return attempts.size;
}
