require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { format, addDays } = require('date-fns');
const { formatInTimeZone, toZonedTime } = require('date-fns-tz');

// === API Key Validation ===
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
function validateKeys() {
    if (!API_FOOTBALL_KEY) {
        console.error(`ERRO: API_FOOTBALL_KEY em falta no .env`);
        process.exit(1);
    }
}

// === Rate Limiting ===
const THROTTLE_MS = 500;
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// NewsAPI rate limit tracker
const newsApiState = { rateLimited: false };

// API-Football rate limiter: max 10 requests per minute
const apiFootballRateLimit = {
    timestamps: [],
    async wait() {
        const now = Date.now();
        // Remove timestamps older than 60s
        this.timestamps = this.timestamps.filter(t => now - t < 60000);
        if (this.timestamps.length >= 10) {
            const waitTime = 60000 - (now - this.timestamps[0]) + 100;
            console.log(`  ⏳ Rate limit: waiting ${Math.ceil(waitTime/1000)}s for API-Football...`);
            await sleep(waitTime);
            this.timestamps = this.timestamps.filter(t => Date.now() - t < 60000);
        }
        this.timestamps.push(Date.now());
    }
};

// === Retry Logic ===
async function withRetry(fn, retries = 2, delayMs = 1000) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries) throw error;
            console.log(`  Retry ${i + 1}/${retries} after error: ${error.message}`);
            await sleep(delayMs * (i + 1));
        }
    }
}

// === Target Competitions ===
// Leagues + Cups + League Cups for: Portugal, Spain, France, England, Germany, Italy, Brazil, Netherlands
const TARGET_LEAGUES = [
    // Main Leagues
    39,  // Premier League (England)
    140, // La Liga (Spain)
    135, // Serie A (Italy)
    78,  // Bundesliga (Germany)
    61,  // Ligue 1 (France)
    71,  // Brasileirão Série A (Brazil)
    94,  // Primeira Liga (Portugal)
    88,  // Eredivisie (Netherlands)
    // Cups
    45,  // FA Cup (England)
    143, // Copa del Rey (Spain)
    137, // Coppa Italia (Italy)
    81,  // DFB Pokal (Germany)
    66,  // Coupe de France (France)
    73,  // Copa do Brasil (Brazil)
    96,  // Taça de Portugal (Portugal)
    90,  // KNVB Beker (Netherlands)
    // League Cups
    48,  // EFL Cup / Carabao Cup (England)
    97,  // Taça da Liga (Portugal)
    // European
    2,   // UEFA Champions League
    3,   // UEFA Europa League
    848, // UEFA Europa Conference League
];

// Mapping league IDs → news language (ISO 639-1)
const LEAGUE_LANGUAGE = {
    39: 'en', 45: 'en', 48: 'en',   // England
    140: 'es', 143: 'es',            // Spain
    135: 'it', 137: 'it',            // Italy
    78: 'de', 81: 'de',              // Germany
    61: 'fr', 66: 'fr',              // France
    71: 'pt', 73: 'pt',              // Brazil (Portuguese)
    94: 'pt', 96: 'pt', 97: 'pt',   // Portugal
    88: 'nl', 90: 'nl',              // Netherlands
    2: 'en', 3: 'en', 848: 'en',    // European (default English)
};

// === Fuzzy Matching (improved) ===
function normalizeTeamName(name) {
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/fc|cf|sc|ac|as|ss|us|rc|rcd|cd|ud|sd/g, '') // remove common prefixes
        .replace(/[^a-z0-9\s]/g, '') // remove punctuation
        .trim()
        .replace(/\s+/g, ' ');
}

function teamNameSimilarity(name1, name2) {
    const n1 = normalizeTeamName(name1);
    const n2 = normalizeTeamName(name2);
    
    // Exact match after normalization
    if (n1 === n2) return 1.0;
    
    // One contains the other fully (but only if the shorter string is meaningful enough - 5+ chars)
    const shorter = n1.length <= n2.length ? n1 : n2;
    const longer = n1.length <= n2.length ? n2 : n1;
    if (shorter.length >= 5 && longer.includes(shorter)) return 0.8;
    
    // Check if significant words overlap — require ALL significant words from the shorter name to match
    const words1 = n1.split(' ').filter(w => w.length > 3);
    const words2 = n2.split(' ').filter(w => w.length > 3);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const shorterWords = words1.length <= words2.length ? words1 : words2;
    const longerWords = words1.length <= words2.length ? words2 : words1;
    
    const matchedWords = shorterWords.filter(w => longerWords.some(w2 => w === w2));
    
    // Require ALL significant words from shorter name to be present in longer
    if (matchedWords.length === shorterWords.length && shorterWords.length > 0) {
        return 0.7;
    }
    
    // Partial match — at least the longest/most distinctive word must match exactly
    const distinctiveWord = shorterWords.reduce((a, b) => a.length >= b.length ? a : b, '');
    if (distinctiveWord.length >= 5 && longerWords.includes(distinctiveWord)) {
        return 0.6;
    }
    
    return 0;
}

