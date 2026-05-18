# AGENTS.md

## Architecture in one sentence
`fetch_data.js` → `dossier.txt` → `gemini_analyze.js` → `history.md` + Telegram;
`evaluate_picks.js` → `evaluation_dossier.txt` → `gemini_evaluate.js` → `lessons.md`

## Commands

```bash
npm run daily      # Full pre-match pipeline (fetch + AI analysis + Telegram)
npm run eval       # Full post-match evaluation (results + lessons)
npm run fetch      # node fetch_data.js only
npm run evaluate   # node evaluate_picks.js only
npm test           # node test_match.js (fuzzy matching tests)
```

Run scripts directly: `bash run_daily.sh` / `bash run_evaluate.sh`

## Required Environment Variables

File: `.env` (loaded from `__dirname` in all scripts)

| Variable | Required by | Notes |
|---|---|---|
| `API_FOOTBALL_KEY` | Both pipelines | Primary data: fixtures, odds, stats, injuries, H2H |
| `GEMINI_API_KEY` | Both pipelines | |
| `GEMINI_MODEL` | Both pipelines | Optional; default `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | daily only | `run_daily.sh` exits if missing |
| `TELEGRAM_CHAT_ID` | daily only | `run_daily.sh` exits if missing |

`ODDS_API_KEY` appears in `.env.example` but is **no longer used** — The Odds API was removed; API-Football provides odds now.

## Critical Gotchas

- **`date-fns-tz` v3**: use `toZonedTime`, NOT `utcToZonedTime` (breaking change from v2)
- **Season parameter**: always `2025` for API-Football endpoints (`/teams/statistics`, `/injuries`, `/h2h`)
- **API-Football bookmaker IDs**: Betfair=3, Bet365=8
- **Rate limit**: 300 req/min — `fetch_data.js` manages this with a self-implemented sliding-window limiter; do not add bare `axios` calls outside it
- **Fuzzy matching threshold**: ≥0.6 similarity, word length >3, distinctive word ≥5 chars (used to reconcile team names across APIs)
- **Fixture time window**: 12:00–04:00 Lisbon time
- **`run_daily.sh`** uses `set -euo pipefail` — any non-zero exit from either node script aborts the whole pipeline
- **`run_evaluate.sh`** has macOS/GNU `date` compatibility shim for "yesterday" (`date -d` vs `date -v-1d`)

## State Files (Do Not Delete)

| File | Written by | Role |
|---|---|---|
| `dossier.txt` | `fetch_data.js` | Daily snapshot fed to Gemini |
| `history.md` | `gemini_analyze.js` | Cumulative pick log; input to `evaluate_picks.js` |
| `evaluation_dossier.txt` | `evaluate_picks.js` | Post-match results fed to Gemini |
| `lessons.md` | `gemini_evaluate.js` | Feedback loop; appended each evaluation cycle |

Picks go to `history.md` only — never to a `.txt` file (per `analyst_prompt.md`).

## Gemini Integration

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
- Uses Node's built-in `https` (not axios)
- Config: `temperature: 0.3`, `maxOutputTokens: 16384`
- `analyst_prompt.md` → system instruction; `dossier.txt` content → user message
- Telegram messages are chunked at 4000 chars with `(continuação N)` labels

## Docs

`CONTEXT.md` is the primary architectural reference (no README exists).
