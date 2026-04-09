@echo off
setlocal EnableDelayedExpansion

:: ═══════════════════════════════════════════════════════════════
:: PAW Agents — Windows Setup & Launcher
:: Checks requirements, installs dependencies, builds, and launches
:: ═══════════════════════════════════════════════════════════════

title PAW Agents Setup
color 0D

echo.
echo   =======================================
echo     PAW Agents -- Setup ^& Launcher
echo     Programmable Autonomous Workers
echo     v4.0.1
echo   =======================================
echo.

:: ─── Locate project root (one level up from scripts/) ───
set "PAW_ROOT=%~dp0.."
pushd "%PAW_ROOT%"
set "PAW_ROOT=%CD%"
popd

echo   [*] Project root: %PAW_ROOT%
echo.

:: ═══════════════════════════════════════════
:: STEP 1: Check Node.js
:: ═══════════════════════════════════════════
echo   [1/6] Checking Node.js...

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [!] Node.js is NOT installed.
    echo.
    echo   PAW Agents requires Node.js 20 or higher.
    echo   Choose an option:
    echo.
    echo     1. Open Node.js download page (recommended)
    echo     2. Try to install via winget
    echo     3. Exit
    echo.
    set /p NODE_CHOICE="   Your choice (1/2/3): "

    if "!NODE_CHOICE!"=="1" (
        start https://nodejs.org/en/download/
        echo.
        echo   [*] Opening nodejs.org in your browser...
        echo   [*] Install Node.js 20+, then re-run this script.
        echo.
        pause
        exit /b 1
    ) else if "!NODE_CHOICE!"=="2" (
        echo   [*] Installing Node.js via winget...
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        if !ERRORLEVEL! NEQ 0 (
            echo   [!] winget install failed. Please install Node.js manually from https://nodejs.org
            pause
            exit /b 1
        )
        echo   [*] Node.js installed. You may need to restart your terminal.
        echo   [*] Please close this window, open a new terminal, and re-run this script.
        pause
        exit /b 0
    ) else (
        echo   [*] Exiting.
        exit /b 1
    )
)

:: Check Node.js version (need 20+)
node -e "process.exit(parseInt(process.version.slice(1)) >= 20 ? 0 : 1)" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [!] Node.js version is too old. Need 20+, found:
    node -v
    echo   Please update from https://nodejs.org
    pause
    exit /b 1
)

for /f %%i in ('node -v') do set NODE_VER=%%i
echo   [OK] Node.js %NODE_VER%

:: ═══════════════════════════════════════════
:: STEP 2: Check npm
:: ═══════════════════════════════════════════
echo   [2/6] Checking npm...

where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [!] npm not found. It should come with Node.js.
    echo   Please reinstall Node.js from https://nodejs.org
    pause
    exit /b 1
)

for /f %%i in ('npm -v') do set NPM_VER=%%i
echo   [OK] npm v%NPM_VER%

:: ═══════════════════════════════════════════
:: STEP 3: Install root dependencies
:: ═══════════════════════════════════════════
echo.
echo   [3/6] Installing PAW framework dependencies...
echo         (this may take a minute on first run)
echo.

cd /d "%PAW_ROOT%"

if not exist "node_modules" (
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo   [!] npm install failed in root directory.
        pause
        exit /b 1
    )
) else (
    echo   [OK] Dependencies already installed (skipping)
)

:: ═══════════════════════════════════════════
:: STEP 4: Build the framework
:: ═══════════════════════════════════════════
echo.
echo   [4/6] Building PAW framework...

if not exist "dist" (
    call npm run build
    if !ERRORLEVEL! NEQ 0 (
        echo   [!] Build failed. Check for TypeScript errors.
        pause
        exit /b 1
    )
) else (
    echo   [OK] Already built (skipping). Run "npm run build" to rebuild.
)

:: ═══════════════════════════════════════════
:: STEP 5: Setup Desktop (PAW Hub)
:: ═══════════════════════════════════════════
echo.
echo   [5/6] Setting up PAW Hub (Desktop)...

cd /d "%PAW_ROOT%\desktop"

if not exist "node_modules" (
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo   [!] npm install failed for desktop.
        pause
        exit /b 1
    )
) else (
    echo   [OK] Desktop dependencies already installed
)

if not exist "dist" (
    call npm run build
    if !ERRORLEVEL! NEQ 0 (
        echo   [!] Desktop build failed.
        pause
        exit /b 1
    )
) else (
    echo   [OK] Desktop already built
)

:: ═══════════════════════════════════════════
:: STEP 6: Setup .env if missing
:: ═══════════════════════════════════════════
echo.
echo   [6/6] Checking configuration...

cd /d "%PAW_ROOT%"

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   [*] Created .env from .env.example
        echo   [*] IMPORTANT: Edit .env to add your API keys!
        echo.
        echo   TIP: For FREE local AI, install Ollama (https://ollama.com)
        echo        then set OLLAMA_ENABLED=true in .env
        echo.
    ) else (
        echo   [!] No .env.example found. Create a .env file manually.
    )
) else (
    echo   [OK] .env exists
)

:: ═══════════════════════════════════════════
:: LAUNCH
:: ═══════════════════════════════════════════
echo.
echo   =======================================
echo     Setup complete!
echo   =======================================
echo.
echo   Choose what to launch:
echo.
echo     1. PAW Hub (Desktop App)
echo     2. PAW Gateway + Hub (full stack)
echo     3. PAW CLI (terminal chat)
echo     4. Exit (launch later)
echo.
set /p LAUNCH_CHOICE="   Your choice (1/2/3/4): "

if "%LAUNCH_CHOICE%"=="1" (
    echo.
    echo   [*] Launching PAW Hub...
    cd /d "%PAW_ROOT%\desktop"
    start "" npx electron dist/main.js
) else if "%LAUNCH_CHOICE%"=="2" (
    echo.
    echo   [*] Starting PAW Gateway (background)...
    cd /d "%PAW_ROOT%"
    start "PAW Gateway" cmd /c "node dist/index.js"

    echo   [*] Waiting for gateway to initialize...
    timeout /t 3 /nobreak >nul

    echo   [*] Launching PAW Hub...
    cd /d "%PAW_ROOT%\desktop"
    start "" npx electron dist/main.js
) else if "%LAUNCH_CHOICE%"=="3" (
    echo.
    echo   [*] Starting PAW CLI...
    cd /d "%PAW_ROOT%"
    node dist/cli/index.js chat
) else (
    echo.
    echo   To launch later:
    echo     Hub:     cd desktop ^&^& npx electron dist/main.js
    echo     Gateway: npm start
    echo     CLI:     npm run chat
    echo.
)

echo.
echo   PAW Agents — https://github.com/DosukaSOL/paw-agents
echo.
pause
