(function () {
  var HH = 60, H0 = 7, H1 = 24, TOP = 10, LEFT = 64;
  var COLORS = window.AGENDA_COLORS;
  /* Ordre protocolaire et couleurs : c = pastille (vive), p = rendez-vous (pastel) */
  var ORDER = ['JMM', 'JFG', 'SP', 'JFL', 'MA'];
  var PALETTE = {
    JMM: { c: '#C00000', p: '#FFEBED' },
    JFG: { c: '#5DC934', p: '#EAF8E6' },
    SP: { c: '#E09B0F', p: '#FDF4E1' },
    JFL: { c: '#C233B5', p: '#F9ECF7' },
    MA: { c: '#0C8BBF', p: '#E3F5FD' }
  };
  var rankOf = function (ini) { var i = ORDER.indexOf(String(ini).toUpperCase()); return i < 0 ? ORDER.length : i; };
  /* Trie l'équipe dans l'ordre protocolaire (les nouveaux membres suivent) et applique les couleurs.
     Les initiales des titres, les pastilles, le formulaire et la liste d'équipe suivent donc le même ordre. */
  function normalizeUsers(list) {
    return list.map(function (u, i) { return { u: u, i: i }; })
      .sort(function (a, b) { return rankOf(a.u.ini) - rankOf(b.u.ini) || a.i - b.i; })
      .map(function (x) {
        var u = x.u, P = PALETTE[String(u.ini).toUpperCase()];
        if (P) { u.c = P.c; u.p = P.p; } else { u.p = 'color-mix(in srgb, ' + u.c + ' 16%, #ffffff)'; }
        return u;
      });
  }
  var plain = function (u) { var o = Object.assign({}, u); delete o.p; return o; };
  var DN = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'], MN = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var short = function (d, withYear) { return DN[d.getDay()] + ' ' + pad(d.getDate()) + ' ' + MN[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : ''); };
  var ARR_UP = '<svg viewBox="0 0 24 30" aria-hidden="true" focusable="false"><polygon points="8,30 16,30 16,16 22,16 12,2 2,16 8,16" fill="#c00000" stroke="#1a1a40" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var ARR_DOWN = '<svg viewBox="0 0 24 30" aria-hidden="true" focusable="false"><polygon points="8,0 16,0 16,14 22,14 12,28 2,14 8,14" fill="#c00000" stroke="#1a1a40" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var model = [];
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ds = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var pd = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  var mins = function (t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; };
  var monday = function (d) { var x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  var fmt = function (d, o) { return d.toLocaleDateString('fr-FR', o); };

  var forced = false;
  var users = [], events = [], selected = {}, view = (window.innerWidth < 700 ? 'day' : 'week'), cursor = ds(new Date()), editing = null, allMode = true;

  var EVT = 'evt';
  function prefix(ids) {
    var list = users.filter(function (u) { return ids.indexOf(u.id) > -1; }).map(function (u) { return u.ini; });
    return (ids.indexOf(EVT) > -1 ? 'EVT: ' : '') + (list.length ? '(' + list.join(', ') + ') ' : '');
  }
  var realParts = function (ids) { return ids.filter(function (p) { return p !== EVT; }); };
  /* Anciens rendez-vous sans étiquettes : on relit « EVT: (JMM, MA) Titre » ou « (JFL, EVT) Titre » dans le titre */
  function legacy(e) {
    if (e.parts.length) return e;
    var m = /^\s*(EVT\s*:\s*)?(?:\(([^)]*)\)\s*)?([\s\S]*)$/.exec(e.title), ids = [];
    if (!m || (!m[1] && m[2] === undefined)) return e;
    if (m[1]) ids.push(EVT);
    (m[2] || '').split(',').forEach(function (t) {
      t = t.trim().toUpperCase(); if (!t) return;
      if (t === 'EVT') { if (ids.indexOf(EVT) < 0) ids.push(EVT); return; }
      users.forEach(function (u) { if (u.ini.toUpperCase() === t) ids.push(u.id); });
    });
    if (!ids.length) return e;
    e.parts = ids; e.title = m[3]; return e;
  }
  var store = window.createStore(prefix);
  var uById = function (id) { for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i]; return null; };

  function showError(e) { var b = $('banner'); b.textContent = e ? (e.message || String(e)) : ''; b.hidden = !e; }
  function run(p) { showError(null); return p.catch(function (e) { if (!(e && e.auth)) showError(e); throw e; }); }

  function range() {
    var c = pd(cursor);
    if (view === 'day') return [c, c];
    var m = monday(c); return [m, addDays(m, 6)];
  }
  /* Données en mémoire : une fenêtre de ±3 semaines autour de la période affichée.
     Changer de semaine ne demande rien au service tant qu'on reste dans la fenêtre ; les rendez-vous créés,
     modifiés ou supprimés s'affichent aussitôt et sont envoyés en arrière-plan. */
  var win = null, gen = 0, pending = 0, loading = 0, refreshing = false, autoScroll = false;
  function busy() {
    var el = $('sync'); if (!el) return;
    el.hidden = !(pending || loading);
    el.textContent = pending ? 'Enregistrement…' : 'Chargement…';
  }
  function covered(r) { return !!win && win.from <= ds(r[0]) && win.to >= ds(r[1]); }
  function fetchWin(r) {
    var from = ds(addDays(r[0], -21)), to = ds(addDays(r[1], 21));
    return store.list(from, to).then(function (list) { return { from: from, to: to, events: users.length ? list.map(legacy) : list, t: Date.now() }; });
  }
  function upsert(e) {
    var found = false;
    win.events = win.events.map(function (x) { if (x.id === e.id) { found = true; return e; } return x; });
    if (!found) win.events.push(e);
  }
  function refresh() {
    if (refreshing || pending || !win) return;
    refreshing = true; var g = gen;
    fetchWin(range()).then(function (w) {
      refreshing = false;
      if (g !== gen || pending) return;
      var changed = JSON.stringify(w.events) !== JSON.stringify(win.events);
      win = w; if (changed) { events = win.events; render(); }
    }, function (e) { refreshing = false; if (e && e.auth) gate(); });
  }
  function reload() {
    var r = range();
    if (covered(r)) {
      events = win.events; autoScroll = true; render();
      var edge = ds(addDays(r[1], 7)) > win.to || ds(addDays(r[0], -7)) < win.from;
      if (edge || Date.now() - win.t > 30000) refresh();
      return Promise.resolve();
    }
    events = win ? win.events : []; render();
    loading++; busy(); var g = ++gen;
    return run(fetchWin(r)).then(function (w) { loading--; busy(); if (g === gen) { win = w; events = win.events; autoScroll = true; render(); } },
      function (e) { loading--; busy(); if (e && e.auth) gate(); render(); });
  }
  setInterval(function () { if (!document.hidden && !$('main').hidden) refresh(); }, 120000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('main').hidden) refresh(); });

  function renderFilters() {
    var h = '<span class="lbl">Afficher</span><button type="button" class="chip all" data-all="1" aria-pressed="' + allMode + '">Tous</button>';
    users.forEach(function (u) {
      h += '<button type="button" class="chip" data-u="' + u.id + '" style="--c:' + u.c + '" aria-pressed="' + (!allMode && !!selected[u.id]) + '" title="' + esc(u.name) + '"><span class="dot"></span>' + esc(u.ini) + '</button>';
    });
    $('filters').innerHTML = h; $('filters').classList.toggle('allmode', allMode);
  }

  /* Couleur d'un rendez-vous : une seule personne = sa couleur, plusieurs = bandes obliques de largeur fixe */
  function paint(e) {
    var us = users.filter(function (u) { return e.parts.indexOf(u.id) > -1; });
    var cols = us.map(function (u) { return u.c; });
    var evt = e.parts.indexOf(EVT) > -1;
    if (!cols.length) return { cls: evt ? ' evt' : ' ext', style: '' };
    if (cols.length === 1 && !evt) return { cls: '', style: 'background:' + us[0].p + ';border-left:3px solid ' + cols[0] + ';' };
    /* bandes obliques de largeur fixe (teintes pastel) ; EVT apporte une bande de gris foncé */
    var tints = us.map(function (u) { return u.p; });
    if (evt) tints.unshift('color-mix(in srgb, #4b5563 70%, var(--surface))');
    var stops = tints.map(function (c, k) { return c + ' ' + (k * 10) + 'px ' + ((k + 1) * 10) + 'px'; }).join(',');
    return { cls: ' multi', style: 'background:repeating-linear-gradient(135deg,' + stops + ');' };
  }
  function evText(e) {
    return prefix(e.parts) + e.title + (e.allDay ? ' (toute la journée)' : ' · ' + e.start + '–' + e.end) + (e.location ? ' · ' + e.location : '');
  }
  function visible(e) { var r = realParts(e.parts); return !r.length || r.some(function (p) { return selected[p]; }); }

  function layout(list) {
    /* à heures égales, les rendez-vous côte à côte suivent l'ordre protocolaire */
    var evRank = function (e) { var r = 99; users.forEach(function (u, i) { if (e.parts.indexOf(u.id) > -1 && i < r) r = i; }); return r; };
    list = list.slice().sort(function (a, b) { return mins(a.start) - mins(b.start) || mins(b.end) - mins(a.end) || evRank(a) - evRank(b); });
    var out = [], cluster = [], clusterEnd = -1;
    function flush() {
      var cols = [];
      cluster.forEach(function (e) {
        var s = mins(e.start), placed = false;
        for (var i = 0; i < cols.length; i++) { if (cols[i] <= s) { cols[i] = mins(e.end); e._col = i; placed = true; break; } }
        if (!placed) { e._col = cols.length; cols.push(mins(e.end)); }
      });
      cluster.forEach(function (e) { e._n = cols.length; out.push(e); });
      cluster = []; clusterEnd = -1;
    }
    list.forEach(function (e) {
      if (cluster.length && mins(e.start) >= clusterEnd) flush();
      cluster.push(e); clusterEnd = Math.max(clusterEnd, mins(e.end));
    });
    flush();
    return out;
  }

  function render() {
    $('v-day').setAttribute('aria-pressed', view === 'day');
    $('v-week').setAttribute('aria-pressed', view === 'week');
    renderFilters();
    $('goto').value = cursor;
    var r = range(), days = [];
    for (var x = r[0]; x <= r[1]; x = addDays(x, 1)) days.push(x);
    if (view === 'day') $('range').textContent = cap(short(days[0], true));
    else $('range').textContent = cap(short(days[0])) + ' > ' + short(days[6], true);
    model = [];
    var span = H1 - H0, today = ds(new Date()), g = $('grid');
    var colW = Math.max(150, ($('scroller').clientWidth - LEFT) / days.length);
    g.classList.toggle('day', view === 'day'); g.style.setProperty('--n', days.length); g.style.setProperty('--hh', HH + 'px'); g.style.setProperty('--span', span);
    var h = '<div class="gh"></div>';
    days.forEach(function (x) {
      /* flèches rouges clignotantes : rendez-vous plus haut / plus bas que la partie visible de la journée */
      h += '<div class="gh' + (ds(x) === today ? ' today' : '') + '" data-date="' + ds(x) + '">' +
        '<button type="button" class="arr up" data-dir="up" aria-label="Rendez-vous plus haut">' + ARR_UP + '</button>' +
        '<button type="button" class="arr down" data-dir="down" aria-label="Rendez-vous plus bas">' + ARR_DOWN + '</button>' +
        fmt(x, { weekday: 'short' }) + '<b>' + x.getDate() + '</b></div>';
    });
    h += '<div class="adl">Journée</div>';
    days.forEach(function (x) {
      var key = ds(x);
      h += '<div class="ad" data-date="' + key + '">';
      events.filter(function (e) { return e.allDay && e.date <= key && (e.endDate || e.date) >= key && visible(e); }).forEach(function (e) {
        var p = paint(e);
        h += '<button type="button" class="adev' + p.cls + '" data-id="' + esc(e.id) + '" style="' + p.style + '" title="' + esc(evText(e)) + '"><div class="t">' + esc(prefix(e.parts) + e.title) + '</div>' + (e.location ? '<div class="h">' + esc(e.location) + '</div>' : '') + '</button>';
      });
      h += '</div>';
    });
    h += '<div class="hours">';
    for (var k = H0; k <= H1; k++) h += '<span style="top:' + ((k - H0) * HH + TOP) + 'px">' + pad(k % 24) + ':00</span>';
    h += '</div>';
    days.forEach(function (x) {
      var key = ds(x);
      var list = events.filter(function (e) { return !e.allDay && e.date === key && visible(e); });
      var md = { key: key, items: [], up: null, down: null }; model.push(md);
      h += '<div class="col' + (key === today ? ' today' : '') + '" data-date="' + key + '">';
      h += '<div class="band mid" style="top:' + ((12 - H0) * HH + TOP) + 'px;height:' + (2 * HH) + 'px"></div><div class="band soir" style="top:' + ((19 - H0) * HH + TOP) + 'px;height:' + (2 * HH) + 'px"></div>';
      layout(list).forEach(function (e) {
        var s = Math.max(mins(e.start), H0 * 60), en = Math.min(mins(e.end), H1 * 60);
        var top = (s - H0 * 60) / 60 * HH + TOP, ht = Math.max((en - s) / 60 * HH, 24) - 1;
        md.items.push({ top: top, bot: top + ht });
        var p = paint(e), n = e._n, side = n <= 2 || view === 'day' || colW / n >= 110, W = side ? (view === 'day' ? Math.min(100 / n, 50) : 100 / n) : 70, L = side ? e._col * W : e._col * (30 / (n - 1));
        h += '<button type="button" class="ev' + p.cls + (e.pending ? ' pending' : '') + '" data-id="' + esc(e.id) + '" title="' + esc(evText(e)) + '" style="' + p.style + 'top:' + top + 'px;--h:' + ht + 'px;z-index:' + (2 + e._col) + ';--l:calc(' + L + '% + 2px);--w:calc(' + W + '% - 4px);left:var(--l);width:var(--w)">' +
          '<div class="t">' + esc(prefix(e.parts) + e.title) + '</div><div class="h">' + e.start + '–' + e.end + '</div>' +
          (e.location && ht >= 58 ? '<div class="loc">' + esc(e.location) + '</div>' : '') + '</button>';
      });
      if (key === today) {
        var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
        if (nm >= H0 * 60 && nm <= H1 * 60) h += '<div class="now" style="top:' + ((nm - H0 * 60) / 60 * HH + TOP) + 'px"></div>';
      }
      h += '</div>';
    });
    var sc = $('scroller'), keep = sc.scrollTop;
    g.innerHTML = h;
    fit(); sc.scrollTop = keep;
    if (autoScroll) {
      autoScroll = false;
      /* à l'ouverture d'une période, le planning se place sur le premier rendez-vous (par exemple 18 h pour une commission) */
      var first = null;
      events.forEach(function (e) { if (!e.allDay && visible(e) && e.date >= ds(r[0]) && e.date <= ds(r[1])) { var m = mins(e.start); if (first === null || m < first) first = m; } });
      sc.scrollTop = first === null ? 0 : Math.max(0, (first - 30 - H0 * 60) / 60 * HH);
    }
    updateArrows();
  }
  /* Flèches rouges clignotantes dans l'entête de chaque jour : ↑ s'il y a un rendez-vous au-dessus de la partie visible, ↓ s'il y en a un en dessous */
  function updateArrows() {
    var sc = $('scroller'), g = $('grid'); if (!sc || !g || !model.length) return;
    var adl = g.querySelector('.adl'), ghh = parseFloat(g.style.getPropertyValue('--ghh')) || 0;
    var hdr = ghh + (adl ? adl.offsetHeight : 0);
    var vt = sc.scrollTop, vb = sc.scrollTop + sc.clientHeight - hdr, tol = 4;
    model.forEach(function (m) {
      var up = null, down = null;
      m.items.forEach(function (it) {
        if (it.bot <= vt + tol) { if (up === null || it.top > up) up = it.top; }
        else if (it.top >= vb - tol) { if (down === null || it.top < down) down = it.top; }
      });
      m.up = up; m.down = down;
      var gh = g.querySelector('.gh[data-date="' + m.key + '"]'); if (!gh) return;
      gh.classList.toggle('hasup', up !== null); gh.classList.toggle('hasdown', down !== null);
    });
  }
  var arrowFrame = 0;
  $('scroller').addEventListener('scroll', function () {
    if (arrowFrame) return;
    arrowFrame = requestAnimationFrame(function () { arrowFrame = 0; updateArrows(); });
  });
  /* Le planning occupe la hauteur de l'écran et défile à l'intérieur : l'entête (jours + journée entière) reste figée. */
  function fit() {
    var g = $('grid'), ghh = 0;
    Array.prototype.forEach.call(g.querySelectorAll('.gh'), function (c) { ghh = Math.max(ghh, c.getBoundingClientRect().height); });
    g.style.setProperty('--ghh', (ghh || 52) + 'px');
    var sc = $('scroller'), top, avail;
    if (forced) { top = 0; for (var el = sc; el && el !== document.body; el = el.offsetParent) top += el.offsetTop; avail = window.innerWidth; }
    else { top = sc.getBoundingClientRect().top + window.pageYOffset; avail = window.innerHeight; }
    sc.style.maxHeight = Math.max(360, avail - top - 62) + 'px';
    updateArrows();
  }
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe($('grid'));

  function shift(n) { cursor = ds(addDays(pd(cursor), view === 'day' ? n : n * 7)); reload(); }
  $('prev').onclick = function () { shift(-1); };
  $('next').onclick = function () { shift(1); };
  $('today').onclick = function () { cursor = ds(new Date()); reload(); };
  $('goto').onchange = function () {
    var y = +String(this.value).slice(0, 4);
    if (this.value && y >= 2000 && y <= 2100) { cursor = this.value; reload(); this.blur(); }
  };
  $('v-day').onclick = function () { view = 'day'; reload(); };
  $('v-week').onclick = function () { view = 'week'; reload(); };
  $('filters').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    /* un clic sur une personne n'affiche que ses rendez-vous ; d'autres clics ajoutent ou retirent des personnes ; « Tous » rétablit l'ensemble */
    if (b.dataset.all) { allMode = true; users.forEach(function (u) { selected[u.id] = true; }); }
    else if (allMode) { allMode = false; users.forEach(function (u) { selected[u.id] = false; }); selected[b.dataset.u] = true; }
    else {
      selected[b.dataset.u] = !selected[b.dataset.u];
      if (!users.some(function (u) { return selected[u.id]; })) { allMode = true; users.forEach(function (u) { selected[u.id] = true; }); }
    }
    render();
  };

  /* Rendez-vous */
  function renderParts(sel) {
    $('parts').innerHTML = users.map(function (u) {
      return '<label style="--c:' + u.c + '"><input type="checkbox" value="' + u.id + '"' + (sel.indexOf(u.id) > -1 ? ' checked' : '') + '><span class="ini">' + esc(u.ini) + '</span><span>' + esc(u.name) + '</span></label>';
    }).join('');
  }
  function checked() { var ids = Array.prototype.map.call($('parts').querySelectorAll('input:checked'), function (i) { return i.value; }); if ($('f-evt').checked) ids.unshift(EVT); return ids; }
  function updatePreview() {
    var t = $('f-title').value.trim(), p = $('preview'), ids = checked();
    if (!t && !ids.length) { p.className = 'preview ph'; p.textContent = 'Cochez des participants et saisissez un titre'; }
    else { p.className = 'preview'; p.textContent = prefix(ids) + t; }
  }
  function syncAllDay() {
    var ad = $('f-allday').checked;
    $('w-start').hidden = ad; $('w-end').hidden = ad; $('w-date2').hidden = !ad;
  }
  function openEv(ev, date, start) {
    if (ev && ev.foreign) { showError(new Error('Ce rendez-vous s\'étale sur plusieurs jours : l\'application ne sait pas le modifier. Demandez à l\'administrateur de le modifier dans l\'agenda de la commune.')); return; }
    editing = ev ? ev.id : null;
    $('ev-h').textContent = ev ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous';
    renderParts(ev ? ev.parts : []);
    $('f-evt').checked = !!(ev && ev.parts.indexOf(EVT) > -1);
    $('f-title').value = ev ? ev.title : '';
    $('f-allday').checked = !!(ev && ev.allDay);
    $('f-date').value = ev ? ev.date : (date || cursor);
    $('f-date2').value = ev && ev.allDay ? (ev.endDate || ev.date) : '';
    var st = (ev && !ev.allDay && ev.start) || start || '09:00';
    $('f-start').value = st;
    $('f-end').value = (ev && !ev.allDay && ev.end) || pad(Math.min(Math.floor(mins(st) / 60) + 1, 23)) + ':' + st.split(':')[1];
    $('f-loc').value = ev ? (ev.location || '') : '';
    $('f-notes').value = ev ? ev.notes : '';
    $('ev-err').textContent = '';
    $('ev-del').hidden = !ev; $('ev-del').textContent = 'Supprimer'; $('ev-del').dataset.arm = '';
    syncAllDay(); updatePreview(); $('veil-ev').hidden = false; $('f-title').focus();
  }
  function closeEv() { $('veil-ev').hidden = true; }
  $('btn-new').onclick = function () { openEv(null); };
  $('ev-cancel').onclick = closeEv;
  $('parts').onchange = updatePreview;
  $('f-evt').onchange = updatePreview;
  $('f-title').oninput = updatePreview;
  $('ev-del').onclick = function () {
    if (!$('ev-del').dataset.arm) { $('ev-del').dataset.arm = '1'; $('ev-del').textContent = 'Confirmer la suppression'; return; }
    var id = editing, prev = win ? win.events.slice() : null;
    closeEv(); gen++;
    if (win) { win.events = win.events.filter(function (x) { return x.id !== id; }); events = win.events; render(); }
    pending++; busy();
    store.remove(id).then(function () { pending--; busy(); refresh(); }, function (e) {
      pending--; busy(); gen++;
      if (e && e.auth) { gate(); return; }
      if (prev && win) { win.events = prev; events = prev; render(); }
      showError(new Error('Suppression non effectuée : ' + e.message));
    });
  };
  $('f-allday').onchange = syncAllDay;
  $('form-ev').onsubmit = function (e) {
    e.preventDefault();
    var ids = checked(), t = $('f-title').value.trim(), dt = $('f-date').value, ad = $('f-allday').checked;
    var s = $('f-start').value, en = $('f-end').value, d2 = $('f-date2').value || dt, err = '';
    if (!ids.length) err = 'Cochez au moins un participant, ou « Événement extérieur ».';
    else if (!t) err = 'Saisissez un titre.';
    else if (!dt) err = 'Indiquez la date.';
    else if (ad && d2 < dt) err = 'La date de fin doit être après la date de début.';
    else if (!ad && (!s || !en)) err = 'Indiquez l\'heure de début et l\'heure de fin.';
    else if (!ad && mins(en) <= mins(s)) err = 'L\'heure de fin doit être après l\'heure de début.';
    $('ev-err').textContent = err; if (err) return;
    var rec = { id: editing, parts: ids, title: t, date: dt, allDay: ad, endDate: ad ? d2 : '', start: ad ? '' : s, end: ad ? '' : en, location: $('f-loc').value.trim(), notes: $('f-notes').value.trim() };
    /* affichage immédiat, envoi au service en arrière-plan */
    var tmp = Object.assign({}, rec, { pending: true }), tmpId = rec.id || ('tmp-' + Date.now());
    tmp.id = tmpId; closeEv(); cursor = dt; gen++;
    var r = range(), ok = covered(r), prev = ok ? win.events.slice() : null;
    if (ok) { upsert(tmp); events = win.events; render(); } else reload();
    pending++; busy();
    store.save(rec).then(function (saved) {
      pending--; gen++;
      if (win) { win.events = win.events.filter(function (x) { return x.id !== tmpId; }); upsert(saved); events = win.events; render(); }
      busy(); refresh();
    }, function (x) {
      pending--; gen++; busy();
      if (x && x.auth) { gate(); return; }
      if (prev && win) { win.events = prev; events = prev; render(); }
      showError(new Error('Rendez-vous non enregistré : ' + x.message + ' Vérifiez l\'agenda et recommencez.'));
    });
  };
  $('grid').onclick = function (e) {
    var ar = e.target.closest('.arr');
    if (ar) {
      /* un clic sur une flèche fait défiler jusqu'au rendez-vous caché */
      var gh = ar.closest('.gh'), m = model.filter(function (x) { return x.key === gh.dataset.date; })[0];
      var t = m ? (ar.dataset.dir === 'up' ? m.up : m.down) : null;
      if (t !== null) { var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; $('scroller').scrollTo({ top: Math.max(0, t - 40), behavior: calm ? 'auto' : 'smooth' }); }
      return;
    }
    var ev = e.target.closest('.ev, .adev');
    if (ev) { var f = events.filter(function (x) { return x.id === ev.dataset.id; })[0]; if (f && f.pending) { showError(new Error('Enregistrement en cours : patientez quelques secondes.')); return; } if (f) openEv(f); return; }
    var ad = e.target.closest('.ad'); if (ad) { openEv(null, ad.dataset.date); $('f-allday').checked = true; syncAllDay(); return; }
    var col = e.target.closest('.col'); if (!col) return;
    var y = ((forced && e.target === col) ? e.offsetY : e.clientY - col.getBoundingClientRect().top) - TOP; if (y < 0) y = 0;
    var m = Math.round((H0 * 60 + y / HH * 60) / 30) * 30;
    openEv(null, col.dataset.date, pad(Math.floor(m / 60)) + ':' + pad(m % 60));
  };

  /* Équipe */
  function renderTeam() { $('team').innerHTML = users.map(function (u) { return '<div style="--c:' + u.c + '"><span class="dot">' + esc(u.ini) + '</span><span>' + esc(u.name) + '</span></div>'; }).join(''); }
  $('btn-person').onclick = function () { renderTeam(); $('p-err').textContent = ''; $('p-name').value = ''; $('p-ini').value = ''; $('veil-p').hidden = false; $('p-name').focus(); };
  $('p-close').onclick = function () { $('veil-p').hidden = true; };
  $('form-p').onsubmit = function (e) {
    e.preventDefault();
    var name = $('p-name').value.trim(), ini = $('p-ini').value.trim().toUpperCase(), err = '';
    if (!name || !ini) err = 'Saisissez un nom et des initiales.';
    else if (users.some(function (u) { return u.ini === ini; })) err = 'Ces initiales sont déjà utilisées.';
    $('p-err').textContent = err; if (err) return;
    var u = { id: 'u' + Date.now(), name: name, ini: ini, c: COLORS[users.length % COLORS.length] };
    var next = normalizeUsers(users.concat([u]));
    run(store.saveUsers(next.map(plain))).then(function () {
      users = next; selected[u.id] = true; $('p-name').value = ''; $('p-ini').value = ''; renderTeam(); render();
    }, function (x) { $('p-err').textContent = x.message; });
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeEv(); $('veil-p').hidden = true; } });
  /* Clavier : ← → changent de semaine (ou de jour), ↑ ↓ font défiler les heures */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if ($('main').hidden || !$('veil-ev').hidden || !$('veil-p').hidden) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); shift(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); shift(1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('scroller').scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * HH, behavior: calm ? 'auto' : 'smooth' });
    }
  });

  /* Bascule portrait / paysage.
     Android (application installée ou plein écran) : le téléphone est verrouillé dans l'orientation choisie.
     Sinon (iPhone, ou verrouillage refusé) : en portrait, l'affichage est tourné de 90° (« paysage forcé »). */
  function isLandscape() { return forced || window.innerWidth > window.innerHeight; }
  function setForced(on) { forced = on; document.documentElement.classList.toggle('force-land', on); fit(); render(); }
  function tryLock(t) {
    var o = window.screen && screen.orientation;
    if (!o || !o.lock) return Promise.reject(new Error('non pris en charge'));
    var go = function () { return o.lock(t); }, root = document.documentElement;
    return go().catch(function (err) {
      if (t !== 'landscape' || !root.requestFullscreen) throw err;
      return root.requestFullscreen().then(go);
    });
  }
  $('btn-rot').onclick = function () {
    var after = function () { if (win) reload(); else render(); };
    if (forced) { setForced(false); view = 'day'; after(); return; }
    if (!isLandscape()) { view = 'week'; tryLock('landscape').catch(function () { setForced(true); }).then(after); }
    else {
      view = 'day';
      tryLock('portrait').then(function () { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); }, function () {}).then(after);
    }
  };
  window.addEventListener('resize', function () { if (forced && window.innerWidth > window.innerHeight) setForced(false); });

  /* Démarrage et connexion */
  function enter() {
    $('login').hidden = true; $('main').hidden = false;
    $('btn-out').hidden = store.mode !== 'script';
    $('status').textContent = store.mode === 'script' ? 'Commune de Laignes' : 'Mode démo · données gardées dans ce navigateur';
    var g = ++gen; loading++; busy();
    return run(Promise.all([store.loadUsers(), fetchWin(range())])).then(function (res) {
      loading--; busy();
      users = normalizeUsers(res[0]); users.forEach(function (x) { selected[x.id] = true; });
      win = res[1]; win.events = win.events.map(legacy); events = win.events; autoScroll = true; render();
    }, function (e) { loading--; busy(); if (e && e.auth) gate(); });
  }
  function gate() {
    win = null; events = [];
    $('main').hidden = true; $('login').hidden = false; $('btn-out').hidden = true; $('status').textContent = 'Non connecté';
  }
  $('form-in').onsubmit = function (e) {
    e.preventDefault(); $('in-err').textContent = '';
    store.signIn($('in-code').value).then(function () { $('in-code').value = ''; return enter(); }, function (x) { $('in-err').textContent = x.message; });
  };
  $('btn-out').onclick = function () { store.signOut().then(gate); };
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  render();
  store.init().then(function (r) { if (r.needsLogin) gate(); else enter(); }, gate);
})();
