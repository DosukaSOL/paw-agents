#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# PAW Agents — Quick Launcher (macOS/Linux)
# Starts the Gateway in the background, then opens PAW Hub
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "  ${BOLD}PAW Hub -- Quick Launcher${NC}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "  ${RED}[!] Node.js not found. Run paw-setup.sh first.${NC}"
    exit 1
fi

# Check builds
if [ ! -d "$PAW_ROOT/dist" ]; then
    echo -e "  ${RED}[!] Framework not built. Run paw-setup.sh first.${NC}"
    exit 1
fi

if [ ! -d "$PAW_ROOT/desktop/dist" ]; then
    echo -e "  ${RED}[!] Desktop not built. Run paw-setup.sh first.${NC}"
    exit 1
fi

# Create .env if missing
if [ ! -f "$PAW_ROOT/.env" ]; then
    if [ -f "$PAW_ROOT/.env.example" ]; then
        cp "$PAW_ROOT/.env.example" "$PAW_ROOT/.env"
        echo -e "  ${CYAN}[*] Created .env from template (edit to add API keys)${NC}"
    fi
fi

# Start Gateway
echo -e "  ${CYAN}[*] Starting PAW Gateway...${NC}"
cd "$PAW_ROOT"
node dist/index.js &
GATEWAY_PID=$!

# Wait for gateway
sleep 2

# Launch Hub
echo -e "  ${CYAN}[*] Launching PAW Hub...${NC}"
cd "$PAW_ROOT/desktop"
npx electron dist/main.js &

echo -e "  ${GREEN}[OK] PAW Hub launched!${NC}"
echo ""
echo "  Gateway PID: $GATEWAY_PID (kill $GATEWAY_PID to stop)"
echo ""
