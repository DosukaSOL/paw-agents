#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PAW Agents — macOS/Linux Setup & Launcher
# Checks requirements, installs dependencies, builds, and launches
# ═══════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo ""
echo -e "${CYAN}  =======================================${NC}"
echo -e "${CYAN}    PAW Agents -- Setup & Launcher${NC}"
echo -e "${CYAN}    Programmable Autonomous Workers${NC}"
echo -e "${CYAN}    v4.0.5${NC}"
echo -e "${CYAN}  =======================================${NC}"
echo ""

# ─── Locate project root (one level up from scripts/) ───
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "  ${BOLD}[*]${NC} Project root: $PAW_ROOT"
echo ""

# ═══════════════════════════════════════════
# STEP 1: Check Node.js
# ═══════════════════════════════════════════
echo -e "  ${BOLD}[1/6]${NC} Checking Node.js..."

if ! command -v node &>/dev/null; then
    echo ""
    echo -e "  ${RED}[!] Node.js is NOT installed.${NC}"
    echo ""
    echo "  PAW Agents requires Node.js 20 or higher."
    echo ""

    # Detect OS for install suggestion
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  Install options:"
        echo ""
        echo "    1. brew install node       (Homebrew)"
        echo "    2. Open nodejs.org          (manual download)"
        echo "    3. Exit"
        echo ""
        read -rp "  Your choice (1/2/3): " NODE_CHOICE

        case "$NODE_CHOICE" in
            1)
                if command -v brew &>/dev/null; then
                    echo -e "  ${CYAN}[*] Installing Node.js via Homebrew...${NC}"
                    brew install node
                else
                    echo -e "  ${RED}[!] Homebrew not found. Install from https://brew.sh first.${NC}"
                    exit 1
                fi
                ;;
            2)
                open "https://nodejs.org/en/download/"
                echo -e "  ${CYAN}[*] Opening nodejs.org in your browser...${NC}"
                echo "  Install Node.js 20+, then re-run this script."
                exit 1
                ;;
            *)
                echo "  Exiting."
                exit 1
                ;;
        esac
    else
        # Linux
        echo "  Install options:"
        echo ""
        echo "    1. Install via NodeSource (recommended)"
        echo "    2. Open nodejs.org"
        echo "    3. Exit"
        echo ""
        read -rp "  Your choice (1/2/3): " NODE_CHOICE

        case "$NODE_CHOICE" in
            1)
                echo -e "  ${CYAN}[*] Installing Node.js 20 via NodeSource...${NC}"
                if command -v apt-get &>/dev/null; then
                    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                elif command -v dnf &>/dev/null; then
                    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                    sudo dnf install -y nodejs
                else
                    echo -e "  ${RED}[!] Could not detect package manager. Install manually.${NC}"
                    exit 1
                fi
                ;;
            2)
                xdg-open "https://nodejs.org/en/download/" 2>/dev/null || echo "  Visit: https://nodejs.org/en/download/"
                exit 1
                ;;
            *)
                echo "  Exiting."
                exit 1
                ;;
        esac
    fi
fi

# Check Node.js version (need 20+)
NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo -e "  ${RED}[!] Node.js version is too old. Need 20+, found: $(node -v)${NC}"
    echo "  Please update from https://nodejs.org"
    exit 1
fi

echo -e "  ${GREEN}[OK]${NC} Node.js $(node -v)"

# ═══════════════════════════════════════════
# STEP 2: Check npm
# ═══════════════════════════════════════════
echo -e "  ${BOLD}[2/6]${NC} Checking npm..."

if ! command -v npm &>/dev/null; then
    echo -e "  ${RED}[!] npm not found. It should come with Node.js.${NC}"
    echo "  Please reinstall Node.js from https://nodejs.org"
    exit 1
fi

echo -e "  ${GREEN}[OK]${NC} npm v$(npm -v)"

# ═══════════════════════════════════════════
# STEP 3: Install root dependencies
# ═══════════════════════════════════════════
echo ""
echo -e "  ${BOLD}[3/6]${NC} Installing PAW framework dependencies..."
echo "         (this may take a minute on first run)"
echo ""

