# Installing & Running NEXORA POS on Windows

This is the exact sequence to go from this source folder to a working
`NEXORA POS Setup.exe` on a Windows machine. It assumes nothing is installed yet.

---

## 1. Install prerequisites (one-time)

### Node.js
Download and install the **LTS** version from https://nodejs.org — pick the
Windows Installer (.msi), 64-bit. Accept the defaults. This also installs `npm`.

Verify it worked — open **Command Prompt** or **PowerShell** and run:
```
node --version
npm --version
```
Both should print a version number.

### Build Tools (needed for the SQLite database)
NEXORA POS uses `better-sqlite3`, which includes native code that must be
compiled for your machine. Open **PowerShell as Administrator** and run:
```
npm install --global windows-build-tools
```
If that command is unavailable or fails on newer Windows/npm versions,
install **Visual Studio Build Tools** instead:
1. Download from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. In the installer, check **"Desktop development with C++"**
3. Install (this takes a while — it's a few GB)

---

## 2. Get the project onto your machine

Unzip the NEXORA POS project folder anywhere, e.g. `C:\NexoraPOS`.

Open Command Prompt, and move into that folder:
```
cd C:\NexoraPOS\nexora-pos
```
(the folder containing `package.json`)

---

## 3. Build everything — the easy way

Double-click **`build-windows.bat`** in that folder.

It will, in order: install dependencies, rebuild the native database module
for Electron, build the React app, then build the Windows installer and
portable version — printing a clear `[OK]` or `[FAILED]` after each step so
you know exactly where things stand if something goes wrong.

When it finishes successfully, you'll find in the `release\` folder:
- **`NEXORA-POS-Setup-1.0.0.exe`** — the installer
- **`NEXORA-POS-Portable-1.0.0.exe`** — a single file, no installation needed

### Or, the manual way (same steps, run one at a time)
```
npm install
npm run rebuild
npm run build
npm run electron:build:win
```
If any step fails, the error message tells you which one — fix that, then
re-run from that step onward (you don't need to repeat earlier steps unless
you changed dependencies).

---

## 4. Install and run

**Installer (`NEXORA-POS-Setup-1.0.0.exe`):**
1. Double-click it.
2. Windows SmartScreen may say "Windows protected your PC" — this is
   because the app isn't code-signed (that requires a paid certificate).
   Click **"More info"** → **"Run anyway"**.
3. Choose an install location (or accept the default) and finish.
4. Launch **NEXORA POS** from the Start Menu or desktop shortcut it creates.

**Portable (`NEXORA-POS-Portable-1.0.0.exe`):**
Just double-click it — no installation, runs directly. Good for testing on a
machine you don't want to install anything on, or running off a USB stick.

### First login
The database seeds itself automatically on first launch. Sign in with:

| Role       | Email                      | Password       |
|------------|-----------------------------|-----------------|
| Admin      | admin@nexorapos.com         | admin123        |
| Manager    | manager@nexorapos.com       | manager123      |
| Cashier    | cashier@nexorapos.com       | cashier123      |
| Accountant | accountant@nexorapos.com    | accountant123   |

**Change these passwords in production** — they're seeded for first-run
convenience, not meant to stay in use.

---

## 5. Where your data lives

The SQLite database is created at:
```
%APPDATA%\NEXORA POS\nexora.db
```
(usually `C:\Users\<YourName>\AppData\Roaming\NEXORA POS\nexora.db`)

This survives reinstalling or updating the app. Back it up regularly —
Settings → Backup & Sync inside the app does this for you, including
automatic scheduled backups.

---

## 6. Troubleshooting

**"NODE_MODULE_VERSION mismatch" error on launch**
The native database module was built for the wrong Node/Electron version.
Re-run `npm run rebuild`, then rebuild the app.

**`npm install` fails partway through**
Almost always a flaky network or a corporate proxy/firewall blocking the npm
registry. Retry; if it keeps failing, check `npm config get proxy` and your
network's proxy settings.

**Antivirus deletes or blocks the .exe**
Unsigned Electron apps are sometimes flagged by aggressive antivirus
heuristics (false positive — this is extremely common for indie/internal
Electron apps). Add an exclusion for the `release\` folder, or the installed
app folder, in your antivirus settings.

**Windows Build Tools install fails**
Use the Visual Studio Build Tools installer instead (see step 1) — it's more
reliable on recent Windows versions than the older `windows-build-tools` npm
package.

**Blank white window on launch**
Usually means `npm run build` didn't complete, or `dist/` is missing/stale.
Re-run `npm run build` then `npm run electron:build:win`.

---

## 7. Updating after code changes

If you edit the source and want a new build:
```
npm run build
npm run electron:build:win
```
You only need `npm install` / `npm run rebuild` again if you changed
`package.json` dependencies.

---

## 8. Uninstalling

Use **Settings → Apps → NEXORA POS → Uninstall** in Windows, same as any
other application (this only applies to the Setup.exe install — the
portable .exe has nothing to uninstall, just delete the file). Your database
in `%APPDATA%\NEXORA POS\` is not removed automatically; delete that folder
too if you want a completely clean removal.
