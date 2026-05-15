# Betfair - AI Sports Betting Value Detection System

## Purpose
Sistema automatizado de deteção de value bets em futebol, usando AI para analisar dados e identificar odds mal precificadas (apostas +EV).

## Architecture

```
fetch_data.js (pré-jogo) → dossier.txt → AI Analyst → history.md
evaluate_picks.js (pós-jogo) → evaluation_dossier.txt → lessons.md (feedback loop)
```

## Files

| File | Role |
|------|------|
| `fetch_data.js` | Pipeline principal: busca fixtures, odds, stats, injuries, H2H e news. Escreve `dossier.txt` |
| `evaluate_picks.js` | Avaliação pós-jogo: lê history, busca resultados e stats via API-Football |
| `run_daily.sh` | Script bash: fetch → análise Gemini → grava picks no history.md → Telegram |
| `run_evaluate.sh` | Script bash: avaliação → Gemini extrai lições → grava no lessons.md |
| `gemini_analyze.js` | Chama Gemini para analisar dossier, grava history, envia Telegram |
| `gemini_evaluate.js` | Chama Gemini para extrair lições pós-jogo, grava lessons.md |
| `analyst_prompt.md` | System prompt para o AI analyst (regras de análise) |
| `history.md` | Log de picks recomendados pelo AI |
| `lessons.md` | Lições acumuladas que alimentam análises futuras |
| `dossier.txt` | Output gerado pelo fetch_data (dados do dia) |
| `test_match.js` | Testes para fuzzy matching |

## APIs Used (2026-05-15)
- **API-Football (v3)** - Primary source: fixtures, odds pre-match, team stats, injuries, H2H
- **NewsAPI.org (v2)** - Notícias de futebol com conteúdo completo. Requer API key (fallback: Google RSS)
- **The Odds API (v4)** - REMOVIDO (não necessário, API-Football já fornece odds)

## Target Competitions
**Countries:** Portugal, Espanha, França, Inglaterra, Alemanha, Itália, Brasil, Holanda

| Tipo | Competições |
|------|------------|
| Ligas | Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Brasileirão, Primeira Liga, Eredivisie |
| Taças | FA Cup, Copa del Rey, Coppa Italia, DFB Pokal, Coupe de France, Copa do Brasil, Taça de Portugal, KNVB Beker |
| Taças da Liga | EFL Cup (Carabao), Taça da Liga (Portugal) |
| Europeias | UCL, UEL, Conference League |

## Key Logic
- Janela temporal: 12:00-04:00 (hora de Lisboa)
- Peso: 70% stats/contexto, 30% news
- Fuzzy matching de nomes de equipas entre APIs
- Feedback loop: lessons.md → dossier → picks → evaluate → lessons.md
- Odds: apenas Betfair (API-Football)
- Season: 2025 (época actual)

## Stats Output Format (Compact)
```
H: GF:GC|CS:X|BTTS:X|Forma
A: GF:GC|CS:X|BTTS:X|Forma
H2H: V-E-D|GF:GC (Últ10)
INJ(H): Player: Type; ...
```

| Campo | Descrição |
|-------|-----------|
| GF:GC | Golos Marcados : Golos Sofridos |
| CS | Clean Sheets |
| BTTS | Both Teams To Score (se disponível) |
| Forma | Últimos 20 jogos (W=Win, D=Draw, L=Loss) |
| H2H | Head-to-head últimos 10 jogos |

## Tech Stack
Node.js, axios, date-fns, dotenv

## Current Status (2026-05-15)

### RESOLVIDO
- **API-Football substitui The Odds API** - Odds, stats, injuries e H2H via API-Football
- **Stats pré-live** - API-Football /teams/statistics (season 2025) fornece golos, clean sheets, forma
- **Injuries** - API-Football /injuries para lesões
- **H2H** - API-Football /fixtures/headtohead

### Limitações do Plano API-Football
- Sem classificação/rank (standings não incluído no plano)
- Sem BTTS detalhado
- Injuries muestran "Missing Fixture" se não há dados

### Still Using
- NewsAPI.org para notícias com conteúdo completo
- Google RSS como fallback para notícias
- Telegram para enviar picks

## Critical Context
- Season atual: 2025 (para /teams/statistics, /injuries, /h2h)
- API-Football rate limit: 10 requests/minuto
- API-Football bookmaker IDs: Betfair=3, Bet365=8
- Matching: ≥0.6 similarity ambas equipas, word length >3, distinctive word ≥5 chars
- `date-fns-tz` v3 usa `toZonedTime` (não `utcToZonedTime`)