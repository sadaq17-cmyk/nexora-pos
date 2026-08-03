# Windows Installer Release Audit

**Date:** 2026-08-03  
**Decision:** FIXED — public download verified Login (not 404)

---

## 1. Public download

| Item | Result |
|------|--------|
| Website page | `https://www.nexorapospro.com/download` |
| Installer URL | `https://github.com/sadaq17-cmyk/nexora-pos/releases/download/v1.0.0/Nexora-POS-Setup-1.0.0.exe` |
| Pre-fix size | 119,061,377 bytes (broken build) |
| Post-fix size | **115,572,382 bytes** (fixed build) |

---

## 2. Broken public EXE (confirmed)

Silent-installed the pre-fix download and launched with CDP:

| Check | Result |
|-------|--------|
| Launch URL | `file://…/app.asar/dist/index.html` (**no `#/login`**) |
| Hash | empty |
| `__NEXORA_FORCE_HASH__` | false |
| UI | **404 — “That page doesn't exist.”** |

### Root cause

Old `electron/main.cjs` called `loadFile(dist/index.html)`, which **drops the hash**. Combined with missing desktop HashRouter boot flags, React Router treated the Windows `file://` pathname as a route → SPA **NotFound (404)**.

---

## 3. Fix

Current production Electron entry (already in repo, now packaged & published):

- `loadURL(file://…/dist/index.html#/login)` — never bare `loadFile`
- `prepare-electron-dist.mjs` injects `__NEXORA_FORCE_HASH__` + `__NEXORA_DESKTOP_BUILD__`
- Desktop build uses `HashRouter` + `VITE_DESKTOP=true`
- NSIS artifact name aligned to website: `Nexora-POS-Setup-${version}.exe`

---

## 4. Rebuild & publish

```text
node scripts/build-electron-win.mjs
→ release/dist/Nexora-POS-Setup-1.0.0.exe
gh release upload v1.0.0 …/Nexora-POS-Setup-1.0.0.exe --clobber
```

Local packaged verify: `verify-packaged-exe: PASS` (Login + `#/login`).

---

## 5. Re-test from public URL (required gate)

1. Re-downloaded `Nexora-POS-Setup-1.0.0.exe` from GitHub release (115,572,382 bytes — matches build)
2. Silent-installed to a clean directory
3. CDP launch result:

| Check | Result |
|-------|--------|
| URL | `file://…/dist/index.html#/login` |
| `forceHash` / `desktopBuild` | true |
| UI | **Sign in + Password** |
| 404 | **false** |

`verify-any-exe: PASS (Login OK)`

HEAD on the public release URL also returns **200 / 115572382**.

---

## Status: COMPLETE
