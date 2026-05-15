/**
 * Gemini Analysis + Telegram Notification
 * Usage: node gemini_analyze.js
 * 
 * Reads dossier.txt + analyst_prompt.md, sends to Gemini,
 * saves to history.md, sends to Telegram.
 */
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DOSSIER_PATH = path.join(__dirname, 'dossier.txt');
const PROMPT_PATH = path.join(__dirname, 'analyst_prompt.md');
const HISTORY_PATH = path.join(__dirname, 'history.md');

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const isJson = typeof body !== 'string';
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data)
            }
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
    console.log(`Calling Gemini (${GEMINI_MODEL})...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        model: GEMINI_MODEL,
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
    };

    const res = await httpPost(url, payload);
    if (res.status !== 200) {
        const err = JSON.parse(res.body);
        throw new Error(`Gemini HTTP ${res.status}: ${err.error?.message || res.body}`);
    }

    const data = JSON.parse(res.body);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');
    return text;
}

async function sendTelegram(message) {
    const chunks = [];
    let remaining = message;
    while (remaining.length > 0) {
        chunks.push(remaining.slice(0, 4000));
        remaining = remaining.slice(4000);
    }

    for (let i = 0; i < chunks.length; i++) {
        const prefix = i > 0 ? `(continuação ${i + 1})\n\n` : '';
        const text = prefix + chunks[i];
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        // Try with Markdown first, fallback to plain text
        let params = new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });
        let res = await httpPost(url, params.toString());

        if (res.status !== 200) {
            params = new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text });
            res = await httpPost(url, params.toString());
        }

        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function main() {
    // Validate
    if (!GEMINI_API_KEY) { console.error('ERRO: GEMINI_API_KEY em falta'); process.exit(1); }
    if (!fs.existsSync(DOSSIER_PATH)) { console.error('ERRO: dossier.txt não encontrado'); process.exit(1); }

    const dossier = fs.readFileSync(DOSSIER_PATH, 'utf-8');
    if (dossier === 'NO_FIXTURES' || dossier.length < 100) {
        console.log('NO_FIXTURES');
        return;
    }

    const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
    const userMessage = 'Analisa o seguinte dossier e identifica apostas +EV:\n\n' + dossier;

    // Call Gemini
    const analysis = await callGemini(systemPrompt, userMessage);
    console.log('--- ANALYSIS_START ---');
    console.log(analysis);
    console.log('--- ANALYSIS_END ---');

    // Save to history
    const today = new Date().toISOString().split('T')[0];
    const entry = `\n## ${today}\n\n${analysis}\n`;
    fs.appendFileSync(HISTORY_PATH, entry);
    console.log(`Picks saved to ${HISTORY_PATH}`);

    // Send Telegram
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const header = `🔥 Betfair Analyst — ${today} 🔥\n\n`;
        await sendTelegram(header + analysis);
        console.log('Telegram sent');
    } else {
        console.log('Telegram skipped (no token/chat_id)');
    }
}

main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
