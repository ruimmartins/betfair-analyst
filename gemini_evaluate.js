/**
 * Post-match evaluation: extract lessons via Gemini, save to lessons.md
 * Usage: node gemini_evaluate.js
 *
 * lessons.md is kept as a consolidated, deduplicated knowledge base.
 * When the file grows beyond MAX_LESSONS_CHARS it is re-summarised by Gemini
 * before saving, so it never balloons indefinitely.
 */
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const EVAL_PATH = path.join(__dirname, 'evaluation_dossier.txt');
const LESSONS_PATH = path.join(__dirname, 'lessons.md');

// Maximum size (in chars) allowed for lessons.md before a consolidation pass
const MAX_LESSONS_CHARS = 8000;

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let result = '';
            res.on('data', c => result += c);
            res.on('end', () => resolve({ status: res.statusCode, body: result }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function callGemini(systemPrompt, userMessage) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await httpPost(url, {
        model: GEMINI_MODEL,
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
    });
    if (res.status !== 200) {
        const err = JSON.parse(res.body);
        throw new Error(`Gemini HTTP ${res.status}: ${err.error?.message || res.body}`);
    }
    const data = JSON.parse(res.body);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
}

async function extractNewLessons(existingLessons, evalContent) {
    const systemPrompt = `És um analista de apostas desportivas. Recebeste o dossier de avaliação pós-jogo com resultados reais, estatísticas e notícias.

O teu objetivo é extrair LIÇÕES CONCRETAS e ACCIONÁVEIS que melhorem futuras análises de value betting.

Regras:
- Sê conciso: cada lição deve ter 1-2 frases no máximo.
- Foca-te em PADRÕES (não em jogos específicos). Ex: 'Equipas em luta pela manutenção a jogar em casa tendem a...'
- Identifica o que correu bem (para repetir) e o que correu mal (para evitar).
- NÃO repitas lições que já existam.
- Responde APENAS com as novas lições, uma por linha, começando com '- '.
- Se não houver nada novo a aprender, responde com 'Sem novas lições.'`;

    const userMessage = `Lições já existentes:\n${existingLessons}\n\nDossier de avaliação:\n${evalContent}`;
    return callGemini(systemPrompt, userMessage);
}

async function consolidateLessons(fullLessons) {
    console.log('lessons.md excede o limite — a consolidar com Gemini...');
    const systemPrompt = `És um analista de apostas desportivas especializado em value betting.

Tens uma lista de lições acumuladas ao longo do tempo. O teu objetivo é consolidá-las numa base de conhecimento compacta e de alta qualidade.

Regras:
- Remove duplicados e lições redundantes ou demasiado semelhantes.
- Agrupa lições relacionadas numa única lição mais completa, se fizer sentido.
- Mantém apenas as lições com valor prático real para futuras análises.
- Preserva toda a informação única e relevante — não percas padrões importantes.
- Responde APENAS com a lista consolidada, uma lição por linha, começando com '- '.
- O resultado deve ter no máximo 6000 caracteres.`;

    const userMessage = `Consolida as seguintes lições:\n\n${fullLessons}`;
    return callGemini(systemPrompt, userMessage);
}

async function main() {
    if (!GEMINI_API_KEY) { console.error('ERRO: GEMINI_API_KEY em falta'); process.exit(1); }
    if (!fs.existsSync(EVAL_PATH)) { console.log('No evaluation dossier found.'); return; }

    const evalContent = fs.readFileSync(EVAL_PATH, 'utf-8');
    if (evalContent.length < 100) { console.log('Evaluation dossier too small.'); return; }

    const existingLessons = fs.existsSync(LESSONS_PATH) ? fs.readFileSync(LESSONS_PATH, 'utf-8') : '';

    // --- Step 1: Extract new lessons ---
    console.log(`Calling Gemini (${GEMINI_MODEL}) for new lessons...`);
    const newLessons = await extractNewLessons(existingLessons, evalContent);

    console.log('\nLições extraídas:');
    console.log(newLessons);

    if (newLessons.toLowerCase().includes('sem novas lições')) {
        console.log('\nSem novas lições para adicionar.');
        return;
    }

    // --- Step 2: Merge new lessons into the knowledge base ---
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const merged = existingLessons
        ? `${existingLessons.trimEnd()}\n\n<!-- ${yesterday} -->\n${newLessons.trimEnd()}\n`
        : `<!-- ${yesterday} -->\n${newLessons.trimEnd()}\n`;

    // --- Step 3: Consolidate if over the limit ---
    let finalContent = merged;
    if (merged.length > MAX_LESSONS_CHARS) {
        const consolidated = await consolidateLessons(merged);
        console.log('\nConteúdo consolidado:');
        console.log(consolidated);
        finalContent = `<!-- Consolidado em ${yesterday} -->\n${consolidated.trimEnd()}\n`;
    }

    fs.writeFileSync(LESSONS_PATH, finalContent, 'utf-8');
    console.log(`\nLições gravadas em ${LESSONS_PATH} (${finalContent.length} chars)`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
