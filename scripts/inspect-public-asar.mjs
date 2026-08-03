import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Asar = require("@electron/asar");

const asarPath = process.argv[2] || path.resolve(
  "release/audit/public-install/resources/app.asar"
);

if (!fs.existsSync(asarPath)) {
  console.error("MISSING", asarPath);
  process.exit(1);
}

const list = Asar.listPackage(asarPath).map((f) => f.replace(/\\/g, "/"));
console.log("asar", asarPath);
console.log("files", list.length);
console.log(
  "has dist/index.html",
  list.some((f) => f === "dist/index.html" || f.endsWith("/dist/index.html"))
);
console.log(
  "key files",
  list.filter((f) => /index\.html|main\.cjs|package\.json|preload/.test(f)).slice(0, 30)
);

const main = Asar.extractFile(asarPath, "electron/main.cjs").toString("utf8");
console.log("\n--- main.cjs interesting lines ---");
main.split(/\n/).forEach((line, i) => {
  if (/loadURL|loadFile|nexorapos|login|HashRouter|file:|https?:|getLogin|PRODUCTION|WEB_ORIGIN/i.test(line)) {
    console.log(`${i + 1}: ${line.trim().slice(0, 200)}`);
  }
});

const pkg = JSON.parse(Asar.extractFile(asarPath, "package.json").toString("utf8"));
console.log("\npkg", { name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main });

try {
  const html = Asar.extractFile(asarPath, "dist/index.html").toString("utf8");
  console.log("\nindex.html checks", {
    forceHash: html.includes("__NEXORA_FORCE_HASH__"),
    desktopBuild: html.includes("__NEXORA_DESKTOP_BUILD__"),
    devEntry: html.includes("/src/main.jsx"),
    relativeAssets: html.includes("./assets/"),
    script: (html.match(/src="[^"]+"/) || [])[0] || null,
  });
} catch (err) {
  console.log("\nno dist/index.html in asar:", err.message);
}
