/**
 * Post-match evaluation: extract lessons via Gemini, save to lessons.md
 * Usage: node gemini_evaluate.js
 */
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const EVAL_PATH = path.join(__dirname, 'evaluation_dossier.txt');
const LESSONS_PATH = path.join(__dirname, 'lessons.md');

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

async function main() {
    if (!GEMINI_API_KEY) { console.error('ERRO: GEMINI_API_KEY em falta'); process.exit(1); }
    if (!fs.existsSync(EVAL_PATH)) { console.log('No evaluation dossier found.'); return; }

    const evalContent = fs.readFileSync(EVAL_PATH, 'utf-8');
    if (evalContent.length < 100) { console.log('Evaluation dossier too small.'); return; }

    const existingLessons = fs.existsSync(LESSONS_PATH) ? fs.readFileSync(LESSONS_PATH, 'utf-8') : '';

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

    console.log(`Calling Gemini (${GEMINI_MODEL}) for lessons...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await httpPost(url, {
        model: GEMINI_MODEL,
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    });

    if (res.status !== 200) {
        const err = JSON.parse(res.body);
        throw new Error(`Gemini HTTP ${res.status}: ${err.error?.message || res.body}`);
    }

    const data = JSON.parse(res.body);
    const lessons = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!lessons) throw new Error('Empty response from Gemini');

    console.log('\nLições extraídas:');
    console.log(lessons);

    if (lessons.toLowerCase().includes('sem novas lições')) {
        console.log('\nSem novas lições para adicionar.');
    } else {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        fs.appendFileSync(LESSONS_PATH, `\n### ${yesterday}\n${lessons}\n`);
        console.log(`\nLições gravadas em ${LESSONS_PATH}`);
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
