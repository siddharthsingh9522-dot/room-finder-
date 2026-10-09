// ROOMRAHI storage Worker — Cloudflare R2 via a *bucket binding* (no access keys exist anywhere).
// PUT    /upload            raw image bytes (jpeg/png/webp, <= 1.5 MB)  -> {url,key}
// DELETE /object?key=...    delete one of YOUR objects (admins: any)
// DELETE /mine              delete everything under your user prefix (account deletion)
// Every call needs  Authorization: Bearer <Supabase access token>, verified against Supabase Auth.
const MAX = 1.5 * 1024 * 1024;
const KEY_RE = /^(listings|profiles|chat)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

function cors(env, req) {
  const o = req.headers.get('Origin') || '';
  const ok = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).includes(o);
  return { 'Access-Control-Allow-Origin': ok ? o : 'null', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'PUT, DELETE, OPTIONS', 'Vary': 'Origin' };
}
const json = (o, s, h) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });

async function authUser(env, req) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  const p = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=role,banned&id=eq.${u.id}`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  const row = p.ok ? (await p.json())[0] : null;
  if (!row || row.banned) return null;
  return { id: u.id, admin: row.role === 'admin' };
}
async function limited(env, uid) {           // optional per-user rate limit (needs a KV binding named RATE_KV)
  if (!env.RATE_KV) return false;
  const k = `rl:${uid}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
  if (n >= 20) return true;
  await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 120 });
  return false;
}
function sniff(b) {                          // trust magic bytes, not the client's Content-Type
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ['jpg', 'image/jpeg'];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return ['png', 'image/png'];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ['webp', 'image/webp'];
  return null;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req), url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const user = await authUser(env, req);
    if (!user) return json({ error: 'unauthorized' }, 401, h);
    if (await limited(env, user.id)) return json({ error: 'too many requests' }, 429, h);

    if (req.method === 'PUT' && url.pathname === '/upload') {
      const folder = ['listings', 'profiles', 'chat'].includes(url.searchParams.get('folder')) ? url.searchParams.get('folder') : 'listings';
      const len = parseInt(req.headers.get('Content-Length') || '0', 10);
      if (len > MAX) return json({ error: 'file too large (max 1.5 MB)' }, 413, h);
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX) return json({ error: 'bad size' }, 413, h);
      const t = sniff(buf);
      if (!t) return json({ error: 'only jpeg/png/webp images allowed' }, 415, h);
      const key = `${folder}/${user.id}/${crypto.randomUUID()}.${t[0]}`;
      await env.BUCKET.put(key, buf, { httpMetadata: { contentType: t[1], cacheControl: 'public, max-age=31536000, immutable' } });
      return json({ key, url: `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}` }, 200, h);
    }
    if (req.method === 'DELETE' && url.pathname === '/object') {
      const key = url.searchParams.get('key') || '';
      if (!KEY_RE.test(key)) return json({ error: 'bad key' }, 400, h);          // blocks path traversal / arbitrary keys
      if (!user.admin && key.split('/')[1] !== user.id) return json({ error: 'forbidden' }, 403, h);
      await env.BUCKET.delete(key);
      return json({ ok: true }, 200, h);
    }
    if (req.method === 'DELETE' && url.pathname === '/mine') {
      let n = 0;
      for (const f of ['listings', 'profiles', 'chat']) {
        let cursor;
        do { const l = await env.BUCKET.list({ prefix: `${f}/${user.id}/`, cursor }); for (const o of l.objects) { await env.BUCKET.delete(o.key); n++; } cursor = l.truncated ? l.cursor : null; } while (cursor);
      }
      return json({ ok: true, deleted: n }, 200, h);
    }
    return json({ error: 'not found' }, 404, h);
  }
};
