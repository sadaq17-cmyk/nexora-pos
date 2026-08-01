import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "../lib/api";
import { hasPermission, normalizeRole, isPlatformOwner, isOwner } from "../lib/rbac";
import {
  supabase,
  supabaseConfigError,
  requireSupabase,
  getAuthClient,
} from "../lib/supabaseClient";
import {
  getLockoutStatus,
  recordLoginFailure,
  clearLoginAttempts,
} from "../lib/loginAttemptTracker";
import {
  clearAllSessions,
  recordSecurityActivity,
  registerSession,
  touchSession,
} from "../lib/securityCenter";
import { resolveLoginEmail, publicSignup, authFetch } from "../lib/authApi";
import {
  PERMANENT_PLATFORM_ADMIN,
  isPermanentPlatformAdminEmail,
  isPermanentPlatformAdminUsername,
} from "../lib/permanentPlatformAdmin";
import {
  ACTIVITY_EVENTS,
  IDLE_TIMEOUT_MS,
  clearSessionStarted,
  isAbsoluteSessionExpired,
  markSessionStarted,
} from "../lib/sessionIdle";
import {
  challengeAndVerifyTotp,
  getMfaAssurance,
  listTotpFactors,
} from "../lib/mfaHelpers";
import { requestOtp as requestOtpApi, verifyOtp as verifyOtpApi } from "../lib/otpApi";
import { initRealtimeSync, stopRealtimeSync } from "../lib/realtimeSync";

const AuthContext = createContext(null);

/** In-memory only — owner tokens for stopImpersonation (lost on full reload). */
let impersonationOwnerSession = null;

const MUST_CHANGE_CLEARED_KEY = "nexora-must-change-cleared";

function wasMustChangeClearedLocally(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    return window.localStorage.getItem(MUST_CHANGE_CLEARED_KEY) === String(userId);
  } catch {
    return false;
  }
}

function markMustChangeClearedLocally(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(MUST_CHANGE_CLEARED_KEY, String(userId));
  } catch {
    /* ignore */
  }
}

function mapSupabaseUser(sbUser, company = null) {
  if (!sbUser) return null;
  const meta = sbUser.app_metadata || {};
  const role = normalizeRole(meta.role);
  // Platform Owner is global — never carry a company tenant id into the session.
  const companyId = isPlatformOwner(role) || meta.company_id == null || meta.company_id === ""
    ? null
    : meta.company_id;
  const mustChange = meta.must_change_password === true && !wasMustChangeClearedLocally(sbUser.id);
  const active = meta.active === false || meta.active === 0 ? 0 : 1;
  const accountStatus = String(meta.account_status || (active ? "active" : "inactive")).toLowerCase();
  return {
    id: sbUser.id,
    email: sbUser.email || "",
    name: meta.name || sbUser.user_metadata?.name || "",
    username: meta.username || "",
    phone: meta.phone || "",
    role,
    company_id: companyId,
    branch_id: isPlatformOwner(role) || meta.branch_id == null || meta.branch_id === "" ? null : meta.branch_id,
    active,
    account_status: accountStatus,
    login_enabled: meta.login_enabled === false || meta.login_enabled === 0 ? 0 : 1,
    profile_photo: meta.profile_photo || "",
    company: isPlatformOwner(role) ? null : (company || null),
    email_verified: !!sbUser.email_confirmed_at,
    must_change_password: mustChange,
    force_logout_at: meta.force_logout_at || null,
    sms_login_otp_enabled: meta.sms_login_otp_enabled === true,
    otp_phone: meta.otp_phone || "",
    employee_id: meta.employee_id || "",
    department: meta.department || "",
    position: meta.position || "",
  };
}

function bridgeAuth(user) {
  if (!api.__setAuthContext) return;
  if (!user) {
    api.__setAuthContext(null);
    return;
  }
  api.__setAuthContext({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    company_id: user.company_id,
    branch_id: user.branch_id,
    company: user.company || null,
    active: user.active,
  });
}

async function loadCompanyForUser(appUser) {
  if (!appUser || isPlatformOwner(appUser.role) || appUser.company_id == null) return null;
  if (api.publicAuth?.getCompanyById) {
    return api.publicAuth.getCompanyById(appUser.company_id);
  }
  return null;
}

async function needsMfaStepUp(client) {
  try {
    const aal = await getMfaAssurance(client);
    return aal.nextLevel === "aal2" && aal.currentLevel === "aal1";
  } catch {
    return false;
  }
}

/** SMS OTP is an opt-in alternative to TOTP; skip it when TOTP MFA already gated this sign-in. */
function needsSmsOtpStepUp(sbUser) {
  const meta = sbUser?.app_metadata || {};
  return Boolean(meta.sms_login_otp_enabled) && Boolean(meta.otp_phone);
}

