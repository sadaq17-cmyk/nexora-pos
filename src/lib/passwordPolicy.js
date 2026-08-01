/** Shared strong password policy for Nexora POS Pro (client + docs). */

export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password, { username = "", email = "" } = {}) {
  const value = String(password || "");
  const errors = [];

  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[A-Z]/.test(value)) errors.push("One uppercase letter");
  if (!/[a-z]/.test(value)) errors.push("One lowercase letter");
  if (!/[0-9]/.test(value)) errors.push("One number");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("One special character");

  const lowered = value.toLowerCase();
  const userPart = String(username || "").trim().toLowerCase();
  const emailLocal = String(email || "").split("@")[0]?.trim().toLowerCase() || "";
  if (userPart && userPart.length >= 3 && lowered.includes(userPart)) {
    errors.push("Must not contain your username");
  }
  if (emailLocal && emailLocal.length >= 3 && lowered.includes(emailLocal)) {
    errors.push("Must not contain your email name");
  }

  return {
    ok: errors.length === 0,
    errors,
    message: errors.length
      ? `Password must include: ${errors.join("; ")}.`
      : "",
  };
}

export const PASSWORD_HINT =
  "Use 8+ characters with upper & lower case, a number, and a special character.";
