import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "dist", "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("FATAL: dist/index.html missing. Run vite build first.");
  process.exit(1);
}

const html = fs.readFileSync(indexPath, "utf8");
if (html.includes("/src/main.jsx")) {
  console.error("FATAL: dist/index.html still points at /src/main.jsx (dev entry).");
  process.exit(1);
}
if (!html.includes("./assets/") && !/assets\/index-/.test(html)) {
  console.error("FATAL: dist/index.html has no production JS assets.");
  process.exit(1);
}

console.log("dist/index.html OK for Electron packaging");
console.log((html.match(/<script[^>]+src="[^"]+"/) || [])[0] || "");
