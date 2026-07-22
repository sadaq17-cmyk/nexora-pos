import { useEffect, useRef } from "react";

/**
 * USB / keyboard-wedge barcode scanner support.
 * Scanners type characters rapidly then send Enter.
 * Ignores input while typing in editable fields unless allowInInputs is true.
 */
export function useBarcodeScanner(onScan, { enabled = true, minLength = 4, maxGapMs = 50, allowInInputs = false } = {}) {
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const callbackRef = useRef(onScan);
  callbackRef.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    const reset = () => {
      bufferRef.current = "";
      lastKeyAtRef.current = 0;
    };

    const isEditableTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (!allowInInputs && isEditableTarget(event.target)) return;

      const now = Date.now();
      if (now - lastKeyAtRef.current > maxGapMs) {
        bufferRef.current = "";
      }
      lastKeyAtRef.current = now;

      if (event.key === "Enter") {
        const code = bufferRef.current.trim();
        reset();
        if (code.length >= minLength) {
          event.preventDefault();
          callbackRef.current?.(code);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, minLength, maxGapMs, allowInInputs]);
}
