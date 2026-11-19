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
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve the existing single-page frontend for Render's root URL.
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
const chatLimit = rateLimit({ windowMs: 60 * 1000, limit: 15 });

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

const TOOLS = [
  { name: 'set_device', description: 'Turn a virtual smart-home device on or off',
    input_schema: { type: 'object', properties: { device: { type: 'string', enum: KEYS }, state: { type: 'boolean' } }, required: ['device', 'state'] } },
  { name: 'pc_action', description: "Control the user's PC",
    input_schema: { type: 'object', properties: {
      action: { type: 'string', enum: ['open_app', 'volume', 'screenshot'] },
      name: { type: 'string', enum: ['notepad', 'calculator', 'chrome', 'vscode'] },
      dir: { type: 'string', enum: ['up', 'down', 'mute'] } }, required: ['action'] } },
];

app.post('/api/chat', auth, chatLimit, async (q, s) => {
  const text = String((q.body || {}).text || '').slice(0, 300);
  if (!text) return s.status(400).json({ error: 'खाली कमांड' });
  if (!process.env.ANTHROPIC_API_KEY)
    return s.json({ reply: 'AI अभी चालू नहीं है। सीधे कमांड बोलो, जैसे लाइट ऑन कर।', devices: getDevs(q.user.id), pc: [] });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: 300,
        system: `You are Jarvis, a voice assistant for ${q.user.name}. Reply in Hindi (Devanagari), one short sentence. Use tools to act. Devices are virtual: light, fan, ac, tv.`,
        tools: TOOLS,
        messages: [{ role: 'user', content: text }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'api error');
    let reply = ''; const pc = [];
    for (const b of j.content) {
      if (b.type === 'text') reply += b.text;
      else if (b.type === 'tool_use') {
        if (b.name === 'set_device' && KEYS.includes(b.input.device)) setDevs(q.user.id, { [b.input.device]: b.input.state });
        else if (b.name === 'pc_action') pc.push(b.input);
      }
    }
    s.json({ reply: reply || 'ठीक है, हो गया।', devices: getDevs(q.user.id), pc });
  } catch (e) { console.error(e.message); s.status(502).json({ error: 'AI से जवाब नहीं मिला' }); }
});

app.listen(process.env.PORT || 3000, () => console.log('Jarvis चालू'));
