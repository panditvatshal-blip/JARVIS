const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('JWT_SECRET set karo'); process.exit(1); }

const db = new Database(process.env.DB_PATH || 'jarvis.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices(user_id INTEGER, k TEXT, state INTEGER DEFAULT 0, PRIMARY KEY(user_id, k));`);

const KEYS = ['light', 'fan', 'ac', 'tv'];
const NAMES_HI = { light: 'लाइट', fan: 'पंखा', ac: 'AC', tv: 'TV' };
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (q, s) => s.sendFile(path.join(__dirname, 'public', 'index.html')));

const getDevs = id => {
  const o = Object.fromEntries(KEYS.map(k => [k, 0]));
  db.prepare('SELECT k,state FROM devices WHERE user_id=?').all(id).forEach(r => (o[r.k] = r.state));
  return o;
};
const setDevs = (id, S) => {
  const st = db.prepare('INSERT INTO devices(user_id,k,state) VALUES(?,?,?) ON CONFLICT(user_id,k) DO UPDATE SET state=excluded.state');
  KEYS.forEach(k => { if (k in S) st.run(id, k, S[k] ? 1 : 0); });
};
const sign = u => jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '7d' });
const auth = (q, s, n) => {
  try { q.user = jwt.verify((q.headers.authorization || '').slice(7), SECRET); n(); }
  catch { s.status(401).json({ error: 'फिर से लॉगिन करो' }); }
};

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 });
const chatLimit = rateLimit({ windowMs: 60 * 1000, limit: 30 });

app.post('/api/signup', authLimit, (q, s) => {
  const { name, email, password } = q.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || !password || password.length < 6)
    return s.status(400).json({ error: 'नाम, सही ईमेल और 6+ अक्षर का पासवर्ड दो' });
  try {
    const r = db.prepare('INSERT INTO users(email,name,hash) VALUES(?,?,?)')
      .run(email.toLowerCase(), name.trim(), bcrypt.hashSync(password, 10));
    const u = { id: r.lastInsertRowid, name: name.trim() };
    s.json({ token: sign(u), name: u.name, devices: getDevs(u.id) });
  } catch { s.status(409).json({ error: 'यह ईमेल पहले से है' }); }
});

app.post('/api/login', authLimit, (q, s) => {
  const { email, password } = q.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.hash))
    return s.status(401).json({ error: 'ईमेल या पासवर्ड गलत है' });
  s.json({ token: sign(u), name: u.name, devices: getDevs(u.id) });
});

app.get('/api/me', auth, (q, s) => s.json({ name: q.user.name, devices: getDevs(q.user.id) }));
app.put('/api/devices', auth, (q, s) => { setDevs(q.user.id, q.body || {}); s.json({ devices: getDevs(q.user.id) }); });

/* ---------- LOCAL COMMANDS (bina AI ke, instant) ---------- */
const DEV_WORDS = {
  light: /light|लाइट|लाईट|बत्ती|batti|bulb|बल्ब/i,
  fan: /\bfan\b|पंखा|पंखे|pankha|पँखा/i,
  ac: /\bac\b|एसी|ए\.सी|air ?con/i,
  tv: /\btv\b|टीवी|टी\.वी|television|टेलीविजन/i,
};
const OFF_RE = /\boff\b|ऑफ|बंद|बन्द|band|\bstop\b|बुझा|bujha/i;
const ON_RE = /\bon\b|ऑन|चालू|चला|खोल|\bstart\b|जला|jala|chalu|chala/i;
const APPS = {
  notepad: /notepad|नोटपैड/i, calculator: /calculator|कैलकुलेटर|कैलकुलेटर|calc/i,
  chrome: /chrome|क्रोम/i, vscode: /vs ?code|वीएस ?कोड/i,
};

