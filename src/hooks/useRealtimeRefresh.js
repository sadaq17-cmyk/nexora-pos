import { useEffect, useRef } from "react";
import { subscribeSync } from "../lib/realtimeSync";

/**
 * Auto-refresh a page/component the instant a relevant ERP module changes
 * anywhere in the company (Supabase Realtime-backed — no polling, no manual
 * refresh required). Debounced so a burst of related mutations (e.g. a sale
 * that updates products + inventory + customers) triggers a single reload.
 *
 * @param {string[]} modules e.g. ["sales", "products", "inventory"]
 * @param {() => void} onEvent called after the debounce window elapses
 * @param {{ debounceMs?: number, enabled?: boolean }} [options]
 */
export function useRealtimeRefresh(modules, onEvent, options = {}) {
  const { debounceMs = 600, enabled = true } = options;
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const modulesKey = Array.isArray(modules) ? modules.join(",") : "";

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const unsubscribe = subscribeSync(modules, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cbRef.current?.();
      }, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
    // modulesKey mirrors `modules`; re-subscribing only when the set of
    // watched modules actually changes avoids resubscribe churn from callers
    // passing a fresh array literal on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesKey, debounceMs, enabled]);
}
