/**
 * Prepare dist/ for Electron file:// loading:
 * - require production index (not Vite dev entry)
 * - force relative asset base
 * - strip crossorigin (breaks ES modules on file://)
 * - inject HashRouter boot flag
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "dist", "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("FATAL: dist/index.html missing");
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("/src/main.jsx")) {
  console.error("FATAL: dist/index.html is still the Vite DEV entry");
  process.exit(1);
}
if (!html.includes("./assets/") && !/src="\.\/assets\//.test(html)) {
  console.error("FATAL: dist/index.html missing relative ./assets/ (Vite base must be ./)");
  process.exit(1);
}

html = html.replace(/\s+crossorigin(="[^"]*")?/g, "");

// Unconditional desktop boot flags BEFORE any module script (HashRouter + no 404).
const bootScript = `<script>
      window.__NEXORA_FORCE_HASH__ = true;
      window.__NEXORA_DESKTOP_BUILD__ = true;
    </script>`;
html = html.replace(/<script>\s*\(function \(\) \{[\s\S]*?__NEXORA_FORCE_HASH__[\s\S]*?<\/script>/, "");
if (html.includes("<head>")) {
  html = html.replace("<head>", `<head>\n    ${bootScript}`);
} else {
  html = html.replace("<div id=\"root\"></div>", `${bootScript}\n    <div id="root"></div>`);
}

fs.writeFileSync(indexPath, html, "utf8");
console.log("prepare-electron-dist: OK");
console.log((html.match(/<script[^>]+src="[^"]+"/) || [])[0] || "");
