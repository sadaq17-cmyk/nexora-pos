import { createServer } from "vite";

async function main() {
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const mod = await server.ssrLoadModule("/src/lib/mockApi.js");
    const api = mod.mockApi;
    const results = [];
    const assert = (name, condition, detail = "") => {
      results.push({ name, ok: !!condition, detail });
      if (!condition) throw new Error(`${name}: ${detail || "assertion failed"}`);
    };

    const plans = await api.platformPublic.getPlans();
    assert("safe plans returned", Array.isArray(plans) && plans.length >= 4);
    assert("plans are public-safe", plans.every((plan) => !("password_hash" in plan) && plan.code && plan.name));

    const email = `owner_${Date.now()}@example.test`;
    const signup = await api.publicAuth.signupCompany({
      company_name: `Smoke Co ${Date.now()}`,
      full_name: "Smoke Owner",
      email,
      phone: "+254700000001",
      password: "SmokePass123!",
      plan_code: "free_trial",
    });
    assert("signup succeeds", signup.success, signup.error);
    assert("signup creates company owner", signup.company_code && signup.email === email);
    assert("signup returns verification token in DEV", !!signup.verification_token);

    const verify1 = await api.publicAuth.verifyEmail(signup.verification_token);
    assert("first verify succeeds", verify1.success, verify1.error);
    const verify2 = await api.publicAuth.verifyEmail(signup.verification_token);
    assert("second verify rejected", !verify2.success && verify2.code === "USED", verify2.error);

    const companyLogin = await api.auth.loginByEmail(email, "SmokePass123!", true);
    assert("verified owner can login", companyLogin.success, companyLogin.error);
    assert("login user is company owner", companyLogin.user?.role === "owner" && companyLogin.user?.company_id != null);

    const deniedOverview = await api.owner.getOverview();
    assert("company owner denied platform overview", !deniedOverview.success && deniedOverview.code === "FORBIDDEN", deniedOverview.error);
    const deniedConsole = await api.owner.getPlatformConsole();
    assert("company owner denied platform console", !deniedConsole.success && deniedConsole.code === "FORBIDDEN", deniedConsole.error);

    await api.auth.logout?.();
    const platformLogin = await api.auth.login("platform", "platformowner", "OwnerAdmin123!");
    assert("platform owner login works", platformLogin.success, platformLogin.error);
    assert("platform owner company_id null", platformLogin.user?.role === "platform_owner" && platformLogin.user?.company_id == null);
    const overview = await api.owner.getOverview();
    assert("platform owner can load overview", overview.success, overview.error);

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2));
  process.exit(1);
});
