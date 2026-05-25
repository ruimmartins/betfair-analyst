#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Betfair Analyst - Post-Match Evaluation Pipeline
# Evaluate picks → LLM extracts lessons → Update lessons.md
# ============================================================

# Ensure PATH includes common Node.js locations (for cron)
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH

# If using nvm, load it
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Debug: log where we are and what we see
echo "DEBUG: Running from: $(pwd)"
echo "DEBUG: history.md exists: $([ -f history.md ] && echo 'YES' || echo 'NO')"
echo "DEBUG: Node path: $(which node 2>&1 || echo 'node not found in PATH')"
echo "DEBUG: Node version: $(node --version 2>&1 || echo 'ERROR: cannot execute node')"
echo ""

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
EVAL_EXIT=$?
echo ""

if [ $EVAL_EXIT -ne 0 ]; then
    echo "Evaluation aborted."
    exit 1
fi

# ---- Step 2: Extract lessons via Gemini ----
echo "🤖 [2/2] A extrair lições com Gemini..."
echo ""
node gemini_evaluate.js

echo ""
echo "============================================"
echo "  Evaluation pipeline completo!"
echo "============================================"

# ---- Step 3: Git commit & push ----
echo ""
echo "📦 A fazer commit e push dos ficheiros gerados..."
git add history.md lessons.md evaluation_dossier.txt 2>/dev/null || true
if git diff --cached --quiet; then
    echo "Sem alterações para commitar."
else
    git commit -m "eval: lessons $YESTERDAY [auto]"
    git push && echo "Push concluído." || echo "AVISO: git push falhou (continuando)."
fi
