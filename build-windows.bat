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

echo [1/4] node --version:
node --version
echo.

echo [2/4] Installing dependencies (npm install)...
call npm install
if errorlevel 1 (
  echo.
  echo [FAILED] npm install did not complete successfully.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.
echo.

echo [3/4] Building React app + Windows installer (electron:build:win)...
call npm run electron:build:win
if errorlevel 1 (
  echo.
  echo [FAILED] electron build failed - see the error above.
  pause
  exit /b 1
)
echo [OK] Installer built.
echo.

echo [4/4] Verifying desktop shell (local hash mode)...
call npm run electron:verify
if errorlevel 1 (
  echo.
  echo [WARN] Automated verify reported issues - check output above.
) else (
  echo [OK] Desktop verify passed.
)

echo.
echo ================================================
echo   BUILD SUCCESSFUL
echo ================================================
echo Find your files in release\dist\:
echo   - Nexora-POS-Pro-Setup-1.0.0.exe
echo   - Nexora-POS-Pro-Portable-1.0.0.exe
echo.
pause
