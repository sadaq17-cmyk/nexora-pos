import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asarPath = path.join(root, "release", "dist", "win-unpacked", "resources", "app.asar");
if (!fs.existsSync(asarPath)) {
  console.error("MISSING", asarPath);
  process.exit(1);
}

const require = createRequire(import.meta.url);
let Asar;
try {
  Asar = require("@electron/asar");
} catch {
  Asar = require("asar");
}

const list = Asar.listPackage(asarPath).map((f) => String(f).replace(/\\/g, "/").replace(/^\//, ""));
const need = ["dist/index.html", "electron/main.cjs", "package.json"];
let failed = false;
for (const n of need) {
  const ok = list.includes(n);
  console.log(n, ok ? "YES" : "NO");
  if (!ok) failed = true;
}

const html = Asar.extractFile(asarPath, "dist/index.html").toString("utf8");
const mainJs = Asar.extractFile(asarPath, "electron/main.cjs").toString("utf8");
console.log("dist script", (html.match(/src="(\.\/assets\/index-[^"]+\.js)"/) || [])[1] || "MISSING");
console.log("has /src/main.jsx", html.includes("/src/main.jsx"));
console.log("has __NEXORA_FORCE_HASH__", html.includes("__NEXORA_FORCE_HASH__"));
console.log("main entry url", (mainJs.match(/LOCAL_LOGIN_URL\s*=\s*`([^`]+)`/) || mainJs.match(/LOCAL_LOGIN_URL\s*=\s*['"]([^'"]+)['"]/) || [])[1] || "MISSING");
console.log("main uses HashRouter entry", /#\/login/.test(mainJs));
console.log("asar entries", list.length);

if (failed || html.includes("/src/main.jsx") || !html.includes("./assets/")) {
  process.exit(1);
}
console.log("asar-audit: PASS");
