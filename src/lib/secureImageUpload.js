/**
 * Client-side image upload validation for logos, avatars, and product images.
 * Does not replace server-side checks when a real upload API exists.
 */

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif)$/i;

const MAGIC = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], webp: true },
];

function bytesMatch(header, expected) {
  return expected.every((byte, index) => header[index] === byte);
}

async function sniffMime(file) {
  const buffer = await file.slice(0, 16).arrayBuffer();
  const header = new Uint8Array(buffer);
  for (const rule of MAGIC) {
    if (!bytesMatch(header, rule.bytes)) continue;
    if (rule.webp) {
      const tag = String.fromCharCode(...header.slice(8, 12));
      if (tag !== "WEBP") continue;
    }
    return rule.mime;
  }
  return null;
}

/**
 * @param {File} file
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<string>} data URL
 */
export async function readSecureImageDataUrl(file, options = {}) {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  if (!file) throw new Error("No file selected.");
  if (!ALLOWED_MIME.has(file.type) || !ALLOWED_EXT.test(file.name || "")) {
    throw new Error("Only JPEG, PNG, WebP, or GIF images are allowed.");
  }
  if (file.size > maxBytes) {
    throw new Error(`Image must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`);
  }
  const sniffed = await sniffMime(file);
  if (!sniffed || sniffed !== file.type) {
    throw new Error("File content does not match a supported image type.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}
