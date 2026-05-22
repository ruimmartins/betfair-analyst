require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { subDays } = require('date-fns');
const { formatInTimeZone } = require('date-fns-tz');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

// NewsAPI rate limit tracker
const newsApiState = { rateLimited: false };

// League to language mapping (for news)
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
    13: 'es', 11: 'es',              // South American (Spanish)
    1: 'en', 4: 'en', 9: 'en', 5: 'en', // International
    528: 'en',                         // Community Shield
    556: 'es',                         // Super Cup (Spain)
    547: 'it',                         // Super Cup (Italy)
    529: 'de',                         // Super Cup (Germany)
    526: 'fr',                         // Trophée des Champions
    632: 'pt',                         // Supercopa do Brasil
    550: 'pt',                         // Super Cup (Portugal)
    543: 'nl',                         // Super Cup (Netherlands)
};

// Keywords that indicate irrelevant news (scheduling, streaming, TV, tickets)
const IRRELEVANT_PATTERNS = [
    /onde assistir/i, /where to watch/i, /how to watch/i, /live stream/i,
    /tv channel/i, /streaming options/i, /horário/i, /kick.?off time/i,
    /tickets?\b/i, /bilhetes/i, /transmiss/i, /broadcast/i,
    /fantasy\s*(football|soccer)/i, /fpl\b/i, /dream\s*team/i,
    /fan\s*zone/i, /merchandise/i
];

// Keywords that indicate relevant POST-MATCH news (match reports, analysis, injuries revealed, reactions)
const RELEVANT_PATTERNS = [
    /injur/i, /lesão/i, /lesionado/i, /lesões/i,
    /suspend/i, /suspenso/i, /expuls/i, /red card/i, /cartão vermelho/i,
    /match\s*report/i, /relato/i, /crónica/i,
    /analysis/i, /anális/i, /tactical/i, /tática/i,
    /reaction/i, /reação/i, /interview/i, /entrevista/i,
    /press\s*conference/i, /coletiva/i,
    /goal/i, /golo/i, /scored/i, /marcou/i,
    /win/i, /won/i, /vitória/i, /venceu/i,
    /loss/i, /lost/i, /derrota/i, /perdeu/i,
    /draw/i, /drew/i, /empate/i,
    /performance/i, /desempenho/i,
    /coach/i, /manager/i, /treinador/i,
    /crisis/i, /crise/i,
    /celebration/i, /comemoração/i,
    /controversy/i, /polémica/i, /polêmica/i,
    /var\b/i, /penalty/i, /pênalti/i, /penálti/i
];

// === API-Football Rate Limiter ===
const apiFootballRateLimit = {
    timestamps: [],
    async wait() {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < 60000);
        if (this.timestamps.length >= 300) {
            const waitTime = 60000 - (now - this.timestamps[0]) + 100;
            console.log(`  ⏳ Rate limit: waiting ${Math.ceil(waitTime/1000)}s...`);
            await sleep(waitTime);
            this.timestamps = this.timestamps.filter(t => Date.now() - 60000);
        }
        this.timestamps.push(Date.now());
    }
};

// === Helpers ===
const THROTTLE_MS = 500;
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function withRetry(fn, retries = 2, delayMs = 1000) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries) throw error;
            console.log(`  Retry ${i + 1}/${retries}: ${error.message}`);
            await sleep(delayMs * (i + 1));
        }
    }
}

