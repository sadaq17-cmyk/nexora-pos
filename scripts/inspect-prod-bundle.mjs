const html = await (await fetch("https://www.nexorapospro.com/login")).text();
const script = (html.match(/src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
if (!script) {
  console.log("No index bundle found");
  process.exit(1);
}
const t = await (await fetch("https://www.nexorapospro.com" + script)).text();
const hits = [
  "/receivables",
  "/payroll",
  "/platform",
  "/owner-management",
  "/approvals",
  "That page",
  "sales-history",
  "/payables",
  "/hr",
  "/warehouses",
  "/reports/users",
  "/user-status",
  "path:\"*\"",
  'path:"*"',
];
console.log("bundle", script, "len", t.length);
for (const h of hits) console.log(h, t.includes(h));

// Extract string literals that look like routes
const routes = [...t.matchAll(/["'](\/(?:dashboard|pos|products|platform|payroll|receivables|suppliers|purchases|owner-management|users|settings|subscription)[^"']*)["']/g)]
  .map((m) => m[1]);
console.log("sample route strings:", [...new Set(routes)].sort().slice(0, 60).join("\n"));
