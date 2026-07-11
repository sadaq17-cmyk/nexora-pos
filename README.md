# NEXORA POS

A supermarket point-of-sale and management system built with React + Vite,
Electron, and SQLite (`better-sqlite3`).

## Stage 1 — Complete
## Stage 2 — Complete

Fully functional as of Stage 2:

**Stage 1:** Login (bcrypt + roles), SQLite database, Dashboard (live stats +
7-day trend), Products CRUD, Inventory + quick stock adjust, POS (barcode
scan, cart, discount, VAT, Cash/Card/M-Pesa), receipt printing, Sales
History, Customers.

**Stage 2, added on top:**
- **Suppliers** — full CRUD, purchase-order count and total spend per supplier computed live
- **Purchases** — create multi-line purchase orders; marking a PO "Received" increases product stock in one DB transaction
- **Expenses** — full CRUD with monthly total and by-category breakdown
- **Reports** — real charts from live queries: revenue vs expenses (6 months), top-selling products, category sales, gross profit this month
- **Settings** — functional: store info, VAT rate, payment method toggles, user list, all persisted to a `settings` key/value table
- **User roles & management** — admins can create users and assign `admin` / `manager` / `cashier` roles from Settings → Users & Roles (Settings itself is admin-only, enforced by `ProtectedRoute`)
- **Backup & Restore** — native save/open dialogs export or replace the actual SQLite file (WAL-checkpointed first so nothing recent is missed); restoring relaunches the app
- **Offline mode** — the app was already fully local-first; a live Online/Offline badge now sits in the top bar (`navigator.onLine` + `online`/`offline` events)
- **Firebase Sync** — pushes unsynced sales (`sales.synced = 0`) to Firestore. Implemented with **zero extra dependencies**: a service-account JWT is signed with Node's built-in `crypto` and exchanged for an OAuth2 token, then documents are written via Firestore's REST API using the built-in `fetch`. Disabled until you drop your own credentials into `electron/firebase/serviceAccount.json` (see `serviceAccount.example.json`)

## Getting started

```bash
npm install
npm run rebuild        # rebuilds better-sqlite3's native bindings against Electron's Node ABI
npm run electron:dev   # runs Vite + Electron together, with the real SQLite-backed API
```

`npm run dev` alone (no Electron) also works for quick UI iteration, but falls
back to an in-memory mock API (`src/lib/mockApi.js`) since `window.api` only
exists inside Electron's preload context. A banner appears in the app when
you're in mock mode. (Backup/Restore and real user creation require the
desktop app — the mock API returns a friendly "requires the desktop app" message.)

### Demo accounts (seeded on first run)

| Role     | Email                    | Password    |
|----------|---------------------------|-------------|
| Admin    | admin@nexorapos.com       | admin123    |
| Manager  | manager@nexorapos.com     | manager123  |
| Cashier  | cashier@nexorapos.com     | cashier123  |

### Enabling Firebase Sync

1. In the Firebase Console: Project Settings → Service Accounts → Generate New Private Key.
2. Save it as `electron/firebase/serviceAccount.json` (gitignored — never commit it).
3. In Settings → Backup & Sync, toggle "Enable auto-sync" or click "Sync Now".

### Building the desktop app

```bash
npm run electron:build:win
```

This requires internet access (Electron downloads its runtime binaries) and
must run on a machine with Node + build tools installed — it can't run inside
this sandbox. Two artifacts land in `release/`:
`NEXORA-POS-Setup-<version>.exe` (installer) and
`NEXORA-POS-Portable-<version>.exe` (portable).

No custom icon is bundled yet — electron-builder will use its default. Drop
a `.ico` at `electron/assets/icon.ico` and add `"icon": "electron/assets/icon.ico"`
back into the `win` block of `package.json` if you want your own.

## How this was tested

This project was built in a sandboxed environment with no network access, so
`npm install`, `vite dev`, and `electron` itself could never actually run
here. What *was* genuinely verified, offline, against the real files, for
both Stage 1 and Stage 2:

- Every `.js` Electron/Node file (main, preload, db, all IPC handlers,
  Firebase module) passed `node --check` — real syntax validation
- The full `schema.sql` was loaded into a real SQLite engine (Node's built-in
  `node:sqlite`) and every query used by every IPC handler was executed
  against it and checked, including: login, product CRUD + barcode lookup,
  the sale-creation transaction (with stock decrement), recent sales, weekly
  trend, customer spend/visit aggregation, supplier stats, purchase-order
  creation, the receive-PO stock-bump transaction, expense summaries, all
  three report aggregations (revenue vs expenses, top products, category
  sales, profit), settings upsert, and user creation with the unique-email
  constraint correctly rejecting a duplicate
- Every `.jsx`/`.js` file under `src/` was parsed with the TypeScript
  compiler (`tsc --jsx preserve --allowJs`) with zero syntax errors
- Every relative import in `src/` was confirmed to resolve to a real file
- Every IPC channel name was cross-checked between `preload.js` and every
  `ipcMain.handle` registration — an exact match both directions
- Every `api.module.method()` call used across all pages was confirmed to
  exist on both the real preload API and the mock API, via proper
  brace-matched parsing (not just string search)
- The mock API's actual JS logic was executed end-to-end
- The Firebase JWT-signing code was tested with a real generated RSA
  keypair: signed a JWT, then verified the signature against the public key
  exactly as Google's token endpoint would
- The Firestore field-type mapping function was checked against Firestore's
  documented REST `Value` format (stringValue/integerValue/doubleValue/
  booleanValue/nullValue) for every JS type it needs to handle

What this does **not** cover: an actual running Electron window, real
`better-sqlite3` native bindings, an actual Firestore write (needs your real
project + network), or a human clicking through the UI. The first real run
should happen with `npm run electron:dev` on a machine with network access,
and any issues at that point are expected — flag them and they'll be fixed
directly rather than guessed at blind.

## Project structure

```
electron/
  main.js              # BrowserWindow + IPC registration
  preload.js            # contextBridge — the only surface the renderer can call
  db/
    schema.sql
    database.js         # opens/creates the SQLite file
    seed.js              # first-run demo data
  ipc/
    authHandlers.js       # login, session, user management
    productHandlers.js
    salesHandlers.js
    customerHandlers.js
    supplierHandlers.js
    purchaseHandlers.js
    expenseHandlers.js
    reportHandlers.js
    settingsHandlers.js
    backupHandlers.js     # native save/open dialogs, DB file export/import
    syncHandlers.js       # Firebase sync trigger + status
  firebase/
    auth.js               # service-account JWT signing + OAuth2 token exchange
    firestore.js           # REST document writes, JS -> Firestore value mapping
    sync.js                 # pushes unsynced sales, marks them synced
    serviceAccount.example.json
src/
  main.jsx / App.jsx     # HashRouter + providers
  context/                # Auth + Toast
  components/             # Layout (sidebar/topbar + online badge), ProtectedRoute
  pages/                  # one file per route
  lib/
    api.js                # window.api, or mockApi fallback outside Electron
    mockApi.js
    useOnlineStatus.js
```

## What's next (Stage 3+)

- Wire the "Quick search" box in the top bar to something real
- Sale returns/refunds
- Multi-store / multi-till support
- Printer-specific (ESC/POS) receipt output instead of browser print, for thermal receipt printers
- Automated end-to-end tests once this runs on a machine with network access