function localCommand(text, user) {
  const t = text.trim();
  const low = t.toLowerCase();

  if (/^(hi|hello|hey|hii+|नमस्ते|हेलो|हैलो|जार्विस|jarvis)\W*$/i.test(t))
    return { reply: `नमस्ते ${user.name}! बताओ क्या करना है?`, pc: [] };

  if (/good ?night|गुड ?नाइट|शुभ रात्रि|सो जा/i.test(t)) {
    setDevs(user.id, { light: 0, fan: 0, ac: 0, tv: 0 });
    return { reply: `शुभ रात्रि ${user.name}! सब डिवाइस बंद कर दिए।`, pc: [] };
  }
  if (/good ?morning|गुड ?मॉर्निंग|सुप्रभात/i.test(t)) {
    setDevs(user.id, { light: 1 });
    return { reply: `सुप्रभात ${user.name}! लाइट चालू कर दी।`, pc: [] };
  }

  if (/volume|वॉल्यूम|आवाज|awaaz|sound/i.test(t)) {
    let dir = null;
    if (/mute|म्यूट|बंद/i.test(t)) dir = 'mute';
    else if (/\bup\b|बढ़ा|बढा|ज्यादा|ज़्यादा|badha|increase|तेज/i.test(t)) dir = 'up';
    else if (/down|कम|घटा|ghata|decrease|धीमा/i.test(t)) dir = 'down';
    if (dir) return { reply: 'ठीक है, आवाज़ बदल रहा हूँ।', pc: [{ action: 'volume', dir }] };
  }

  if (/screenshot|स्क्रीनशॉट|स्क्रीन शॉट/i.test(t))
    return { reply: 'स्क्रीनशॉट ले रहा हूँ।', pc: [{ action: 'screenshot' }] };

  for (const [name, re] of Object.entries(APPS)) {
    if (re.test(t) && /open|खोल|चला|start|launch/i.test(t))
      return { reply: `${name} खोल रहा हूँ।`, pc: [{ action: 'open_app', name }] };
  }

  const hit = KEYS.filter(k => DEV_WORDS[k].test(t));
  if (hit.length) {
    const off = OFF_RE.test(t), on = ON_RE.test(t);
    if (off || on) {
      const state = off ? 0 : 1;
      const patch = {}; hit.forEach(k => (patch[k] = state));
      setDevs(user.id, patch);
      return { reply: `${hit.map(k => NAMES_HI[k]).join(' और ')} ${state ? 'चालू' : 'बंद'} कर दिया।`, pc: [] };
    }
  }
  return null;
}

