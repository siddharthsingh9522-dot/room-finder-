/* ROOMRAHI features.js — works in local AND cloud mode (uses the window.RR interface).
   Map + clustering, search-this-area, alerts (device), recommendations with reasons, favorite collections, search history,
   floor-wise units, 360 tour link, nearby facilities (OpenStreetMap), shift advice, listing completeness, change history,
   owner/tenant onboarding, draft autosave, move-in checklist + notes, scam check, rent split, theme. */
(function () {
  'use strict';
  var RR = window.RR; if (!RR) return;
  var S = RR.S, esc = RR.esc, inr = RR.inr, C = window.ROOMRAHI_CONFIG || {}, FL = C.FLAGS || {}, $ = function (i) { return document.getElementById(i); };
  var room = function (id) { return S.rooms.filter(function (x) { return x.id === id; })[0]; };
  var TY = RR.TYPES;
  var st = document.createElement('style');
  st.textContent = '.mk{background:var(--acc);color:#fff;border-radius:12px;padding:2px 8px;font-size:12px;font-weight:700;border:2px solid #fff;white-space:nowrap;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4)}.mk.v{background:#15803D}.leaflet-container{font-family:inherit}.unit{display:inline-block;padding:4px 9px;border-radius:8px;border:1px solid var(--line);margin:0 4px 4px 0;font-size:13px;background:var(--card)}';
  document.head.appendChild(st);
  if (S.theme) document.documentElement.dataset.theme = S.theme;

  /* ---------- history, search history, price tracking ---------- */
  function touch(id) { S.hist = [id].concat((S.hist || []).filter(function (x) { return x !== id; })).slice(0, 40); RR.save(); }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return; var a = el.dataset.act;
    if (a === 'open' && el.dataset.id) { var id = el.dataset.id; touch(id); setTimeout(function () { detailExtras(id); }, 140); }
    if (a === 'go' && $('q') && $('q').value.trim()) { var q = $('q').value.trim(); S.sq = [q].concat((S.sq || []).filter(function (x) { return x !== q; })).slice(0, 8); }
  }, true);
  RR.after.push(function () { S.favs.forEach(function (id) { var r = room(id); if (r && S.lastRent[id] == null) S.lastRent[id] = r.rent; }); });

  /* ---------- MAP (Leaflet + marker clustering + search-this-area) ---------- */
  var map = null;
  RR.after.push(function () {
    var box = $('rr-map'); if (!box) { if (map) { map.remove(); map = null; } return; }
    if (!window.L) { box.innerHTML = '<p class="mut pad">मैप के लिए इंटरनेट चाहिए (Leaflet लोड नहीं हुआ)।</p>'; return; }
    if (map) { map.remove(); map = null; }
    var rs = RR.list().filter(function (r) { return r.lat != null && r.lng != null; }), me = RR.here(), c = me || (rs[0] ? { lat: rs[0].lat, lng: rs[0].lng } : { lat: 28.35, lng: 76.93 });
    map = L.map(box).setView([c.lat, c.lng], rs.length ? 13 : 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    var cl = L.markerClusterGroup();
    rs.forEach(function (r) {
      var k = r.rent >= 1000 ? (r.rent / 1000).toFixed(r.rent % 1000 ? 1 : 0) + 'k' : r.rent;
      var m = L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', html: '<div class="mk' + (r.verified ? ' v' : '') + '">₹' + k + '</div>', iconSize: [54, 26], iconAnchor: [27, 13] }) });
      m.bindPopup('<b>' + esc(r.name) + '</b><br>' + inr(r.rent) + '/माह' + (r.verified ? ' • ✓ वेरिफाइड' : '') + '<br><a href="javascript:void(0)" data-act="open" data-id="' + r.id + '">विवरण</a> • <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + r.lat + ',' + r.lng + '">रास्ता</a>');
      cl.addLayer(m);
    });
    map.addLayer(cl);
    if (me) L.circleMarker([me.lat, me.lng], { radius: 8, color: '#2563EB' }).addTo(map).bindPopup('आप / काम की जगह');
    var ctl = L.control({ position: 'bottomleft' });
    ctl.onAdd = function () { var d = L.DomUtil.create('div'); d.innerHTML = '<button class="btn s" data-act="maparea">🔎 इस इलाके में खोजें</button>'; L.DomEvent.disableClickPropagation(d); return d; };
    ctl.addTo(map);
    if (!rs.length) box.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:auto 8px 8px 8px;z-index:999;background:var(--card);padding:6px 10px;border-radius:8px;font-size:12px">इन फ़िल्टर के लिए GPS वाला कोई कमरा नहीं।</div>');
  });
  function areaSheet() {
    if (!map) return; var b = map.getBounds();
    var rs = RR.list().filter(function (r) { return r.lat != null && b.contains([r.lat, r.lng]); });
    RR.sheet('<h1>🔎 इस इलाके के कमरे (' + rs.length + ')</h1>' + (rs.length ? rs.map(function (r) { return '<div class="card pad row sp" data-act="open" data-id="' + r.id + '" role="button" tabindex="0"><span>' + esc(r.name) + '<div class="mut">' + esc(r.area) + '</div></span><b>' + inr(r.rent) + '</b></div>'; }).join('') : '<p class="mut">इस नक्शे वाले हिस्से में कोई कमरा नहीं।</p>'));
  }

  /* ---------- home / search / saved slots ---------- */
  function recs() {
    var seed = (S.hist || []).concat(S.favs).map(room).filter(Boolean); if (seed.length < 2) return [];
    var tc = {}, ac = {}, rents = seed.map(function (r) { return r.rent; }).sort(function (a, b) { return a - b; }), med = rents[Math.floor(rents.length / 2)];
    seed.forEach(function (r) { tc[r.type] = (tc[r.type] || 0) + 1; ac[r.area] = (ac[r.area] || 0) + 1; });
    var top = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })[0]; }, tt = top(tc), ta = top(ac), ids = seed.map(function (r) { return r.id; });
    return S.rooms.filter(function (r) { return ids.indexOf(r.id) < 0 && r.mine !== true && ['active', 'confirm'].indexOf(RR.fresh(r)) > -1; }).map(function (r) {
      var s = 0, why = [], d = RR.dist(r, RR.here());
      if (r.type === tt) { s += 30; why.push('आपने ' + TY[tt][1] + ' ज़्यादा देखे/सेव किए'); }
      if (med && Math.abs(r.rent - med) / med <= .25) { s += 30; why.push('किराया आपके देखे गए कमरों के आसपास'); }
      if (r.area === ta) { s += 20; why.push(r.area + ' इलाका'); }
      if (d != null && d <= 3) { s += 15; why.push('काम की जगह से ' + d.toFixed(1) + ' km'); }
      return { r: r, s: s + RR.trust(r).s / 10, why: why };
    }).filter(function (x) { return x.why.length >= 2; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 3);
  }
  function alerts() {
    var out = [];
    S.favs.forEach(function (id) { var r = room(id), p = S.lastRent[id]; if (r && p && r.rent < p) out.push('📉 ' + esc(r.name) + ': ' + inr(p) + ' → ' + inr(r.rent)); });
    S.saved.forEach(function (s) { var n = match(s.f).filter(function (r) { return (r.created || 0) > (s.checked || s.at || 0); }).length; if (n) out.push('🔎 "' + esc(s.label) + '" पर ' + n + ' नए कमरे'); });
    return out;
  }
  function match(f) {
    return S.rooms.filter(function (r) {
      if (r.mine === true || RR.fresh(r) === 'rented' || RR.fresh(r) === 'paused') return false;
      if (f.pt && f.pt !== 'all' && r.type !== f.pt) return false; if (f.max && r.rent > f.max) return false;
      if (f.ac && (r.am || []).indexOf('AC') < 0) return false; if (f.furn && (r.am || []).indexOf('फर्निश्ड') < 0) return false;
      if (f.text && (r.name + ' ' + r.area + ' ' + r.city).toLowerCase().indexOf(f.text.toLowerCase()) < 0) return false; return true;
    });
  }
  RR.slots.home = [function () {
    var h = '', al = alerts(), rc = RR.S.role === 'tenant' ? recs() : [];
    if (al.length) h += '<div class="card pad" style="border-color:var(--acc)"><b>🔔 अलर्ट (सिर्फ इस डिवाइस पर)</b>' + al.map(function (x) { return '<div>' + x + '</div>'; }).join('') + '<button class="btn g s" style="margin-top:6px" data-act="alertok">ठीक है, देख लिया</button></div>';
    if (rc.length) h += '<h2>✨ आपके लिए सुझाव</h2>' + rc.map(function (x) { return '<div class="card pad" data-act="open" data-id="' + x.r.id + '" role="button" tabindex="0"><div class="row sp"><b>' + esc(x.r.name) + '</b><b>' + inr(x.r.rent) + '</b></div><div class="mut">क्यों: ' + esc(x.why.join(' • ')) + '</div></div>'; }).join('') + '<div class="mut" style="font-size:11px">यह आपकी देखी/सेव की गई चीज़ों से इसी फोन में बनता है। प्रोफाइल → "इतिहास साफ़ करें" से मिटाएँ।</div>';
    return h;
  }];
  RR.slots.search = [function () {
    return (S.sq || []).length ? '<div class="sc" style="margin:6px 0">' + S.sq.map(function (q, i) { return '<button class="chip" data-act="sq" data-v="' + i + '">🕘 ' + esc(q.slice(0, 22)) + '</button>'; }).join('') + '<button class="chip" data-act="sqclr">✕ साफ़</button></div>' : '';
  }];
  var COLS = [['best', '⭐ बेस्ट'], ['cheap', '💰 सस्ते'], ['factory', '🏭 फैक्ट्री के पास'], ['visit', '📅 विज़िट प्लान']];
  RR.slots.saved = [function () {
    return '<div class="sc" style="margin:6px 0"><button class="chip' + (!S.colSel ? ' on' : '') + '" data-act="colsel" data-v="">सभी</button>' + COLS.map(function (c) { return '<button class="chip' + (S.colSel === c[0] ? ' on' : '') + '" data-act="colsel" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>';
  }];
  /* owner onboarding checklist + completeness */
  function completeness(r) {
    var chk = [['नाम', r.name], ['किराया', r.rent], ['इलाका', r.area], ['फोन', r.phone], ['3+ फोटो', (r.imgs || []).length >= 3], ['GPS', r.lat != null], ['विवरण (30+ अक्षर)', (r.desc || '').length >= 30], ['3+ सुविधाएँ', (r.am || []).length >= 3], ['डिपॉज़िट', r.dep > 0]];
    var miss = chk.filter(function (c) { return !c[1]; }).map(function (c) { return c[0]; });
    return { pct: Math.round((chk.length - miss.length) / chk.length * 100), miss: miss };
  }
  RR.slots.dash = [function () {
    var mine = S.rooms.filter(function (r) { return r.mine !== false && !r.demo; });
    var steps = [['प्रॉपर्टी जोड़ें', mine.length > 0], ['3+ फोटो डालें', mine.some(function (r) { return (r.imgs || []).length >= 3; })], ['GPS लोकेशन जोड़ें', mine.some(function (r) { return r.lat != null; })], ['फोन नंबर डालें', mine.some(function (r) { return r.phone; })], ['अवेलेबिलिटी की पुष्टि करें', mine.some(function (r) { return RR.fresh(r) === 'active'; })]];
    if (steps.every(function (s) { return s[1]; })) return '';
    return '<div class="card pad"><b>🚀 शुरुआत के स्टेप</b>' + steps.map(function (s) { return '<div>' + (s[1] ? '✅' : '⬜') + ' ' + s[0] + '</div>'; }).join('') + '</div>';
  }];

  /* ---------- detail add-ons ---------- */
  function shiftAdvice(r) {
    var d = RR.dist(r, RR.S.work), m = String(S.shift || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); if (d == null || !m) return '';
    var h = +m[1], mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; if (h > 23) return '';
    var mins = Math.round(d / 25 * 60), t = h * 60 + mi - mins - 15, hh = Math.floor(((t % 1440) + 1440) % 1440 / 60), mm = ((t % 60) + 60) % 60;
    return '<div class="mut">⏱ शिफ्ट "' + esc(S.shift) + '": बाइक ~' + mins + ' मिनट, लगभग ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' तक निकलें (अनुमान)</div>';
  }
  function detailExtras(id) {
    var r = room(id), sb = $('sb'); if (!r || !sb || !sb.querySelector('h1')) return; if ($('rr-x')) $('rr-x').remove();
    var own = S.role === 'owner' && r.mine !== false, h = '<div id="rr-x">';
    var sh = shiftAdvice(r); if (sh) h += '<div class="card pad"><b>🕒 शिफ्ट के हिसाब से</b>' + sh + '</div>';
    var us = r.units || []; if (us.length || own) {
      var fl = {}; us.forEach(function (u, i) { (fl[u.f] = fl[u.f] || []).push([u, i]); });
      var free = us.filter(function (u) { return u.s === 'vacant'; }).length, sym = { vacant: '🟢', occupied: '🔴', soon: '🟡' };
      h += '<div class="card pad"><div class="row sp"><b>🏢 यूनिट / कमरे</b><span class="mut">' + free + ' खाली / ' + us.length + '</span></div>' + Object.keys(fl).sort().map(function (f) { return '<div style="margin-top:6px"><span class="mut">मंज़िल ' + esc(f) + '</span><br>' + fl[f].map(function (p) { return '<button class="unit"' + (own ? ' data-act="unitcy" data-id="' + r.id + '" data-v="' + p[1] + '"' : '') + '>' + sym[p[0].s] + ' ' + esc(p[0].l) + (p[0].rent ? ' • ' + inr(p[0].rent) : '') + '</button>'; }).join('') + '</div>'; }).join('') + (own ? '<div class="row wrap" style="margin-top:8px"><button class="btn g s" data-act="unitadd" data-id="' + r.id + '">+ यूनिट जोड़ें</button><button class="btn g s" data-act="unitdel" data-id="' + r.id + '">− आखिरी हटाएँ</button></div><div class="mut">यूनिट दबाकर स्थिति बदलें: 🟢 खाली → 🔴 भरा → 🟡 जल्द खाली</div>' : '') + (us.length ? '' : '<div class="mut">अभी कोई यूनिट नहीं जोड़ी।</div>') + '</div>';
    }
    if (FL.VIRTUAL_TOUR !== false && (r.tour || own)) h += '<div class="card pad"><b>🧭 वर्चुअल टूर</b>' + (r.tour ? '<div><a class="btn g s" style="text-decoration:none;display:inline-block;margin-top:6px" target="_blank" rel="noopener noreferrer" href="' + esc(r.tour) + '">360° टूर खोलें</a></div>' : '<div class="mut">अभी कोई टूर लिंक नहीं। असली 360° फोटो/वीडियो का https लिंक जोड़ें।</div>') + (own ? '<button class="btn g s" style="margin-top:6px" data-act="tourset" data-id="' + r.id + '">🔗 टूर लिंक ' + (r.tour ? 'बदलें' : 'जोड़ें') + '</button>' : '') + '</div>';
    if (own) {
      var cp = completeness(r);
      h += '<div class="card pad"><div class="row sp"><b>📋 लिस्टिंग पूर्णता</b><b>' + cp.pct + '%</b></div><div class="bar" style="margin:6px 0"><u style="width:' + cp.pct + '%"></u></div><div class="mut">' + (cp.miss.length ? 'जोड़ें: ' + esc(cp.miss.join(', ')) : 'सब जानकारी भरी है 👍') + '</div></div>';
      if ((r.hist || []).length) h += '<div class="card pad"><b>🕘 बदलाव का इतिहास</b>' + r.hist.slice(-6).reverse().map(function (x) { return '<div class="mut">' + new Date(x.t).toLocaleString('hi-IN') + ' • ' + esc(x.c) + '</div>'; }).join('') + '<div class="mut" style="font-size:11px">यह इतिहास इसी डिवाइस/सेशन में रखा जाता है।</div></div>';
    } else {
      h += '<div class="card pad"><b>📁 संग्रह में रखें</b><div class="sc" style="margin-top:6px">' + COLS.map(function (c) { return '<button class="chip' + (S.fcol[id] === c[0] ? ' on' : '') + '" data-act="fcol" data-id="' + id + '" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
      h += '<div class="g2"><button class="btn g" data-act="chk" data-id="' + id + '">✅ चेकलिस्ट + नोट</button>' + (r.lat != null ? '<button class="btn g" data-act="near_x" data-id="' + id + '">📍 आसपास क्या है</button>' : '') + '</div><div id="rr-nb"></div>';
    }
    sb.insertAdjacentHTML('beforeend', h + '</div>');
  }

  /* ---------- nearby facilities (real OpenStreetMap data; may be incomplete) ---------- */
  function nearby(id) {
    var r = room(id), o = $('rr-nb'); if (!r || !o) return; o.innerHTML = '<div class="mut">OpenStreetMap से खोज रहे हैं…</div>';
    var q = '[out:json][timeout:12];(node(around:800,' + r.lat + ',' + r.lng + ')[amenity~"pharmacy|hospital|clinic|atm|bank|marketplace"];node(around:800,' + r.lat + ',' + r.lng + ')[shop~"supermarket|convenience|laundry|general"];node(around:800,' + r.lat + ',' + r.lng + ')[highway=bus_stop];);out 80;';
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 14000);
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal }).then(function (x) { return x.json(); }).then(function (j) {
      clearTimeout(tm); var g = { 'दवाई की दुकान': 0, 'अस्पताल/क्लिनिक': 0, 'ATM/बैंक': 0, 'दुकान/मार्केट': 0, 'बस स्टॉप': 0 }, near = {};
      (j.elements || []).forEach(function (e) { var t = e.tags || {}, k = t.amenity === 'pharmacy' ? 'दवाई की दुकान' : /hospital|clinic/.test(t.amenity || '') ? 'अस्पताल/क्लिनिक' : /atm|bank/.test(t.amenity || '') ? 'ATM/बैंक' : t.highway === 'bus_stop' ? 'बस स्टॉप' : 'दुकान/मार्केट', d = RR.dist({ lat: e.lat, lng: e.lon }, { lat: r.lat, lng: r.lng }) * 1000; g[k]++; if (near[k] == null || d < near[k]) near[k] = d; });
      o.innerHTML = '<div class="card pad"><b>📍 800 मीटर के अंदर</b>' + Object.keys(g).map(function (k) { return '<div class="row sp"><span>' + k + '</span><span>' + (g[k] ? g[k] + ' • सबसे पास ~' + Math.round(near[k]) + ' m' : 'डेटा में नहीं मिला') + '</span></div>'; }).join('') + '<div class="mut" style="font-size:11px">स्रोत: OpenStreetMap योगदानकर्ता — अधूरा हो सकता है, खुद भी देखें।</div></div>';
    }).catch(function () { o.innerHTML = '<div class="mut">अभी आसपास का डेटा नहीं मिल पाया (इंटरनेट/सर्वर)।</div>'; });
  }

  /* ---------- sheets: checklist/notes, scam check, rent split ---------- */
  var CHK = ['पानी का प्रेशर और 24 घंटे सप्लाई', 'छत/दीवार में सीलन या रिसाव', 'ताला, दरवाज़े, खिड़कियाँ ठीक', 'बिजली का बोर्ड/वायरिंग, मीटर किसके नाम', 'मोबाइल नेटवर्क / WiFi', 'बाथरूम-टॉयलेट की सफाई', 'रात को रास्ते की रोशनी और सुरक्षा', 'पार्किंग और सीढ़ी'];
  var ASK = ['कुल किराया + बिजली/पानी/मेंटेनेंस अलग से?', 'डिपॉज़िट कितना, वापसी कब और कैसे?', 'नोटिस पीरियड और किराया बढ़ने का नियम?', 'मेहमान/खाना बनाने/समय के नियम?', 'लिखित एग्रीमेंट और किराया रसीद मिलेगी?'];
  function chkSheet(id) {
    var r = room(id), c = S.chk[id] || {};
    RR.sheet('<h1>✅ देखने जाएँ तो</h1><div class="mut">' + esc(r ? r.name : '') + '</div>' + CHK.map(function (t, i) { return '<button class="chip" style="display:block;width:100%;text-align:left;margin:4px 0;' + (c[i] ? 'background:#DCFCE7' : '') + '" data-act="chkt" data-id="' + id + '" data-v="' + i + '">' + (c[i] ? '☑' : '☐') + ' ' + t + '</button>'; }).join('') + '<h2>ओनर से पूछें</h2>' + ASK.map(function (t) { return '<div class="mut">• ' + t + '</div>'; }).join('') + '<h2>मेरा निजी नोट</h2><textarea id="rr-note" rows="3" placeholder="सिर्फ आपको दिखेगा">' + esc(S.notes[id] || '') + '</textarea>');
    $('rr-note').oninput = function () { S.notes[id] = this.value.slice(0, 600); RR.save(); };
  }
  var SCAM = ['ओनर पहले ही एडवांस/बुकिंग का पैसा माँग रहा है', 'कमरा देखे बिना पैसा देने को कह रहा है', 'किराया इलाके के मुकाबले बहुत कम है', '"जल्दी करो, कोई और ले जाएगा" का दबाव है', 'ओनर बाहर/फौज/विदेश में बताता है और चाबी "कूरियर" से भेजने की बात करता है', 'OTP, UPI PIN या QR स्कैन करने को कहा', 'फोटो इंटरनेट से ली लगती हैं / लोकेशन मेल नहीं खाती'];
  var scam = {};
  function scamSheet() {
    var n = Object.keys(scam).filter(function (k) { return scam[k]; }).length, lvl = n === 0 ? ['कम जोखिम', 'ok', 'फिर भी कमरा खुद देखें और रसीद लें।'] : n <= 2 ? ['सावधान रहें', 'w', 'पैसा देने से पहले कमरा देखें, ओनर की पहचान और मालिकाना कागज़ माँगें।'] : ['ऊँचा जोखिम', 'x', 'पैसा न दें। रिपोर्ट करें; धोखाधड़ी हो तो 1930 (साइबर हेल्पलाइन) पर कॉल करें।'];
    RR.sheet('<h1>🕵 स्कैम चेक</h1><div class="mut">जो बातें सच हैं उन पर दबाएँ।</div>' + SCAM.map(function (t, i) { return '<button class="chip" style="display:block;width:100%;text-align:left;margin:4px 0;white-space:normal;' + (scam[i] ? 'background:#FEE2E2' : '') + '" data-act="scamt" data-v="' + i + '">' + (scam[i] ? '⚠' : '○') + ' ' + t + '</button>'; }).join('') + '<div class="card pad" style="margin-top:10px"><span class="b ' + lvl[1] + '">' + lvl[0] + '</span> ' + lvl[2] + '</div><div class="mut">यह सिर्फ मार्गदर्शन है, गारंटी नहीं।</div>');
  }
  function splitSheet() {
    RR.sheet('<h1>🧮 रेंट स्प्लिट</h1><div class="g2"><div><label>किराया ₹</label><input id="sp_r" type="number" inputmode="numeric"></div><div><label>बिजली ₹</label><input id="sp_e" type="number" inputmode="numeric"></div><div><label>खाना/अन्य ₹</label><input id="sp_o" type="number" inputmode="numeric"></div><div><label>कितने लोग</label><input id="sp_n" type="number" value="2" min="1"></div></div><div id="sp_out" class="card pad" style="margin-top:10px">रकम डालें</div>');
    var f = function () { var n = Math.max(1, +$('sp_n').value || 1), t = (+$('sp_r').value || 0) + (+$('sp_e').value || 0) + (+$('sp_o').value || 0); $('sp_out').innerHTML = t ? 'कुल ' + inr(t) + ' → हर व्यक्ति <b>' + inr(Math.ceil(t / n)) + '</b> / माह' : 'रकम डालें'; };
    ['sp_r', 'sp_e', 'sp_o', 'sp_n'].forEach(function (i) { $(i).oninput = f; });
  }

  /* ---------- profile buttons ---------- */
  RR.extras.push(function () {
    return '<div style="height:8px"></div><div class="g2"><button class="btn g" data-act="split">🧮 रेंट स्प्लिट</button><button class="btn g" data-act="scam">🕵 स्कैम चेक</button><button class="btn g" data-act="theme">🌓 थीम बदलें</button><button class="btn g" data-act="histclr">🧹 इतिहास साफ़ करें</button></div>';
  });

  /* ---------- actions ---------- */
  RR.acts.push(function (a, el, id, v) {
    var r = room(id);
    if (a === 'maparea') areaSheet();
    else if (a === 'sq') { var q = S.sq[+v]; if (q && $('q')) { $('q').value = q; var b = document.querySelector('[data-act=go]'); if (b) b.click(); } }
    else if (a === 'sqclr') { S.sq = []; RR.save(); RR.render(); }
    else if (a === 'colsel') { S.colSel = v; RR.save(); RR.render(); }
    else if (a === 'fcol' && r) { if (S.fcol[id] === v) delete S.fcol[id]; else { S.fcol[id] = v; if (S.favs.indexOf(id) < 0) S.favs.push(id); } RR.save(); RR.render(); detailExtras(id); }
    else if (a === 'alertok') { S.favs.forEach(function (i) { var x = room(i); if (x) S.lastRent[i] = x.rent; }); S.saved.forEach(function (s) { s.checked = Date.now(); }); RR.save(); RR.render(); }
    else if (a === 'unitadd' && r) { var l = prompt('यूनिट का नाम/नंबर (जैसे 101)'); if (!l) return; var f = prompt('मंज़िल (जैसे 1)', '1') || '1', rt = +prompt('किराया ₹ (खाली छोड़ सकते हैं)', '') || 0; if ((r.units || []).length >= 60) { RR.toast('अधिकतम 60 यूनिट'); return; } (r.units = r.units || []).push({ l: l.slice(0, 12), f: String(f).slice(0, 4), s: 'vacant', rent: rt }); RR.save(); detailExtras(id); }
    else if (a === 'unitcy' && r) { var u = r.units[+v], nx = { vacant: 'occupied', occupied: 'soon', soon: 'vacant' }; u.s = nx[u.s] || 'vacant'; RR.save(); detailExtras(id); }
    else if (a === 'unitdel' && r) { if (r.units && r.units.length && confirm('आखिरी यूनिट हटाएँ?')) { r.units.pop(); RR.save(); detailExtras(id); } }
    else if (a === 'tourset' && r) { var u2 = prompt('असली 360° टूर का https लिंक (खाली = हटाएँ)', r.tour || ''); if (u2 === null) return; u2 = u2.trim(); if (u2 && !/^https:\/\/[^\s]+$/.test(u2)) { RR.toast('सही https लिंक डालें'); return; } r.tour = u2; RR.save(); detailExtras(id); }
    else if (a === 'near_x') nearby(id);
    else if (a === 'chk') chkSheet(id);
    else if (a === 'chkt') { var c = S.chk[id] = S.chk[id] || {}; c[v] = !c[v]; RR.save(); chkSheet(id); }
    else if (a === 'scam') { scam = {}; scamSheet(); }
    else if (a === 'scamt') { scam[v] = !scam[v]; scamSheet(); }
    else if (a === 'split') splitSheet();
    else if (a === 'theme') { var cur = S.theme || '', nx2 = cur === '' ? 'dark' : cur === 'dark' ? 'light' : ''; S.theme = nx2; if (nx2) document.documentElement.dataset.theme = nx2; else delete document.documentElement.dataset.theme; RR.save(); RR.toast('थीम: ' + (nx2 || 'सिस्टम')); }
    else if (a === 'histclr') { S.hist = []; S.sq = []; RR.save(); RR.toast('इतिहास साफ़'); RR.render(); }
    else if (a === 'w_go') welcomeGo();
    else if (a === 'w_pick') { if ($('w_l')) $('w_l').value = v; }
    else if (a === 'w_gps') gpsPick();
    else if (a === 'w_all') { if (S.guest) S.guest.loc = ''; RR.setF({ text: '' }); RR.save(); RR.closeSh(); RR.render(); }
    else if (a === 'locchg') welcomeSheet(true);
    else if (a === 'g_ok') gateOk();
  });

  /* ---------- draft autosave (new listing form) ---------- */
  var dt = null;
  document.addEventListener('input', function (e) {
    var sb = $('sb'); if (!sb || !sb.contains(e.target) || !$('f_name') || $('f_id').value) return;
    clearTimeout(dt); dt = setTimeout(function () {
      S.draft = { name: RR.val('f_name'), type: RR.val('f_type'), rent: +RR.val('f_rent') || '', dep: +RR.val('f_dep') || '', area: RR.val('f_area'), city: RR.val('f_city'), phone: RR.val('f_phone'), beds: +RR.val('f_beds') || '', desc: RR.val('f_desc'),
        am: [].map.call(document.querySelectorAll('#sb [data-act=am].on'), function (b) { return b.dataset.v; }), foodInc: $('f_food').classList.contains('on'), elecInc: $('f_elec').classList.contains('on') };
      try { localStorage.setItem('roomrahi2', JSON.stringify(S)); } catch (x) {}
    }, 700);
  });

  /* ---------- change history (local) ---------- */
  var snap = null;
  RR.hooks.push(function () {
    var cur = {}; S.rooms.forEach(function (r) { if (r.mine !== false && !r.demo) cur[r.id] = { rent: r.rent, dep: r.dep, area: r.area, phone: r.phone, state: r.state || '' }; });
    if (snap) Object.keys(cur).forEach(function (id) {
      var o = snap[id], n = cur[id], r = room(id); if (!o || !r) return; var ch = [];
      if (o.rent !== n.rent) ch.push('किराया ' + inr(o.rent) + ' → ' + inr(n.rent)); if (o.dep !== n.dep) ch.push('डिपॉज़िट ' + inr(o.dep) + ' → ' + inr(n.dep)); if (o.area !== n.area) ch.push('इलाका: ' + o.area + ' → ' + n.area); if (o.phone !== n.phone) ch.push('फोन बदला'); if (o.state !== n.state) ch.push('स्थिति: ' + (o.state || 'सक्रिय') + ' → ' + (n.state || 'सक्रिय'));
      if (ch.length) (r.hist = r.hist || []).push({ t: Date.now(), c: ch.join(', ') });
    });
    snap = cur;
  });

  /* ---------- welcome popup: name + mobile + location -> rooms of that location (Flipkart-style: browse first, login on action) ---------- */
  function areas() {
    var c = {}; S.rooms.forEach(function (r) { if (r.area) c[r.area] = (c[r.area] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 8);
  }
  function welcomeSheet(change) {
    var g = S.guest || {}, ar = areas();
    RR.sheet('<h1>' + (change ? '📍 जगह बदलें' : '🏠 ROOMRAHI में स्वागत है') + '</h1><div class="mut">' + (change ? 'किस जगह के कमरे देखने हैं?' : 'पहले अपनी जगह चुनें — कमरे देखें, पसंद आए तो ओनर से बात करें।') + '</div>' +
      (change ? '' : '<label>आपका नाम *</label><input id="w_n" autocomplete="name" value="' + esc(g.name || '') + '"><label>मोबाइल नंबर *</label><input id="w_p" type="tel" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="10 अंक" value="' + esc(g.phone || '') + '">') +
      '<label>कमरा किस जगह चाहिए? *</label><input id="w_l" list="w_dl" placeholder="जैसे: मानेसर, सेक्टर 8, धारूहेड़ा" value="' + esc(g.loc || '') + '"><datalist id="w_dl">' + ar.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
      (ar.length ? '<div class="sc" style="margin-top:6px">' + ar.map(function (a) { return '<button class="chip" data-act="w_pick" data-v="' + esc(a) + '">📍 ' + esc(a) + '</button>'; }).join('') + '</div>' : '') +
      '<button class="btn g f" style="margin-top:8px" data-act="w_gps">🎯 मेरी लोकेशन से चुनें</button><div id="w_err" style="color:var(--bad);margin:8px 0;font-size:13px"></div>' +
      '<button class="btn f" data-act="w_go">कमरे दिखाओ</button>' + (change ? '<button class="btn g f" style="margin-top:8px" data-act="w_all">सभी जगह के कमरे देखें</button>' : '') +
      '<div class="mut" style="font-size:11px;margin-top:8px">नाम और नंबर सिर्फ इस फोन में रखे जाते हैं। ओनर से बात, विज़िट और बुकिंग के लिए लॉगिन चाहिए होगा।</div>');
  }
  function welcomeGo() {
    var old = S.guest || {}, n = $('w_n') ? RR.val('w_n') : old.name, p = $('w_p') ? RR.val('w_p').replace(/\D/g, '') : old.phone, l = RR.val('w_l'), e = $('w_err');
    if (!n || n.length < 2) { e.textContent = 'अपना नाम लिखें'; return; }
    if (!/^[6-9]\d{9}$/.test(p || '')) { e.textContent = '10 अंक का सही मोबाइल नंबर लिखें'; return; }
    if (!l) { e.textContent = 'जगह लिखें या चुनें'; return; }
    S.guest = { name: n.slice(0, 40), phone: p, loc: l.slice(0, 60), confirmed: old.confirmed || false, at: old.at || Date.now() };
    RR.setF({ text: S.guest.loc, pt: 'all', max: null }); RR.save(); RR.closeSh(); RR.tab = 'search'; RR.render();
    var cnt = RR.list().length; RR.toast(cnt ? '📍 ' + S.guest.loc + ' के ' + cnt + ' कमरे' : 'अभी ' + S.guest.loc + ' में कोई कमरा नहीं मिला');
  }
  function gpsPick() {
    RR.gps(function (p) {
      var best = null, bd = 1e9; S.rooms.forEach(function (r) { var d = RR.dist(r, p); if (d != null && d < bd) { bd = d; best = r; } });
      if (best && bd <= 20) { $('w_l').value = best.area; RR.toast('सबसे पास का इलाका: ' + best.area + ' (' + bd.toFixed(1) + ' km)'); }
      else RR.toast('आपकी लोकेशन के पास कोई कमरा नहीं — जगह खुद लिखें');
    });
  }
  RR.keepLoc = function (f) { if (!f.text && S.guest && S.guest.loc) f.text = S.guest.loc; };
  function locBar() {
    if (!S.guest || !S.guest.loc || S.role !== 'tenant') return '';
    return '<div class="card pad row sp" style="margin:8px 0"><span>📍 <b>' + esc(S.guest.loc) + '</b> के कमरे</span><button class="btn g s" data-act="locchg">बदलें</button></div>';
  }
  RR.slots.home.unshift(locBar); RR.slots.search.unshift(locBar);
  if (S.guest && S.guest.loc) { RR.setF({ text: S.guest.loc }); RR.render(); }
  setTimeout(function () {
    var loggedIn = RR.isGuest && !RR.isGuest();
    if (S.guest || loggedIn || S.role !== 'tenant' || $('rr-auth') || $('sh').classList.contains('o')) return;
    welcomeSheet(false);
  }, 1500);

  /* ---------- "login to continue" gate (cloud: real login; local mode: clearly-labelled demo confirmation) ---------- */
  var GATED = ['visit', 'book', 'chat'], lastOpen = null;
  function openRoom(id) { var b = document.createElement('div'); b.dataset.act = 'open'; b.dataset.id = id; document.body.appendChild(b); b.click(); b.remove(); }
  function gateSheet() {
    var g = S.guest || {};
    RR.sheet('<h1>🔐 आगे बढ़ने के लिए कन्फर्म करें</h1><div class="card pad"><div>👤 ' + esc(g.name || '—') + '</div><div>📱 ' + esc(g.phone || '—') + '</div></div><div class="mut" style="margin:8px 0">यह डेमो कन्फर्मेशन है — मोबाइल पर OTP नहीं जाता। असली लॉगिन (ईमेल/पासवर्ड, चाहें तो OTP) बैकएंड जुड़ने पर यहीं आएगा।</div><button class="btn f" data-act="g_ok">कन्फर्म करके आगे बढ़ें</button>');
  }
  function gateOk() { S.guest = S.guest || { name: '', phone: '' }; S.guest.confirmed = true; RR.save(); RR.closeSh(); if (lastOpen) setTimeout(function () { openRoom(lastOpen); RR.toast('अब विज़िट/बुकिंग/संपर्क कर सकते हैं'); }, 80); }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'), a = e.target.closest('a[href]');
    if (el && el.dataset.act === 'open' && el.dataset.id) { lastOpen = RR.lastOpen = el.dataset.id; }
    if (RR.cloud) return;                       // cloud mode: cloud.js shows the real login
    var gate = (el && GATED.indexOf(el.dataset.act) > -1) || (a && /^tel:|wa\.me/.test(a.getAttribute('href') || ''));
    if (gate && !(S.guest && S.guest.confirmed)) { e.preventDefault(); e.stopPropagation(); gateSheet(); }
  }, true);
})();
