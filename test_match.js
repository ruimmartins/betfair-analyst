/**
 * Test suite for team matching logic
 * Run with: npm test
 */

// === Copy of matching logic from fetch_data.js ===
function normalizeTeamName(name) {
    return name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/fc|cf|sc|ac|as|ss|us|rc|rcd|cd|ud|sd/g, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

function teamNameSimilarity(name1, name2) {
    const n1 = normalizeTeamName(name1);
    const n2 = normalizeTeamName(name2);
    if (n1 === n2) return 1.0;
    const shorter = n1.length <= n2.length ? n1 : n2;
    const longer = n1.length <= n2.length ? n2 : n1;
    if (shorter.length >= 5 && longer.includes(shorter)) return 0.8;
    const words1 = n1.split(' ').filter(w => w.length > 3);
    const words2 = n2.split(' ').filter(w => w.length > 3);
    if (words1.length === 0 || words2.length === 0) return 0;
    const shorterWords = words1.length <= words2.length ? words1 : words2;
    const longerWords = words1.length <= words2.length ? words2 : words1;
    const matchedWords = shorterWords.filter(w => longerWords.some(w2 => w === w2));
    if (matchedWords.length === shorterWords.length && shorterWords.length > 0) return 0.7;
    const distinctiveWord = shorterWords.reduce((a, b) => a.length >= b.length ? a : b, '');
    if (distinctiveWord.length >= 5 && longerWords.includes(distinctiveWord)) return 0.6;
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
        if (homeScore >= 0.6 && awayScore >= 0.6) {
            const combinedScore = homeScore + awayScore;
            if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestMatch = odd;
            }
        }
    }
    return bestMatch;
}

// === Tests ===
let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✓ ${testName}`);
        passed++;
    } else {
        console.log(`  ✗ FAIL: ${testName}`);
        failed++;
    }
}

console.log('=== Team Matching Tests ===\n');

// Test 1: Exact match
const odds1 = [{ home_team: 'Borussia Dortmund', away_team: 'Eintracht Frankfurt', bookmakers: [] }];
const fix1 = { teams: { home: { name: 'Borussia Dortmund' }, away: { name: 'Eintracht Frankfurt' } } };
assert(matchOddsToFixture(fix1, odds1) !== null, 'Exact match: Dortmund vs Frankfurt');

// Test 2: Should NOT match different teams with similar substrings
const odds2 = [{ home_team: 'Arsenal de Sarandi', away_team: 'Real Betis', bookmakers: [] }];
const fix2 = { teams: { home: { name: 'Arsenal' }, away: { name: 'Real Madrid' } } };
const result2 = matchOddsToFixture(fix2, odds2);
assert(result2 === null, 'Should NOT match Arsenal with Arsenal de Sarandi + Real Madrid with Real Betis');

// Test 3: Accent handling
const odds3 = [{ home_team: 'Atletico Madrid', away_team: 'FC Barcelona', bookmakers: [] }];
const fix3 = { teams: { home: { name: 'Atlético Madrid' }, away: { name: 'Barcelona' } } };
assert(matchOddsToFixture(fix3, odds3) !== null, 'Accent normalization: Atlético vs Atletico');

// Test 4: FC prefix removal
const odds4 = [{ home_team: 'FC Porto', away_team: 'Sporting CP', bookmakers: [] }];
const fix4 = { teams: { home: { name: 'Porto' }, away: { name: 'Sporting CP' } } };
assert(matchOddsToFixture(fix4, odds4) !== null, 'FC prefix: Porto matches FC Porto');

// Test 5: No false positive between similar short names
const odds5 = [{ home_team: 'Real Sociedad', away_team: 'Celta Vigo', bookmakers: [] }];
const fix5 = { teams: { home: { name: 'Real Madrid' }, away: { name: 'Celta Vigo' } } };
const result5 = matchOddsToFixture(fix5, odds5);
assert(result5 === null, 'Should NOT match Real Madrid with Real Sociedad');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
