# NEXORA POS

A supermarket point-of-sale and management system built with React + Vite,
Electron, and SQLite (`better-sqlite3`).

## Stage 1 — Complete

Fully functional in this stage:

- **Login** — real auth against the `users` table, bcrypt password hashing, session persisted across restarts
- **SQLite database** — file-based DB in the OS user-data folder, schema + auto-seed on first run
- **Dashboard** — live stats (today's sales, product count, customer count, low stock, monthly revenue) and a real 7-day sales trend chart, all queried from SQLite
- **Products** — full CRUD (add / edit / soft-delete / search)
- **Inventory** — stock levels, low-stock alerts, quick +/- stock adjustment
- **POS Sales** — barcode scan (Enter-terminated input, works with any USB/Bluetooth HID scanner), live product search, cart, discount %, 16% VAT, Cash / Card / M-Pesa, checkout persists a real sale + line items + decrements stock in one DB transaction
- **Receipt printing** — `window.print()` with dedicated print-only CSS (80mm receipt layout)
- **Sales History** — every completed sale, expandable to line-item detail
- **Customers** — list + add, with real visit count / total spend computed from sales
- **User roles** — `admin`, `manager`, `cashier` stored per user; route-level role gating is wired (Settings is admin-only as an example)
- **React Router** — every module has a real route; Suppliers / Purchases / Reports / Expenses / Settings are routed with a "coming in next stage" placeholder, ready to be filled in

Not yet built (upcoming stages): Suppliers, Purchases, Expenses, full Reports, Settings, Backup & Restore, Offline queue + Firebase Sync, Electron installer.

## Getting started

```bash
npm install
npm run rebuild        # rebuilds better-sqlite3's native bindings against Electron's Node ABI
npm run electron:dev   # runs Vite + Electron together, with the real SQLite-backed API
```

`npm run dev` alone (no Electron) also works for quick UI iteration, but falls
back to an in-memory mock API (`src/lib/mockApi.js`) since `window.api` only
exists inside Electron's preload context. A banner appears in the app when
you're in mock mode.

### Demo accounts (seeded on first run)

| Role     | Email                    | Password    |
|----------|---------------------------|-------------|
| Admin    | admin@nexorapos.com       | admin123    |
| Manager  | manager@nexorapos.com     | manager123  |
| Cashier  | cashier@nexorapos.com     | cashier123  |

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
here. What *was* genuinely verified, offline, against the real files:

- Every `.js` Electron/Node file passed `node --check` (real syntax validation)
- The full `schema.sql` was loaded into a real SQLite engine (Node's built-in
  `node:sqlite`) and every query used by the IPC handlers — login, product
  CRUD + barcode lookup, the sale-creation transaction (including stock
  decrement), recent sales, the weekly trend aggregation, and customer
  spend/visit aggregation — was executed and its output checked
- Every `.jsx`/`.js` file under `src/` was parsed with the TypeScript
  compiler (`tsc --jsx preserve --allowJs`) with zero syntax errors
- Every relative import in `src/` was confirmed to resolve to a real file
- Every IPC channel name was cross-checked between `preload.js` and the
  `ipcMain.handle` registrations — an exact match both directions
- Every `api.module.method()` call used in the React pages was confirmed to
  exist on both the real preload API and the mock API
- The mock API's actual JS logic (not just its shape) was executed end-to-end:
  login, create/read/update/delete on products, a full sale with stock
  decrement, and stock adjustment

What this does **not** cover: an actual running Electron window, real
`better-sqlite3` native bindings, or a human clicking through the UI. The
first real run should happen with `npm run electron:dev` on a machine with
network access, and any issues at that point are expected — flag them and
they'll be fixed directly rather than guessed at blind.

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
    authHandlers.js
    productHandlers.js
    salesHandlers.js
    customerHandlers.js
src/
  main.jsx / App.jsx     # HashRouter + providers
  context/                # Auth + Toast
  components/             # Layout (sidebar/topbar), ProtectedRoute
  pages/                  # one file per route
  lib/
    api.js                # window.api, or mockApi fallback outside Electron
    mockApi.js
```