async function gateAfterSignIn(sbUser) {
  const confirmed = sbUser.email_confirmed_at || sbUser.confirmed_at;
  if (!confirmed) {
    await requireSupabase().auth.signOut();
    return { success: false, error: "Verify your email before signing in.", code: "EMAIL_UNVERIFIED" };
  }

  const meta = sbUser.app_metadata || {};
  const accountStatus = String(meta.account_status || "").toLowerCase();
  if (meta.active === false || meta.active === 0 || accountStatus === "inactive" || accountStatus === "suspended") {
    await requireSupabase().auth.signOut();
    return {
      success: false,
      error: accountStatus === "suspended"
        ? "This account has been suspended. Contact your administrator."
        : "Invalid email or password.",
      code: accountStatus === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_INACTIVE",
    };
  }
  if (meta.login_enabled === false || meta.login_enabled === 0) {
    await requireSupabase().auth.signOut();
    return { success: false, error: "Login is disabled for this account.", code: "LOGIN_DISABLED" };
  }
  if (accountStatus === "locked" || (meta.locked_until && new Date(meta.locked_until).getTime() > Date.now())) {
    await requireSupabase().auth.signOut();
    return { success: false, error: "This account is locked. Contact your administrator.", code: "ACCOUNT_LOCKED" };
  }
  // Admin force-logout: reject sessions started before the revoke timestamp.
  if (meta.force_logout_at) {
    const revokedAt = new Date(meta.force_logout_at).getTime();
    const started = typeof window !== "undefined"
      ? Number(window.sessionStorage.getItem("nexora-session-started-at") || 0)
      : 0;
    if (revokedAt && started && started < revokedAt) {
      await requireSupabase().auth.signOut();
      return { success: false, error: "Your session was revoked by an administrator.", code: "FORCE_LOGOUT" };
    }
  }

  const role = normalizeRole(meta.role);
  if (!isPlatformOwner(role)) {
    const companyId = meta.company_id;
    if (companyId == null || companyId === "") {
      await requireSupabase().auth.signOut();
      return { success: false, error: "Invalid company identifier or credentials." };
    }
    // Auth is global; hydrate company workspace into Postgres via /api/pos.
    if (api.publicAuth?.hydrateCompanyWorkspaceFromAuth) {
      await api.publicAuth.hydrateCompanyWorkspaceFromAuth({
        supabase_user_id: sbUser.id,
        company_id: companyId,
        branch_id: meta.branch_id,
        company_code: meta.company_code,
        company_name: meta.company_name,
        plan_code: meta.plan_code,
        trial_ends_at: meta.trial_ends_at,
        currency: meta.currency,
        email: sbUser.email,
        phone: meta.phone,
        username: meta.username,
        name: meta.name || sbUser.user_metadata?.name,
        email_verified: true,
      });
    }
    // Email already confirmed at Supabase — activate any pending local company workspace.
    if (api.publicAuth?.activateCompanyForOwner) {
      await api.publicAuth.activateCompanyForOwner(sbUser.id);
    }
    const gate = api.publicAuth?.checkCompanyAccess
      ? await api.publicAuth.checkCompanyAccess(companyId, { role })
      : { ok: true };
    if (!gate.ok) {
      // After trial/subscription expiry: only Company Owner may log in to renew.
      // Staff are signed out and temporarily disabled from app access.
      const isCompanyOwner = role === "owner";
      if (!isCompanyOwner) {
        await requireSupabase().auth.signOut();
        return {
          success: false,
          subscriptionLocked: false,
          code: "STAFF_SUBSCRIPTION_LOCKED",
          error:
            gate.staff_error
            || "Your company trial or subscription has expired. Only the Company Owner can log in to choose a plan. Staff access is temporarily disabled.",
        };
      }
      // Keep owner session but restrict the app to renewal/payment/login pages.
      const appUserLocked = mapSupabaseUser(sbUser);
      const companyLocked = await loadCompanyForUser(appUserLocked);
      return {
        success: true,
        subscriptionLocked: true,
        user: { ...appUserLocked, company: companyLocked },
        code: gate.code || "SUBSCRIPTION_INACTIVE",
        error: gate.error || "This company subscription is inactive or expired.",
      };
    }
  }

  const appUser = mapSupabaseUser(sbUser);
  const company = await loadCompanyForUser(appUser);
  return { success: true, subscriptionLocked: false, user: { ...appUser, company } };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState(null);
  const [subscriptionLocked, setSubscriptionLocked] = useState(false);
  const mounted = useRef(true);
  const logoutRef = useRef(async () => {});
  const mfaPendingRef = useRef(false);
  /** Pending SMS login-verification challenge: { user, isPlatformLogin, company, lockKey, email }. */
  const smsOtpPendingRef = useRef(null);
  /** Skip duplicate gateAfterSignIn when login() already hydrated the same user. */
  const gatedUserIdRef = useRef(null);
  const actionsRef = useRef({});

  const loadPermissions = useCallback(async () => {
    if (!api.permissions?.getMine) return;
    try {
      const perms = await api.permissions.getMine();
      if (mounted.current) setPermissions(perms || {});
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[AuthContext] loadPermissions failed", err);
      if (mounted.current) setPermissions({});
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let subscription = null;

    (async () => {
      const bootTimeoutMs = 18_000;
      const withTimeout = (promise, ms, label) =>
        Promise.race([
          promise,
          new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
            promise?.finally?.(() => clearTimeout(t));
          }),
        ]);
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), bootTimeoutMs, "getSession");
        if (data?.session?.user) {
          if (isAbsoluteSessionExpired() || await withTimeout(needsMfaStepUp(supabase), 8_000, "mfa")) {
            await supabase.auth.signOut();
            clearSessionStarted();
            setUser(null);
            setSubscriptionLocked(false);
            bridgeAuth(null);
          } else {
            const gated = await withTimeout(gateAfterSignIn(data.session.user), bootTimeoutMs, "gate");
            if (gated.success) {
              markSessionStarted();
              gatedUserIdRef.current = gated.user.id;
              setUser(gated.user);
              setSubscriptionLocked(Boolean(gated.subscriptionLocked));
              bridgeAuth(gated.user);
              await withTimeout(loadPermissions(), 10_000, "permissions").catch(() => {});
            } else {
              gatedUserIdRef.current = null;
              setUser(null);
              setSubscriptionLocked(false);
              bridgeAuth(null);
            }
          }
        } else {
          bridgeAuth(null);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error("[AuthContext] getSession failed:", err);
        bridgeAuth(null);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();

    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        clearSessionStarted();
        mfaPendingRef.current = false;
        gatedUserIdRef.current = null;
        setUser(null);
        setSubscriptionLocked(false);
        bridgeAuth(null);
        setPermissions({});
        setImpersonation(null);
        impersonationOwnerSession = null;
        return;
      }
      if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
        if (mfaPendingRef.current || await needsMfaStepUp(supabase)) {
          // Keep the aal1 session for the login MFA challenge; do not elevate app user yet.
          mfaPendingRef.current = true;
          setUser(null);
          bridgeAuth(null);
          return;
        }
        if (event === "TOKEN_REFRESHED") {
          const appUser = mapSupabaseUser(session.user);
          const company = await loadCompanyForUser(appUser);
          const withCompany = { ...appUser, company };
          gatedUserIdRef.current = withCompany.id;
          setUser(withCompany);
          bridgeAuth(withCompany);
          return;
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          // login()/loginByEmail already ran gateAfterSignIn for this user.
          if (event === "SIGNED_IN" && gatedUserIdRef.current === session.user.id) {
            return;
          }
          const gated = await gateAfterSignIn(session.user);
          if (gated.success) {
            markSessionStarted();
            gatedUserIdRef.current = gated.user.id;
            setUser(gated.user);
            setSubscriptionLocked(Boolean(gated.subscriptionLocked));
            bridgeAuth(gated.user);
            await loadPermissions();
          } else {
            gatedUserIdRef.current = null;
            setUser(null);
            setSubscriptionLocked(false);
            bridgeAuth(null);
            setPermissions({});
          }
        }
      }
    });
    subscription = data?.subscription;

    return () => {
      mounted.current = false;
      subscription?.unsubscribe?.();
    };
  }, [loadPermissions]);

  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return undefined;
    // Do NOT call markSessionStarted() here — TOKEN_REFRESHED / setUser must not reset the 12h clock.
    let lastActivity = Date.now();
    const onActivity = () => {
      lastActivity = Date.now();
    };
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now - lastActivity >= IDLE_TIMEOUT_MS || isAbsoluteSessionExpired(now)) {
        logoutRef.current();
      }
    }, 15000);
    return () => {
      window.clearInterval(timer);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity);
      }
    };
  }, [user?.id]);

  const finishRememberMeStorage = async (rememberMe, session) => {
    if (!session) return;
    // Persist on the same client used for sign-in; wiping the other storage only.
    const client = getAuthClient(rememberMe);
    await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (typeof window === "undefined") return;
    if (rememberMe) {
      window.sessionStorage.removeItem("nexora-supabase-auth");
    } else {
      window.localStorage.removeItem("nexora-supabase-auth");
    }
  };

  const login = async (companyIdentifier, identifier, password, rememberMe = false) => {
    if (supabaseConfigError || !supabase) {
      return { success: false, error: supabaseConfigError || "Supabase is not configured.", code: "CONFIG" };
    }

    const normalizedCompany = String(companyIdentifier || "").trim().toLowerCase();
    const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
    const lock = getLockoutStatus(normalizedCompany, normalizedIdentifier);
    if (lock.locked) {
      return { success: false, error: lock.error, code: lock.code };
    }

    // Canonical Super Owner scope — accept common aliases users type in the Platform field.
    const PLATFORM_IDENTIFIERS = new Set(["platform", "nexora", "nexora-platform", "nexorapos", "super"]);
    const isPlatformLogin = PLATFORM_IDENTIFIERS.has(normalizedCompany);
    let companyId = null;
    let company = null;

    if (!isPlatformLogin) {
      const resolved = api.publicAuth?.resolveCompany
        ? await api.publicAuth.resolveCompany(normalizedCompany)
        : null;
      if (!resolved) {
        recordLoginFailure(lock.key);
        return { success: false, error: "Invalid company identifier or credentials." };
      }
      company = resolved;
      companyId = resolved.id;
    }

    let email = normalizedIdentifier;
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentifier);
    // Permanent Super Owner: never depend on resolve-login-email (avoids rate-limit → @invalid.local).
    if (isPlatformLogin && (
      isPermanentPlatformAdminUsername(normalizedIdentifier)
      || isPermanentPlatformAdminEmail(normalizedIdentifier)
    )) {
      email = PERMANENT_PLATFORM_ADMIN.email;
    } else if (!looksLikeEmail || isPlatformLogin) {
      const resolvedEmail = await resolveLoginEmail({
        company_id: isPlatformLogin ? "platform" : companyId,
        identifier: normalizedIdentifier,
        scope: isPlatformLogin ? "platform" : undefined,
      });
      if (resolvedEmail.email) {
        email = resolvedEmail.email;
      } else if (isPlatformLogin && isPermanentPlatformAdminUsername(normalizedIdentifier)) {
        email = PERMANENT_PLATFORM_ADMIN.email;
      } else if (!looksLikeEmail) {
        email = normalizedIdentifier.includes("@") ? normalizedIdentifier : `${normalizedIdentifier}@invalid.local`;
      }
    }

    try {
      const client = getAuthClient(rememberMe);
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data?.user) {
        const fail = recordLoginFailure(lock.key);
        recordSecurityActivity({
          email,
          type: "login_failed",
          detail: "Failed sign-in attempt",
        });
        if (fail.locked) return { success: false, error: fail.error, code: fail.code };
        return {
          success: false,
          error: isPlatformLogin
            ? "Invalid platform username or password."
            : "Invalid company identifier or credentials.",
        };
      }

      await finishRememberMeStorage(rememberMe, data.session);
      if (await needsMfaStepUp(client)) {
        mfaPendingRef.current = true;
        const listed = await listTotpFactors(client);
        return {
          success: false,
          code: "MFA_REQUIRED",
          factorId: listed.factors?.[0]?.id || null,
          error: "Enter the 6-digit code from your authenticator app.",
        };
      }
      if (needsSmsOtpStepUp(data.user)) {
        const sent = await requestOtpApi({
          purpose: "login",
          channel: "sms",
          identifier: data.user.app_metadata.otp_phone,
          fallbackEmail: data.user.email,
        });
        smsOtpPendingRef.current = { user: data.user, isPlatformLogin, company, lockKey: lock.key, email };
        return {
          success: false,
          code: "SMS_OTP_REQUIRED",
          maskedPhone: sent?.masked_identifier || "",
          error: sent?.success
            ? "Enter the 6-digit code we texted to your phone."
            : (sent?.error || "Unable to send the SMS code. Please try again."),
        };
      }
      const gated = await gateAfterSignIn(data.user);
      if (!gated.success) {
        recordLoginFailure(lock.key);
        recordSecurityActivity({
          email,
          type: "login_failed",
          detail: gated.error || "Sign-in blocked",
        });
        return gated;
      }

      // Tenant isolation: typed company code MUST match the account's JWT company.
      // Never overwrite JWT company identity with a Super Owner / foreign company.
      if (!isPlatformLogin) {
        const jwtCompanyId = gated.user?.company_id;
        if (companyId != null && jwtCompanyId != null && String(companyId) !== String(jwtCompanyId)) {
          await client.auth.signOut();
          recordLoginFailure(lock.key);
          recordSecurityActivity({
            email,
            type: "login_failed",
            detail: "Company mismatch — account does not belong to typed company",
          });
          return {
            success: false,
            error: "This account does not belong to that company.",
            code: "COMPANY_MISMATCH",
          };
        }
      }

      clearLoginAttempts(lock.key);
      mfaPendingRef.current = false;
      markSessionStarted();
      registerSession(gated.user.id, { email: gated.user.email });
      recordSecurityActivity({
        userId: gated.user.id,
        email: gated.user.email,
        type: "login",
        detail: "Successful sign-in",
      });
      gatedUserIdRef.current = gated.user.id;
      setUser(gated.user);
      setSubscriptionLocked(Boolean(gated.subscriptionLocked));
      bridgeAuth(gated.user);
      setImpersonation(null);
      impersonationOwnerSession = null;
      await loadPermissions();
      return {
        success: true,
        user: gated.user,
        subscriptionLocked: Boolean(gated.subscriptionLocked),
        mustChangePassword: Boolean(gated.user?.must_change_password),
      };
    } catch (err) {
      recordLoginFailure(lock.key);
      recordSecurityActivity({
        email,
        type: "login_failed",
        detail: "Failed sign-in attempt",
      });
      return { success: false, error: err?.message || "Invalid company identifier or credentials." };
    }
  };

  const loginByEmail = async (email, password, rememberMe = false, companyIdentifier = "") => {
    if (supabaseConfigError || !supabase) {
      return { success: false, error: supabaseConfigError || "Supabase is not configured.", code: "CONFIG" };
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const companyCode = String(companyIdentifier || "").trim().toLowerCase();
    const lock = getLockoutStatus(companyCode || "email", normalizedEmail);
    if (lock.locked) {
      return { success: false, error: lock.error, code: lock.code };
    }

    let companyId = null;
    if (companyCode) {
      const resolved = api.publicAuth?.resolveCompany
        ? await api.publicAuth.resolveCompany(companyCode)
        : null;
      if (!resolved) {
        recordLoginFailure(lock.key);
        return { success: false, error: "Invalid email or password." };
      }
      companyId = resolved.id;
    }

    let signInEmail = normalizedEmail;
    if (companyId != null) {
      const resolvedEmail = await resolveLoginEmail({
        company_id: companyId,
        identifier: normalizedEmail,
      });
      if (resolvedEmail.email) signInEmail = resolvedEmail.email;
    }

    try {
      const client = getAuthClient(rememberMe);
      const { data, error } = await client.auth.signInWithPassword({
        email: signInEmail,
        password,
      });
      if (error || !data?.user) {
        const fail = recordLoginFailure(lock.key);
        recordSecurityActivity({
          email: normalizedEmail,
          type: "login_failed",
          detail: "Failed sign-in attempt",
        });
        if (fail.locked) return { success: false, error: fail.error, code: fail.code };
        return { success: false, error: "Invalid email or password." };
      }

      await finishRememberMeStorage(rememberMe, data.session);
      if (await needsMfaStepUp(client)) {
        mfaPendingRef.current = true;
        const listed = await listTotpFactors(client);
        return {
          success: false,
          code: "MFA_REQUIRED",
          factorId: listed.factors?.[0]?.id || null,
          error: "Enter the 6-digit code from your authenticator app.",
        };
      }
      if (needsSmsOtpStepUp(data.user)) {
        const sent = await requestOtpApi({
          purpose: "login",
          channel: "sms",
          identifier: data.user.app_metadata.otp_phone,
          fallbackEmail: data.user.email,
        });
        smsOtpPendingRef.current = { user: data.user, isPlatformLogin: false, company: null, lockKey: lock.key, email: normalizedEmail };
        return {
          success: false,
          code: "SMS_OTP_REQUIRED",
          maskedPhone: sent?.masked_identifier || "",
          error: sent?.success
            ? "Enter the 6-digit code we texted to your phone."
            : (sent?.error || "Unable to send the SMS code. Please try again."),
        };
      }
      const gated = await gateAfterSignIn(data.user);
      if (!gated.success) {
        recordLoginFailure(lock.key);
        recordSecurityActivity({
          email: normalizedEmail,
          type: "login_failed",
          detail: gated.error || "Sign-in blocked",
        });
        return gated;
      }

      if (companyId != null) {
        const jwtCompanyId = gated.user?.company_id;
        if (jwtCompanyId != null && String(companyId) !== String(jwtCompanyId)) {
          await client.auth.signOut();
          recordLoginFailure(lock.key);
          recordSecurityActivity({
            email: normalizedEmail,
            type: "login_failed",
            detail: "Company mismatch — account does not belong to typed company",
          });
          return {
            success: false,
            error: "This account does not belong to that company.",
            code: "COMPANY_MISMATCH",
          };
        }
      }

      clearLoginAttempts(lock.key);
      mfaPendingRef.current = false;
      markSessionStarted();
      registerSession(gated.user.id, { email: gated.user.email });
      recordSecurityActivity({
        userId: gated.user.id,
        email: gated.user.email,
        type: "login",
        detail: "Successful sign-in",
      });
      gatedUserIdRef.current = gated.user.id;
      setUser(gated.user);
      setSubscriptionLocked(Boolean(gated.subscriptionLocked));
      bridgeAuth(gated.user);
      setImpersonation(null);
      impersonationOwnerSession = null;
      await loadPermissions();
      return {
        success: true,
        user: gated.user,
        subscriptionLocked: Boolean(gated.subscriptionLocked),
        mustChangePassword: Boolean(gated.user?.must_change_password),
      };
    } catch (err) {
      recordLoginFailure(lock.key);
      recordSecurityActivity({
        email: normalizedEmail,
        type: "login_failed",
        detail: "Failed sign-in attempt",
      });
      return { success: false, error: err?.message || "Invalid email or password." };
    }
  };

  const verifyMfa = async (factorId, code) => {
    if (!supabase) {
      return { success: false, error: "Supabase is not configured.", code: "CONFIG" };
    }
    if (!factorId) {
      return { success: false, error: "No authenticator factor is available." };
    }
    try {
      const result = await challengeAndVerifyTotp(supabase, factorId, code);
      if (!result.success) return result;
      mfaPendingRef.current = false;
      const { data } = await supabase.auth.getUser();
      if (!data?.user) return { success: false, error: "Session expired. Please sign in again." };
      const gated = await gateAfterSignIn(data.user);
      if (!gated.success) return gated;
      markSessionStarted();
      gatedUserIdRef.current = gated.user.id;
      setUser(gated.user);
      setSubscriptionLocked(Boolean(gated.subscriptionLocked));
      bridgeAuth(gated.user);
      setImpersonation(null);
      impersonationOwnerSession = null;
      await loadPermissions();
      return {
        success: true,
        user: gated.user,
        subscriptionLocked: Boolean(gated.subscriptionLocked),
        mustChangePassword: Boolean(gated.user?.must_change_password),
      };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to verify authenticator code." };
    }
  };

  const verifySmsOtpLogin = async (code) => {
    const pending = smsOtpPendingRef.current;
    if (!pending?.user) {
      return { success: false, error: "No pending SMS verification. Please sign in again." };
    }
    try {
      const result = await verifyOtpApi({
        purpose: "login",
        channel: "sms",
        identifier: pending.user.app_metadata?.otp_phone,
        code,
      });
      if (!result?.success) {
        return { success: false, error: result?.error || "Incorrect code.", attemptsRemaining: result?.attempts_remaining };
      }
      const gated = await gateAfterSignIn(pending.user);
      if (!gated.success) {
        recordLoginFailure(pending.lockKey);
        recordSecurityActivity({ email: pending.email, type: "login_failed", detail: gated.error || "Sign-in blocked" });
        smsOtpPendingRef.current = null;
        return gated;
      }
      if (!pending.isPlatformLogin && pending.company) {
        const jwtCompanyId = gated.user?.company_id;
        if (
          pending.company.id != null &&
          jwtCompanyId != null &&
          String(pending.company.id) !== String(jwtCompanyId)
        ) {
          await requireSupabase().auth.signOut();
          recordLoginFailure(pending.lockKey);
          smsOtpPendingRef.current = null;
          return {
            success: false,
            error: "This account does not belong to that company.",
            code: "COMPANY_MISMATCH",
          };
        }
      }
      clearLoginAttempts(pending.lockKey);
      smsOtpPendingRef.current = false;
      markSessionStarted();
      registerSession(gated.user.id, { email: gated.user.email });
      recordSecurityActivity({ userId: gated.user.id, email: gated.user.email, type: "login", detail: "Successful sign-in (SMS verified)" });
      gatedUserIdRef.current = gated.user.id;
      setUser(gated.user);
      setSubscriptionLocked(Boolean(gated.subscriptionLocked));
      bridgeAuth(gated.user);
      setImpersonation(null);
      impersonationOwnerSession = null;
      await loadPermissions();
      smsOtpPendingRef.current = null;
      return {
        success: true,
        user: gated.user,
        subscriptionLocked: Boolean(gated.subscriptionLocked),
        mustChangePassword: Boolean(gated.user?.must_change_password),
      };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to verify SMS code." };
    }
  };

  const enableSmsLoginOtp = async ({ phone, ticket }) => {
    try {
      const result = await authFetch("/api/admin-update-user", {
        method: "POST",
        body: { action: "set_sms_login_otp", enabled: true, phone, ticket },
      });
      if (result?.success && user) {
        setUser({ ...user, sms_login_otp_enabled: true, otp_phone: result.otp_phone || phone });
      }
      return result || { success: false, error: "Unable to enable SMS login verification." };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to enable SMS login verification." };
    }
  };

  const disableSmsLoginOtp = async () => {
    try {
      const result = await authFetch("/api/admin-update-user", {
        method: "POST",
        body: { action: "set_sms_login_otp", enabled: false },
      });
      if (result?.success && user) {
        setUser({ ...user, sms_login_otp_enabled: false });
      }
      return result || { success: false, error: "Unable to disable SMS login verification." };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to disable SMS login verification." };
    }
  };

  const signup = async (payload = {}) => {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const name = String(payload.full_name || "").trim();
    const companyName = String(payload.company_name || "").trim();
    const phone = String(payload.phone || "").trim();

    if (!companyName || !name || !email || password.length < 8) {
      return { success: false, error: "Please provide valid signup details." };
    }

    // Server-side signup: creates Auth user with email_confirm:false (never
    // triggers Supabase Auth's built-in confirmation email / rate limit) and
    // delivers a 6-digit OTP via our Zoho SMTP / Resend transport.
    const result = await publicSignup({
      company_name: companyName,
      full_name: name,
      email,
      phone,
      password,
      plan_code: payload.plan_code || "free_trial",
      country: payload.country,
      country_code: payload.country_code,
      currency: payload.currency || payload.currency_code,
      currency_code: payload.currency_code || payload.currency,
      currency_symbol: payload.currency_symbol,
      locale: payload.locale,
    });

    if (!result.success) {
      const msg = String(result.error || "");
      if (result.code === "RATE_LIMITED" || /rate.?limit|too many/i.test(msg)) {
        return {
          success: false,
          error: "Too many signup attempts right now. Please wait about a minute and try again.",
          code: "RATE_LIMITED",
          retry_after: result.retry_after || 60,
        };
      }
      if (result.code === "EMAIL_EXISTS" || /already exists|already registered/i.test(msg)) {
        return { success: false, error: "An account already exists for this email. Sign in, or reset your password if you forgot it.", code: "EMAIL_EXISTS" };
      }
      if (result.code === "COMPANY_EXISTS") {
        return { success: false, error: "A company with that name already exists.", code: "COMPANY_EXISTS" };
      }
      return { success: false, error: result.error || "Unable to create your account.", code: result.code };
    }

    return {
      success: true,
      needs_email_otp: true,
      otp_sent: result.otp_sent !== false,
      company_code: result.company_code,
      email,
      phone,
      username: result.username,
      email_delivery_configured: result.email_delivery_configured !== false && result.otp_sent !== false,
      email_error: result.email_error,
      expires_at: result.expires_at,
      resend_after: result.resend_after || 60,
      masked_identifier: result.masked_identifier,
      currency: result.currency_code || result.currency,
      currency_code: result.currency_code || result.currency,
      currency_symbol: result.currency_symbol,
      locale: result.locale,
      country: result.country,
      country_code: result.country_code,
      company_id: result.company_id,
      branch_id: result.branch_id,
      supabase_user_id: result.supabase_user_id,
      trial_ends_at: result.trial_ends_at,
      plan_code: result.plan_code,
    };
  };

  const logout = async () => {
    mfaPendingRef.current = false;
    gatedUserIdRef.current = null;
    clearSessionStarted();
    if (user?.id) {
      recordSecurityActivity({
        userId: user.id,
        email: user.email,
        type: "logout",
        detail: "Signed out",
      });
    }
    try {
      if (supabase) await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[AuthContext] signOut error:", err);
    }
    setUser(null);
    setSubscriptionLocked(false);
    setPermissions({});
    setImpersonation(null);
    impersonationOwnerSession = null;
    bridgeAuth(null);
  };
  logoutRef.current = logout;

  const logoutAllDevices = async () => {
    const activeUser = user;
    mfaPendingRef.current = false;
    gatedUserIdRef.current = null;
    clearSessionStarted();
    if (activeUser?.id) {
      clearAllSessions(activeUser.id);
      recordSecurityActivity({
        userId: activeUser.id,
        email: activeUser.email,
        type: "logout_all",
        detail: "Logged out of all devices",
      });
    }
    try {
      if (supabase) await supabase.auth.signOut({ scope: "global" });
    } catch (err) {
      if (import.meta.env.DEV) console.error("[AuthContext] global signOut error:", err);
    }
    setUser(null);
    setSubscriptionLocked(false);
    setPermissions({});
    setImpersonation(null);
    impersonationOwnerSession = null;
    bridgeAuth(null);
    return { success: true };
  };

  useEffect(() => {
    if (!user) return undefined;
    registerSession(user.id, { email: user.email });
    const localBeat = () => {
      if (document.visibilityState === "visible") {
        api.auth?.heartbeat?.();
        touchSession(user.id);
      }
    };
    localBeat();
    const timer = window.setInterval(localBeat, 60000);
    window.addEventListener("focus", localBeat);
    document.addEventListener("visibilitychange", localBeat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", localBeat);
      document.removeEventListener("visibilitychange", localBeat);
    };
  }, [user?.id, user?.email]);

  // Enterprise ERP real-time sync: one Supabase Realtime channel per signed-in
  // company, feeding every open tab/page's useRealtimeRefresh() subscribers.
  useEffect(() => {
    const companyId = user && !isPlatformOwner(user.role) ? user.company_id : null;
    if (companyId == null || companyId === "") {
      stopRealtimeSync();
      return undefined;
    }
    initRealtimeSync(companyId);
    return () => stopRealtimeSync();
  }, [user?.company_id, user?.role]);

  const can = useCallback((module, action = "view") => {
    return hasPermission(user?.role, module, action, { [user?.role]: permissions });
  }, [user?.role, permissions]);

  const refreshPermissions = useCallback(async () => {
    await loadPermissions();
  }, [loadPermissions]);

  const impersonate = async (targetId) => {
    if (!supabase) return { success: false, error: "Supabase is not configured." };
    const { data: currentSessionData } = await supabase.auth.getSession();
    const ownerSession = currentSessionData?.session;
    if (!ownerSession) return { success: false, error: "No active session." };

    const result = await authFetch("/api/admin-impersonate", {
      method: "POST",
      body: { target_id: targetId },
    });
    if (!result.success) return result;

    impersonationOwnerSession = {
      access_token: ownerSession.access_token,
      refresh_token: ownerSession.refresh_token,
      owner: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };

    try {
      if (result.hashed_token) {
        let data; let error;
        ({ data, error } = await supabase.auth.verifyOtp({
          token_hash: result.hashed_token,
          type: "email",
        }));
        if (error || !data?.session) {
          const retry = await supabase.auth.verifyOtp({
            token_hash: result.hashed_token,
            type: "magiclink",
          });
          if (retry.error || !retry.data?.session) {
            impersonationOwnerSession = null;
            return {
              success: false,
              error: error?.message || retry.error?.message || "Unable to establish impersonation session.",
              code: "IMPERSONATION_FAILED",
            };
          }
        }
      } else {
        impersonationOwnerSession = null;
        return { success: false, error: "No impersonation token returned.", code: "IMPERSONATION_FAILED" };
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const targetUser = sessionData?.session?.user;
      if (!targetUser) {
        impersonationOwnerSession = null;
        return { success: false, error: "Impersonation session was not established." };
      }

      const mapped = mapSupabaseUser(targetUser);
      const company = await loadCompanyForUser(mapped);
      const effectiveUser = { ...mapped, company };
      const impersonationMeta = result.impersonation || {
        owner: impersonationOwnerSession.owner,
        target_id: targetId,
        started_at: new Date().toISOString(),
      };
      setUser(effectiveUser);
      setSubscriptionLocked(false);
      bridgeAuth(effectiveUser);
      setImpersonation(impersonationMeta);
      await loadPermissions();
      try {
        if (api.owner?.recordAudit) {
          await api.owner.recordAudit("impersonate_company_owner", {
            target_id: targetId,
            target_email: effectiveUser.email,
            company_id: effectiveUser.company_id,
          });
        }
      } catch {
        /* non-blocking */
      }
      return { success: true, user: effectiveUser, impersonation: impersonationMeta };
    } catch (err) {
      impersonationOwnerSession = null;
      return { success: false, error: err?.message || "Impersonation failed." };
    }
  };

  const updateOwnerAccount = async ({ currentPassword, email, password, confirmPassword } = {}) => {
    if (!supabase || !user) return { success: false, error: "Not signed in." };
    if (!isOwner(user.role)) {
      return {
        success: false,
        error: "Only the Company Owner can change owner email or password.",
        code: "FORBIDDEN",
      };
    }
    if (!String(currentPassword || "").trim()) {
      return { success: false, error: "Current password is required before saving any changes." };
    }

    const nextEmail = String(email || "").trim().toLowerCase();
    const nextPassword = String(password || "");
    const emailChanged = nextEmail && nextEmail !== String(user.email || "").toLowerCase();
    const passwordChanged = Boolean(nextPassword);

    if (!emailChanged && !passwordChanged) {
      return { success: false, error: "Change your email or password before saving." };
    }
    if (emailChanged) {
      const { isValidEmail } = await import("../lib/emailValidation");
      if (!isValidEmail(nextEmail)) {
        return { success: false, error: "Enter a valid email address." };
      }
    }
    if (passwordChanged) {
      if (nextPassword !== String(confirmPassword || "")) {
        return { success: false, error: "New password and confirmation do not match." };
      }
      const { validatePassword } = await import("../lib/passwordPolicy");
      const policy = validatePassword(nextPassword, { username: user.username, email: nextEmail || user.email });
      if (!policy.ok) return { success: false, error: policy.message };
    }

    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        return { success: false, error: "Current password is incorrect." };
      }

      let emailVerificationSent = false;
      if (emailChanged) {
        const { isValidEmail } = await import("../lib/emailValidation");
        if (!isValidEmail(nextEmail)) {
          return { success: false, error: "Enter a valid email address." };
        }
        // Zoho SMTP verification flow — email becomes login only after confirm.
        const emailResult = await authFetch("/api/owner-email-change", {
          method: "POST",
          body: { action: "request", email: nextEmail },
        });
        if (!emailResult.success) {
          return {
            success: false,
            error: emailResult.error || "Unable to send email verification.",
            code: emailResult.code,
          };
        }
        emailVerificationSent = true;
        // Keep the active session on the current login email until Zoho verification completes.
        setUser((prev) => (prev ? {
          ...prev,
          pending_email: nextEmail,
          pending_email_change: true,
        } : prev));
        recordSecurityActivity({
          userId: user.id,
          email: user.email,
          type: "email_changed",
          detail: `Verification sent to ${nextEmail}`,
        });
        if (api.owner?.recordAudit) {
          await api.owner.recordAudit("owner_email_change_requested", {
            user_id: user.id,
            from_domain: String(user.email || "").split("@")[1] || "",
            to_domain: nextEmail.split("@")[1] || "",
          });
        }
      }

      if (passwordChanged) {
        const { error: passwordError } = await supabase.auth.updateUser({ password: nextPassword });
        if (passwordError) {
          return { success: false, error: passwordError.message || "Unable to update password." };
        }
        const cleared = await authFetch("/api/admin-update-user", {
          method: "POST",
          body: { action: "clear_must_change_password" },
        });
        if (cleared.success) markMustChangeClearedLocally(user.id);
        await supabase.auth.signInWithPassword({
          email: user.email,
          password: nextPassword,
        }).catch(() => null);
        recordSecurityActivity({
          userId: user.id,
          email: user.email,
          type: "password_changed",
          detail: "Password updated",
        });
        if (api.owner?.recordAudit) {
          await api.owner.recordAudit("owner_password_changed", { user_id: user.id });
        }
      }

      // After email-change request only, preserve current login email in session state.
      if (!emailChanged || passwordChanged) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          const gated = await gateAfterSignIn(data.user);
          if (gated.success) {
            setUser((prev) => ({
              ...gated.user,
              pending_email: emailChanged ? nextEmail : prev?.pending_email,
              pending_email_change: emailChanged ? true : prev?.pending_email_change,
            }));
            setSubscriptionLocked(Boolean(gated.subscriptionLocked));
            bridgeAuth(gated.user);
          }
        }
      }

      return {
        success: true,
        emailVerificationSent,
        pendingEmail: emailChanged ? nextEmail : undefined,
        sessionUnchanged: emailChanged ? true : undefined,
      };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to update account." };
    }
  };

  const changePassword = async ({ currentPassword, newPassword } = {}) => {
    if (!supabase || !user) return { success: false, error: "Not signed in." };
    const { validatePassword } = await import("../lib/passwordPolicy");
    const policy = validatePassword(newPassword, { username: user.username, email: user.email });
    if (!policy.ok) return { success: false, error: policy.message };

    try {
      if (!user.must_change_password && !currentPassword) {
        return { success: false, error: "Current password is required before saving any changes." };
      }
      if (currentPassword) {
        const { error: reauthError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (reauthError) {
          return { success: false, error: "Current password is incorrect." };
        }
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message || "Unable to update password." };

      const cleared = await authFetch("/api/admin-update-user", {
        method: "POST",
        body: { action: "clear_must_change_password" },
      });
      if (!cleared.success) {
        if (import.meta.env.DEV) console.warn("[changePassword] clear flag failed:", cleared.error);
      }
      markMustChangeClearedLocally(user.id);

      // Admin metadata updates do not rewrite the active JWT. Re-authenticate so the
      // next full-page load sees must_change_password=false from a fresh token.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { data: signedIn, error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: newPassword,
      });
      if (reauthError) {
        if (import.meta.env.DEV) console.warn("[changePassword] re-auth after update failed:", reauthError.message);
        await supabase.auth.refreshSession().catch(() => null);
      }
      const sessionUser = signedIn?.user || (await supabase.auth.getUser()).data?.user || null;
      if (sessionUser) {
        const gated = await gateAfterSignIn(sessionUser);
        if (gated.success) {
          const nextUser = { ...gated.user, must_change_password: false };
          setUser(nextUser);
          setSubscriptionLocked(Boolean(gated.subscriptionLocked));
          bridgeAuth(nextUser);
        } else {
          setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
        }
      } else {
        setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
      }

      if (api.owner?.recordAudit) {
        await api.owner.recordAudit("password_changed", { user_id: user.id });
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to update password." };
    }
  };

  const refreshSessionGate = async () => {
    if (!supabase) return { success: false };
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) return { success: false };
    const gated = await gateAfterSignIn(data.session.user);
    if (gated.success) {
      gatedUserIdRef.current = gated.user.id;
      setUser(gated.user);
      setSubscriptionLocked(Boolean(gated.subscriptionLocked));
      bridgeAuth(gated.user);
      await loadPermissions();
    }
    return gated;
  };

  const stopImpersonation = async () => {
    if (!impersonationOwnerSession?.access_token) {
      return {
        success: false,
        error: "No impersonation session is active (or it was lost after a page reload).",
      };
    }
    try {
      const { data, error } = await requireSupabase().auth.setSession({
        access_token: impersonationOwnerSession.access_token,
        refresh_token: impersonationOwnerSession.refresh_token,
      });
      if (error || !data?.session?.user) {
        return { success: false, error: error?.message || "The original Owner session is no longer valid." };
      }
      const mapped = mapSupabaseUser(data.session.user);
      const company = await loadCompanyForUser(mapped);
      const owner = { ...mapped, company };
      setUser(owner);
      bridgeAuth(owner);
      setImpersonation(null);
      impersonationOwnerSession = null;
      await loadPermissions();
      return { success: true, user: owner };
    } catch (err) {
      return { success: false, error: err?.message || "Unable to stop impersonation." };
    }
  };

  const mustChangePassword = Boolean(user?.must_change_password);

  actionsRef.current = {
    login,
    loginByEmail,
    verifyMfa,
    verifySmsOtpLogin,
    enableSmsLoginOtp,
    disableSmsLoginOtp,
    signup,
    logout,
    impersonate,
    stopImpersonation,
    changePassword,
    updateOwnerAccount,
    logoutAllDevices,
    refreshSessionGate,
  };

  const stableLogin = useCallback((...args) => actionsRef.current.login(...args), []);
  const stableLoginByEmail = useCallback((...args) => actionsRef.current.loginByEmail(...args), []);
  const stableVerifyMfa = useCallback((...args) => actionsRef.current.verifyMfa(...args), []);
  const stableVerifySmsOtpLogin = useCallback((...args) => actionsRef.current.verifySmsOtpLogin(...args), []);
  const stableEnableSmsLoginOtp = useCallback((...args) => actionsRef.current.enableSmsLoginOtp(...args), []);
  const stableDisableSmsLoginOtp = useCallback((...args) => actionsRef.current.disableSmsLoginOtp(...args), []);
  const stableSignup = useCallback((...args) => actionsRef.current.signup(...args), []);
  const stableLogout = useCallback((...args) => actionsRef.current.logout(...args), []);
  const stableImpersonate = useCallback((...args) => actionsRef.current.impersonate(...args), []);
  const stableStopImpersonation = useCallback((...args) => actionsRef.current.stopImpersonation(...args), []);
  const stableChangePassword = useCallback((...args) => actionsRef.current.changePassword(...args), []);
  const stableUpdateOwnerAccount = useCallback((...args) => actionsRef.current.updateOwnerAccount(...args), []);
  const stableLogoutAllDevices = useCallback((...args) => actionsRef.current.logoutAllDevices(...args), []);
  const stableRefreshSessionGate = useCallback((...args) => actionsRef.current.refreshSessionGate(...args), []);

  const value = useMemo(() => ({
    user,
    login: stableLogin,
    loginByEmail: stableLoginByEmail,
    verifyMfa: stableVerifyMfa,
    verifySmsOtpLogin: stableVerifySmsOtpLogin,
    enableSmsLoginOtp: stableEnableSmsLoginOtp,
    disableSmsLoginOtp: stableDisableSmsLoginOtp,
    signup: stableSignup,
    logout: stableLogout,
    loading,
    permissions,
    can,
    refreshPermissions,
    impersonation,
    impersonate: stableImpersonate,
    stopImpersonation: stableStopImpersonation,
    changePassword: stableChangePassword,
    updateOwnerAccount: stableUpdateOwnerAccount,
    logoutAllDevices: stableLogoutAllDevices,
    refreshSessionGate: stableRefreshSessionGate,
    subscriptionLocked,
    mustChangePassword,
    configError: supabaseConfigError,
  }), [
    user,
    loading,
    permissions,
    can,
    refreshPermissions,
    impersonation,
    subscriptionLocked,
    mustChangePassword,
    stableLogin,
    stableLoginByEmail,
    stableVerifyMfa,
    stableVerifySmsOtpLogin,
    stableEnableSmsLoginOtp,
    stableDisableSmsLoginOtp,
    stableSignup,
    stableLogout,
    stableImpersonate,
    stableStopImpersonation,
    stableChangePassword,
    stableUpdateOwnerAccount,
    stableLogoutAllDevices,
    stableRefreshSessionGate,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