/* ---------- AI (retry + fallback models) ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GEMINI_TOOLS = [{
  functionDeclarations: [
    { name: 'set_device', description: 'Turn a virtual smart-home device on or off',
      parameters: { type: 'OBJECT', properties: { device: { type: 'STRING', enum: KEYS }, state: { type: 'BOOLEAN' } }, required: ['device', 'state'] } },
    { name: 'pc_action', description: "Control the user's PC",
      parameters: { type: 'OBJECT', properties: {
        action: { type: 'STRING', enum: ['open_app', 'volume', 'screenshot'] },
        name: { type: 'STRING', enum: ['notepad', 'calculator', 'chrome', 'vscode'] },
        dir: { type: 'STRING', enum: ['up', 'down', 'mute'] } }, required: ['action'] } },
  ],
}];
const CLAUDE_TOOLS = [
  { name: 'set_device', description: 'Turn a virtual smart-home device on or off',
    input_schema: { type: 'object', properties: { device: { type: 'string', enum: KEYS }, state: { type: 'boolean' } }, required: ['device', 'state'] } },
  { name: 'pc_action', description: "Control the user's PC",
    input_schema: { type: 'object', properties: {
      action: { type: 'string', enum: ['open_app', 'volume', 'screenshot'] },
      name: { type: 'string', enum: ['notepad', 'calculator', 'chrome', 'vscode'] },
      dir: { type: 'string', enum: ['up', 'down', 'mute'] } }, required: ['action'] } },
];

async function callGemini(model, text, sysPrompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sysPrompt }] }, contents: [{ role: 'user', parts: [{ text }] }], tools: GEMINI_TOOLS }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'gemini error'); e.status = r.status; throw e; }
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const out = { reply: '', devs: {}, pc: [] };
  for (const p of parts) {
    if (p.text) out.reply += p.text;
    else if (p.functionCall) {
      const { name, args } = p.functionCall;
      if (name === 'set_device' && args && KEYS.includes(args.device)) out.devs[args.device] = args.state ? 1 : 0;
      else if (name === 'pc_action' && args) out.pc.push(args);
    }
  }
  return out;
}

async function callClaude(model, text, sysPrompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 300, system: sysPrompt, tools: CLAUDE_TOOLS, messages: [{ role: 'user', content: text }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'claude error'); e.status = r.status; throw e; }
  const out = { reply: '', devs: {}, pc: [] };
  for (const b of j.content || []) {
    if (b.type === 'text') out.reply += b.text;
    else if (b.type === 'tool_use') {
      if (b.name === 'set_device' && KEYS.includes(b.input.device)) out.devs[b.input.device] = b.input.state ? 1 : 0;
      else if (b.name === 'pc_action') out.pc.push(b.input);
    }
  }
  return out;
}

async function askAI(text, sysPrompt) {
  const gem = [];
  if (process.env.GEMINI_API_KEY) {
    const ms = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].filter(Boolean);
    [...new Set(ms)].forEach(m => gem.push(() => callGemini(m, text, sysPrompt).then(r => { console.log('AI ok:', m); return r; })));
  }
  const claude = process.env.ANTHROPIC_API_KEY
    ? () => callClaude(process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', text, sysPrompt) : null;

  let lastErr;
  for (let round = 0; round < 2; round++) {
    // saare Gemini models ek saath, jo pehle jawab de wahi le lo
    if (gem.length) {
      try { return await Promise.any(gem.map(f => f())); }
      catch (e) {
        (e.errors || [e]).forEach(x => console.error('AI fail:', x.status || '', x.message));
        lastErr = (e.errors && e.errors[0]) || e;
      }
    }
    if (claude) {
      try { return await claude(); }
      catch (e) { console.error('AI fail (claude):', e.status || '', e.message); lastErr = e; }
    }
    if (round === 0) await sleep(1000);
  }
  throw lastErr || new Error('no AI configured');
}

app.post('/api/chat', auth, chatLimit, async (q, s) => {
  const text = String((q.body || {}).text || '').slice(0, 300);
  if (!text) return s.status(400).json({ error: 'खाली कमांड' });
  const uid = q.user.id;

  // 1) pehle local command – AI down ho tab bhi chalega
  const local = localCommand(text, q.user);
  if (local) return s.json({ reply: local.reply, devices: getDevs(uid), pc: local.pc });

  // 2) AI
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY)
    return s.json({ reply: 'AI अभी चालू नहीं है। सीधे कमांड बोलो, जैसे लाइट ऑन कर।', devices: getDevs(uid), pc: [] });

  const sysPrompt = `You are Jarvis, a voice assistant for ${q.user.name}. Reply in Hindi (Devanagari), one short sentence. Use tools to act. Devices are virtual: light, fan, ac, tv.`;
  try {
    const o = await askAI(text, sysPrompt);
    if (Object.keys(o.devs).length) setDevs(uid, o.devs);
    let reply = o.reply.trim();
    if (!reply) {
      const d = Object.entries(o.devs).map(([k, v]) => `${NAMES_HI[k]} ${v ? 'चालू' : 'बंद'}`).join(', ');
      reply = d ? `${d} कर दिया।` : o.pc.length ? 'पीसी कमांड भेज दी गई है।' : 'ठीक है, हो गया।';
    }
    s.json({ reply, devices: getDevs(uid), pc: o.pc });
  } catch (e) {
    console.error('final AI fail:', e.message);
    // hamesha reply do, chup mat raho
    s.json({ reply: 'अभी AI busy है, थोड़ी देर बाद try करो। लाइट/पंखा/AC/TV के कमांड फिर भी चलेंगे।', devices: getDevs(uid), pc: [] });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Jarvis चालू'));
