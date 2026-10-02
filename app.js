(function () {
  var HH = 60, H0 = 7, H1 = 24, TOP = 10, LEFT = 64;
  var COLORS = window.AGENDA_COLORS;
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ds = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var pd = function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  var mins = function (t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; };
  var monday = function (d) { var x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  var fmt = function (d, o) { return d.toLocaleDateString('fr-FR', o); };

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
    var cols = users.filter(function (u) { return e.parts.indexOf(u.id) > -1; }).map(function (u) { return u.c; });
    var evt = e.parts.indexOf(EVT) > -1;
    var tint = function (c) { return 'color-mix(in srgb, ' + c + ' 40%, var(--surface))'; };
    if (!cols.length) return { cls: evt ? ' evt' : ' ext', style: '' };
    if (cols.length === 1 && !evt) return { cls: '', style: 'background:' + tint(cols[0]) + ';border-left:3px solid ' + cols[0] + ';' };
    /* bandes obliques de largeur fixe ; EVT apporte une bande de gris foncé */
    var tints = cols.map(tint);
    if (evt) tints.unshift('color-mix(in srgb, #4b5563 70%, var(--surface))');
    var stops = tints.map(function (c, k) { return c + ' ' + (k * 10) + 'px ' + ((k + 1) * 10) + 'px'; }).join(',');
    return { cls: ' multi', style: 'background:repeating-linear-gradient(135deg,' + stops + ');' };
  }
  function evText(e) {
    return prefix(e.parts) + e.title + (e.allDay ? ' (toute la journée)' : ' · ' + e.start + '–' + e.end) + (e.location ? ' · ' + e.location : '');
  }
  function visible(e) { var r = realParts(e.parts); return !r.length || r.some(function (p) { return selected[p]; }); }

  function layout(list) {
    list = list.slice().sort(function (a, b) { return mins(a.start) - mins(b.start) || mins(b.end) - mins(a.end); });
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
    if (view === 'day') $('range').textContent = fmt(days[0], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    else $('range').textContent = fmt(days[0], { day: 'numeric', month: 'short' }) + ' – ' + fmt(days[6], { day: 'numeric', month: 'short', year: 'numeric' });
    var span = H1 - H0, today = ds(new Date()), g = $('grid');
    var colW = Math.max(150, ($('scroller').clientWidth - LEFT) / days.length);
    g.style.setProperty('--n', days.length); g.style.setProperty('--hh', HH + 'px'); g.style.setProperty('--span', span);
    var h = '<div class="gh"></div>';
    days.forEach(function (x) { h += '<div class="gh' + (ds(x) === today ? ' today' : '') + '">' + fmt(x, { weekday: 'short' }) + '<b>' + x.getDate() + '</b></div>'; });
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
      h += '<div class="col' + (key === today ? ' today' : '') + '" data-date="' + key + '">';
      h += '<div class="band mid" style="top:' + ((12 - H0) * HH + TOP) + 'px;height:' + (2 * HH) + 'px"></div><div class="band soir" style="top:' + ((19 - H0) * HH + TOP) + 'px;height:' + (2 * HH) + 'px"></div>';
      layout(list).forEach(function (e) {
        var s = Math.max(mins(e.start), H0 * 60), en = Math.min(mins(e.end), H1 * 60);
        var top = (s - H0 * 60) / 60 * HH + TOP, ht = Math.max((en - s) / 60 * HH, 24) - 1;
        var p = paint(e), n = e._n, side = n <= 2 || view === 'day' || colW / n >= 110, W = side ? 100 / n : 70, L = side ? e._col * W : e._col * (30 / (n - 1));
        h += '<button type="button" class="ev' + p.cls + (e.pending ? ' pending' : '') + '" data-id="' + esc(e.id) + '" title="' + esc(evText(e)) + '" style="' + p.style + 'top:' + top + 'px;--h:' + ht + 'px;z-index:' + (2 + e._col) + ';left:calc(' + L + '% + 2px);width:calc(' + W + '% - 4px)">' +
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
  }
  /* Le planning occupe la hauteur de l'écran et défile à l'intérieur : l'entête (jours + journée entière) reste figée. */
  function fit() {
    var g = $('grid'), ghh = 0;
    Array.prototype.forEach.call(g.querySelectorAll('.gh'), function (c) { ghh = Math.max(ghh, c.getBoundingClientRect().height); });
    g.style.setProperty('--ghh', (ghh || 52) + 'px');
    var sc = $('scroller'), top = sc.getBoundingClientRect().top + window.pageYOffset;
    sc.style.maxHeight = Math.max(360, window.innerHeight - top - 62) + 'px';
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
    if (this.value && y >= 2000 && y <= 2100) { cursor = this.value; reload(); }
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
    var ev = e.target.closest('.ev, .adev');
    if (ev) { var f = events.filter(function (x) { return x.id === ev.dataset.id; })[0]; if (f && f.pending) { showError(new Error('Enregistrement en cours : patientez quelques secondes.')); return; } if (f) openEv(f); return; }
    var ad = e.target.closest('.ad'); if (ad) { openEv(null, ad.dataset.date); $('f-allday').checked = true; syncAllDay(); return; }
    var col = e.target.closest('.col'); if (!col) return;
    var y = e.clientY - col.getBoundingClientRect().top - TOP; if (y < 0) y = 0;
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
    var next = users.concat([u]);
    run(store.saveUsers(next)).then(function () {
      users = next; selected[u.id] = true; $('p-name').value = ''; $('p-ini').value = ''; renderTeam(); render();
    }, function (x) { $('p-err').textContent = x.message; });
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeEv(); $('veil-p').hidden = true; } });

  /* Démarrage et connexion */
  function enter() {
    $('login').hidden = true; $('main').hidden = false;
    $('btn-out').hidden = store.mode !== 'script';
    $('status').textContent = store.mode === 'script' ? 'Commune de Laignes' : 'Mode démo · données gardées dans ce navigateur';
    var g = ++gen; loading++; busy();
    return run(Promise.all([store.loadUsers(), fetchWin(range())])).then(function (res) {
      loading--; busy();
      users = res[0]; users.forEach(function (x) { selected[x.id] = true; });
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
