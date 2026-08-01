/**
 * Guards against the Purchase Receive regression:
 *   admin.from(...).insert(...).catch is not a function
 * PostgREST builders are thenable but lack .catch — use quietSb/trySb/Promise.resolve.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "api", "_posData.js"), "utf8");

assert.match(src, /async function quietSb\(/, "quietSb helper missing");
assert.match(src, /async function trySb\(/, "trySb helper missing");
assert.match(src, /case "purchases\.receive":/, "purchases.receive case missing");
assert.match(src, /case "purchases\.approve":/, "purchases.approve case missing");
assert.match(src, /pos_approve_purchase/, "atomic approve RPC must be called");
assert.match(src, /opening_debit/, "supplier opening_debit accounting required");
assert.match(src, /PURCHASE_POSTED_STATUSES/, "posted-status gate required");

// Inside receive: stock_movements must use quietSb, not bare .catch on builder
const receiveIdx = src.indexOf('case "purchases.receive":');
const nextCase = src.indexOf("\n    case \"", receiveIdx + 10);
const receiveBlock = src.slice(receiveIdx, nextCase > 0 ? nextCase : undefined);

assert.match(receiveBlock, /quietSb\([\s\S]*stock_movements/, "receive must quietSb stock_movements insert");
assert.match(receiveBlock, /trySb\([\s\S]*purchases[\s\S]*status/, "receive must trySb purchase status update");
assert.match(receiveBlock, /receive_purchase/, "receive must write audit receive_purchase");
assert.match(receiveBlock, /canPurchaseAction\(caller\.role, "approve"/, "receive must require approve permission");
assert.match(receiveBlock, /from_approve/, "receive must support approve-gated inventory post");

const approveIdx = src.indexOf('case "purchases.approve":');
const approveNext = src.indexOf("\n    case \"", approveIdx + 10);
const approveBlock = src.slice(approveIdx, approveNext > 0 ? approveNext : undefined);
assert.match(approveBlock, /pos_approve_purchase/, "approve must prefer RPC transaction");
assert.match(approveBlock, /approve_purchase/, "approve must write audit");

// Create must not write product cost before approve (approval-gated costing).
const createIdx = src.indexOf('case "purchases.create":');
const createNext = src.indexOf("\n    case \"", createIdx + 10);
const createBlock = src.slice(createIdx, createNext > 0 ? createNext : undefined);
assert.equal(
  /products\"\)\.update\(\s*\{\s*cost:/.test(createBlock),
  false,
  "purchases.create must not update product cost before approve"
);
assert.match(createBlock, /Nothing posts to inventory or supplier AP before Approval/);

// No bare builder.catch in receive block (Promise.resolve(...).catch is OK; listScoped etc not in receive)
const bareCatch = receiveBlock.match(/admin[\s\S]{0,200}\.(insert|update)\([\s\S]{0,400}?\)\s*\n?\s*\.catch\(/);
assert.equal(bareCatch, null, `Unsafe builder.catch in purchases.receive:\n${bareCatch?.[0] || ""}`);

// Simulate thenable without .catch
const builder = {
  then(ok, fail) {
    return Promise.resolve({ data: null, error: null }).then(ok, fail);
  },
};
assert.equal(typeof builder.catch, "undefined");
await Promise.resolve(builder).catch(() => null);

console.log("purchase-receive-guard: PASS");
