// ROOMRAHI AI Worker — Gemini with automatic free-model fallback, auth, rate limit, token caps.
// POST { task: 'parse'|'compare'|'describe'|'support', payload: {...} }  + Authorization: Bearer <Supabase token>
// The AI only receives the small facts the app sends (never the database) and is told not to invent anything.
const API = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const SKIP = /embed|tts|image|live|audio|vision|aqa|imagen|veo|robotics|computer-use/i;
let cache = { models: null, at: 0 };
const cooldown = new Map();

const PROMPTS = {
  parse: { json: true, max: 200, sys: 'Convert a Hindi/Hinglish/English room-rental search into JSON ONLY: {"pt":"all|room|rk|house|pg|shared","max":number|null,"ac":0|1,"food":0|1,"furn":0|1,"ver":0|1,"sui":"लड़के|लड़कियाँ|फैमिली|","text":"area or locality name or empty","km":number|null}. Do not add keys. Do not guess values that are not in the text.' },
  compare: { max: 300, sys: 'You compare rental listings for Indian workers/students. Use ONLY the facts in the JSON. Reply in simple Hindi, max 4 short lines: which is best overall and why, and one trade-off. Never invent amenities, prices, distances, reviews or availability. Say that totals are estimates.' },
  describe: { max: 300, sys: 'Write a short honest Hindi listing description (title line + 2-3 sentences) using ONLY the facts given. Never add amenities, distances, claims like "best" or "safe". If a fact is missing, leave it out.' },
  support: { max: 300, sys: 'You are the ROOMRAHI help assistant. Answer in simple Hindi about how to use a room-rental app and general rental safety (never pay advance without seeing the room, never share OTP). You have NO access to any listing, price or availability; if asked, say to check the listing page. Never claim legal validity of any document.' }
};

function cors(env, req) {
  const o = req.headers.get('Origin') || '';
  const ok = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).includes(o);
  return { 'Access-Control-Allow-Origin': ok ? o : 'null', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
const json = (o, s, h) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });
async function uid(env, req) {
  const a = req.headers.get('Authorization') || '';
  if (!a.startsWith('Bearer ')) return null;
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: a } });
  return r.ok ? (await r.json()).id || null : null;
}
async function limited(env, u) {
  if (!env.RATE_KV) return false;
  const k = `ai:${u}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
  if (n >= 10) return true;
  await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 120 });
  return false;
}
async function models(key) {                 // new Gemini models are picked up automatically; flash > flash-lite > pro
  if (cache.models && Date.now() - cache.at < 6 * 3600e3) return cache.models;
  try {
    const j = await (await fetch(`${API}/models?pageSize=200&key=${key}`)).json();
    const score = n => (/flash-lite/.test(n) ? 100 : /flash/.test(n) ? 200 : 0) + parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const l = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''))
      .filter(n => n.startsWith('gemini') && !SKIP.test(n)).sort((a, b) => score(b) - score(a));
    if (l.length) { cache = { models: l, at: Date.now() }; return l; }
  } catch (e) {}
  return FALLBACK;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405, h);
    const u = await uid(env, req);
    if (!u) return json({ error: 'unauthorized' }, 401, h);
    if (await limited(env, u)) return json({ error: 'थोड़ी देर बाद कोशिश करें' }, 429, h);
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400, h); }
    const P = PROMPTS[body.task];
    if (!P) return json({ error: 'unknown task' }, 400, h);
    const input = JSON.stringify(body.payload || {});
    if (input.length > 4000) return json({ error: 'input too large' }, 413, h);

    const payload = { contents: [{ role: 'user', parts: [{ text: input }] }], systemInstruction: { parts: [{ text: P.sys }] },
      generationConfig: { maxOutputTokens: P.max, temperature: 0.2, ...(P.json ? { responseMimeType: 'application/json' } : {}) } };
    for (const m of await models(env.GEMINI_API_KEY)) {
      if ((cooldown.get(m) || 0) > Date.now()) continue;
      const r = await fetch(`${API}/models/${m}:generateContent?key=${env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) {
        const j = await r.json();
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (text) return json({ text, model: m }, 200, h);
        continue;
      }
      if (r.status === 429) cooldown.set(m, Date.now() + 60e3);
      else if (r.status === 404 || r.status === 403) cooldown.set(m, Date.now() + 6 * 3600e3);
      else if (r.status >= 500) cooldown.set(m, Date.now() + 15e3);
    }
    return json({ error: 'AI अभी व्यस्त है, थोड़ी देर बाद कोशिश करें' }, 503, h);
  }
};
