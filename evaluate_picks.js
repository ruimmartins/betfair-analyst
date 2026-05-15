require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { subDays } = require('date-fns');
const { formatInTimeZone } = require('date-fns-tz');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

// === API-Football Rate Limiter ===
const apiFootballRateLimit = {
    timestamps: [],
    async wait() {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < 60000);
        if (this.timestamps.length >= 10) {
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

// === Parsing picks from history.md ===
function parsePicksForDate(historyContent, targetDate) {
    const lines = historyContent.split('\n');
    const picks = [];
    let currentDate = null;
    let currentPick = null;

    for (const line of lines) {
        // Detect date headers like "## 2026-05-10" or "# Picks 2026-05-10" or lines containing the date
        const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch && (line.startsWith('#') || line.startsWith('##'))) {
            currentDate = dateMatch[1];
        }

        // Only process picks for the target date
        if (currentDate !== targetDate) continue;

        // Match team names from various formats:
        // "Team A vs Team B", "Team A - Team B", with optional emojis/markdown
        const vsMatch = line.match(/(?:^|\s)([A-Za-zÀ-ÿ\s.'-]+?)\s+(?:vs\.?|x|-)\s+([A-Za-zÀ-ÿ\s.'-]+?)(?:\s*[\(|\\n]|$)/i);
        if (vsMatch) {
            const home = vsMatch[1].replace(/[*_#🔥⚽🏆]/g, '').trim();
            const away = vsMatch[2].replace(/[*_#🔥⚽🏆]/g, '').trim();
            if (home.length > 2 && away.length > 2) {
                picks.push({ home, away });
            }
        }
    }

    // Fallback: if no date-filtered picks found, try a broader regex on the whole file
    // but only if the file is small (likely only recent picks)
    if (picks.length === 0) {
        const fallbackRegex = /([A-Za-zÀ-ÿ\s.'-]{3,}?)\s+(?:vs\.?|x|-)\s+([A-Za-zÀ-ÿ\s.'-]{3,}?)(?:\s*[\(|]|$)/gm;
        let m;
        while ((m = fallbackRegex.exec(historyContent)) !== null) {
            const home = m[1].replace(/[*_#🔥⚽🏆]/g, '').trim();
            const away = m[2].replace(/[*_#🔥⚽🏆]/g, '').trim();
            if (home.length > 2 && away.length > 2 && !home.startsWith('http')) {
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
    
    const teamsToSearch = parsePicksForDate(historyContent, yesterdayStr);
    console.log(`Found ${teamsToSearch.length} picks to evaluate:`, teamsToSearch.map(t => `${t.home} vs ${t.away}`));

    if (teamsToSearch.length === 0) {
        console.log("No picks found for yesterday in history.md.");
        fs.writeFileSync(evaluationPath, `Não foram encontradas picks para ${yesterdayStr} no history.md.`);
        return;
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
            
            console.log(`  Processing: ${home} vs ${away}...`);
            
            // Fetch events and timeline in parallel
            const [events, timeline] = await Promise.all([
                fetchMatchEvents(f.fixture.id),
                fetchMatchTimeline(f.fixture.id)
            ]);
            
            // COMPACT OUTPUT
            report += `--- ${home} vs ${away} ---\n`;
            report += `RES: ${score.home}-${score.away} (${status})\n`;
            
            if (events) report += `EVT: ${events}\n`;
            
            if (timeline) {
                report += `STATS: ${home}[${timeline.home.possession}%, ${timeline.home.shots}/${timeline.home.shotsOnTarget}, ${timeline.home.corners}corners] vs `;
                report += `${away}[${timeline.away.possession}%, ${timeline.away.shots}/${timeline.away.shotsOnTarget}, ${timeline.away.corners}corners]\n`;
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
