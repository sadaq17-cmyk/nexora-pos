import assert from "node:assert/strict";
import { computeDueDate, paymentTermsToDays } from "../src/lib/paymentTerms.js";

assert.equal(paymentTermsToDays("Net 30"), 30);
assert.equal(paymentTermsToDays("30 Days"), 30);
assert.equal(paymentTermsToDays("COD"), 0);
assert.equal(paymentTermsToDays("Net 15"), 15);

const base = new Date(Date.UTC(2026, 6, 21)); // 2026-07-21
assert.equal(computeDueDate("Net 30", base), "2026-08-20");
assert.equal(computeDueDate("COD", base), "2026-07-21");

console.log("payment-terms: PASS");
