# Electron Desktop 404 — Final QA Report

**Status: FIXED** (verified on packaged + freshly installed Windows app)

**Date:** 2026-07-23

---

## 1. Root cause

Installed Electron used `loadFile(dist/index.html)` → `file://` protocol.

React **`BrowserRouter`** reads `location.pathname`. On `file://` that is the **Windows filesystem path** (under `app.asar`), not `/login`.

No route matched → `NotFound.jsx` rendered:

> **404 — That page doesn't exist.**

Earlier “fixes” that only changed source without shipping a **new installer** left end users on the old `main` process still calling `loadFile`.

---

## 2. Startup URL used (packaged)

```
https://www.nexorapospro.com/login
```

Logged to: `%APPDATA%\nexora-pos-enterprise\nexora-electron.log`

---

## 3. How it was fixed

1. **Packaged Electron always `loadURL` the live Login page** (not `loadFile`).
2. Navigation / redirect logging to `nexora-electron.log`.
3. Local `file://` fallback only via **`file/.../index.html#/login`** + HashRouter (not bare `loadFile`).
4. Rebuild Vite + electron-builder; uninstall old app; silent-install new Setup; CDP verify Login UI.

---

## 4. Files changed

| File | Change |
|------|--------|
| `electron/main.cjs` | Production Login URL; logging; hash file fallback |
| `electron/preload.cjs` | Desktop bridge + API origin |
| `src/App.jsx` | HashRouter when `file:` |
| `src/lib/desktopRuntime.js` | Runtime helpers |
| `src/lib/authApi.js` | Absolute API URLs on `file:` |
| `src/pages/NotFound.jsx` | file:// safety redirect to login |
| `scripts/probe-electron-cdp.mjs` | CDP QA helper |

---

## 5. Test evidence (packaged / installed)

| Check | Result |
|-------|--------|
| `isPackaged=true` | PASS (`Nexora POS.exe` under Local\\Programs) |
| Startup URL | `https://www.nexorapospro.com/login` |
| Protocol | `https:` (not `file:`) |
| Pathname | `/login` |
| CDP body | Contains **Sign in**, Email, Password tabs |
| “That page doesn't exist” | **NO_404** |
| Fresh uninstall + `/S` install | PASS |
| New artifacts | `C:\nxpos-build\Nexora POS Setup 1.0.0.exe` (~119 MB) |
| Copied to | `release\dist\` |

### CDP sample (installed app)

```
URL https://www.nexorapospro.com/login
BODY … Sign in … Email … Password … Remember me …
NO_404
HAS_LOGIN_UI
```

---

## 6. Installer locations

- Local: `release\dist\Nexora POS Setup 1.0.0.exe`
- Also: `C:\nxpos-build\Nexora POS Setup 1.0.0.exe`
- Portable: `C:\nxpos-build\Nexora POS 1.0.0.exe`

**You must install this new build.** The previous installed copy was the broken `loadFile` build.

---

## 7. Remaining notes

- Desktop requires network to load the SaaS Login page (by design; APIs are on Vercel).
- Web app on Vercel unchanged for normal browsers (`BrowserRouter` on `https`).
- Re-upload GitHub Release asset so https://www.nexorapospro.com/download gets the new Setup binary.
