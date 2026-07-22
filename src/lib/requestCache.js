/**
 * In-memory TTL cache + in-flight request dedupe for frequent POS lookups.
 * Safe for browser session only; cleared on logout via clearRequestCache().
 */

const DEFAULT_TTL_MS = 60_000;

/** @type {Map<string, { expires: number, value: unknown }>} */
const cache = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

export function cacheKey(parts) {
  return (Array.isArray(parts) ? parts : [parts])
    .map((p) => (p == null ? "" : typeof p === "object" ? JSON.stringify(p) : String(p)))
    .join("|");
}

export function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, expires: Date.now() + Math.max(0, ttlMs) });
  return value;
}

export function invalidateCache(prefixOrKey) {
  if (!prefixOrKey) {
    cache.clear();
    return;
  }
  const prefix = String(prefixOrKey);
  for (const key of cache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}|`) || key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export function clearRequestCache() {
  cache.clear();
  inflight.clear();
}

/**
 * Deduplicate concurrent identical work and optionally cache the result.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number, bypassCache?: boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function cachedRequest(key, fn, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (!opts.bypassCache) {
    const existing = getCached(key);
    if (existing !== undefined) return existing;
  }
  if (inflight.has(key)) return inflight.get(key);

  const promise = Promise.resolve()
    .then(fn)
    .then((value) => {
      if (ttlMs > 0) setCached(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Simple debounce for search inputs. */
export function debounce(fn, waitMs = 250) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/**
 * React-friendly debounced value helper (use with useEffect + useState).
 * Returns a function that schedules setState.
 */
export function createDebouncedSetter(setValue, waitMs = 250) {
  return debounce((next) => setValue(next), waitMs);
}

export const LOOKUP_TTL_MS = 90_000;
export const LIST_TTL_MS = 20_000;
export const DEFAULT_PAGE_SIZE = 40;
