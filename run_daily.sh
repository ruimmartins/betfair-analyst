#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Betfair Analyst - Daily Pipeline
# Fetch data → LLM Analysis (Gemini) → Save picks → Telegram
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "ERRO: Ficheiro .env não encontrado em $SCRIPT_DIR"
    exit 1
fi

# Validate required keys
for key in API_FOOTBALL_KEY GEMINI_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
    if [ -z "${!key:-}" ]; then
        echo "ERRO: $key não está definida no .env"
        exit 1
    fi
done

TODAY=$(date +"%Y-%m-%d")

echo "============================================"
echo "  Betfair Analyst Pipeline - $TODAY"
echo "============================================"
echo ""

# ---- Step 1: Fetch Data ----
echo "📡 [1/2] A buscar dados (fixtures, odds, stats, news)..."
echo ""
node fetch_data.js
echo ""

# ---- Step 2: Analyze + Save + Telegram ----
echo "🤖 [2/2] Análise Gemini + gravação + Telegram..."
echo ""
node gemini_analyze.js

echo ""
echo "============================================"
echo "  Pipeline completo!"
echo "============================================"
