# Changelog

## 2026-07-16 — Web App Conversion

### Added
- Browser-first SaaS shell with responsive sidebar navigation
- Login-first routing (`/` → `/login`, post-auth → `/dashboard`)
- Dark/light theme toggle with persisted preference
- New modules: Categories, Users, Roles & Permissions, Subscription
- POS enhancements: hold sales, split payment, barcode scan, discounts, tax, receipt print
- Sales returns workflow
- Inventory stock transfer and adjustment
- Dashboard widgets: revenue, today's/monthly sales, profit, top products, recent transactions
- `localStorage`-backed persistent data layer for web mode
- Vercel SPA deployment config (`vercel.json`)

### Changed
- Removed Electron/native SQLite build blockers from `package.json`
- Switched from `HashRouter` to `BrowserRouter`
- Rebranded to **Nexora POS Enterprise**

### Demo Accounts
- `admin@nexorapos.com` / `admin123`
- `manager@nexorapos.com` / `manager123`
- `cashier@nexorapos.com` / `cashier123`
- `accountant@nexorapos.com` / `accountant123`
