import { authFetch } from "./authApi";

/**
 * Client for Nexora AI Dual Mode via /api/pos (ai.meta / ai.chat).
 * Modes: assistant (staff) | executive (Owner / Super Admin).
 * Hosted on the POS endpoint to stay within Vercel Hobby serverless limits.
 */
export async function fetchNexoraAiMeta(signal) {
  return authFetch("/api/pos", {
    method: "POST",
    body: { action: "ai.meta" },
    timeoutMs: 20000,
    signal,
    retries: 1,
  });
}

/**
 * @param {{ mode?: 'auto'|'assistant'|'public'|'executive', messages: Array<{role:string, content:string}>, image_base64?: string|null, signal?: AbortSignal }} opts
 */
export async function sendNexoraAiChat({ mode = "auto", messages, image_base64 = null, signal } = {}) {
  return authFetch("/api/pos", {
    method: "POST",
    body: {
      action: "ai.chat",
      params: {
        mode,
        messages,
        image_base64: image_base64 || undefined,
      },
    },
    timeoutMs: 90000,
    signal,
    retries: 0,
  });
}

export function fileToBase64DataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file"));
      return;
    }
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      reject(new Error("Please attach a PNG, JPEG, or WebP image."));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error("Image must be under 4MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}
