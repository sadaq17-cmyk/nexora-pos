/**
 * Post-deploy live validation against www.nexorapospro.com
 */
const origin = "https://www.nexorapospro.com";
const routes = ["/", "/login", "/dashboard", "/pos", "/reports", "/inventory", "/purchases", "/settings", "/invoice/test"];
const headersNeeded = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

async function get(url, opts = {}) {
  const r = await fetch(url, { ...opts, redirect: "follow" });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, len: text.length };
}

async function postJson(url, body, extraHeaders = {}) {
  const r = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, len: text.length };
}

const routeResults = [];
for (const path of routes) {
  const r = await get(origin + path);
  const sec = headersNeeded.filter((h) => r.headers.get(h)).length;
  routeResults.push({ path, status: r.status, secHeaders: sec, ok: r.status === 200 });
}

const home = await get(`${origin}/`);
const assets = [...home.text.matchAll(/\/assets\/[^"'\\\s]+/g)].map((m) => m[0]);
const uniq = [...new Set(assets)];
const cssPath = uniq.find((a) => a.endsWith(".css"));
const jsPath = uniq.find((a) => /index-.*\.js$/.test(a));

let cssFlags = {};
if (cssPath) {
  const c = await get(origin + cssPath);
  cssFlags = {
    css: cssPath,
    skipLink: /nx-skip-link/.test(c.text),
    contentMax: /--content-max|1400px/.test(c.text),
  };
}

let jsFlags = {};
if (jsPath) {
  const j = await get(origin + jsPath);
  jsFlags = {
    js: jsPath,
    bytes: j.len,
    purifyRef: /purify|DOMPurify|dompurify/i.test(j.text),
    lazyHint: /lazy|Suspense/.test(j.text),
    apiPos: j.text.includes("/api/pos"),
    mockDb: j.text.includes("nexora_pos_web_db"),
    demoPassword: j.text.includes("Honest@2026"),
  };
}

// Validate real hashed assets referenced by the HTML (not stale hardcoded names).
const chunkChecks = {};
for (const asset of uniq) {
  const name = asset.replace(/^\/assets\//, "");
  const r = await get(origin + asset);
  const head = r.text.trimStart().slice(0, 200).toLowerCase();
  const isHtml = head.startsWith("<!doctype") || head.startsWith("<html");
  chunkChecks[name] = { status: r.status, isAsset: r.status === 200 && !isHtml, len: r.len };
}

const invoice = await get(`${origin}/api/invoice-public?id=NX-TEST`, {
  headers: { Origin: origin },
});
const invoiceIsVercel404 = /The page could not be found|NOT_FOUND cpt/i.test(invoice.text);
let invoiceJson = null;
try {
  invoiceJson = JSON.parse(invoice.text);
} catch {
  /* ignore */
}

const health = await postJson(`${origin}/api/pos`, { action: "health.probe" }, { Origin: origin });
let healthJson = null;
try {
  healthJson = JSON.parse(health.text);
} catch {
  /* ignore */
}
const healthChecks = healthJson?.checks || {};
const healthFailed = Object.entries(healthChecks)
  .filter(([, v]) => v && v.ok === false)
  .map(([k]) => k);

const out = {
  routes: routeResults,
  assets: uniq,
  cssFlags,
  jsFlags,
  chunkChecks,
  invoice: {
    status: invoice.status,
    vercelHtml404: invoiceIsVercel404,
    json: invoiceJson,
    head: invoice.text.slice(0, 180).replace(/\s+/g, " "),
  },
  health: {
    status: health.status,
    failed: healthFailed,
    posCreateSale: healthChecks.pos_create_sale || null,
    companies: healthChecks.companies || null,
    invoice_verifications: healthChecks.invoice_verifications || null,
  },
};

console.log(JSON.stringify(out, null, 2));

const routesOk = routeResults.every((r) => r.ok);
const deployMarkersOk = Boolean(cssFlags.skipLink && cssFlags.contentMax && jsFlags.js);
const chunksOk = Object.values(chunkChecks).every((c) => c.isAsset);
const invoiceOk = !invoiceIsVercel404 && (invoiceJson?.code === "NOT_FOUND" || invoiceJson?.success === true || invoice.status === 503);
const bundleSafe = Boolean(jsFlags.apiPos) && !jsFlags.mockDb && !jsFlags.demoPassword;
const healthOk = health.status === 200 && healthJson?.success === true && healthFailed.length === 0;

console.log("\nSUMMARY");
console.log(`routes_ok=${routesOk}`);
console.log(`deploy_markers_ok=${deployMarkersOk}`);
console.log(`chunks_ok=${chunksOk}`);
console.log(`invoice_api_ok=${invoiceOk} (vercelHtml404=${invoiceIsVercel404})`);
console.log(`bundle_safe=${bundleSafe}`);
console.log(`health_ok=${healthOk} failed=${healthFailed.join(",") || "none"}`);

if (!routesOk || !deployMarkersOk || !chunksOk || !invoiceOk || !bundleSafe || !healthOk) {
  process.exitCode = 1;
}
