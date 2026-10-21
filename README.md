# Betfair Analyst

Sistema automatizado de deteção de value bets (+EV) em futebol. Recolhe fixtures, odds, estatísticas, lesões, H2H e notícias, pede ao Gemini para identificar odds mal precificadas, envia as picks para o Telegram e, no dia seguinte, avalia os resultados para alimentar um ciclo de aprendizagem (`lessons.md`).

## Arquitetura

```
Pré-jogo:  fetch_data.js → dossier.txt → gemini_analyze.js → history.md + Telegram
Pós-jogo:  evaluate_picks.js → evaluation_dossier.txt → gemini_evaluate.js → lessons.md
```

As lições de `lessons.md` são injetadas no dossier seguinte, fechando o feedback loop.

| Ficheiro | Função |
|---|---|
| `fetch_data.js` | Busca fixtures, odds, stats, lesões, H2H e notícias; escreve `dossier.txt` |
| `gemini_analyze.js` | Envia `analyst_prompt.md` + `dossier.txt` ao Gemini, grava em `history.md`, envia para o Telegram |
| `evaluate_picks.js` | Lê as picks de ontem em `history.md`, busca resultados/stats/notícias pós-jogo; escreve `evaluation_dossier.txt` |
| `gemini_evaluate.js` | Extrai lições com o Gemini e consolida `lessons.md` (re-sumarizado acima de 8000 caracteres) |
| `analyst_prompt.md` | System prompt do analista (critérios e formato de resposta) |
| `run_daily.sh` / `run_evaluate.sh` | Pipelines completos, prontos para cron, com commit e push automático dos ficheiros gerados |
| `test_match.js` | Testes do fuzzy matching de nomes de equipas |

## Requisitos

- Node.js
- Chave [API-Football](https://www.api-football.com/) (v3)
- Chave [Google Gemini](https://aistudio.google.com/apikey)
- Bot do Telegram (apenas para o pipeline diário)

## Instalação

```bash
npm install
```

```bash
cp .env.example .env
```

### Variáveis de ambiente (`.env`)

| Variável | Usada por | Notas |
|---|---|---|
| `API_FOOTBALL_KEY` | ambos os pipelines | Obrigatória |
| `GEMINI_API_KEY` | ambos os pipelines | Obrigatória |
| `GEMINI_MODEL` | ambos os pipelines | Opcional, default `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | pipeline diário | Obrigatória em `run_daily.sh` |
| `TELEGRAM_CHAT_ID` | pipeline diário | Obrigatória em `run_daily.sh` |
| `NEWS_API_KEY` | ambos os pipelines | Opcional; sem ela as notícias vêm do Google News RSS |

`ODDS_API_KEY` ainda aparece em `.env.example` mas já não é usada — as odds vêm da API-Football.

## Utilização

```bash
npm run daily
```

```bash
npm run eval
```

| Comando | O que faz |
|---|---|
| `npm run daily` | Pipeline pré-jogo completo (`run_daily.sh`) |
| `npm run eval` | Avaliação pós-jogo das picks de ontem (`run_evaluate.sh`) |
| `npm run fetch` | Só `fetch_data.js` |
| `npm run evaluate` | Só `evaluate_picks.js` |
| `npm test` | Testes de fuzzy matching |

Os dois scripts bash fazem `git add`, `commit` e `push` dos ficheiros gerados no fim da execução.

## Competições cobertas

- **Ligas:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Brasileirão, Primeira Liga, Eredivisie
- **Taças:** FA Cup, Copa del Rey, Coppa Italia, DFB Pokal, Coupe de France, Copa do Brasil, Taça de Portugal, KNVB Beker, EFL Cup, Taça da Liga
- **Europeias:** Champions League, Europa League, Conference League
- **América do Sul:** Libertadores, Sudamericana
- **Seleções:** Mundial, Euro, Copa América, Nations League
- **Supertaças:** Inglaterra, Espanha, Itália, Alemanha, França, Brasil, Portugal, Países Baixos

A lista completa (IDs da API-Football) está em `TARGET_LEAGUES` em `fetch_data.js`.

## Detalhes importantes

- Janela de jogos: 12:00–04:00 (hora de Lisboa)
- Season `2025` em `/teams/statistics`, `/injuries` e H2H
- Bookmakers priorizados: Betfair (ID 3) > Bet365 (ID 8) > restantes
- Rate limit da API-Football: 300 req/min, gerido por um limitador interno em `fetch_data.js`
- Fuzzy matching de equipas: similaridade ≥ 0.6, palavras com > 3 caracteres, palavra distintiva ≥ 5 caracteres
- Gemini: `temperature 0.3`, `maxOutputTokens 16384` na análise; mensagens do Telegram divididas em blocos de 4000 caracteres
- `date-fns-tz` v3: usar `toZonedTime` (não `utcToZonedTime`)

## Cron

Ambos os scripts são seguros para cron: definem o `PATH`, carregam o NVM se existir e fazem `cd` para a pasta do projeto. Para testar com um ambiente mínimo:

```bash
env -i HOME=$HOME PATH=/usr/bin:/bin bash run_evaluate.sh
```

## Documentação adicional

- [`CONTEXT.md`](CONTEXT.md) — referência de arquitetura, APIs e formato do dossier
- [`AGENTS.md`](AGENTS.md) — notas para agentes de código

## Aviso

Ferramenta de análise para uso pessoal. As picks geradas não constituem aconselhamento financeiro nem de apostas.