function matchOddsToFixture(fixture, oddsData) {
    const homeTeam = fixture.teams.home.name;
    const awayTeam = fixture.teams.away.name;

    let bestMatch = null;
    let bestScore = 0;

    for (const odd of oddsData) {
        const homeScore = teamNameSimilarity(homeTeam, odd.home_team);
        const awayScore = teamNameSimilarity(awayTeam, odd.away_team);
        
        // Both teams must have at least 0.6 similarity
        if (homeScore >= 0.6 && awayScore >= 0.6) {
            const combinedScore = homeScore + awayScore;
            if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestMatch = odd;
            }
        }
    }

    if (!bestMatch) {
        console.log(`  ⚠️ Failed to match odds: ${homeTeam} vs ${awayTeam}`);
    }

    return bestMatch;
}

async function fetchFixtures() {
    const now = new Date();
    const dateStr1 = formatInTimeZone(now, 'Europe/Lisbon', 'yyyy-MM-dd');
    const dateStr2 = formatInTimeZone(addDays(now, 1), 'Europe/Lisbon', 'yyyy-MM-dd');

    console.log(`Fetching fixtures for ${dateStr1} and ${dateStr2}...`);
    
    let allFixtures = [];
    
    for (const date of [dateStr1, dateStr2]) {
        await apiFootballRateLimit.wait();
        try {
            const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/fixtures', {
                params: { date },
                headers: { 'x-apisports-key': API_FOOTBALL_KEY }
            }));
            if (res.data && res.data.response) {
                allFixtures = allFixtures.concat(res.data.response);
            }
        } catch (error) {
            console.error(`Error fetching API-Football for ${date}:`, error.message);
        }
    }

    // Filter by timeframe: 12:00 today to 04:00 tomorrow (Lisbon time)
    // Convert boundaries to UTC for correct comparison with fixture dates (which are ISO/UTC)
    const startUTC = new Date(`${dateStr1}T12:00:00+00:00`);
    // Adjust for Lisbon offset: Lisbon is UTC+0 in winter, UTC+1 in summer (WEST)
    // Instead of guessing, convert properly using the fixture's own time
    // Better approach: convert each fixture time to Lisbon and check
    const filtered = allFixtures.filter(f => {
        if (!TARGET_LEAGUES.includes(f.league.id)) return false;
        const matchTimeUTC = new Date(f.fixture.date);
        const matchTimeLisbon = formatInTimeZone(matchTimeUTC, 'Europe/Lisbon', 'HH:mm');
        const matchDateLisbon = formatInTimeZone(matchTimeUTC, 'Europe/Lisbon', 'yyyy-MM-dd');
        
        const [hours, minutes] = matchTimeLisbon.split(':').map(Number);
        const timeInMinutes = hours * 60 + minutes;
        
        // Window: 12:00 today to 04:00 tomorrow (Lisbon)
        if (matchDateLisbon === dateStr1 && timeInMinutes >= 720) return true; // 12:00+
        if (matchDateLisbon === dateStr2 && timeInMinutes <= 240) return true; // until 04:00
        return false;
    });

    console.log(`Found ${filtered.length} target matches in the time window.`);
    return filtered;
}

// Fetch odds from API-Football for a specific fixture
async function fetchOddsFromApiFootball(fixtureId) {
    await apiFootballRateLimit.wait();
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/odds', {
            params: { fixture: fixtureId },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));

        if (res.data?.response?.[0]?.bookmakers) {
            const bookmakers = res.data.response[0].bookmakers;
            return bookmakers.map(bm => ({
                title: bm.name,
                id: bm.id,
                markets: bm.bets.map(bet => ({
                    key: bet.name,
                    outcomes: bet.values.map(v => ({
                        name: v.value,
                        price: v.odd
                    }))
                }))
            }));
        }
        return null;
    } catch (error) {
        console.error(`  Error fetching odds from API-Football for fixture ${fixtureId}:`, error.message);
        return null;
    }
}

