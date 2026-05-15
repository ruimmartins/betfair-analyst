#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Betfair Analyst - Post-Match Evaluation Pipeline
# Evaluate picks → LLM extracts lessons → Update lessons.md
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "ERRO: Ficheiro .env não encontrado."
    exit 1
fi

for key in API_FOOTBALL_KEY GEMINI_API_KEY; do
    if [ -z "${!key:-}" ]; then
        echo "ERRO: $key não está definida no .env"
        exit 1
    fi
done

YESTERDAY=$(date -d "yesterday" +"%Y-%m-%d" 2>/dev/null || date -v-1d +"%Y-%m-%d")

echo "============================================"
echo "  Betfair Evaluation Pipeline - $YESTERDAY"
echo "============================================"
echo ""

# ---- Step 1: Generate evaluation dossier ----
echo "📡 [1/2] A avaliar picks de ontem..."
echo ""
node evaluate_picks.js
echo ""

# ---- Step 2: Extract lessons via Gemini ----
echo "🤖 [2/2] A extrair lições com Gemini..."
echo ""
node gemini_evaluate.js

echo ""
echo "============================================"
echo "  Evaluation pipeline completo!"
echo "============================================"
