@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   NEXORA POS PRO - Windows Build Pipeline
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Install Node.js LTS from https://nodejs.org before running this script.
  pause
  exit /b 1
)

echo [1/5] node --version:
node --version
echo.

echo [2/5] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo [FAILED] npm install did not complete successfully.
  echo Check your internet connection and the error above, then re-run this script.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.
echo.

echo [3/5] Rebuilding native modules for Electron (better-sqlite3)...
call npm run rebuild
if errorlevel 1 (
  echo.
  echo [FAILED] electron-rebuild failed.
  echo This usually means Windows Build Tools are missing. Run this in an
  echo elevated PowerShell, then re-run this script:
  echo   npm install --global windows-build-tools
  pause
  exit /b 1
)
echo [OK] Native modules rebuilt for Electron.
echo.

echo [4/5] Building the React app (vite build)...
call npm run build
if errorlevel 1 (
  echo.
  echo [FAILED] vite build failed - see the error above.
  pause
  exit /b 1
)
echo [OK] React app built to dist/.
echo.

echo [5/5] Building the Windows installer and portable .exe...
call npm run electron:build:win
if errorlevel 1 (
  echo.
  echo [FAILED] electron-builder failed - see the error above.
  pause
  exit /b 1
)

echo.
echo ================================================
echo   BUILD SUCCESSFUL
echo ================================================
echo Find your files in the release\ folder:
echo   - Nexora-POS-Pro-Setup-1.0.0.exe      (installer)
echo   - Nexora-POS-Pro-Portable-1.0.0.exe   (portable, no install needed)
echo.
pause
