/**
 * Pre-launch verification: media files, public routes in App, dist assets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;

function pass(msg) {
  console.log(`  PASS  ${msg}`);
}
function fail(msg) {
  fails += 1;
  console.log(`  FAIL  ${msg}`);
}

console.log("Launch verification\n");

const cfg = fs.readFileSync(path.join(root, "site.config.ts"), "utf8");
const srcs = [...cfg.matchAll(/src:\s*"([^"]+)"/g)].map((m) => m[1]);
for (const src of srcs) {
  const file = path.join(root, "public", src.replace(/^\//, ""));
  if (fs.existsSync(file) && fs.statSync(file).size > 5000) pass(`image ${src}`);
  else fail(`missing/small image ${src}`);
}

const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const publicRoutes = [
  "/", "/features", "/pricing", "/contact", "/faq", "/help", "/support",
  "/login", "/signup", "/forgot-password",
];
for (const route of publicRoutes) {
  const needle = route === "/" ? 'path="/"' : `path="${route}"`;
  if (app.includes(needle)) pass(`route ${route}`);
  else fail(`route missing ${route}`);
}

const css = fs.readFileSync(path.join(root, "src", "styles", "public.css"), "utf8");
for (const bp of ["1024px", "800px", "520px", "900px"]) {
  if (css.includes(bp)) pass(`responsive breakpoint ${bp}`);
  else fail(`breakpoint ${bp}`);
}

const distMedia = path.join(root, "dist", "media");
if (fs.existsSync(distMedia)) {
  const count = fs.readdirSync(distMedia, { recursive: true }).filter((n) => String(n).endsWith(".jpg")).length;
  if (count >= 16) pass(`dist/media jpgs (${count})`);
  else fail(`dist/media jpg count ${count}`);
} else {
  fail("dist/media missing — run build first");
}

const indexHtml = path.join(root, "dist", "index.html");
if (fs.existsSync(indexHtml)) pass("dist/index.html");
else fail("dist/index.html missing");

console.log(fails ? `\nRESULT: FAIL (${fails})` : "\nRESULT: PASS");
process.exit(fails ? 1 : 0);
