# NEXORA POS

A supermarket point-of-sale and management system built with React + Vite,
Electron, and SQLite (`better-sqlite3`).

## Stage 1 — Complete
## Stage 2 — Complete (Enterprise)

**Stage 1:** Login (bcrypt + roles), SQLite database, Dashboard, Products CRUD,
Inventory + quick stock adjust, POS (barcode scan, cart, discount, VAT,
Cash/Card/M-Pesa), receipt printing, Sales History, Customers.

**Stage 2 Enterprise, added on top:**
- **Suppliers** — CRUD, running balance (accounts payable), payments, full statements
- **Customers** — CRUD, credit accounts with a credit limit, loyalty points (1 pt / Ksh 100), payments, full statements, purchase history
- **Purchases** — POs with a supplier invoice number, receiving (bumps stock *and* supplier balance in one transaction), purchase returns (reduces stock and supplier balance)
- **Expenses** — managed categories, daily entries, monthly summaries by category, receipt attachment (copies the file into the app's own folder via a native file dialog)
- **Reports** — a tabbed hub: Overview (charts), Sales, Purchases, Profit & Loss, Inventory (stock valuation), Low Stock, Customers (spend + balance), Suppliers (spend + balance)
- **User Management** — four roles: Admin, Manager, Cashier, Accountant
- **Roles & Permissions** — a real `role × module × action` matrix in SQLite (13 modules × 4 actions), editable per role in Settings; enforced *twice*: the sidebar/buttons hide what a role can't do, and every mutating IPC handler independently re-checks via `requirePermission()` so the UI hiding something is never the only thing stopping it
- **Backup & Restore** — manual export/import (unchanged from Stage 2 basic) *plus* scheduled automatic backups that run silently in the background on an interval you set, keeping the last 14
- **Firebase Sync** — now genuinely two-way: every mutation is recorded in a `sync_queue` table and pushed on connect; customers and suppliers (the master data multiple tills would share) are also *pulled* from Firestore with last-write-wins conflict resolution by `updated_at` timestamp. Background sync runs every 60s and immediately on reconnect (`navigator.onLine`)
- **Offline mode** — unchanged in spirit (SQLite is always local-first) but now has a real queue backing it, so "sync when connection returns" is an actual mechanism, not just a description
- **Audit Log** — every login, logout, failed login, create/update/delete across every module, permission change, and manual/automatic backup is recorded with who did it and when; viewable and filterable in the app (Audit Log page, permission-gated)

### Where I simplified scope on purpose

This is an enormous spec. A few things are real but intentionally not maximal:

- **Conflict resolution** is last-write-wins by timestamp, not a full merge/CRDT system — the right amount of sophistication for a single-store POS, and clearly documented in `electron/firebase/sync.js` if you need more later.
- **Two-way pull** only covers customers and suppliers (shared master data). Sales, purchases, and expenses are push-only ledgers — each till is authoritative for its own transactions, which is how most real multi-till POS systems are architected; pulling those back down would risk double-counting.
- **Menu visibility** is permission-filtered for the whole sidebar; **action-level button gating** is wired on the highest-traffic screens (Products, Inventory, Customers, Suppliers, Purchases, Expenses, Settings/Users). The server-side `requirePermission()` check is universal across every mutating handler regardless, so nothing is actually exploitable even where a button wasn't hidden.
- **Receipt template / barcode / printer settings** are stored and editable, and printer selection reads real OS printer names via Electron's `getPrintersAsync` — but receipt *rendering* still uses the browser print dialog (Stage 1's approach) rather than raw ESC/POS thermal printer commands.

## Getting started

```bash
npm install
npm run rebuild        # rebuilds better-sqlite3's native bindings against Electron's Node ABI
npm run electron:dev   # runs Vite + Electron together, with the real SQLite-backed API
```

`npm run dev` alone (no Electron) falls back to an in-memory mock API
(`src/lib/mockApi.js`) — every module works there too, including permissions,
audit logging, and statements, just without persistence.

### Demo accounts (seeded on first run)

| Role       | Email                      | Password       |
|------------|-----------------------------|-----------------|
| Admin      | admin@nexorapos.com         | admin123        |
| Manager    | manager@nexorapos.com       | manager123      |
| Cashier    | cashier@nexorapos.com       | cashier123      |
| Accountant | accountant@nexorapos.com    | accountant123   |

### Enabling Firebase Sync

1. Firebase Console → Project Settings → Service Accounts → Generate New Private Key.
2. Save it as `electron/firebase/serviceAccount.json` (gitignored).
3. In Settings → Backup & Sync, toggle "Enable background auto-sync" or click "Sync Now".

### Building the desktop app

```bash
npm run electron:build:win
```

Requires internet access (Electron downloads its runtime binaries) and a
machine with Node + build tools — can't run inside this sandbox. Outputs land
in `release/`: `NEXORA-POS-Setup-<version>.exe` and `NEXORA-POS-Portable-<version>.exe`.

## How this was tested

Same constraint as always: this sandbox has no network access, so
`npm install`, `vite dev`, and `electron` itself cannot actually run here.
Everything below was genuinely verified offline against the real files:

- Every `.js` Electron file (main, preload, db, all 13 IPC handler modules,
  the Firebase auth/firestore/sync/queue modules) passed `node --check`
- **76 IPC channels** cross-checked exact-match between every `ipcMain.handle`
  registration and `preload.js`
- **63 distinct `api.module.method()` calls** used across every page
  confirmed present on both the real preload API and the mock API, via
  brace-matched parsing (not naive string search)
- The full enterprise schema loaded into a real SQLite engine (Node's
  built-in `node:sqlite`) and exercised end-to-end: permission matrix seeding
  and every role's actual allow/deny rules, audit log writes, a credit sale
  (customer balance + loyalty points), customer payment reducing balance,
  supplier balance increasing on PO receipt and decreasing on payment, a
  purchase return reducing both stock and supplier balance, expense category
  uniqueness, every new report query (Sales, Purchase, P&L, Inventory,
  Low Stock, Customer, Supplier), the sync queue lifecycle, and the
  column-migration helper against a table missing the new columns
- A second full-schema smoke test inserted at least one row into **every
  single table** (14 tables) and verified `ON DELETE CASCADE` and both
  `CHECK` constraints (`users.role`, `permissions.action`) actually reject
  bad data
- Every `.jsx`/`.js` file parsed with the TypeScript compiler with zero
  syntax errors; every relative import confirmed to resolve to a real file
- The Firebase JWT-signing code was tested against a real generated RSA
  keypair (sign, then verify with the public key, as Google's token endpoint
  would); the Firestore value-mapping functions were checked against
  Firestore's documented REST format in both directions (JS → Firestore and
  Firestore → JS)

What this doesn't cover: an actual running Electron window, real
`better-sqlite3` bindings, a live Firestore read/write, or a human clicking
through the UI. First real run should be `npm run electron:dev` on a machine
with network access — report anything that breaks and it'll be fixed
directly rather than guessed at blind.

## Project structure

```
electron/
  main.js / preload.js / session.js / permissions.js / audit.js
  db/            schema.sql, database.js (+ migration), seed.js
  ipc/           13 handler modules — one per domain
  firebase/      auth.js (JWT), firestore.js (REST CRUD), sync.js (two-way),
                 queue.js (offline queue), serviceAccount.example.json
src/
  main.jsx / App.jsx     HashRouter + providers, every route permission-guarded
  context/                Auth (+ permissions), Toast
  components/             Layout (permission-filtered nav), ProtectedRoute
  pages/                  14 pages — one per module, incl. AuditLog
  lib/                    api.js, mockApi.js, useOnlineStatus.js
```