// Prioritize bookmakers: Betfair > Bet365 > rest (API-Football)
function prioritizeApiFootballBookmakers(bookmakers) {
    // Betfair = id 3, Bet365 = id 8
    const priorityIds = [3, 8];
    const sorted = [...bookmakers].sort((a, b) => {
        const aIdx = priorityIds.indexOf(a.id);
        const bIdx = priorityIds.indexOf(b.id);
        const aRank = aIdx >= 0 ? aIdx : 999;
        const bRank = bIdx >= 0 ? bIdx : 999;
        return aRank - bRank;
    });
    return sorted;
}

// Fetch team statistics - COMPACT FORMAT
async function fetchTeamStats(teamId, teamName, leagueId, season) {
    console.log(`  Fetching stats for ${teamName} (league ${leagueId}, season ${season})...`);
    await apiFootballRateLimit.wait();
    // Use season 2025 for current season (2025/2026)
    const effectiveSeason = season || 2025;
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/teams/statistics', {
            params: { team: teamId, league: leagueId, season: effectiveSeason },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        
        
        
        if (res.data && res.data.response && !res.data.errors?.plan) {
            const s = res.data.response;
            const rank = s.league?.standings?.[0]?.[0]?.rank || '-';
            const pts = s.league?.standings?.[0]?.[0]?.points || '-';
            const pj = s.games?.played?.home + s.games?.played?.away || '-';
            const v = s.games?.win?.home + s.games?.win?.away || '-';
            const e = s.games?.draw?.home + s.games?.draw?.away || '-';
            const d = s.games?.lose?.home + s.games?.lose?.away || '-';
            const gf = s.goals?.for?.total?.total || '-';
            const gc = s.goals?.against?.total?.total || '-';
            const form = s.form || '-';
            const cs = s.clean_sheet?.home + s.clean_sheet?.away || '-';
            const btts = s.btts?.yes?.home + s.btts?.yes?.away || '-';
            
            // More readable format for AI
            const rankInfo = rank !== '-' && pts !== '-' ? `Rank:${rank}º Pts:${pts} | ` : '';
            return `${rankInfo}GF:${gf} GC:${gc} | CS:${cs} | Forma:${form}`;
        } else {
            return "Stats:N/A";
        }
    } catch (error) {
        return "Stats:Err";
    }
}

