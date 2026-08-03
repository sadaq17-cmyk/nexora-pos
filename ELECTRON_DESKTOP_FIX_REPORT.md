# Windows Desktop 404 — Verified Fix

**Status: FIXED (packaged EXE verified)**  
**Date:** 2026-08-03

## Root cause (immediate 404 on startup)

Packaged app could resolve the document URL as `…/index.html`. With **BrowserRouter**, React treated pathname `/index.html` as an unknown route → catch-all **NotFound (404)** before Login painted.

## Production entry (verified in asar)

| Check | Result |
|-------|--------|
| `dist/index.html` in `app.asar` | YES |
| `electron/main.cjs` in `app.asar` | YES |
| Production script (not `/src/main.jsx`) | `./assets/index-C_CulxFe.js` |
| Inline `__NEXORA_FORCE_HASH__` boot flag | YES |
| Startup URL | `nexora://app/#/login` |
| HashRouter forced | YES (`forceHashRouter` + protocol + boot flag) |

## Packaged EXE CDP verification

```
PACKAGED_URL nexora://app/#/login
STATE Sign in + Password, forceHash=true, hasDesktop=true
verify-packaged-exe: PASS
```

No SPA 404 on launch. Unauthenticated deep hashes redirect to Login (not 404).

## Artifacts (use these)

- **Installer:** `release\dist\Nexora-POS-Setup-1.0.0.exe` (matches website / GitHub `v1.0.0`)
- **Portable:** `release\dist\Nexora-POS-Portable-1.0.0.exe`
- Unpacked test binary: `release\dist\win-unpacked\Nexora POS Pro.exe`

Public release asset replaced 2026-08-03 — see `INSTALLER_RELEASE_AUDIT.md`.

## How to re-verify

```bat
npm run electron:build:win
node scripts/inspect-asar.mjs
npm run electron:verify:packaged
```

## Install note

Uninstall any older “Nexora POS Pro” build first, then run the new Setup.exe so Windows does not keep an old shortcut/asar.