function validateKeys() {
    const missing = [];
    if (!API_FOOTBALL_KEY) missing.push('API_FOOTBALL_KEY');
    // NEWS_API_KEY is optional - will fallback to Google RSS
    if (missing.length > 0) {
        console.error(`ERRO: Keys em falta no .env: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// === API Functions ===
async function fetchFixtures(dateStr) {
    await sleep(THROTTLE_MS);
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { date: dateStr },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        return res.data?.response || [];
    } catch (error) {
        console.error(`Error fetching fixtures for ${dateStr}:`, error.message);
        return [];
    }
}



// Fetch match events (goals, cards, subs) from API-Football
async function fetchMatchEvents(fixtureId) {
    await apiFootballRateLimit.wait();
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/fixtures/events', {
            params: { fixture: fixtureId },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        
        if (res.data?.response?.length > 0) {
            const events = res.data.response
                .filter(e => e.type === 'Goal' || e.type === 'Card' || e.type === 'Substitution')
                .slice(0, 10)
                .map(e => `${e.time?.elapsed}' ${e.type === 'Goal' ? e.detail : e.type}: ${e.player?.name}`);
            return events.join(' | ');
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Fetch match timeline (aggregated stats like xG if available via API)
async function fetchMatchTimeline(fixtureId) {
    await apiFootballRateLimit.wait();
    try {
        const res = await withRetry(() => axios.get('https://v3.football.api-sports.io/fixtures/statistics', {
            params: { fixture: fixtureId },
            headers: { 'x-apisports-key': API_FOOTBALL_KEY }
        }));
        
        if (res.data?.response?.length > 0) {
            const home = res.data.response[0];
            const away = res.data.response[1];
            
            // Compact stats: Possession, Shots, ShotsOnTarget, Corners, Cards
            const getStat = (team, type) => team?.statistics?.find(s => s.type === type)?.value || '-';
            
            return {
                home: {
                    possession: getStat(home, 'Ball Possession'),
                    shots: getStat(home, 'Shots Total'),
                    shotsOnTarget: getStat(home, 'Shots on Target'),
                    corners: getStat(home, 'Corner Kicks'),
                    cards: getStat(home, 'Yellow Cards')
                },
                away: {
                    possession: getStat(away, 'Ball Possession'),
                    shots: getStat(away, 'Shots Total'),
                    shotsOnTarget: getStat(away, 'Shots on Target'),
                    corners: getStat(away, 'Corner Kicks'),
                    cards: getStat(away, 'Yellow Cards')
                }
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

// === News Functions ===
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

function isRelevantNews(title, description) {
    const text = `${title} ${description || ''}`;
    // Exclude if matches irrelevant patterns
    if (IRRELEVANT_PATTERNS.some(p => p.test(text))) return false;
    // Include if matches relevant patterns, or if it has a meaningful description
    if (RELEVANT_PATTERNS.some(p => p.test(text))) return true;
    // Default: include if description is substantial (50+ chars)
    return (description || '').length >= 50;
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
    // For post-match news, look at last 2 days (the match + day after)
    const fromDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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

    if (allArticles.length === 0) return "Sem notícias pós-jogo encontradas.";

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

    // Limit to 3 and fetch full content
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
    // Post-match queries focus on match reports and analysis
    const queries = [
        `"${homeTeam}" "${awayTeam}" match report analysis reaction`,
        `"${homeTeam}" "${awayTeam}" injury tactical performance`
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

    if (allArticles.length === 0) return "Sem notícias pós-jogo encontradas.";

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
    if (relevant.length === 0) return "Sem notícias pós-jogo relevantes.";

    // Fetch full content for top 3 articles
    const top = relevant.slice(0, 3);
    const newsWithContent = [];

    try {
        for (const article of top) {
            if (article.link) {
                const body = await fetchArticleContent(article.link);
                if (body && body.length > 50) {
                    newsWithContent.push({ body });
                }
            }
        }
    } catch (e) {
        console.log(`  Scraping skipped: ${e.message}`);
    }

    // If no scraped content, return titles
    if (newsWithContent.length === 0) {
        return top.map(a => `- ${a.title}${a.source ? ` (${a.source})` : ''}`).join('\n');
    }

    // Return full content
    return newsWithContent.map(n => `- ${n.body}`).join('\n\n');
}

async function fetchPostMatchNews(homeTeam, awayTeam, leagueId) {
    console.log(`  Fetching post-match news for: ${homeTeam} vs ${awayTeam}`);

    const language = LEAGUE_LANGUAGE[leagueId] || 'en';

    // If NewsAPI key available and not rate limited, use it
    if (NEWS_API_KEY && NEWS_API_KEY !== 'YOUR_NEWSAPI_KEY_HERE' && !newsApiState.rateLimited) {
        return await fetchNewsFromNewsAPI(homeTeam, awayTeam, NEWS_API_KEY, language);
    }

    // Fallback to Google News RSS
    return await fetchNewsFromGoogleRSS(homeTeam, awayTeam);
}

// === Parsing picks from history.md ===
function parsePicksForDate(historyContent, targetDate) {
    const lines = historyContent.split('\n');
    const picks = [];
    let currentDate = null;

    for (const line of lines) {
        // Detect date headers like "## 2026-05-10"
        const dateMatch = line.match(/^##?\s*(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            currentDate = dateMatch[1];
            continue;
        }

        // Only process picks for the target date
        if (currentDate !== targetDate) continue;

        // Match lines with format: "🔥 League - Team A vs Team B" or just "Team A vs Team B"
        // First, remove emojis and league names
        let cleanLine = line.replace(/🔥|⚽|🏆|⏰|💡|📊|📝/g, '').trim();
        
        // Remove league prefixes like "Bundesliga -", "Premier League -", etc.
        cleanLine = cleanLine.replace(/^(Bundesliga|Premier League|La Liga|Serie A|Ligue 1|Primeira Liga|Liga Portugal|Eredivisie|Championship|MLS|Serie A \(Brasil\)|Brasileirão)\s*-\s*/i, '');
        
        // Now try to match "Team A vs Team B" pattern
        const vsMatch = cleanLine.match(/^([A-Za-zÀ-ÿ\s.'\-0-9]+?)\s+(?:vs\.?|x)\s+([A-Za-zÀ-ÿ\s.'\-0-9]+?)(?:\s*$|⏰)/i);
        if (vsMatch) {
            let home = vsMatch[1].replace(/[*_#]/g, '').trim();
            let away = vsMatch[2].replace(/[*_#]/g, '').trim();
            
            // Skip if it looks like a league name or is too short
            const skipWords = ['bundesliga', 'premier', 'league', 'serie', 'ligue', 'primeira', 'liga'];
            const homeNorm = home.toLowerCase();
            const awayNorm = away.toLowerCase();
            
            if (home.length > 2 && away.length > 2 && 
                !skipWords.some(w => homeNorm === w || awayNorm === w) &&
                !home.startsWith('http') && !away.startsWith('http')) {
                picks.push({ home, away });
            }
        }
    }

    return picks;
}

// === Fuzzy matching (same as fetch_data.js) ===
function normalizeTeamName(name) {
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/fc|cf|sc|ac|as|ss|us|rc|rcd|cd|ud|sd/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

function teamsMatch(name1, name2) {
    const n1 = normalizeTeamName(name1);
    const n2 = normalizeTeamName(name2);
    if (n1 === n2) return true;
    if (n1.includes(n2) || n2.includes(n1)) return true;
    const words1 = n1.split(' ').filter(w => w.length > 2);
    const words2 = n2.split(' ').filter(w => w.length > 2);
    const common = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
    return common.length > 0 && (common.length / Math.min(words1.length, words2.length)) >= 0.5;
}

// === Main ===
async function main() {
    validateKeys();

    const historyPath = path.join(__dirname, 'history.md');
    const evaluationPath = path.join(__dirname, 'evaluation_dossier.txt');

    if (!fs.existsSync(historyPath)) {
        console.log("No history.md found.");
        return;
    }

    const historyContent = fs.readFileSync(historyPath, 'utf-8');
    
    const yesterday = subDays(new Date(), 1);
    const yesterdayStr = formatInTimeZone(yesterday, 'Europe/Lisbon', 'yyyy-MM-dd');
    
    console.log(`Evaluating picks for date: ${yesterdayStr}`);
    
    const allPicks = parsePicksForDate(historyContent, yesterdayStr);
    
    // Deduplicate picks based on normalized team names
    const uniquePicks = [];
    const seen = new Set();
    for (const pick of allPicks) {
        const key = `${normalizeTeamName(pick.home)}|${normalizeTeamName(pick.away)}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniquePicks.push(pick);
        }
    }
    
    const teamsToSearch = uniquePicks;
    console.log(`Found ${teamsToSearch.length} unique picks to evaluate for ${yesterdayStr}:`);
    teamsToSearch.forEach((t, i) => console.log(`  ${i+1}. ${t.home} vs ${t.away}`));

    if (teamsToSearch.length === 0) {
        console.log("No picks found for yesterday in history.md.");
        fs.writeFileSync(evaluationPath, `📚 DOSSIER DE AVALIAÇÃO - PICKS DE ${yesterdayStr} 📚\n\n========================================\n\n⚠️ Não foram encontrados picks para avaliar nesta data.\n`);
        process.exit(0);
    }

    console.log("Fetching yesterday's fixtures...");
    const yesterdayFixtures = await fetchFixtures(yesterdayStr);
    
    let report = `📚 DOSSIER DE AVALIAÇÃO - PICKS DE ${yesterdayStr} 📚\n\n`;
    report += `========================================\n\n`;

    const processedIds = new Set();

    for (const target of teamsToSearch) {
        const f = yesterdayFixtures.find(fix => {
            const h = fix.teams.home.name;
            const a = fix.teams.away.name;
            return teamsMatch(h, target.home) && teamsMatch(a, target.away);
        });

        if (f && !processedIds.has(f.fixture.id)) {
            processedIds.add(f.fixture.id);
            const home = f.teams.home.name;
            const away = f.teams.away.name;
            const score = f.score.fulltime;
            const status = f.fixture.status?.short;
            const leagueId = f.league.id;
            
            console.log(`  Processing: ${home} vs ${away}...`);
            
            // Fetch events, timeline, and news in parallel
            const [events, timeline, news] = await Promise.all([
                fetchMatchEvents(f.fixture.id),
                fetchMatchTimeline(f.fixture.id),
                fetchPostMatchNews(home, away, leagueId)
            ]);
            
            // COMPACT OUTPUT
            report += `--- ${home} vs ${away} ---\n`;
            report += `RES: ${score.home}-${score.away} (${status})\n`;
            
            if (events) report += `EVT: ${events}\n`;
            
            if (timeline) {
                report += `STATS: ${home}[${timeline.home.possession}%, ${timeline.home.shots}/${timeline.home.shotsOnTarget}, ${timeline.home.corners}corners] vs `;
                report += `${away}[${timeline.away.possession}%, ${timeline.away.shots}/${timeline.away.shotsOnTarget}, ${timeline.away.corners}corners]\n`;
            }
            
            if (news) {
                report += `NEWS:\n${news}\n`;
            }
            
            report += `\n`;
        } else if (!f) {
            report += `⚠️ Jogo não encontrado no API-Football: ${target.home} vs ${target.away}\n\n`;
        }
    }

    fs.writeFileSync(evaluationPath, report);
    console.log(`Evaluation dossier generated at ${evaluationPath}!`);
}

main();
