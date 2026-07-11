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

function fromFirestoreValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
}

async function baseUrl(collection) {
  const { token, projectId } = await getAccessToken();
  return { token, url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}` };
}

async function createDocument(collection, docId, data) {
  const { token, url } = await baseUrl(collection);
  const res = await fetch(`${url}?documentId=${encodeURIComponent(docId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    if (res.status === 409) return updateDocument(collection, docId, data); // already exists -> upsert
    throw new Error(`Firestore create failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function updateDocument(collection, docId, data) {
  const { token, url } = await baseUrl(collection);
  const fieldPaths = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${url}/${encodeURIComponent(docId)}?${fieldPaths}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) throw new Error(`Firestore update failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function deleteDocument(collection, docId) {
  const { token, url } = await baseUrl(collection);
  const res = await fetch(`${url}/${encodeURIComponent(docId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore delete failed (${res.status}): ${await res.text()}`);
  return { success: true };
}

async function listDocuments(collection, pageSize = 300) {
  const { token, url } = await baseUrl(collection);
  const res = await fetch(`${url}?pageSize=${pageSize}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firestore list failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.documents || []).map((doc) => ({
    id: doc.name.split("/").pop(),
    fields: fromFirestoreFields(doc.fields),
    updateTime: doc.updateTime,
  }));
}

module.exports = { createDocument, updateDocument, deleteDocument, listDocuments, toFirestoreFields, fromFirestoreFields };
