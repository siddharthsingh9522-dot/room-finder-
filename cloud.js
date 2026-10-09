/* ROOMRAHI cloud layer — Supabase auth + sync + realtime chat + notifications + admin + rent/agreement + roommate + AI.
   Loads only when config.js has real keys; otherwise the app runs in local-only mode. All authorization is enforced by
   Postgres RLS / Workers (see docs/SECURITY.md) — nothing here is a security boundary. */
(function () {
  'use strict';
  var C = window.ROOMRAHI_CONFIG || {}, RR = window.RR;
  if (!RR || !window.supabase || !C.SUPABASE_URL || /YOUR_/.test(C.SUPABASE_URL)) { return; }
  var FL = C.FLAGS || {}, S = RR.S, esc = RR.esc, inr = RR.inr, $ = function (i) { return document.getElementById(i); };
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  var me = null, prof = null, last = { rooms: {}, photos: {}, favs: [], vis: {}, bks: {}, role: null }, busy = false, again = false, timer = null, chan = null, unread = 0, notifs = [], peerNames = {};
  RR.cloud = true;
  var isId = function (s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s || ''); };
  var log = function (e) { console.warn('[RoomRahi]', e && e.message || e); };
  var tok = function () { return sb.auth.getSession().then(function (r) { return r.data.session && r.data.session.access_token; }); };
  var ST = { REQUESTED: 'w', RESCHEDULED: 'w', ACCEPTED: 'ok', CONFIRMED: 'ok', COMPLETED: 'ok', REJECTED: 'x', CANCELLED: 'x' };

  /* ---------- analytics (event kind + listing only) ---------- */
  RR.ev = function (kind, lid) {
    if (!me || FL.ANALYTICS === false || (prof && prof.prefs && prof.prefs.analytics === false)) return;
    sb.from('events').insert({ kind: kind, listing_id: lid && isId(lid) ? lid : null }).then(function () {}, log);
  };

  /* ---------- AI (via Worker; grounded: only small facts are sent) ---------- */
  var aiCache = {};
  function ai(task, payload) {
    if (!C.AI_WORKER_URL || !me) return Promise.reject(new Error('ai-off'));
    return tok().then(function (t) { return fetch(C.AI_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ task: task, payload: payload }) }); })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }
  RR.aiParse = function (q) {
    if (FL.AI_SEARCH === false || !me || !C.AI_WORKER_URL) return Promise.resolve(null);
    if (aiCache[q]) return Promise.resolve(aiCache[q]);
    return ai('parse', { q: q }).then(function (j) {
      var o = JSON.parse(String(j.text).replace(/```json|```/g, '').trim()), f = RR.parse(q);
      ['pt', 'max', 'ac', 'food', 'furn', 'ver', 'sui', 'text', 'km'].forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== '') f[k] = o[k]; });
      return (aiCache[q] = f);
    }).catch(function () { return null; });
  };

  /* ---------- mapping ---------- */
  function mapL(d) {
    var ph = (d.listing_photos || []).slice().sort(function (a, b) { return a.position - b.position; });
    return { id: d.id, name: d.name, type: d.type, rent: d.rent, dep: d.deposit, area: d.area, city: d.city, phone: d.phone || '', beds: d.beds || 0, am: d.amenities || [], sui: d.suitable || '',
      foodInc: d.food_included, elecInc: d.elec_included, desc: d.description || '', lat: d.lat, lng: d.lng, imgs: ph.map(function (p) { return p.url; }),
      meta: ph.map(function (p) { return { url: p.url, key: p.key, phash: p.phash }; }), state: d.state === 'active' ? '' : (d.state === 'suspended' ? 'paused' : d.state), susp: d.state === 'suspended',
      created: Date.parse(d.created_at), confirmed: Date.parse(d.confirmed_at), verified: d.verification === 'verified', vstate: d.verification, note: d.admin_note, mine: d.owner_id === me.id, owner: d.owner_id, units: d.units || [], tour: d.tour_url || '', demo: false };
  }
  var mapV = function (d) { return { id: d.id, rid: d.listing_id, when: d.when_text, date: d.when_text, note: d.note, st: d.status, tenant: d.tenant_id, owner: d.owner_id }; };
  var mapB = function (d) { return { id: d.id, rid: d.listing_id, date: d.move_in ? 'मूव-इन ' + d.move_in : '', note: d.note, st: d.status, tenant: d.tenant_id, owner: d.owner_id }; };
  var rsig = function (r) { return JSON.stringify([r.name, r.type, r.rent, r.dep, r.area, r.city, r.phone, r.beds, r.am, r.sui, r.foodInc, r.elecInc, r.desc, r.lat, r.lng, r.imgs, r.state, r.confirmed, r.units, r.tour]); };
  var keyOf = function (u) { var p = (C.R2_PUBLIC_URL || '').replace(/\/$/, '') + '/'; return u && u.indexOf(p) === 0 ? u.slice(p.length) : null; };

  /* ---------- photos: upload via Worker, perceptual hash for duplicate review ---------- */
  function phash(dataUrl) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = 8; var x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
        var d = x.getImageData(0, 0, 8, 8).data, g = [], sum = 0, i;
        for (i = 0; i < 64; i++) { var v = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; g.push(v); sum += v; }
        var avg = sum / 64, h = '', n = 0; for (i = 0; i < 64; i++) { n = (n << 1) | (g[i] > avg ? 1 : 0); if (i % 4 === 3) { h += n.toString(16); n = 0; } }
        res(h);
      }; im.onerror = function () { res(null); }; im.src = dataUrl;
    });
  }
  function upload(dataUrl, folder) {
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
      return tok().then(function (t) { return fetch(C.STORAGE_WORKER_URL + '/upload?folder=' + (folder || 'listings'), { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': b.type || 'image/jpeg' }, body: b }); });
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'upload failed'); return j; }); });
  }
  function delObj(key) {
    if (!key) return Promise.resolve();
    return tok().then(function (t) { return fetch(C.STORAGE_WORKER_URL + '/object?key=' + encodeURIComponent(key), { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); }).catch(log);
  }
  function uploadImgs(r) {
    var p = Promise.resolve(); r.meta = r.meta || [];
    (r.imgs || []).forEach(function (u, i) {
      if (u.indexOf('data:') !== 0) return;
      p = p.then(function () { return phash(u).then(function (h) { return upload(u).then(function (res) { r.imgs[i] = res.url; r.meta.push({ url: res.url, key: res.key, phash: h }); }); }); });
    });
    return p;
  }

  /* ---------- pull / sync ---------- */
  function snap() {
    last.rooms = {}; last.photos = {}; S.rooms.forEach(function (r) { if (r.mine !== false && !r.demo) { last.rooms[r.id] = rsig(r); last.photos[r.id] = (r.imgs || []).slice(); } });
    last.favs = S.favs.slice(); last.vis = {}; last.bks = {};
    S.visits.forEach(function (v) { last.vis[v.id] = v.st + '|' + v.when; }); S.books.forEach(function (v) { last.bks[v.id] = v.st + '|' + v.date; }); last.role = S.role;
  }
  function pull() {
    var q = sb.from('listings').select('*,listing_photos(*)').order('confirmed_at', { ascending: false }).limit(C.PAGE_SIZE || 150);
    q = me ? q.or('state.eq.active,owner_id.eq.' + me.id) : q.eq('state', 'active');
    var ps = [q];
    if (me) ps.push(sb.from('favorites').select('listing_id'), sb.from('visits').select('*'), sb.from('bookings').select('*'));
    return Promise.all(ps).then(function (r) {
      if (r[0].error) throw r[0].error;
      S.rooms = (r[0].data || []).map(mapL);
      if (me) { S.favs = (r[1].data || []).map(function (x) { return x.listing_id; }); S.visits = (r[2].data || []).map(mapV); S.books = (r[3].data || []).map(mapB); }
      S.cmp = S.cmp.filter(function (id) { return S.rooms.some(function (x) { return x.id === id; }); });
      snap(); RR.save(); RR.render(); document.getElementById('rr-off').style.display = 'none';
    }).catch(function (e) { log(e); document.getElementById('rr-off').style.display = 'block'; });
  }
  function toastErr(e) { log(e); RR.toast('सेव नहीं हो पाया: ' + ((e && e.message) || 'नेटवर्क')); }
  function pushRoom(r) {
    var had = (last.photos[r.id] || []);
    return uploadImgs(r).then(function () {
      var row = { id: r.id, owner_id: me.id, name: r.name, type: r.type, rent: r.rent, deposit: r.dep || 0, area: r.area, city: r.city || '', phone: r.phone || '', beds: r.beds || 0, amenities: r.am || [], suitable: r.sui || '',
        food_included: !!r.foodInc, elec_included: !!r.elecInc, description: r.desc || '', units: r.units || [], tour_url: r.tour || null, lat: r.lat == null ? null : r.lat, lng: r.lng == null ? null : r.lng, confirmed_at: new Date(r.confirmed || Date.now()).toISOString() };
      if (!r.susp) row.state = (r.state === 'rented' || r.state === 'paused') ? r.state : 'active';
      return sb.from('listings').upsert(row).then(function (x) { if (x.error) throw x.error; });
    }).then(function () {
      var rows = (r.imgs || []).map(function (u, i) { var m = (r.meta || []).filter(function (z) { return z.url === u; })[0] || {}; return { listing_id: r.id, url: u, key: m.key || keyOf(u), phash: m.phash || null, position: i }; });
      return sb.from('listing_photos').delete().eq('listing_id', r.id).then(function () { return rows.length ? sb.from('listing_photos').insert(rows) : null; });
    }).then(function () {
      had.forEach(function (u) { if ((r.imgs || []).indexOf(u) < 0) delObj(keyOf(u)); });
      last.rooms[r.id] = rsig(r); last.photos[r.id] = (r.imgs || []).slice();
    }).catch(toastErr);
  }
  function delRoom(id) {
    (last.photos[id] || []).forEach(function (u) { delObj(keyOf(u)); });
    return sb.from('listings').delete().eq('id', id).then(function (x) { if (x.error) throw x.error; delete last.rooms[id]; delete last.photos[id]; }).catch(toastErr);
  }
  function sync() {
    if (!me) return;
    if (busy) { again = true; return; }
    busy = true; var jobs = [], cur = {};
    S.rooms.forEach(function (r) { if (r.mine !== false && !r.demo && isId(r.id) && r.rent) cur[r.id] = r; });
    Object.keys(cur).forEach(function (id) { if (last.rooms[id] !== rsig(cur[id])) jobs.push(pushRoom(cur[id])); });
    Object.keys(last.rooms).forEach(function (id) { if (!cur[id]) jobs.push(delRoom(id)); });
    var favs = S.favs.filter(isId);
    favs.forEach(function (id) { if (last.favs.indexOf(id) < 0) { jobs.push(sb.from('favorites').upsert({ user_id: me.id, listing_id: id }).then(function (x) { if (!x.error) RR.ev('favorite', id); })); } });
    last.favs.forEach(function (id) { if (favs.indexOf(id) < 0) jobs.push(sb.from('favorites').delete().eq('listing_id', id).then(function () {})); });
    last.favs = favs;
    function reqs(list, lastMap, table, mk, kind) {
      list.forEach(function (v) {
        if (!isId(v.id)) return; var sg = v.st + '|' + (kind === 'visit' ? v.when : v.date);
        if (lastMap[v.id] === undefined) {
          jobs.push(sb.from(table).insert(Object.assign({ id: v.id, listing_id: v.rid, note: v.note || '' }, mk(v))).then(function (x) { if (x.error) { toastErr(x.error); pull(); } else RR.ev(kind === 'visit' ? 'visit' : 'booking', v.rid); }));
        } else if (lastMap[v.id] !== sg) {
          var u = { status: v.st }; Object.assign(u, mk(v));
          jobs.push(sb.from(table).update(u).eq('id', v.id).then(function (x) { if (x.error) { toastErr(x.error); pull(); } }));
        }
        lastMap[v.id] = sg;
      });
    }
    reqs(S.visits, last.vis, 'visits', function (v) { return { when_text: v.when || '' }; }, 'visit');
    reqs(S.books, last.bks, 'bookings', function (v) { return { move_in: String(v.date || '').replace('मूव-इन ', '') }; }, 'book');
    (S.reports || []).forEach(function (r) {
      if (r.synced || !isId(r.rid)) return; r.synced = true;
      jobs.push(sb.from('reports').insert({ listing_id: r.rid, reason: r.reason }).then(function (x) { if (x.error) { r.synced = false; log(x.error); } }));
    });
    if (S.role !== last.role && prof && prof.role !== 'admin') { var nr = S.role; jobs.push(sb.from('profiles').update({ role: nr }).eq('id', me.id).then(function (x) { if (!x.error) prof.role = nr; })); }
    last.role = S.role;
    Promise.all(jobs).catch(log).then(function () { busy = false; if (again) { again = false; sync(); } });
  }
  RR.hooks.push(function () { if (!me) return; clearTimeout(timer); timer = setTimeout(sync, 600); });

  /* ---------- auth UI ---------- */
  function authUI(msg) {
    var d = $('rr-auth') || document.createElement('div'); d.id = 'rr-auth';
    d.style.cssText = 'position:fixed;inset:0;z-index:150;background:var(--bg);overflow-y:auto;padding:24px 16px calc(24px + env(safe-area-inset-bottom,0px))';
    d.innerHTML = '<div style="max-width:420px;margin:0 auto"><h1 style="font-size:30px">🏠 ROOMRAHI</h1><p class="mut">सही कमरा, सही भरोसा</p><div class="card pad"><label>ईमेल</label><input id="a_em" type="email" autocomplete="email"><label>पासवर्ड (कम से कम 8 अक्षर)</label><input id="a_pw" type="password" autocomplete="current-password"><label>नाम (नया खाता बनाते समय)</label><input id="a_nm" value="' + esc((S.guest && S.guest.name) || '') + '"><label>मोबाइल (अभी वेरिफाई नहीं होता)</label><input id="a_ph" type="tel" inputmode="numeric" maxlength="10" value="' + esc((S.guest && S.guest.phone) || '') + '"><label>मैं हूँ</label><div class="row"><button class="chip on" id="a_t" data-r="tenant">किरायेदार</button><button class="chip" id="a_o" data-r="owner">ओनर</button></div><div id="a_msg" class="mut" style="margin:8px 0;color:var(--bad)">' + esc(msg || '') + '</div><button class="btn f" id="a_in">लॉगिन</button><div style="height:8px"></div><button class="btn g f" id="a_up">नया खाता बनाएँ</button>' + (FL.GOOGLE_LOGIN ? '<div style="height:8px"></div><button class="btn g f" id="a_g">Google से जारी रखें</button>' : '') + '<div style="height:8px"></div><button class="btn g f" id="a_fp">पासवर्ड भूल गए?</button></div><button class="btn g f" id="a_guest">अभी नहीं, कमरे देखता रहूँगा</button></div>';
    document.body.appendChild(d); var role = 'tenant', m = function (t, ok) { var e = $('a_msg'); e.textContent = t; e.style.color = ok ? 'var(--ok)' : 'var(--bad)'; };
    [$('a_t'), $('a_o')].forEach(function (b) { b.onclick = function () { role = b.dataset.r; $('a_t').classList.toggle('on', role === 'tenant'); $('a_o').classList.toggle('on', role === 'owner'); }; });
    $('a_in').onclick = function () { sb.auth.signInWithPassword({ email: $('a_em').value.trim(), password: $('a_pw').value }).then(function (r) { if (r.error) m('लॉगिन नहीं हुआ: ' + r.error.message); }); };
    $('a_up').onclick = function () {
      if ($('a_pw').value.length < 8) { m('पासवर्ड कम से कम 8 अक्षर का रखें'); return; }
      sb.auth.signUp({ email: $('a_em').value.trim(), password: $('a_pw').value, options: { data: { name: $('a_nm').value.trim(), phone: $('a_ph').value.replace(/\D/g, '').slice(0, 10), role: role }, emailRedirectTo: location.origin + location.pathname } })
        .then(function (r) { if (r.error) m(r.error.message); else if (!r.data.session) m('ईमेल पर भेजा लिंक खोलकर खाता चालू करें', true); });
    };
    if ($('a_g')) $('a_g').onclick = function () { sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }); };
    $('a_fp').onclick = function () { var e = $('a_em').value.trim(); if (!e) { m('पहले ईमेल लिखें'); return; } sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname }).then(function (r) { r.error ? m(r.error.message) : m('रीसेट लिंक ईमेल पर भेज दिया', true); }); };
    $('a_guest').onclick = function () { d.remove(); };
  }
  function needLogin(msg) { RR.pending = RR.lastOpen || null; RR.closeSh(); authUI(msg || 'लॉगिन करें — फिर ओनर से बात, विज़िट और बुकिंग कर पाएँगे'); }
  RR.isGuest = function () { return !me; }; RR.needLogin = needLogin;

  /* ---------- start ---------- */
  function start(user) {
    me = user; var a = $('rr-auth'); if (a) a.remove();
    sb.from('profiles').select('*').eq('id', me.id).single().then(function (r) {
      if (r.error || !r.data) { authUI('प्रोफाइल लोड नहीं हुई'); return; }
      prof = r.data; if (prof.banned) { sb.auth.signOut(); authUI('यह खाता बंद है'); return; }
      try { if (S.rooms.some(function (x) { return !isId(x.id) && !x.demo; })) localStorage.setItem('roomrahi2_local_backup', JSON.stringify(S)); } catch (e) {}
      S.rooms = []; S.visits = []; S.books = []; S.favs = []; S.cmp = []; S.reports = [];
      S.role = prof.role === 'admin' ? (S.role === 'tenant' ? 'tenant' : 'owner') : prof.role; RR.tab = S.role === 'owner' ? 'dash' : 'home';
      pull().then(function () {
        bell(); if (prof.role === 'admin') adminBtn(); loadNotifs(); subscribe();
        var rid = RR.pending || new URLSearchParams(location.search).get('room'); RR.pending = null; if (rid) setTimeout(function () { var b = document.createElement('div'); b.dataset.act = 'open'; b.dataset.id = rid; document.body.appendChild(b); b.click(); b.remove(); }, 200);
      });
    });
  }
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') { RR.sheet('<h1>नया पासवर्ड</h1><input id="np" type="password" placeholder="कम से कम 8 अक्षर"><button class="btn f" style="margin-top:10px" data-act="setpw">सेव करें</button>'); } });
  sb.auth.getSession().then(function (r) { if (r.data.session) start(r.data.session.user); else { me = null; pull(); } });
  sb.auth.onAuthStateChange(function (ev, ses) { if (ev === 'SIGNED_IN' && ses && !me) start(ses.user); });

  /* ---------- notifications ---------- */
  function bell() {
    if ($('rr-bell')) return; var b = document.createElement('button'); b.id = 'rr-bell'; b.className = 'chip'; b.setAttribute('aria-label', 'सूचनाएँ'); b.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:10px;z-index:40;font-size:16px'; b.dataset.act = 'notifs'; b.textContent = '🔔'; document.body.appendChild(b);
  }
  function setBadge() { var b = $('rr-bell'); if (b) b.textContent = '🔔' + (unread ? ' ' + unread : ''); }
  function loadNotifs() {
    sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40).then(function (r) { notifs = r.data || []; unread = notifs.filter(function (n) { return !n.read; }).length; setBadge(); });
  }
  function subscribe() {
    if (chan) return;
    chan = sb.channel('notif-' + me.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + me.id }, function (p) {
      notifs.unshift(p.new); unread++; setBadge();
      if (window.Notification && Notification.permission === 'granted' && (prof.prefs || {}).notify !== false && document.hidden) { try { new Notification(p.new.title, { body: p.new.body }); } catch (e) {} }
      if (p.new.kind === 'visits' || p.new.kind === 'bookings') pull();
    }).subscribe();
  }
  function notifSheet() {
    var h = '<h1>🔔 सूचनाएँ</h1>' + (notifs.length ? notifs.map(function (n) { return '<div class="card pad" style="' + (n.read ? '' : 'border-color:var(--acc)') + '"><b>' + esc(n.title) + '</b><div class="mut">' + esc(n.body) + ' • ' + new Date(n.created_at).toLocaleString('hi-IN') + '</div></div>'; }).join('') : '<p class="mut">कोई सूचना नहीं।</p>');
    RR.sheet(h); var ids = notifs.filter(function (n) { return !n.read; }).map(function (n) { return n.id; });
    if (ids.length) sb.from('notifications').update({ read: true }).in('id', ids).then(function () { notifs.forEach(function (n) { n.read = true; }); unread = 0; setBadge(); });
  }

  /* ---------- chat ---------- */
  var thread = null;
  RR.views.msgs = function () {
    setTimeout(loadConvs, 0); return '<h1>संदेश</h1><div id="rr-convs" class="mut">लोड हो रहा है…</div>';
  };
  function names(ids) {
    var need = ids.filter(function (i) { return !peerNames[i]; }); if (!need.length) return Promise.resolve();
    return sb.from('public_profiles').select('id,name').in('id', need).then(function (r) { (r.data || []).forEach(function (p) { peerNames[p.id] = p.name || 'यूज़र'; }); });
  }
  function loadConvs() {
    if (!me) { var e0 = $('rr-convs'); if (e0) e0.innerHTML = '<p class="mut">ओनर से बात करने के लिए लॉगिन करें।</p><button class="btn" data-act="login">लॉगिन / खाता बनाएँ</button>'; return; }
    sb.from('conversations').select('id,listing_id,user_a,user_b,created_at').order('created_at', { ascending: false }).then(function (r) {
      var cs = r.data || [], el = $('rr-convs'); if (!el) return; if (!cs.length) { el.innerHTML = 'अभी कोई चैट नहीं। किसी कमरे में 💬 चैट दबाएँ।'; return; }
      var peers = cs.map(function (c) { return c.user_a === me.id ? c.user_b : c.user_a; });
      names(peers).then(function () { return sb.from('messages').select('conversation_id,body,kind,sender_id,read_at,created_at').in('conversation_id', cs.map(function (c) { return c.id; })).order('created_at', { ascending: false }).limit(200); }).then(function (m) {
        var lastm = {}, un = {}; (m.data || []).forEach(function (x) { if (!lastm[x.conversation_id]) lastm[x.conversation_id] = x; if (x.sender_id !== me.id && !x.read_at) un[x.conversation_id] = (un[x.conversation_id] || 0) + 1; });
        el.innerHTML = cs.map(function (c, i) { var l = lastm[c.id], rm = S.rooms.filter(function (x) { return x.id === c.listing_id; })[0];
          return '<div class="card pad" data-act="thread" data-id="' + c.id + '" data-v="' + esc(peers[i]) + '" role="button" tabindex="0"><div class="row sp"><b>' + esc(peerNames[peers[i]] || 'यूज़र') + '</b>' + (un[c.id] ? '<span class="b">' + un[c.id] + ' नया</span>' : '') + '</div><div class="mut">' + (rm ? esc(rm.name) + ' • ' : '') + (l ? esc(l.kind === 'text' ? l.body.slice(0, 50) : '[' + l.kind + ']') : '') + '</div></div>'; }).join('');
      });
    });
  }
  function startChat(listingId, peer) {
    if (!me) return needLogin(); if (peer === me.id) { RR.toast('यह आपकी अपनी प्रॉपर्टी है'); return; }
    var q = sb.from('conversations').select('id').eq('user_a', me.id).eq('user_b', peer); q = listingId ? q.eq('listing_id', listingId) : q.is('listing_id', null);
    q.maybeSingle().then(function (r) {
      if (r.data) return r.data.id;
      return sb.from('conversations').insert({ listing_id: listingId || null, user_b: peer }).select('id').single().then(function (x) { if (x.error) throw x.error; RR.ev('chat', listingId); return x.data.id; });
    }).then(function (cid) { return names([peer]).then(function () { openThread(cid, peer); }); }).catch(toastErr);
  }
  var QR = ['हाँ, उपलब्ध है', 'किराया फिक्स है', 'कब देखने आएँगे?', 'फोन करें'];
  function bubble(m) {
    var mine = m.sender_id === me.id, body;
    if (m.kind === 'image') body = /^https:\/\//.test(m.body) && m.body.indexOf((C.R2_PUBLIC_URL || '#').replace(/\/$/, '')) === 0 ? '<img src="' + esc(m.body) + '" alt="फोटो" style="max-width:100%;border-radius:8px">' : '[फोटो]';
    else if (m.kind === 'location') { var p = m.body.split(','), la = parseFloat(p[0]), ln = parseFloat(p[1]); body = isFinite(la) && isFinite(ln) ? '<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + la + ',' + ln + '">📍 लोकेशन देखें</a>' : '[लोकेशन]'; }
    else if (m.kind === 'listing') body = '<a href="#" data-act="open" data-id="' + esc(m.body) + '">🏠 प्रॉपर्टी देखें</a>';
    else body = esc(m.body);
    return '<div style="display:flex;justify-content:' + (mine ? 'flex-end' : 'flex-start') + ';margin:4px 0"><div style="max-width:80%;padding:8px 10px;border-radius:12px;background:' + (mine ? 'var(--acc2)' : 'var(--card)') + ';border:1px solid var(--line)">' + body + '<div class="mut" style="font-size:10px;text-align:right">' + new Date(m.created_at).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' }) + (mine ? (m.read_at ? ' ✓✓' : ' ✓') : '') + '</div></div></div>';
  }
  function openThread(cid, peer) {
    if (thread && thread.ch) sb.removeChannel(thread.ch);
    thread = { cid: cid, peer: peer };
    RR.sheet('<div class="row sp"><b>' + esc(peerNames[peer] || 'चैट') + '</b><span id="rr-pres" class="mut"></span></div><div id="rr-msgs" style="min-height:200px;max-height:48vh;overflow-y:auto;margin:8px 0"></div><div id="rr-typ" class="mut" style="height:16px"></div>' +
      (S.role === 'owner' ? '<div class="sc" style="margin-bottom:6px">' + QR.map(function (q) { return '<button class="chip" data-act="qr" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="row"><input id="rr-in" maxlength="1000" placeholder="संदेश लिखें…" aria-label="संदेश"><button class="btn s" data-act="send">भेजें</button></div><div class="row wrap" style="margin-top:6px"><button class="chip" data-act="sendloc">📍 लोकेशन</button><label class="chip" style="margin:0">📷 फोटो<input id="rr-img" type="file" accept="image/*" style="display:none"></label><button class="chip" data-act="blk">🚫 ब्लॉक</button><button class="chip" data-act="rptu">🚩 रिपोर्ट</button></div>');
    sb.from('messages').select('*').eq('conversation_id', cid).order('created_at', { ascending: true }).limit(150).then(function (r) { var el = $('rr-msgs'); if (!el) return; el.innerHTML = (r.data || []).map(bubble).join(''); el.scrollTop = el.scrollHeight; sb.rpc('mark_read', { c: cid }).then(function () {}); });
    var ch = sb.channel('chat-' + cid, { config: { presence: { key: me.id } } });
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + cid }, function (p) { var el = $('rr-msgs'); if (!el || !thread || thread.cid !== cid) return; el.insertAdjacentHTML('beforeend', bubble(p.new)); el.scrollTop = el.scrollHeight; if (p.new.sender_id !== me.id) sb.rpc('mark_read', { c: cid }).then(function () {}); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + cid }, function () { sb.from('messages').select('*').eq('conversation_id', cid).order('created_at').limit(150).then(function (r) { var el = $('rr-msgs'); if (el) el.innerHTML = (r.data || []).map(bubble).join(''); }); })
      .on('broadcast', { event: 'typing' }, function (p) { if (p.payload.u !== me.id) { var t = $('rr-typ'); if (t) { t.textContent = 'टाइप कर रहे हैं…'; clearTimeout(thread.tt); thread.tt = setTimeout(function () { t.textContent = ''; }, 2500); } } })
      .on('presence', { event: 'sync' }, function () { var st = ch.presenceState(), pr = $('rr-pres'); if (pr) pr.textContent = st[peer] ? '🟢 ऑनलाइन' : ''; })
      .subscribe(function (s) { if (s === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
    thread.ch = ch;
    var inp = $('rr-in'); if (inp) { inp.oninput = function () { if (!thread.lt || Date.now() - thread.lt > 1500) { thread.lt = Date.now(); ch.send({ type: 'broadcast', event: 'typing', payload: { u: me.id } }); } }; inp.onkeydown = function (e) { if (e.key === 'Enter') sendMsg('text', inp.value); }; }
    var im = $('rr-img'); if (im) im.onchange = function (e) { var f = e.target.files[0]; if (!f) return; RR.toast('फोटो भेज रहे हैं…'); var rd = new FileReader(); rd.onload = function () { var i = new Image(); i.onload = function () { var s = Math.min(1, 800 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = i.width * s; c.height = i.height * s; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); upload(c.toDataURL('image/jpeg', .7), 'chat').then(function (u) { sendMsg('image', u.url); }).catch(toastErr); }; i.src = rd.result; }; rd.readAsDataURL(f); };
  }
  function sendMsg(kind, body) {
    body = String(body || '').trim(); if (!body || !thread) return;
    sb.from('messages').insert({ conversation_id: thread.cid, kind: kind, body: body }).then(function (x) { if (x.error) toastErr(x.error); else { var i = $('rr-in'); if (i && kind === 'text') i.value = ''; } });
  }
  /* admin tools use their own sheets below */

  /* ---------- owner stats shown on detail (only with real data; never fabricated) ---------- */
  function ownerLine(r) {
    if (!r.owner || !$('sb')) return;
    sb.rpc('owner_response', { u: r.owner }).then(function (x) {
      var d = x.data; if (!d || d.convs < 3 || !$('sb')) return;
      $('sb').insertAdjacentHTML('beforeend', '<div class="card pad" style="margin-top:10px"><b>🧑 ओनर का जवाब</b><div class="mut">' + d.convs + ' चैट में से ' + d.replied + ' में जवाब' + (d.median_min != null ? ' • औसत पहला जवाब ~' + Math.round(d.median_min) + ' मिनट' : '') + '</div></div>');
    });
  }

  /* ---------- profile extras ---------- */
  RR.extras.push(function () {
    var h = '<div style="height:8px"></div>';
    if (!me) return h + '<button class="btn f" data-act="login">लॉगिन / खाता बनाएँ</button>';
    var own = S.role === 'owner';
    h += '<div class="card pad"><b>' + esc(prof ? prof.name : '') + '</b> <span class="mut">' + esc(me.email || '') + '</span></div>';
    h += '<div class="g2"><button class="btn g" data-act="notifset">🔔 सूचना सेटिंग</button>' + (FL.RENT !== false ? '<button class="btn g" data-act="rentme">💰 किराया' + (own ? ' / एग्रीमेंट' : '') + '</button>' : '') + (FL.ROOMMATE !== false ? '<button class="btn g" data-act="roommate">👥 रूममेट</button>' : '') + '<button class="btn g" data-act="helpai">❓ मदद पूछें</button>' + (own ? '<button class="btn g" data-act="stats">📈 एनालिटिक्स</button><button class="btn g" data-act="verreq">🛡 वेरिफिकेशन</button>' : '') + '<button class="btn g" data-act="pw">🔑 पासवर्ड बदलें</button><button class="btn g" data-act="others">📵 बाकी डिवाइस लॉगआउट</button></div>';
    return h + '<div style="height:8px"></div><button class="btn g f" data-act="logout">लॉगआउट</button><div style="height:8px"></div><button class="btn g f" data-act="delacct" style="color:var(--bad)">⚠ मेरा खाता हमेशा के लिए हटाएँ</button>';
  });

  /* ---------- rent, agreement ---------- */
  function today() { return new Date().toISOString().slice(0, 10); }
  function rentSheet() {
    var own = S.role === 'owner';
    Promise.all([sb.from('rent_records').select('*').order('due_date', { ascending: false }).limit(60), sb.from('agreements').select('*').order('created_at', { ascending: false }).limit(30)]).then(function (r) {
      var recs = r[0].data || [], ags = r[1].data || [], ids = recs.map(function (x) { return x.tenant_id; }).concat(ags.map(function (x) { return x.tenant_id; }), S.books.map(function (b) { return b.tenant; }).filter(Boolean));
      return names(ids).then(function () {
        var nm = function (id) { var x = S.rooms.filter(function (z) { return z.id === id; })[0]; return x ? x.name : 'प्रॉपर्टी'; };
        var h = '<h1>💰 ' + (own ? 'किराया / एग्रीमेंट' : 'मेरा किराया') + '</h1>';
        if (own) {
          var bk = S.books.filter(function (b) { return ['ACCEPTED', 'CONFIRMED', 'COMPLETED'].indexOf(b.st) > -1 && b.owner === me.id; });
          h += '<h2>किरायेदार (स्वीकृत बुकिंग)</h2>' + (bk.length ? bk.map(function (b) { return '<div class="card pad"><b>' + esc(nm(b.rid)) + '</b> — ' + esc(peerNames[b.tenant] || 'किरायेदार') + '<div class="row wrap" style="margin-top:6px">' + (FL.AGREEMENT !== false ? '<button class="btn s" data-act="agnew" data-id="' + b.id + '">📄 एग्रीमेंट</button>' : '') + '<button class="btn g s" data-act="rentnew" data-id="' + b.id + '">➕ किराया रिकॉर्ड</button></div></div>'; }).join('') : '<p class="mut">कोई स्वीकृत बुकिंग नहीं।</p>');
        }
        var due = recs.filter(function (x) { return (x.status === 'PENDING' || x.status === 'PARTIAL' || x.status === 'OVERDUE') && x.due_date <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); });
        if (!own && due.length) h += '<div class="card pad" style="border-color:var(--warn)"><b>⏰ किराया रिमाइंडर</b>' + due.map(function (x) { return '<div>' + x.month + ' — ' + inr(x.amount - x.paid_amount) + ' • ' + x.due_date + (x.due_date < today() ? ' (देय तारीख निकल गई)' : '') + '</div>'; }).join('') + '</div>';
        h += '<h2>किराया रिकॉर्ड</h2>' + (recs.length ? recs.map(function (x) { var st = x.status === 'PENDING' && x.due_date < today() ? 'OVERDUE' : x.status;
          return '<div class="card pad"><div class="row sp"><b>' + esc(nm(x.listing_id)) + ' • ' + x.month + '</b><span class="b ' + (st === 'PAID' ? 'ok' : st === 'CANCELLED' ? '' : 'w') + '">' + st + '</span></div><div class="mut">' + inr(x.amount) + (x.paid_amount ? ' (मिला ' + inr(x.paid_amount) + ')' : '') + ' • देय ' + x.due_date + (own ? ' • ' + esc(peerNames[x.tenant_id] || '') : '') + '</div>' + (own ? '<div class="row wrap" style="margin-top:6px"><button class="btn s" data-act="rentst" data-id="' + x.id + '" data-v="PAID">मिल गया</button><button class="btn g s" data-act="rentst" data-id="' + x.id + '" data-v="PARTIAL">आंशिक</button><button class="btn g s" data-act="rentst" data-id="' + x.id + '" data-v="CANCELLED">रद्द</button></div>' : '') + '</div>'; }).join('') : '<p class="mut">कोई रिकॉर्ड नहीं।</p>') + '<p class="mut">ऐप पेमेंट नहीं लेता। "मिल गया" सिर्फ ओनर की पुष्टि है।</p>';
        h += '<h2>एग्रीमेंट</h2>' + (ags.length ? ags.map(function (a) { return '<div class="card pad"><div class="row sp"><b>' + esc(nm(a.listing_id)) + '</b><span class="b">' + a.status + '</span></div><div class="row wrap" style="margin-top:6px"><button class="btn g s" data-act="agprint" data-id="' + a.id + '">🖨 प्रिंट/PDF</button>' + (!own && a.status === 'SENT' ? '<button class="btn s" data-act="agok" data-id="' + a.id + '">✓ पढ़ लिया, स्वीकार</button>' : '') + '</div></div>'; }).join('') : '<p class="mut">कोई एग्रीमेंट नहीं।</p>');
        RR._ags = ags; RR._recs = recs; RR.sheet(h);
      });
    }).catch(toastErr);
  }
  function agHtml(a) {
    var r = S.rooms.filter(function (x) { return x.id === a.listing_id; })[0] || {}, t = a.terms || {};
    var li = function (k, v) { return '<tr><td style="padding:6px;border:1px solid #999"><b>' + k + '</b></td><td style="padding:6px;border:1px solid #999">' + esc(v) + '</td></tr>'; };
    return '<!DOCTYPE html><html lang="hi"><meta charset="utf-8"><title>किराया एग्रीमेंट</title><body style="font-family:Mukta,sans-serif;max-width:700px;margin:20px auto;padding:0 12px"><h2 style="text-align:center">किराया एग्रीमेंट (ड्राफ्ट)</h2><p style="font-size:12px;border:1px solid #B45309;padding:6px">यह ROOMRAHI द्वारा बना सादा ड्राफ्ट है। यह कानूनी रूप से मान्य ई-साइन/स्टाम्प पेपर नहीं है; अपने राज्य के नियमों के अनुसार रजिस्ट्रेशन/नोटरी करवाएँ।</p><table style="width:100%;border-collapse:collapse">' +
      li('एग्रीमेंट ID', a.id) + li('तारीख', String(a.created_at).slice(0, 10)) + li('ओनर', t.owner_name) + li('किरायेदार', t.tenant_name) + li('प्रॉपर्टी', (r.name || '') + ', ' + (r.area || '') + ' ' + (r.city || '')) + li('मासिक किराया', '₹' + t.rent) + li('डिपॉज़िट', '₹' + t.deposit) + li('शुरू होने की तारीख', t.start) + li('अवधि', t.months + ' महीने') + li('नोटिस अवधि', t.notice + ' दिन') + li('बिजली/पानी/अन्य', t.utilities) + li('नियम', t.rules) + '</table><p>स्थिति: ' + esc(a.status) + '</p><br><br><div style="display:flex;justify-content:space-between"><span>ओनर के हस्ताक्षर: __________</span><span>किरायेदार के हस्ताक्षर: __________</span></div><script>setTimeout(function(){print()},400)<\/script></body></html>';
  }

  /* ---------- roommate (opt-in; only chosen preferences are shared) ---------- */
  function roommateSheet() {
    var rm = prof.roommate || {};
    var sel = function (id, opts, v) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    RR.sheet('<h1>👥 रूममेट</h1><div class="mut">यह सिर्फ तभी दिखेगा जब आप चालू करेंगे। केवल पहला नाम और नीचे की पसंद दिखती है — फोन/ईमेल नहीं।</div><label><input type="checkbox" id="rm_on" style="width:auto;min-height:0"' + (prof.roommate_opt_in ? ' checked' : '') + '> मुझे रूममेट खोजना है</label><div class="g2"><div><label>बजट ₹</label><input id="rm_b" type="number" value="' + (rm.budget || '') + '"></div><div><label>काम/इलाका</label><input id="rm_a" value="' + esc(rm.area || '') + '"></div><div><label>खाना</label>' + sel('rm_f', [['veg', 'शाकाहारी'], ['nonveg', 'मांसाहारी']], rm.food) + '</div><div><label>स्मोकिंग</label>' + sel('rm_s', [['no', 'नहीं'], ['yes', 'हाँ']], rm.smoke) + '</div><div><label>सोने का समय</label>' + sel('rm_z', [['early', 'जल्दी'], ['late', 'देर से']], rm.sleep) + '</div><div><label>पालतू जानवर</label>' + sel('rm_p', [['no', 'नहीं'], ['yes', 'ठीक है']], rm.pets) + '</div></div><button class="btn f" style="margin-top:10px" data-act="rmsave">सेव करें और मैच देखें</button><div id="rm_out"></div>');
  }
  function rmMatch() {
    var mine = prof.roommate || {};
    sb.from('roommate_candidates').select('*').neq('id', me.id).limit(40).then(function (r) {
      var out = (r.data || []).map(function (c) {
        var x = c.roommate || {}, s = 0, why = [];
        if (mine.budget && x.budget && Math.abs(mine.budget - x.budget) / mine.budget <= .25) { s += 30; why.push('मिलता-जुलता बजट'); }
        if (mine.area && x.area && mine.area.toLowerCase() === String(x.area).toLowerCase()) { s += 25; why.push('एक ही इलाका/काम'); }
        [['food', 15, 'खाना'], ['smoke', 10, 'स्मोकिंग'], ['sleep', 10, 'सोने का समय'], ['pets', 10, 'पालतू']].forEach(function (k) { if (mine[k[0]] && mine[k[0]] === x[k[0]]) { s += k[1]; why.push('एक जैसा ' + k[2]); } });
        return { c: c, s: s, why: why };
      }).filter(function (m) { return m.s >= 30; }).sort(function (a, b) { return b.s - a.s; });
      var el = $('rm_out'); if (!el) return;
      el.innerHTML = '<h2>मैच (' + out.length + ')</h2>' + (out.length ? out.map(function (m) { return '<div class="card pad"><div class="row sp"><b>' + esc(m.c.name || 'यूज़र') + '</b><span class="b ok">' + m.s + '% मेल</span></div><div class="mut">' + esc(m.why.join(' • ')) + '</div><button class="btn s" style="margin-top:6px" data-act="rmchat" data-v="' + m.c.id + '">💬 बात करें</button></div>'; }).join('') : '<p class="mut">अभी कोई मेल नहीं मिला।</p>');
    });
  }

  /* ---------- analytics (owner) ---------- */
  function statsSheet() {
    var since = new Date(Date.now() - 30 * 864e5).toISOString();
    Promise.all([sb.from('events').select('kind,listing_id').gte('created_at', since).limit(5000), sb.rpc('owner_response', { u: me.id })]).then(function (r) {
      var ev = r[0].data || [], mine = S.rooms.filter(function (x) { return x.mine; }), rs = r[1].data;
      var row = function (x) { var e = ev.filter(function (z) { return z.listing_id === x.id; }), c = function (k) { return e.filter(function (z) { return z.kind === k; }).length; }, v = c('view');
        return '<tr><td>' + esc(x.name.slice(0, 14)) + '</td><td>' + v + '</td><td>' + c('favorite') + '</td><td>' + c('contact') + '</td><td>' + c('chat') + '</td><td>' + (c('visit') + c('booking')) + '</td><td>' + (v ? Math.round((c('visit') + c('booking')) / v * 100) + '%' : '—') + '</td></tr>'; };
      RR.sheet('<h1>📈 पिछले 30 दिन</h1>' + (mine.length ? '<table><tr><td></td><th>व्यू</th><th>सेव</th><th>संपर्क</th><th>चैट</th><th>विज़िट/बुक</th><th>कन्वर्ज़न</th></tr>' + mine.map(row).join('') + '</table>' : '<p class="mut">कोई प्रॉपर्टी नहीं।</p>') +
        '<div class="card pad" style="margin-top:10px"><b>जवाब देने की दर</b><div class="mut">' + (rs && rs.convs ? rs.convs + ' चैट में से ' + rs.replied + ' में जवाब' + (rs.median_min != null ? ' • औसत ~' + Math.round(rs.median_min) + ' मिनट' : '') : 'अभी चैट का डेटा नहीं है') + '</div></div><p class="mut">ये असली गिनती हैं; कोई वादा नहीं कि सुधार करने पर लीड बढ़ेंगी।</p>');
    }).catch(toastErr);
  }

  /* ---------- admin (UI only; every action is an RPC checked by Postgres) ---------- */
  function adminBtn() {
    var b = document.createElement('button'); b.className = 'chip'; b.id = 'rr-adm'; b.dataset.act = 'admin'; b.textContent = '🛠'; b.setAttribute('aria-label', 'एडमिन');
    b.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:64px;z-index:40;font-size:16px'; document.body.appendChild(b);
  }
  function adminSheet() {
    Promise.all([sb.rpc('admin_stats'), sb.rpc('suspicious_listings'), sb.from('listings').select('id,name,area,rent,verification,state').eq('verification', 'pending').limit(30), sb.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(30), sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(15)]).then(function (r) {
      if (r[0].error) { RR.toast('एडमिन एक्सेस नहीं है'); return; }
      var st = r[0].data || {}, sus = r[1].data || [], pend = r[2].data || [], rep = r[3].data || [], au = r[4].data || [];
      var acts = function (id) { return '<div class="row wrap" style="margin-top:6px">' + [['verify', '✓ वेरिफाई'], ['request_changes', '✏ बदलाव'], ['reject', '✕ रिजेक्ट'], ['suspend', '⏸ सस्पेंड'], ['unsuspend', '▶ चालू'], ['remove', '🗑 हटाएँ']].map(function (a) { return '<button class="btn g s" data-act="adm" data-id="' + id + '" data-v="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'; };
      var cells = [['users', 'यूज़र'], ['owners', 'ओनर'], ['listings', 'लिस्टिंग'], ['active', 'सक्रिय'], ['pending', 'वेरिफ़ाई बाकी'], ['verified', 'वेरिफाइड'], ['reported', 'रिपोर्टेड'], ['visits', 'विज़िट'], ['bookings', 'बुकिंग'], ['messages', 'संदेश']];
      RR.sheet('<h1>🛠 एडमिन</h1><div class="g2">' + cells.map(function (c) { return '<div class="card pad"><b>' + (st[c[0]] || 0) + '</b><div class="mut">' + c[1] + '</div></div>'; }).join('') + '</div>' +
        '<h2>⚠ संदिग्ध / डुप्लीकेट (' + sus.length + ')</h2>' + sus.map(function (s) { return '<div class="card pad"><b>' + esc(s.name) + '</b><div class="mut">' + esc((s.reasons || []).join(' • ')) + '</div>' + acts(s.listing_id) + '</div>'; }).join('') +
        '<h2>वेरिफिकेशन कतार (' + pend.length + ')</h2>' + pend.map(function (s) { return '<div class="card pad"><b>' + esc(s.name) + '</b> <span class="mut">' + esc(s.area) + ' • ' + inr(s.rent) + '</span>' + acts(s.id) + '</div>'; }).join('') +
        '<h2>खुली रिपोर्ट (' + rep.length + ')</h2>' + rep.map(function (s) { return '<div class="card pad"><b>' + esc(s.reason) + '</b><div class="mut">' + new Date(s.created_at).toLocaleDateString('hi-IN') + '</div>' + (s.listing_id ? acts(s.listing_id) : '') + '<div class="row" style="margin-top:6px"><button class="btn s" data-act="admrep" data-id="' + s.id + '" data-v="actioned">कार्रवाई हुई</button><button class="btn g s" data-act="admrep" data-id="' + s.id + '" data-v="dismissed">खारिज</button></div></div>'; }).join('') +
        '<h2>ऑडिट लॉग</h2>' + au.map(function (a) { return '<div class="mut">' + new Date(a.created_at).toLocaleString('hi-IN') + ' • ' + esc(a.action) + ' • ' + esc(a.target_type) + ' • ' + esc(a.result) + '</div>'; }).join(''));
    }).catch(toastErr);
  }

  /* ---------- click handling (capture phase: gating + AI add-ons; bubble: new actions) ---------- */
  var NEEDS = ['fav', 'visit', 'vsend', 'book', 'bsend', 'rsend', 'chat', 'add', 'savef', 'edit'];
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return; var a = el.dataset.act;
    if (!me && NEEDS.indexOf(a) > -1) { e.stopPropagation(); e.preventDefault(); needLogin(); return; }
    if (a === 'open' && el.dataset.id) { RR.ev('view', el.dataset.id); var r0 = S.rooms.filter(function (x) { return x.id === el.dataset.id; })[0]; setTimeout(function () { if (r0) ownerLine(r0); }, 150); }
    if (a === 'gen' && FL.AI_DESCRIBE !== false && me && C.AI_WORKER_URL) {
      setTimeout(function () {
        var f = { name: RR.val('f_name'), type: RR.val('f_type'), rent: RR.val('f_rent'), area: RR.val('f_area'), city: RR.val('f_city'), amenities: [].map.call(document.querySelectorAll('#sb [data-act=am].on'), function (b) { return b.dataset.v; }), foodIncluded: $('f_food') && $('f_food').classList.contains('on'), electricityIncluded: $('f_elec') && $('f_elec').classList.contains('on') };
        ai('describe', f).then(function (j) { if ($('f_desc')) { $('f_desc').value = j.text.trim(); RR.toast('AI ड्राफ्ट तैयार — कृपया जाँचकर ही सेव करें'); } }).catch(function () {});
      }, 0);
    }
    if (a === 'cmpgo' && FL.AI_COMPARE !== false && me && C.AI_WORKER_URL) {
      setTimeout(function () {
        var rs = S.cmp.map(function (id) { return S.rooms.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean).map(function (r) { var d = RR.dist(r, RR.here()); return { name: r.name, rent: r.rent, deposit: r.dep, estimatedTotal: RR.cost(r).tot, km: d == null ? null : +d.toFixed(1), trust: RR.trust(r).s, status: RR.fresh(r), amenities: r.am }; });
        ai('compare', { rooms: rs }).then(function (j) { if ($('sb')) $('sb').insertAdjacentHTML('beforeend', '<div class="card pad" style="margin-top:10px"><b>🤖 AI सारांश</b><div class="mut">ऊपर की तालिका के तथ्यों पर आधारित; अनुमान हो सकते हैं।</div><div>' + esc(j.text) + '</div></div>'); }).catch(function () {});
      }, 80);
    }
    if (a === 'share') { var r1 = S.rooms.filter(function (x) { return x.id === el.dataset.id; })[0]; if (r1) { e.stopPropagation(); var link = location.origin + location.pathname + '?room=' + r1.id, tx = r1.name + ' — ' + inr(r1.rent) + '/माह, ' + r1.area + ' (ROOMRAHI)';
      RR.sheet('<h1>↗ शेयर</h1><a class="btn f" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(tx + ' ' + link) + '">WhatsApp</a><div style="height:8px"></div><a class="btn g f" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(tx) + '">Telegram</a><div style="height:8px"></div><button class="btn g f" data-act="copylink" data-v="' + esc(link) + '">लिंक कॉपी करें</button>'); } }
  }, true);
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]'); if (!a) return; var h = a.getAttribute('href') || ''; if (!/^tel:|wa\.me/.test(h)) return;
    if (!me) { e.preventDefault(); e.stopPropagation(); needLogin('ओनर का नंबर/WhatsApp इस्तेमाल करने के लिए लॉगिन करें'); return; }
    var rr = S.rooms.filter(function (x) { return x.phone && h.indexOf(x.phone.replace(/\D/g, '').slice(-10)) > -1; })[0]; RR.ev('contact', rr && rr.id);
  }, true);

  RR.acts.push(function (a, el, id, v) {
    var R = function () { return S.rooms.filter(function (x) { return x.id === id; })[0]; };
    if (a === 'chat') { var r = R(); if (r) startChat(r.id, r.owner); }
    else if (a === 'thread') { names([v]).then(function () { openThread(id, v); }); }
    else if (a === 'send') sendMsg('text', $('rr-in').value);
    else if (a === 'qr') sendMsg('text', v);
    else if (a === 'sendloc') RR.gps(function (p) { sendMsg('location', p.lat.toFixed(5) + ',' + p.lng.toFixed(5)); });
    else if (a === 'blk') { if (confirm('इस यूज़र को ब्लॉक करें?')) sb.from('blocks').upsert({ blocker_id: me.id, blocked_id: thread.peer }).then(function (x) { x.error ? toastErr(x.error) : RR.toast('ब्लॉक हो गया'); }); }
    else if (a === 'rptu') { var rs = prompt('रिपोर्ट का कारण'); if (rs) sb.from('reports').insert({ target_user: thread.peer, reason: rs.slice(0, 300) }).then(function (x) { x.error ? toastErr(x.error) : RR.toast('रिपोर्ट दर्ज हुई'); }); }
    else if (a === 'notifs') notifSheet();
    else if (a === 'login') authUI();
    else if (a === 'logout') { sb.auth.signOut().then(function () { location.reload(); }); }
    else if (a === 'others') sb.auth.signOut({ scope: 'others' }).then(function () { RR.toast('बाकी डिवाइस लॉगआउट हो गए'); });
    else if (a === 'pw') RR.sheet('<h1>🔑 पासवर्ड बदलें</h1><input id="np" type="password" placeholder="नया पासवर्ड (8+ अक्षर)"><button class="btn f" style="margin-top:10px" data-act="setpw">सेव करें</button>');
    else if (a === 'setpw') { var p = $('np').value; if (p.length < 8) { RR.toast('कम से कम 8 अक्षर'); return; } sb.auth.updateUser({ password: p }).then(function (x) { x.error ? toastErr(x.error) : (RR.closeSh(), RR.toast('पासवर्ड बदल गया')); }); }
    else if (a === 'delacct') { if (confirm('आपका खाता, लिस्टिंग, फोटो और चैट हमेशा के लिए हट जाएँगे। पक्का?')) { tok().then(function (t) { return fetch(C.STORAGE_WORKER_URL + '/mine', { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); }).catch(log).then(function () { return sb.rpc('delete_my_account'); }).then(function (x) { if (x && x.error) throw x.error; return sb.auth.signOut(); }).then(function () { localStorage.removeItem('roomrahi2'); location.reload(); }).catch(toastErr); } }
    else if (a === 'notifset') { var on = (prof.prefs || {}).notify !== false, an = (prof.prefs || {}).analytics !== false; RR.sheet('<h1>🔔 सेटिंग</h1><label><input type="checkbox" id="ns_n" style="width:auto;min-height:0"' + (on ? ' checked' : '') + '> ब्राउज़र सूचनाएँ (ऐप खुला/बैकग्राउंड में)</label><label><input type="checkbox" id="ns_a" style="width:auto;min-height:0"' + (an ? ' checked' : '') + '> उपयोग के आँकड़े (सिर्फ व्यू/सेव जैसी गिनती) भेजने दें</label><button class="btn f" style="margin-top:10px" data-act="nssave">सेव</button><p class="mut">फ़ोन बंद/ऐप बंद होने पर पुश नोटिफिकेशन के लिए अलग सर्वर सेटअप चाहिए (docs/DEPLOYMENT.md)।</p>'); }
    else if (a === 'nssave') { var pr = Object.assign({}, prof.prefs, { notify: $('ns_n').checked, analytics: $('ns_a').checked }); if (pr.notify && window.Notification && Notification.permission === 'default') Notification.requestPermission(); sb.from('profiles').update({ prefs: pr }).eq('id', me.id).then(function (x) { if (!x.error) { prof.prefs = pr; RR.closeSh(); RR.toast('सेव हुआ'); } }); }
    else if (a === 'helpai') RR.sheet('<h1>❓ मदद</h1><input id="hq" placeholder="जैसे: एडवांस पैसा देना सुरक्षित है?"><button class="btn f" style="margin-top:8px" data-act="helpgo">पूछें</button><div id="ho" class="card pad" style="margin-top:10px;display:none"></div>');
    else if (a === 'helpgo') { var o = $('ho'); o.style.display = 'block'; o.textContent = '…'; ai('support', { q: $('hq').value.slice(0, 300) }).then(function (j) { o.textContent = j.text; }).catch(function () { o.textContent = 'AI अभी उपलब्ध नहीं। सेफ्टी सेंटर देखें।'; }); }
    else if (a === 'rentme') rentSheet();
    else if (a === 'rentnew') { var b = S.books.filter(function (x) { return x.id === id; })[0], rm = b && R2(b.rid); if (!b) return; RR.sheet('<h1>➕ किराया रिकॉर्ड</h1><label>महीना</label><input id="rn_m" type="month" value="' + today().slice(0, 7) + '"><label>रकम ₹</label><input id="rn_a" type="number" value="' + (rm ? rm.rent : '') + '"><label>देय तारीख</label><input id="rn_d" type="date" value="' + today() + '"><button class="btn f" style="margin-top:10px" data-act="rentsave" data-id="' + b.id + '">सेव</button>'); }
    else if (a === 'rentsave') { var bb = S.books.filter(function (x) { return x.id === id; })[0]; sb.from('rent_records').insert({ listing_id: bb.rid, owner_id: me.id, tenant_id: bb.tenant, month: RR.val('rn_m'), amount: +RR.val('rn_a'), due_date: RR.val('rn_d') }).then(function (x) { x.error ? toastErr(x.error) : (RR.toast('दर्ज हुआ'), rentSheet()); }); }
    else if (a === 'rentst') { var up = { status: v }; if (v === 'PAID') { var rc = (RR._recs || []).filter(function (x) { return x.id === id; })[0]; up.paid_amount = rc ? rc.amount : 0; } if (v === 'PARTIAL') { var pa = +prompt('कितना मिला ₹?'); if (!pa) return; up.paid_amount = pa; } sb.from('rent_records').update(up).eq('id', id).then(function (x) { x.error ? toastErr(x.error) : rentSheet(); }); }
    else if (a === 'agnew') { var b2 = S.books.filter(function (x) { return x.id === id; })[0], r2 = b2 && R2(b2.rid); if (!b2) return; RR.sheet('<h1>📄 एग्रीमेंट</h1><div class="mut">सिर्फ वही लिखें जो आप दोनों ने तय किया है।</div><div class="g2"><div><label>शुरू तारीख</label><input id="ag_s" type="date" value="' + today() + '"></div><div><label>अवधि (महीने)</label><input id="ag_m" type="number" value="11"></div><div><label>किराया ₹</label><input id="ag_r" type="number" value="' + (r2 ? r2.rent : '') + '"></div><div><label>डिपॉज़िट ₹</label><input id="ag_d" type="number" value="' + (r2 ? r2.dep : '') + '"></div><div><label>नोटिस (दिन)</label><input id="ag_n" type="number" value="30"></div></div><label>बिजली/पानी/अन्य</label><input id="ag_u" placeholder="जैसे: बिजली मीटर से"><label>नियम</label><textarea id="ag_ru" rows="3"></textarea><button class="btn f" style="margin-top:10px" data-act="agsave" data-id="' + b2.id + '">बनाएँ और भेजें</button>'); }
    else if (a === 'agsave') { var b3 = S.books.filter(function (x) { return x.id === id; })[0]; var terms = { owner_name: prof.name || '', tenant_name: peerNames[b3.tenant] || '', rent: +RR.val('ag_r'), deposit: +RR.val('ag_d'), start: RR.val('ag_s'), months: +RR.val('ag_m'), notice: +RR.val('ag_n'), utilities: RR.val('ag_u'), rules: RR.val('ag_ru') };
      sb.from('agreements').insert({ listing_id: b3.rid, booking_id: b3.id, owner_id: me.id, tenant_id: b3.tenant, terms: terms }).select().single().then(function (x) { if (x.error) return toastErr(x.error); RR.toast('भेज दिया'); printAg(x.data); }); }
    else if (a === 'agprint') { var ag = (RR._ags || []).filter(function (x) { return x.id === id; })[0]; if (ag) printAg(ag); }
    else if (a === 'agok') sb.from('agreements').update({ status: 'ACCEPTED_BY_TENANT' }).eq('id', id).then(function (x) { x.error ? toastErr(x.error) : rentSheet(); });
    else if (a === 'roommate') roommateSheet();
    else if (a === 'rmsave') { var rmv = { budget: +RR.val('rm_b') || null, area: RR.val('rm_a'), food: RR.val('rm_f'), smoke: RR.val('rm_s'), sleep: RR.val('rm_z'), pets: RR.val('rm_p') }, opt = $('rm_on').checked; sb.from('profiles').update({ roommate: rmv, roommate_opt_in: opt }).eq('id', me.id).then(function (x) { if (x.error) return toastErr(x.error); prof.roommate = rmv; prof.roommate_opt_in = opt; if (opt) rmMatch(); else $('rm_out').innerHTML = '<p class="mut">रूममेट खोज बंद है — आपकी पसंद किसी को नहीं दिखेगी।</p>'; }); }
    else if (a === 'rmchat') { names([v]).then(function () { startChat(null, v); }); }
    else if (a === 'stats') statsSheet();
    else if (a === 'verreq') { var mine = S.rooms.filter(function (x) { return x.mine; }); RR.sheet('<h1>🛡 वेरिफिकेशन</h1><div class="mut">एडमिन फोटो, लोकेशन और जानकारी जाँचकर वेरिफाई करता है। अर्जी देने के बाद रेंट/एरिया/GPS बदलने पर दोबारा जाँच होगी।</div>' + (mine.length ? mine.map(function (x) { return '<div class="card pad row sp"><span>' + esc(x.name) + ' <span class="b ' + (x.verified ? 'ok' : '') + '">' + esc(x.vstate || 'none') + '</span>' + (x.note ? '<div class="mut">एडमिन नोट: ' + esc(x.note) + '</div>' : '') + '</span>' + (x.vstate === 'none' || x.vstate === 'rejected' ? '<button class="btn s" data-act="verask" data-id="' + x.id + '">अर्जी दें</button>' : '') + '</div>'; }).join('') : '<p class="mut">कोई प्रॉपर्टी नहीं।</p>')); }
    else if (a === 'verask') sb.from('listings').update({ verification: 'pending' }).eq('id', id).then(function (x) { x.error ? toastErr(x.error) : (RR.toast('अर्जी भेज दी'), pull()); });
    else if (a === 'admin') adminSheet();
    else if (a === 'adm') { var note = (v === 'request_changes' || v === 'reject' || v === 'suspend') ? (prompt('एडमिन नोट (ओनर को दिखेगा)') || '') : ''; if (v === 'remove' && !confirm('यह लिस्टिंग हमेशा के लिए हटाएँ?')) return; sb.rpc('admin_listing_action', { lid: id, act: v, note: note }).then(function (x) { x.error ? toastErr(x.error) : (RR.toast('हो गया'), adminSheet(), pull()); }); }
    else if (a === 'admrep') sb.rpc('admin_resolve_report', { rid: id, res: v, note: '' }).then(function (x) { x.error ? toastErr(x.error) : adminSheet(); });
    else if (a === 'copylink') { if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { RR.toast('कॉपी हो गया'); }); }
    function R2(i) { return S.rooms.filter(function (x) { return x.id === i; })[0]; }
  });
  function printAg(a) { var w = window.open('', '_blank'); if (!w) { RR.toast('पॉप-अप की अनुमति दें'); return; } w.document.write(agHtml(a)); w.document.close(); }
})();