cd "$PAW_ROOT"

if [ ! -d "node_modules" ]; then
    npm install
else
    echo -e "  ${GREEN}[OK]${NC} Dependencies already installed (skipping)"
fi

# ═══════════════════════════════════════════
# STEP 4: Build the framework
# ═══════════════════════════════════════════
echo ""
echo -e "  ${BOLD}[4/6]${NC} Building PAW framework..."

if [ ! -d "dist" ]; then
    npm run build
else
    echo -e "  ${GREEN}[OK]${NC} Already built (skipping). Run 'npm run build' to rebuild."
fi

# ═══════════════════════════════════════════
# STEP 5: Setup Desktop (PAW Hub)
# ═══════════════════════════════════════════
echo ""
echo -e "  ${BOLD}[5/6]${NC} Setting up PAW Hub (Desktop)..."

cd "$PAW_ROOT/desktop"

if [ ! -d "node_modules" ]; then
    npm install
else
    echo -e "  ${GREEN}[OK]${NC} Desktop dependencies already installed"
fi

if [ ! -d "dist" ]; then
    npm run build
else
    echo -e "  ${GREEN}[OK]${NC} Desktop already built"
fi

# ═══════════════════════════════════════════
# STEP 6: Setup .env if missing
# ═══════════════════════════════════════════
echo ""
echo -e "  ${BOLD}[6/6]${NC} Checking configuration..."

cd "$PAW_ROOT"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp ".env.example" ".env"
        echo -e "  ${CYAN}[*] Created .env from .env.example${NC}"
        echo -e "  ${YELLOW}[*] IMPORTANT: Edit .env to add your API keys!${NC}"
        echo ""
        echo "  TIP: For FREE local AI, install Ollama (https://ollama.com)"
        echo "       then set OLLAMA_ENABLED=true in .env"
        echo ""
    else
        echo -e "  ${RED}[!] No .env.example found. Create a .env file manually.${NC}"
    fi
else
    echo -e "  ${GREEN}[OK]${NC} .env exists"
fi

# ═══════════════════════════════════════════
# LAUNCH
# ═══════════════════════════════════════════
echo ""
echo -e "  ${CYAN}=======================================${NC}"
echo -e "  ${GREEN}  Setup complete!${NC}"
echo -e "  ${CYAN}=======================================${NC}"
echo ""
echo "  Choose what to launch:"
echo ""
echo "    1. PAW Hub (Desktop App)"
echo "    2. PAW Gateway + Hub (full stack)"
echo "    3. PAW CLI (terminal chat)"
echo "    4. Exit (launch later)"
echo ""
read -rp "  Your choice (1/2/3/4): " LAUNCH_CHOICE

case "$LAUNCH_CHOICE" in
    1)
        echo ""
        echo -e "  ${CYAN}[*] Launching PAW Hub...${NC}"
        cd "$PAW_ROOT/desktop"
        npx electron dist/main.js &
        ;;
    2)
        echo ""
        echo -e "  ${CYAN}[*] Starting PAW Gateway (background)...${NC}"
        cd "$PAW_ROOT"
        node dist/index.js &

        echo -e "  ${CYAN}[*] Waiting for gateway to initialize...${NC}"
        sleep 3

        echo -e "  ${CYAN}[*] Launching PAW Hub...${NC}"
        cd "$PAW_ROOT/desktop"
        npx electron dist/main.js &
        ;;
    3)
        echo ""
        echo -e "  ${CYAN}[*] Starting PAW CLI...${NC}"
        cd "$PAW_ROOT"
        node dist/cli/index.js chat
        ;;
    *)
        echo ""
        echo "  To launch later:"
        echo "    Hub:     cd desktop && npx electron dist/main.js"
        echo "    Gateway: npm start"
        echo "    CLI:     npm run chat"
        echo ""
        ;;
esac

echo ""
echo "  PAW Agents — https://github.com/DosukaSOL/paw-agents"
echo ""
