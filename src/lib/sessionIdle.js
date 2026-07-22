/** Idle / absolute session timeout helpers (client-side UX gate). */

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];

const STARTED_KEY = "nexora-session-started-at";

export function markSessionStarted() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STARTED_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearSessionStarted() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STARTED_KEY);
  } catch {
    /* ignore */
  }
}

export function getSessionStartedAt() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STARTED_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function isAbsoluteSessionExpired(now = Date.now()) {
  const started = getSessionStartedAt();
  if (!started) return false;
  return now - started >= ABSOLUTE_TIMEOUT_MS;
}
