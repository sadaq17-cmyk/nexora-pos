/**
 * Optional TOTP MFA helpers wrapping Supabase Auth MFA APIs.
 * No app database schema changes — factors live in Supabase Auth.
 */

export async function listTotpFactors(client) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) return { factors: [], error: error.message };
  const factors = (data?.totp || []).filter((factor) => factor.status === "verified");
  return { factors, error: null };
}

export async function getMfaAssurance(client) {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return { currentLevel: null, nextLevel: null, error: error.message };
  return {
    currentLevel: data?.currentLevel || null,
    nextLevel: data?.nextLevel || null,
    error: null,
  };
}

export async function enrollTotp(client, friendlyName = "Nexora POS Pro Authenticator") {
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    factorId: data.id,
    qr: data.totp?.qr_code || "",
    secret: data.totp?.secret || "",
    uri: data.totp?.uri || "",
  };
}

export async function challengeAndVerifyTotp(client, factorId, code) {
  const trimmed = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) {
    return { success: false, error: "Enter the 6-digit authenticator code." };
  }
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
  if (challengeError) return { success: false, error: challengeError.message };
  const { data, error } = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: trimmed,
  });
  if (error) return { success: false, error: error.message || "Invalid authenticator code." };
  return { success: true, session: data };
}

export async function unenrollFactor(client, factorId) {
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