// Fetch injuries for a team
async function fetchInjuries(teamId, teamName, leagueId, season) {
    await apiFootballRateLimit.wait();
    const effectiveSeason = season || 2025;
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/injuries', {
            params: { team: teamId, league: leagueId, season: effectiveSeason },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        
        if (res.data?.response?.length > 0) {
            const players = res.data.response
                .filter(i => i.game?.status?.short !== 'FT' && i.game?.status?.short !== 'NS')
                .slice(0, 5)
                .map(i => `${i.player?.name}: ${i.player?.type}`);
            
            if (players.length > 0) return players.join('; ');
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Fetch head-to-head - COMPACT FORMAT
async function fetchH2H(homeId, awayId) {
    await apiFootballRateLimit.wait();
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/fixtures/headtohead', {
            params: { h2h: `${homeId}-${awayId}`, last: 10 },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        
        if (res.data?.response?.length > 0) {
            let v = 0, e = 0, d = 0, gf = 0, gc = 0;
            for (const f of res.data.response) {
                const hs = f.score?.fulltime?.home ?? 0;
                const as = f.score?.fulltime?.away ?? 0;
                if (hs > as) v++;
                else if (hs === as) e++;
                else d++;
                gf += hs;
                gc += as;
            }
            return `${v}-${e}-${d}|${gf}:${gc}`;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Parse Google News RSS XML to extract items
function parseGoogleNewsRSS(xml) {
    const items = [];
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    for (const match of itemMatches) {
        const content = match[1];
        const title = content.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const link = content.match(/<link>(.*?)<\/link>/)?.[1] || '';
        const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        const description = content.match(/<description>(.*?)<\/description>/)?.[1] || '';
        const source = content.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || '';
        // Decode HTML entities in title
        const cleanTitle = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        items.push({ title: cleanTitle, link, pubDate, description, source });
    }
    return items;
}

// Fetch stats from Google News RSS — extract team-specific info from article titles
async function fetchStatsFromWeb(teamName) {
    await sleep(THROTTLE_MS);
    try {
        const query = encodeURIComponent(`"${teamName}" season 2025 2026 form results standings`);
        const url = `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`;
        const res = await withRetry(() => axios.get(url, { timeout: 10000 }));
        const items = parseGoogleNewsRSS(res.data);

        // Filter for stats-relevant articles that mention the team name
        const teamWords = teamName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const relevant = items.filter(item => {
            const text = item.title.toLowerCase();
            // Must mention the team
            const mentionsTeam = teamWords.some(w => text.includes(w));
            if (!mentionsTeam) return false;
            // Must be stats-related
            return /form|standing|table|result|stats|season|points|goal|position|relegat|promot|champion|preview|prediction|analysis/i.test(item.title)
                && !IRRELEVANT_PATTERNS.some(p => p.test(item.title));
        });

        const selected = relevant.length > 0 ? relevant.slice(0, 3) : items.filter(item => {
            const text = item.title.toLowerCase();
            return teamWords.some(w => text.includes(w));
        }).slice(0, 3);

        if (selected.length > 0) {
            return `[Dados via Web]: ${selected.map(i => i.title).join(' | ')}`;
        }

        return "Estatísticas indisponíveis.";
    } catch (error) {
        return "Erro ao procurar estatísticas na Web.";
    }
}

// Keywords that indicate irrelevant news (scheduling, streaming, TV, tickets)
const IRRELEVANT_PATTERNS = [
    /onde assistir/i, /where to watch/i, /how to watch/i, /live stream/i,
    /tv channel/i, /streaming options/i, /horário/i, /kick.?off time/i,
    /tickets?\b/i, /bilhetes/i, /transmiss/i, /broadcast/i,
    /fantasy\s*(football|soccer)/i, /fpl\b/i, /dream\s*team/i,
    /fan\s*zone/i, /merchandise/i
];

// Keywords that indicate relevant news (injuries, lineups, tactics, suspensions, form)
const RELEVANT_PATTERNS = [
    /injur/i, /lesão/i, /lesionado/i, /lesões/i,
    /suspend/i, /suspenso/i, /expuls/i, /red card/i, /cartão vermelho/i,
    /lineup/i, /line.?up/i, /escalação/i, /alineacion/i,
    /doubtful/i, /dúvida/i, /miss/i, /ausência/i, /absent/i,
    /transfer/i, /signing/i, /loan/i, /contrat/i,
    /coach/i, /manager/i, /sacked/i, /fired/i, /treinador/i, /demitido/i,
    /tactic/i, /formation/i, /tática/i, /esquema/i,
    /form\b/i, /streak/i, /unbeaten/i, /invicto/i, /sequência/i,
    /relegat/i, /descida/i, /manutenção/i, /promot/i, /subida/i,
    /title\s*race/i, /champion/i, /campeão/i, /título/i,
    /derby/i, /rival/i, /clássico/i,
    /crisis/i, /crise/i, /dressing room/i, /balneário/i,
    /key\s*player/i, /star\s*player/i, /captain/i, /capitão/i,
    /goal.?scor/i, /artilheiro/i, /top\s*scorer/i,
    /preview/i, /prediction/i, /analysis/i, /anális/i,
    /betting/i, /odds/i, /aposta/i
];

function isRelevantNews(title, description) {
    const text = `${title} ${description || ''}`;
    // Exclude if matches irrelevant patterns
    if (IRRELEVANT_PATTERNS.some(p => p.test(text))) return false;
    // Include if matches relevant patterns, or if it has a meaningful description
    if (RELEVANT_PATTERNS.some(p => p.test(text))) return true;
    // Default: include if description is substantial (50+ chars)
    return (description || '').length >= 50;
}


async function fetchNews(homeTeam, awayTeam, leagueId) {
    console.log(`  Fetching news for: ${homeTeam} vs ${awayTeam}`);

    const newsApiKey = process.env.NEWS_API_KEY;
    const language = LEAGUE_LANGUAGE[leagueId] || 'en';

    // If NewsAPI key available and not rate limited, use it
    if (newsApiKey && newsApiKey !== 'YOUR_NEWSAPI_KEY_HERE' && !newsApiState.rateLimited) {
        return await fetchNewsFromNewsAPI(homeTeam, awayTeam, newsApiKey, language);
    }

    // Fallback to Google News RSS
    return await fetchNewsFromGoogleRSS(homeTeam, awayTeam);
}

async function fetchArticleContent(url) {
    try {
        const res = await withRetry(() => axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }));
        let text = res.data;
        // Remove script and style tags completely
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        // Remove all HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        // Remove multiple spaces
        text = text.replace(/\s+/g, ' ').trim();
        // Return first 2000 chars (enough for context)
        return text.slice(0, 2000);
    } catch (error) {
        return null;
    }
}

async function fetchNewsFromNewsAPI(homeTeam, awayTeam, apiKey, language) {
    const allArticles = [];
    const fromDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Search query must mention BOTH teams (the match itself)
    const queries = [
        `"${homeTeam}" AND "${awayTeam}"`
    ];

    for (const q of queries) {
        await sleep(THROTTLE_MS);
        try {
            const res = await withRetry(() => axios.get('https://newsapi.org/v2/everything', {
                params: {
                    q,
                    from: fromDate,
                    sortBy: 'relevancy',
                    language,
                    pageSize: 10,
                    apiKey
                },
                timeout: 10000
            }));
            if (res.data.status === 'ok' && res.data.articles) {
                allArticles.push(...res.data.articles.map(a => ({
                    title: a.title,
                    description: a.description || '',
                    source: a.source?.name || '',
                    url: a.url
                })));
            }
        } catch (error) {
            const status = error.response?.status;
            if (status === 429) {
                console.log(`  ⚠️ NewsAPI rate limit detected, switching to Google RSS`);
                newsApiState.rateLimited = true;
                break;
            }
            console.error(`  NewsAPI error: ${error.response?.data?.message || error.message}`);
        }
    }

    if (allArticles.length === 0) return "Sem notícias relevantes encontradas.";

    // Deduplicate by title
    const seen = new Set();
    const unique = allArticles.filter(a => {
        if (!a.title) return false;
        const key = a.title.toLowerCase().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Filter: MUST mention BOTH teams
    const homeLower = homeTeam.toLowerCase();
    const awayLower = awayTeam.toLowerCase();
    const bothTeamsMentioned = unique.filter(a => {
        const text = `${a.title} ${a.description || ''}`.toLowerCase();
        return text.includes(homeLower) && text.includes(awayLower);
    });

    // Fallback: if no articles mention both teams, use all relevant
    const results = bothTeamsMentioned.length > 0 ? bothTeamsMentioned : unique;

    // Limit to 3 and fetch full content (skip if NewsAPI rate limited)
    const top = results.slice(0, 3);
    const newsWithContent = [];

    try {
        for (const article of top) {
            const body = await fetchArticleContent(article.url);
            if (body && body.length > 50) {
                newsWithContent.push({ body });
            }
        }
    } catch (e) {
        console.log(`  Scraping skipped due to error: ${e.message}`);
    }

    // If no scraped content, fallback to description from API
    if (newsWithContent.length === 0) {
        return top.map(a => {
            let line = `- ${a.title}`;
            if (a.description) line += `\n  ${a.description}`;
            return line;
        }).join('\n');
    }

    // Return only body content
    return newsWithContent.map(n => `- ${n.body}`).join('\n\n');
}

async function fetchNewsFromGoogleRSS(homeTeam, awayTeam) {
    const queries = [
        `"${homeTeam}" "${awayTeam}" preview lineup injury`,
        `"${homeTeam}" OR "${awayTeam}" injury suspension team news`
    ];

    const allArticles = [];

    for (const query of queries) {
        await sleep(THROTTLE_MS);
        try {
            const encoded = encodeURIComponent(query);
            const url = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;
            const res = await withRetry(() => axios.get(url, { timeout: 10000 }));
            const items = parseGoogleNewsRSS(res.data);
            allArticles.push(...items);
        } catch (error) {
            console.error(`  Error fetching news: ${error.message}`);
        }
    }

    if (allArticles.length === 0) return "Sem notícias relevantes encontradas.";

    // Deduplicate by title
    const seen = new Set();
    const unique = allArticles.filter(a => {
        if (!a.title) return false;
        const key = a.title.toLowerCase().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Filter for relevant content
    const relevant = unique.filter(a => isRelevantNews(a.title, a.description));
    if (relevant.length === 0) return "Sem notícias relevantes encontradas.";

    // Use top 5 article titles + source as news context
    const top = relevant.slice(0, 5);
    return top.map(a => `- ${a.title}${a.source ? ` (${a.source})` : ''}`).join('\n');
}

async function main() {
    validateKeys();
    
    const fixtures = await fetchFixtures();
    if (fixtures.length === 0) {
        console.log("No fixtures found for the specified timeframe.");
        const dossierPath = path.join(__dirname, 'dossier.txt');
        fs.writeFileSync(dossierPath, 'NO_FIXTURES');
        return;
    }

    let report = "⚽ BETFAIR ANALYST - DOSSIER\n";

    for (const f of fixtures) {
        const homeTeam = f.teams.home;
        const awayTeam = f.teams.away;
        const league = f.league;
        const dateStr = formatInTimeZone(new Date(f.fixture.date), 'Europe/Lisbon', 'yyyy-MM-dd HH:mm');
        
        report += `========================================\n`;
        report += `🏆 ${league.name} | 🕒 ${dateStr}\n`;
        report += `🏟️ ${homeTeam.name} vs ${awayTeam.name}\n\n`;
        
        // Fetch stats, injuries and H2H in parallel
        const [homeStats, awayStats, homeInjuries, awayInjuries, h2h] = await Promise.all([
            fetchTeamStats(homeTeam.id, homeTeam.name, league.id, league.season),
            fetchTeamStats(awayTeam.id, awayTeam.name, league.id, league.season),
            fetchInjuries(homeTeam.id, homeTeam.name, league.id, league.season),
            fetchInjuries(awayTeam.id, awayTeam.name, league.id, league.season),
            fetchH2H(homeTeam.id, awayTeam.id)
        ]);
        
        // STATS - Compact: Rank|Pts|PJ-V-E-D|GF-GC|CS|BTTS|Forma
        report += `📊 STATS:\n`;
        report += `  H: ${homeStats}\n`;
        report += `  A: ${awayStats}\n`;
        
        // H2H
        if (h2h) {
            const [record, goals] = h2h.split('|');
            report += `  H2H: ${record} (V-E-D) | Goals: ${goals}\n`;
        }
        
        // Injuries
        if (homeInjuries) report += `  INJ(H): ${homeInjuries}\n`;
        if (awayInjuries) report += `  INJ(A): ${awayInjuries}\n`;
        
        report += `\n`;

        // Fetch odds from API-Football
        console.log(`  Fetching odds from API-Football for fixture ${f.fixture.id}...`);
        const fixtureOdds = await fetchOddsFromApiFootball(f.fixture.id);
        if (fixtureOdds && fixtureOdds.length > 0) {
            const sorted = prioritizeApiFootballBookmakers(fixtureOdds);
            const best = sorted[0];
            report += `📈 ODDS [${best.title}]:\n`;
            const keyMarkets = best.markets.filter(m =>
                ['Match Winner', 'Goals Over/Under', 'Both Teams Score', 'Home/Away', 'Asian Handicap']
                    .some(k => m.key.includes(k))
            );
            (keyMarkets.length > 0 ? keyMarkets : best.markets.slice(0, 3)).forEach(m => {
                const outcomes = m.outcomes.map(o => `${o.name.slice(0,8)}@${o.price}`).join(' ');
                report += `  ${m.key}: ${outcomes}\n`;
            });
        } else {
            report += `📈 ODDS: N/A\n`;
        }
        
        report += `\n📰 NEWS:\n`;
        const news = await fetchNews(homeTeam.name, awayTeam.name, league.id);
        report += news + `\n\n`;
    }

    // Prepend lessons if they exist (compact)
    const lessonsPath = path.join(__dirname, 'lessons.md');
    if (fs.existsSync(lessonsPath)) {
        const lessons = fs.readFileSync(lessonsPath, 'utf-8');
        const compactLessons = lessons.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 10).join('\n');
        report = `📚 LESSONS: ${compactLessons.slice(0, 500)}\n\n` + report;
    }

    // Backup previous dossier before overwriting
    const dossierPath = path.join(__dirname, 'dossier.txt');
    if (fs.existsSync(dossierPath)) {
        const backupPath = path.join(__dirname, `dossier_backup_${format(new Date(), 'yyyyMMdd_HHmmss')}.txt`);
        fs.copyFileSync(dossierPath, backupPath);
        console.log(`Previous dossier backed up to ${backupPath}`);
    }

    fs.writeFileSync(dossierPath, report);
    console.log(`Dossier generated at ${dossierPath}!`);
}

main();
