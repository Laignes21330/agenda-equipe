(function () {
  var HH = 48, H0 = 7, H1 = 21;
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

  var users = [], events = [], selected = {}, view = (window.innerWidth < 700 ? 'day' : 'week'), cursor = ds(new Date()), editing = null, busy = false;

  function prefix(ids) {
    var list = users.filter(function (u) { return ids.indexOf(u.id) > -1; }).map(function (u) { return u.ini; });
    return list.length ? '(' + list.join(', ') + ') ' : '';
  }
  var store = window.createStore(prefix);
  var uById = function (id) { for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i]; return null; };

  function showError(e) { var b = $('banner'); b.textContent = e ? (e.message || String(e)) : ''; b.hidden = !e; }
  function run(p) { showError(null); return p.catch(function (e) { showError(e); throw e; }); }

  function range() {
    var c = pd(cursor);
    if (view === 'day') return [c, c];
    var m = monday(c); return [m, addDays(m, 6)];
  }
  function reload() {
    var r = range();
    return run(store.list(ds(r[0]), ds(r[1]))).then(function (list) { events = list; render(); }, function () { render(); });
  }

  function renderFilters() {
    var all = users.length && users.every(function (u) { return selected[u.id]; });
    var h = '<span class="lbl">Afficher</span><button type="button" class="chip all" data-all="1" aria-pressed="' + !!all + '">Tous</button>';
    users.forEach(function (u) {
      h += '<button type="button" class="chip" data-u="' + u.id + '" style="--c:' + u.c + '" aria-pressed="' + !!selected[u.id] + '" title="' + esc(u.name) + '"><span class="dot"></span>' + esc(u.ini) + '</button>';
    });
    $('filters').innerHTML = h;
  }

  /* Couleur d'un rendez-vous : une seule personne = sa couleur, plusieurs = bandes obliques de largeur fixe */
  function paint(e) {
    var cols = users.filter(function (u) { return e.parts.indexOf(u.id) > -1; }).map(function (u) { return u.c; });
    var tint = function (c) { return 'color-mix(in srgb, ' + c + ' 40%, var(--surface))'; };
    if (!cols.length) return { cls: ' ext', style: '' };
    if (cols.length === 1) return { cls: '', style: 'background:' + tint(cols[0]) + ';border-left:3px solid ' + cols[0] + ';' };
    var stops = cols.map(function (c, k) { return tint(c) + ' ' + (k * 10) + 'px ' + ((k + 1) * 10) + 'px'; }).join(',');
    return { cls: ' multi', style: 'background:repeating-linear-gradient(135deg,' + stops + ');' };
  }
  function evText(e) {
    return prefix(e.parts) + e.title + (e.allDay ? ' (toute la journée)' : ' · ' + e.start + '–' + e.end) + (e.location ? ' · ' + e.location : '');
  }
  function visible(e) { return !e.parts.length || e.parts.some(function (p) { return selected[p]; }); }

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
    var r = range(), days = [];
    for (var x = r[0]; x <= r[1]; x = addDays(x, 1)) days.push(x);
    if (view === 'day') $('range').textContent = fmt(days[0], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    else $('range').textContent = fmt(days[0], { day: 'numeric', month: 'short' }) + ' – ' + fmt(days[6], { day: 'numeric', month: 'short', year: 'numeric' });
    var span = H1 - H0, today = ds(new Date()), g = $('grid');
    var colW = Math.max(150, ($('scroller').clientWidth - 52) / days.length);
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
    for (var k = H0; k <= H1; k++) h += '<span style="top:' + ((k - H0) * HH) + 'px">' + pad(k) + ':00</span>';
    h += '</div>';
    days.forEach(function (x) {
      var key = ds(x);
      var list = events.filter(function (e) { return !e.allDay && e.date === key && visible(e); });
      h += '<div class="col' + (key === today ? ' today' : '') + '" data-date="' + key + '">';
      layout(list).forEach(function (e) {
        var s = Math.max(mins(e.start), H0 * 60), en = Math.min(mins(e.end), H1 * 60);
        var top = (s - H0 * 60) / 60 * HH, ht = Math.max((en - s) / 60 * HH, 24) - 1;
        var p = paint(e), n = e._n, side = n <= 2 || view === 'day' || colW / n >= 110, W = side ? 100 / n : 70, L = side ? e._col * W : e._col * (30 / (n - 1));
        h += '<button type="button" class="ev' + p.cls + '" data-id="' + esc(e.id) + '" title="' + esc(evText(e)) + '" style="' + p.style + 'top:' + top + 'px;--h:' + ht + 'px;z-index:' + (2 + e._col) + ';left:calc(' + L + '% + 2px);width:calc(' + W + '% - 4px)">' +
          '<div class="t">' + esc(prefix(e.parts) + e.title) + '</div><div class="h">' + e.start + '–' + e.end + '</div>' +
          (e.location && ht >= 58 ? '<div class="loc">' + esc(e.location) + '</div>' : '') + '</button>';
      });
      if (key === today) {
        var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
        if (nm >= H0 * 60 && nm <= H1 * 60) h += '<div class="now" style="top:' + ((nm - H0 * 60) / 60 * HH) + 'px"></div>';
      }
      h += '</div>';
    });
    g.innerHTML = h;
  }

  function shift(n) { cursor = ds(addDays(pd(cursor), view === 'day' ? n : n * 7)); reload(); }
  $('prev').onclick = function () { shift(-1); };
  $('next').onclick = function () { shift(1); };
  $('today').onclick = function () { cursor = ds(new Date()); reload(); };
  $('v-day').onclick = function () { view = 'day'; reload(); };
  $('v-week').onclick = function () { view = 'week'; reload(); };
  $('filters').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.all) { var all = users.every(function (u) { return selected[u.id]; }); users.forEach(function (u) { selected[u.id] = !all; }); }
    else selected[b.dataset.u] = !selected[b.dataset.u];
    render();
  };

  /* Rendez-vous */
  function renderParts(sel) {
    $('parts').innerHTML = users.map(function (u) {
      return '<label style="--c:' + u.c + '"><input type="checkbox" value="' + u.id + '"' + (sel.indexOf(u.id) > -1 ? ' checked' : '') + '><span class="ini">' + esc(u.ini) + '</span><span>' + esc(u.name) + '</span></label>';
    }).join('');
  }
  function checked() { return Array.prototype.map.call($('parts').querySelectorAll('input:checked'), function (i) { return i.value; }); }
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
  $('f-title').oninput = updatePreview;
  $('ev-del').onclick = function () {
    if (!$('ev-del').dataset.arm) { $('ev-del').dataset.arm = '1'; $('ev-del').textContent = 'Confirmer la suppression'; return; }
    run(store.remove(editing)).then(function () { closeEv(); return reload(); }, function (e) { $('ev-err').textContent = e.message; });
  };
  $('f-allday').onchange = syncAllDay;
  $('form-ev').onsubmit = function (e) {
    e.preventDefault();
    var ids = checked(), t = $('f-title').value.trim(), dt = $('f-date').value, ad = $('f-allday').checked;
    var s = $('f-start').value, en = $('f-end').value, d2 = $('f-date2').value || dt, err = '';
    if (!ids.length) err = 'Cochez au moins un participant.';
    else if (!t) err = 'Saisissez un titre.';
    else if (!dt) err = 'Indiquez la date.';
    else if (ad && d2 < dt) err = 'La date de fin doit être après la date de début.';
    else if (!ad && (!s || !en)) err = 'Indiquez l\'heure de début et l\'heure de fin.';
    else if (!ad && mins(en) <= mins(s)) err = 'L\'heure de fin doit être après l\'heure de début.';
    $('ev-err').textContent = err; if (err) return;
    var rec = { id: editing, parts: ids, title: t, date: dt, allDay: ad, endDate: ad ? d2 : '', start: ad ? '' : s, end: ad ? '' : en, location: $('f-loc').value.trim(), notes: $('f-notes').value.trim() };
    run(store.save(rec)).then(function () { closeEv(); cursor = dt; return reload(); }, function (x) { $('ev-err').textContent = x.message; });
  };
  $('grid').onclick = function (e) {
    var ev = e.target.closest('.ev, .adev');
    if (ev) { var f = events.filter(function (x) { return x.id === ev.dataset.id; })[0]; if (f) openEv(f); return; }
    var ad = e.target.closest('.ad'); if (ad) { openEv(null, ad.dataset.date); $('f-allday').checked = true; syncAllDay(); return; }
    var col = e.target.closest('.col'); if (!col) return;
    var y = e.clientY - col.getBoundingClientRect().top;
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
    $('status').textContent = store.mode === 'script' ? 'Agenda de la commune' : 'Mode démo · données gardées dans ce navigateur';
    return run(store.loadUsers()).then(function (u) {
      users = u; users.forEach(function (x) { selected[x.id] = true; });
      return reload();
    });
  }
  function gate() {
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
