import { createAdminClient, ensureUserSynced, sanitizeText } from "./_authHelpers.js";
import { resolveMoneyProfile, catalogEntry } from "./_currency.js";
import { DEFAULT_TRIAL_DAYS, getPlanByCode } from "./_saasPlans.js";
import { notifyRegistrationSms } from "./_smsService.js";
import { requestOtp } from "./_otpService.js";
import { isValidEmailAddress } from "./_mailTransport.js";

function nextCompanyCode(name) {
  const base = String(name || "CO")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "CO";
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${suffix}`.slice(0, 16);
}

/**
 * Create tenant company + main branch + settings + trial subscription.
 * Invoked from bootstrap-company-owner (no separate serverless function — Hobby limit).
 */
export async function createCompanyWorkspace({ caller, body = {} }) {
  const companyName = sanitizeText(body.company_name, 120);
  const fullName = sanitizeText(body.full_name || body.name, 120);
  const email = sanitizeText(body.email || caller.email, 160).toLowerCase();
  const phone = sanitizeText(body.phone, 40);
  const supabaseUserId = sanitizeText(body.supabase_user_id || caller.id, 80);
  const planCode = sanitizeText(body.plan_code || "free_trial", 40).toLowerCase() || "free_trial";

  if (!companyName || !fullName || !email || !supabaseUserId) {
    return { status: 400, body: { success: false, error: "company_name, full_name, email, and supabase_user_id are required." } };
  }
  if (String(caller.id) !== String(supabaseUserId)) {
    return { status: 403, body: { success: false, error: "You can only create a company for your own account.", code: "FORBIDDEN" } };
  }

  const money = resolveMoneyProfile({
    country: body.country,
    country_code: body.country_code,
    currency: body.currency || body.currency_code,
    currency_code: body.currency_code || body.currency,
    currency_symbol: body.currency_symbol,
    locale: body.locale,
  });

  const admin = createAdminClient();

  const { data: existingName } = await admin
    .from("companies")
    .select("id")
    .ilike("name", companyName)
    .limit(1)
    .maybeSingle();
  if (existingName?.id) {
    return { status: 409, body: { success: false, error: "A company with that name already exists.", code: "COMPANY_EXISTS" } };
  }

  const plan = getPlanByCode(planCode) || getPlanByCode("free_trial");
  const trialDays = Math.max(1, Number(plan?.trial_days || DEFAULT_TRIAL_DAYS || 7));
  const trialEndsAt = new Date(Date.now() + trialDays * 86400000).toISOString();
  const companyCode = nextCompanyCode(companyName);
  const catalog = catalogEntry(money.currency_code);

  const companyInsert = {
    name: companyName,
    code: companyCode,
    business_type: sanitizeText(body.business_type || "Retail", 60) || "Retail",
    country: money.country,
    currency: money.currency_code,
    currency_symbol: money.currency_symbol,
    locale: money.locale,
    email,
    phone,
    address: sanitizeText(body.address, 240),
    status: "pending_verification",
    owner_user_id: supabaseUserId,
    plan_code: plan?.code || "free_trial",
    trial_ends_at: trialEndsAt,
  };

  let company = null;
  const { data: inserted, error: companyError } = await admin
    .from("companies")
    .insert(companyInsert)
    .select("id, code, currency, currency_symbol, locale, country")
    .single();

  if (companyError) {
    if (/currency_symbol|locale/i.test(companyError.message || "")) {
      delete companyInsert.currency_symbol;
      delete companyInsert.locale;
      const retry = await admin.from("companies").insert(companyInsert).select("id, code, currency, country").single();
      if (retry.error) {
        console.error("[signup-company] insert", retry.error);
        return { status: 502, body: { success: false, error: retry.error.message || "Unable to create company." } };
      }
      company = retry.data;
    } else {
      console.error("[signup-company] insert", companyError);
      return { status: 502, body: { success: false, error: companyError.message || "Unable to create company." } };
    }
  } else {
    company = inserted;
  }

  const companyId = Number(company?.id);
  const resolvedCode = company?.code || companyCode;

  const { data: branch, error: branchError } = await admin
    .from("branches")
    .insert({
      company_id: companyId,
      name: "Main Branch",
      code: "MAIN",
      active: true,
    })
    .select("id")
    .single();
  if (branchError) {
    console.error("[signup-company] branch", branchError);
    return { status: 502, body: { success: false, error: "Company created but branch setup failed." } };
  }

  const settingsPayload = {
    store_name: companyName,
    store_phone: phone,
    currency: money.currency_code,
    currency_code: money.currency_code,
    currency_symbol: money.currency_symbol,
    locale: money.locale,
    country: money.country,
    country_code: money.country_code,
    base_currency_code: money.currency_code,
    report_currency: money.currency_code,
    enable_multi_currency: "true",
    default_branch_id: String(branch.id),
  };

  await admin.from("company_settings").upsert(
    {
      company_id: companyId,
      settings: settingsPayload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  try {
    await admin.from("company_subscriptions").upsert(
      {
        company_id: companyId,
        plan_code: plan?.code || "free_trial",
        status: "trialing",
        trial_ends_at: trialEndsAt,
        expires_at: trialEndsAt,
        limits: plan?.limits || { users: 5, branches: 1 },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" }
    );
  } catch (subErr) {
    console.warn("[signup-company] subscription", subErr?.message || subErr);
  }

  try {
    await admin.from("company_currencies").upsert(
      {
        company_id: companyId,
        code: money.currency_code,
        name: catalog.name,
        symbol: money.currency_symbol,
        exchange_rate_to_base: 1,
        is_base: true,
        is_default: true,
        is_active: true,
      },
      { onConflict: "company_id,code" }
    );
  } catch {
    /* optional until 012 present */
  }

  const baseUsername = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").slice(0, 24).toLowerCase() || "owner";

  // Best-effort welcome SMS — awaited so Vercel doesn't freeze the function
  // before delivery completes, but failures never fail signup itself
  // (notifyRegistrationSms swallows its own errors).
  if (phone) {
    await notifyRegistrationSms({
      phone,
      ownerName: fullName,
      companyName,
      companyId,
      userId: supabaseUserId,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      company_id: companyId,
      branch_id: branch.id,
      company_code: resolvedCode,
      email,
      username: baseUsername,
      currency: money.currency_code,
      currency_code: money.currency_code,
      currency_symbol: money.currency_symbol,
      locale: money.locale,
      country: money.country,
      country_code: money.country_code,
      trial_ends_at: trialEndsAt,
      plan_code: plan?.code || "free_trial",
    },
  };
}

/**
 * Full public signup — bypasses supabase.auth.signUp() so we never hit
 * Supabase Auth's built-in confirmation-email rate limit
 * ("email rate limit exceeded" / over_email_send_rate_limit).
 *
 * Flow:
 *  1. Create Auth user with email_confirm: false (no Supabase email sent)
 *  2. Create company + Main Branch + trial subscription
 *  3. Bootstrap owner app_metadata + profiles row
 *  4. Send a 6-digit OTP via our own Zoho SMTP / Resend transport
 *
 * The client then verifies the OTP; otp_verify confirms the email and
 * activates the company so the owner can sign in and start the trial.
 */
export async function completePublicSignup(body = {}, { ip = null } = {}) {
  const companyName = sanitizeText(body.company_name, 120);
  const fullName = sanitizeText(body.full_name || body.name, 120);
  const email = sanitizeText(body.email, 160).toLowerCase();
  const phone = sanitizeText(body.phone, 40);
  const password = String(body.password || "");
  const planCode = sanitizeText(body.plan_code || "free_trial", 40).toLowerCase() || "free_trial";

  if (!companyName || !fullName || !email || password.length < 8) {
    return {
      status: 400,
      body: { success: false, error: "Please provide a company name, your full name, email, and a password of at least 8 characters.", code: "VALIDATION" },
    };
  }
  if (!isValidEmailAddress(email)) {
    return { status: 400, body: { success: false, error: "Enter a valid email address.", code: "VALIDATION" } };
  }

  const admin = createAdminClient();

  const { data: existingName } = await admin
    .from("companies")
    .select("id")
    .ilike("name", companyName)
    .limit(1)
    .maybeSingle();
  if (existingName?.id) {
    return { status: 409, body: { success: false, error: "A company with that name already exists.", code: "COMPANY_EXISTS" } };
  }

  // Create the Auth user WITHOUT sending Supabase's built-in confirmation
  // email. We deliver verification ourselves via OTP (Zoho/Resend). Duplicate
  // emails are rejected by Auth and mapped to a friendly EMAIL_EXISTS below —
  // no need for an expensive listUsers scan.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { name: fullName },
    app_metadata: {},
  });
  if (createError || !created?.user?.id) {
    const msg = createError?.message || "Unable to create your account.";
    console.error("[public-signup] createUser failed", createError);
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return {
        status: 409,
        body: { success: false, error: "An account already exists for this email. Sign in, or reset your password if you forgot it.", code: "EMAIL_EXISTS" },
      };
    }
    if (/rate.?limit|over_email/i.test(msg)) {
      // Should not happen with email_confirm:false, but map it just in case.
      return {
        status: 429,
        body: {
          success: false,
          error: "Too many signup attempts right now. Please wait about a minute and try again.",
          code: "RATE_LIMITED",
          retry_after: 60,
        },
      };
    }
    return { status: 502, body: { success: false, error: "Unable to create your account right now. Please try again.", code: "AUTH_CREATE_FAILED" } };
  }

  const supabaseUserId = created.user.id;

  // Reuse company/branch/subscription creation (caller identity = the new user).
  const workspace = await createCompanyWorkspace({
    caller: { id: supabaseUserId, email },
    body: {
      company_name: companyName,
      full_name: fullName,
      email,
      phone,
      plan_code: planCode,
      supabase_user_id: supabaseUserId,
      country: body.country,
      country_code: body.country_code,
      currency: body.currency || body.currency_code,
      currency_code: body.currency_code || body.currency,
      currency_symbol: body.currency_symbol,
      locale: body.locale,
      address: body.address,
      business_type: body.business_type,
    },
  });

  if (!workspace?.body?.success) {
    console.error("[public-signup] company workspace failed after createUser; rolling back auth user", workspace?.body);
    try {
      await admin.auth.admin.deleteUser(supabaseUserId);
    } catch (rollbackErr) {
      console.error("[public-signup] rollback deleteUser failed", rollbackErr);
    }
    return {
      status: workspace?.status || 502,
      body: workspace?.body || { success: false, error: "Unable to create your company workspace.", code: "COMPANY_FAILED" },
    };
  }

  const ws = workspace.body;
  const username = ws.username || email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").slice(0, 24).toLowerCase() || "owner";

  const app_metadata = {
    role: "owner",
    company_id: ws.company_id,
    branch_id: ws.branch_id,
    username,
    name: fullName,
    phone,
    active: true,
    account_status: "active",
    login_enabled: true,
    created_by_name: "Public signup",
    company_code: ws.company_code,
    company_name: companyName,
    plan_code: ws.plan_code || "free_trial",
    trial_ends_at: ws.trial_ends_at,
    currency: ws.currency_code || ws.currency || "KES",
  };

  const { error: metaError } = await admin.auth.admin.updateUserById(supabaseUserId, {
    app_metadata,
    user_metadata: { name: fullName },
  });
  if (metaError) {
    console.error("[public-signup] owner metadata update failed", metaError);
    return {
      status: 502,
      body: {
        success: false,
        error: "Your account was created but owner setup failed. Contact support with your email.",
        code: "BOOTSTRAP_FAILED",
        supabase_user_id: supabaseUserId,
        company_code: ws.company_code,
        email,
      },
    };
  }

  try {
    await ensureUserSynced(admin, {
      id: supabaseUserId,
      email,
      name: fullName,
      role: "owner",
      company_id: ws.company_id,
      branch_id: ws.branch_id,
      username,
      active: true,
    });
  } catch (syncErr) {
    console.error("[public-signup] profile sync failed", syncErr);
    // Non-fatal for signup — login hydrate will retry. Continue to OTP.
  }

  // Deliver verification OTP via our own mail transport (not Supabase Auth).
  const otp = await requestOtp(admin, {
    purpose: "registration",
    channel: "email",
    identifier: email,
    fallbackEmail: email,
    companyId: ws.company_id,
    userId: supabaseUserId,
    ip,
  });

  if (!otp.success) {
    console.error("[public-signup] OTP email delivery failed", {
      code: otp.code,
      error: otp.error,
      email,
      company_id: ws.company_id,
      user_id: supabaseUserId,
    });
    // Account + company exist; client can resend OTP. Surface a friendly
    // message rather than failing the whole signup.
    return {
      status: 200,
      body: {
        success: true,
        needs_email_otp: true,
        otp_sent: false,
        email_delivery_configured: false,
        email_error: otp.error || "We could not send the verification email just now. Use Resend code in a moment.",
        otp_retry_after: otp.retry_after || 60,
        company_id: ws.company_id,
        branch_id: ws.branch_id,
        company_code: ws.company_code,
        email,
        phone,
        username,
        supabase_user_id: supabaseUserId,
        currency: ws.currency_code || ws.currency,
        currency_code: ws.currency_code || ws.currency,
        currency_symbol: ws.currency_symbol,
        locale: ws.locale,
        country: ws.country,
        country_code: ws.country_code,
        trial_ends_at: ws.trial_ends_at,
        plan_code: ws.plan_code,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      needs_email_otp: true,
      otp_sent: true,
      email_delivery_configured: true,
      expires_at: otp.expires_at,
      resend_after: otp.resend_after || 60,
      masked_identifier: otp.masked_identifier,
      company_id: ws.company_id,
      branch_id: ws.branch_id,
      company_code: ws.company_code,
      email,
      phone,
      username,
      supabase_user_id: supabaseUserId,
      currency: ws.currency_code || ws.currency,
      currency_code: ws.currency_code || ws.currency,
      currency_symbol: ws.currency_symbol,
      locale: ws.locale,
      country: ws.country,
      country_code: ws.country_code,
      trial_ends_at: ws.trial_ends_at,
      plan_code: ws.plan_code,
    },
  };
}
