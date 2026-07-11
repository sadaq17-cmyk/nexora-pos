const { getAccessToken } = require("./auth");

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFirestoreValue(v)]));
}

async function createDocument(collection, docId, data) {
  const { token, projectId } = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    // 409 = document already exists (already synced from a previous run) — not a real failure.
    if (res.status === 409) return { alreadyExists: true };
    const body = await res.text();
    throw new Error(`Firestore write failed (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { createDocument, toFirestoreFields };
