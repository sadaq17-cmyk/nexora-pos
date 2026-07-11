const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "serviceAccount.json");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

let cachedToken = null; // { token, expiresAt }

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function loadServiceAccount() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (!raw.project_id || !raw.client_email || !raw.private_key) return null;
    return raw;
  } catch {
    return null;
  }
}

function isConfigured() {
  return loadServiceAccount() !== null;
}

function signJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${unsigned}.${signature}`;
}

async function getAccessToken() {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) throw new Error("No Firebase service account configured.");

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.token, projectId: serviceAccount.project_id };
  }

  const jwt = signJwt(serviceAccount);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase auth failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return { token: cachedToken.token, projectId: serviceAccount.project_id };
}

module.exports = { getAccessToken, isConfigured, CONFIG_PATH };
