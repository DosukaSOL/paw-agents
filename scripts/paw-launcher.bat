@echo off
setlocal EnableDelayedExpansion

:: ═══════════════════════════════════════════════════════════════
:: PAW Agents — Quick Launcher (Windows)
:: Starts the Gateway in the background, then opens PAW Hub
:: ═══════════════════════════════════════════════════════════════

title PAW Hub Launcher

set "PAW_ROOT=%~dp0.."
pushd "%PAW_ROOT%"
set "PAW_ROOT=%CD%"
popd

echo.
echo   PAW Hub -- Quick Launcher
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [!] Node.js not found. Run paw-setup.bat first.
    pause
    exit /b 1
)

:: Check builds
if not exist "%PAW_ROOT%\dist" (
    echo   [!] Framework not built. Run paw-setup.bat first.
    pause
    exit /b 1
)

if not exist "%PAW_ROOT%\desktop\dist" (
    echo   [!] Desktop not built. Run paw-setup.bat first.
    pause
    exit /b 1
)

:: Create .env if missing
if not exist "%PAW_ROOT%\.env" (
    if exist "%PAW_ROOT%\.env.example" (
        copy "%PAW_ROOT%\.env.example" "%PAW_ROOT%\.env" >nul
        echo   [*] Created .env from template (edit to add API keys)
    )
)

:: Start Gateway
echo   [*] Starting PAW Gateway...
cd /d "%PAW_ROOT%"
start "PAW Gateway" /min cmd /c "node dist/index.js"

:: Wait for gateway
timeout /t 2 /nobreak >nul

:: Launch Hub
echo   [*] Launching PAW Hub...
cd /d "%PAW_ROOT%\desktop"
start "" npx electron dist/main.js

echo   [OK] PAW Hub launched!
echo.
timeout /t 3 /nobreak >nul
