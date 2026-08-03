const paths = [
  "/",
  "/login",
  "/dashboard",
  "/receivables",
  "/payroll",
  "/payroll/self",
  "/platform",
  "/platform/companies",
  "/suppliers",
  "/purchases",
  "/help",
  "/support",
  "/approvals",
  "/user-status",
  "/reports/users",
  "/owner-management",
  "/subscription/renew",
  "/settings/login-security",
  "/features",
  "/faq",
  "/verify-email",
  "/invoice/test-id",
  "/this-should-404-xyz",
];

const base = "https://www.nexorapospro.com";

for (const p of paths) {
  const r = await fetch(base + p, {
    redirect: "manual",
    headers: { "User-Agent": "nexora-route-audit/1.0" },
  });
  const t = await r.text();
  const spa = /id=["']root["']|\/assets\//i.test(t);
  const title = (t.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  console.log(
    String(r.status).padStart(3),
    p.padEnd(28),
    spa ? "SPA" : "RAW",
    title.slice(0, 40),
    r.headers.get("location") || ""
  );
}
