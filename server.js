// Runs on your own computer. Serves the app and talks to Sarvam with the key from the .env file.
// Start it with:  node server.js   then open http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
const BASE = process.env.SARVAM_BASE || 'https://api.sarvam.ai';
const PORT = process.env.PORT || 3000;

function loadEnv() {
  try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) {}
}
loadEnv();
const KEY = process.env.SARVAM_API_KEY;
if (!KEY) { console.error('Missing SARVAM_API_KEY. Put it in the .env file next to server.js.'); process.exit(1); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function body(req, max) {
  return new Promise((ok, no) => {
    const c = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > max) { no(Object.assign(new Error('big'), { code: 413 })); req.destroy(); } else c.push(d); });
    req.on('end', () => ok(Buffer.concat(c))); req.on('error', no);
  });
}
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

async function stt(req, res) {
  const buf = await body(req, 3 * 1024 * 1024);
  if (buf.length < 1000) return send(res, 400, { error: 'No audio received' });
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', 'saaras:v3');
  fd.append('mode', 'transcribe');
  fd.append('language_code', 'unknown'); // auto-detect
  const r = await fetch(BASE + '/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': KEY }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Sarvam speech-to-text error', r.status, JSON.stringify(d).slice(0, 300)); return send(res, r.status === 429 ? 429 : 502, { error: 'Transcription failed', status: r.status }); }
  send(res, 200, { text: d.transcript || '', language: d.language_code || null });
}

function clean(t, wantJson) {
  t = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!wantJson) return t;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}
async function parse(req, res) {
  const { prompt, json } = JSON.parse((await body(req, 100000)).toString() || '{}');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) return send(res, 400, { error: 'Bad request' });
  const messages = [];
  if (json) messages.push({ role: 'system', content: 'Reply with one valid JSON object only. No explanation, no code fences.' });
  messages.push({ role: 'user', content: prompt });
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST', headers: { 'api-subscription-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CHAT_MODEL || 'sarvam-30b', messages, temperature: 0.2, max_tokens: 2500, reasoning_effort: 'low' })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Sarvam chat error', r.status, JSON.stringify(d).slice(0, 300)); return send(res, 502, { error: 'Model call failed', status: r.status }); }
  send(res, 200, { text: clean(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content, json) });
}

http.createServer(async (req, res) => {
  try {
    const u = (req.url || '/').split('?')[0];
    if (req.method === 'POST' && u === '/api/stt') return await stt(req, res);
    if (req.method === 'POST' && u === '/api/parse') return await parse(req, res);
    if (req.method === 'GET' && (u === '/' || u === '/index.html' || u === '/shim.js')) {
      const f = u === '/shim.js' ? 'shim.js' : 'index.html';
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] }); return res.end(fs.readFileSync(path.join(__dirname, f)));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, e.code === 413 ? 413 : 500, { error: 'Failed' }); }
}).listen(PORT, '127.0.0.1', () => console.log('Kutumb is running. Open http://localhost:' + PORT));
