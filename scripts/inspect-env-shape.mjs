import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.production.local");
if (!existsSync(file)) {
  console.log("missing");
  process.exit(1);
}
const raw = readFileSync(file);
console.log("bom=", raw[0] === 0xff && raw[1] === 0xfe);
console.log("bytes=", raw.length);
const text = raw.toString("utf8");
for (const key of ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_ANON_KEY"]) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) {
    console.log(key, "MISSING");
    continue;
  }
  let v = line.slice(key.length + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  // unescape common vercel encodings
  v = v.replace(/\\n/g, "\n").replace(/\\r/g, "").trim();
  console.log(
    JSON.stringify({
      key,
      len: v.length,
      http: /^https?:\/\//i.test(v),
      jwt: v.startsWith("eyJ"),
      codes: [...v.slice(0, 4)].map((c) => c.charCodeAt(0)),
    })
  );
}
