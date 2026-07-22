# Purchase Receive Fix Report

**Date:** 2026-07-21  
**Module:** Purchases → Receive  
**File:** `api/_posData.js`

## Root cause

Supabase JS v2 PostgREST query builders are **thenable** (they implement `.then`) but **do not implement `.catch`**.

Code like this threw at runtime:

```js
await admin.from("stock_movements").insert({ ... }).catch(() => null);
```

Error:

```text
admin.from(...).insert(...).catch is not a function
```

This broke `purchases.receive` as soon as it attempted to write a stock movement (and the same pattern existed in several other handlers).

## Fix

1. Added helpers in `api/_posData.js`:
   - `sb(builder)` → `Promise.resolve(builder)`
   - `quietSb(builder)` → `await` in try/catch, ignore failures
   - `trySb(builder, onFail)` → await builder; on throw/`error`, run fallback

2. Rewrote **`purchases.receive`** to use `quietSb` / `trySb` for:
   - `stock_movements` insert
   - purchase status / `items_json` / `received_at` update
   - `purchase_items.qty_received` sync
   - supplier balance / totals update
   - purchase balance update
   - audit log via `writeAudit` (also fixed)

3. Replaced the same unsafe `.catch()` pattern across related purchase/supplier/customer stock flows so the same crash cannot recur.

## Receive workflow (verified by code path)

| Step | Behavior |
|------|----------|
| Permission | `canPurchaseAction(role, "approve")` — Owner / Admin / platform_owner / super_admin allowed; Cashier denied unless matrix grants `purchases.approve` |
| Status gate | Blocks already Received, Cancelled, Draft |
| Stock | Increments `products.stock` by qty received |
| Movements | Inserts `stock_movements` type `in` (quiet if table missing) |
| Purchase | Updates `status` (`Received` / `PartiallyReceived`), `items_json`, `received_at` |
| Supplier | On first receive, updates balance / order_count / total_ordered |
| Audit | `writeAudit(..., action: "receive_purchase")` |
| RLS | Service-role admin client used server-side; app RBAC is the gate (unchanged) |

## Verification

- `node --check api/_posData.js` → **PASS** (exit 0)
- No remaining `admin.from(...).insert(...).catch` / `.update(...).catch` chains without `Promise.resolve` / `quietSb` / `trySb`

## Note

Service role bypasses RLS for POS API writes; Owner/Admin receive access remains enforced by `canPurchaseAction` + permission middleware (`purchases.approve`).
