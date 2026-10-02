/* Couche de données : deux implémentations avec la même interface.
   - démo   : tout est gardé dans le navigateur (localStorage)
   - Google : lit et écrit dans Google Agenda via l'API Calendar v3 (OAuth 2.0)
   Interface : init() signIn() signOut() loadUsers() saveUsers(u) list(from,to) save(ev) remove(id) */
(function () {
  var CFG = window.AGENDA_CONFIG;
  var COLORS = ['#2f7dd1', '#d9822b', '#2e9e6b', '#b45bb8', '#d1495b', '#7a8a1f', '#3a9fb5', '#8a6d3b'];
  var DEFAULT_USERS = [
    { id: 'u1', name: 'Jean-Michel Mars', ini: 'JMM', c: COLORS[0] },
    { id: 'u2', name: 'Mireille Augueux', ini: 'MA', c: COLORS[1] },
    { id: 'u3', name: 'Sylvie Palomino', ini: 'SP', c: COLORS[2] },
    { id: 'u4', name: 'Jean-François Guillaume', ini: 'JFG', c: COLORS[3] },
    { id: 'u5', name: 'Jean-François Louchin', ini: 'JFL', c: COLORS[4] }
  ];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ds(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /* ---------- Mode démo ---------- */
  function demoStore() {
    function get(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
    function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function sample() {
      var now = new Date(), mon = addDays(now, -((now.getDay() + 6) % 7));
      var d = function (n) { return ds(addDays(mon, n)); };
      return [
        { id: 'e1', parts: ['u1', 'u2', 'u3', 'u4', 'u5'], title: 'Conseil municipal', date: d(3), start: '18:30', end: '21:00', notes: 'Salle du conseil.' },
        { id: 'e2', parts: ['u5', 'u1'], title: 'Préparation du budget', date: d(0), start: '09:00', end: '10:30', notes: '' },
        { id: 'e3', parts: ['u2', 'u3'], title: 'Commission travaux', date: d(1), start: '14:00', end: '16:00', notes: '' },
        { id: 'e4', parts: ['u5'], title: 'Point comptable', date: d(1), start: '10:00', end: '11:00', notes: '' },
        { id: 'e5', parts: ['u4', 'u3'], title: 'Visite de la salle des fêtes', date: d(2), start: '11:00', end: '12:00', notes: '' }
      ];
    }
    return {
      mode: 'demo',
      init: function () { return Promise.resolve({ needsLogin: false }); },
      signIn: function () { return Promise.resolve(); },
      signOut: function () { return Promise.resolve(); },
      loadUsers: function () { return Promise.resolve(get('agenda.users', DEFAULT_USERS)); },
      saveUsers: function (u) { put('agenda.users', u); return Promise.resolve(); },
      list: function (from, to) {
        var all = get('agenda.events', null); if (!all) { all = sample(); put('agenda.events', all); }
        return Promise.resolve(all.filter(function (e) { return e.date >= from && e.date <= to; }));
      },
      save: function (ev) {
        var all = get('agenda.events', sample());
        if (!ev.id) ev.id = 'e' + Date.now();
        var found = false;
        all = all.map(function (x) { if (x.id === ev.id) { found = true; return ev; } return x; });
        if (!found) all.push(ev);
        put('agenda.events', all); return Promise.resolve(ev);
      },
      remove: function (id) { put('agenda.events', get('agenda.events', []).filter(function (e) { return e.id !== id; })); return Promise.resolve(); }
    };
  }

  /* ---------- Mode Google Agenda ---------- */
  function googleStore(prefixFn) {
    var SCOPE = 'https://www.googleapis.com/auth/calendar.events';
    var BASE = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CFG.calendarId);
    var token = null, expires = 0, client = null, pending = null, configId = null;

    function loadGsi() {
      return new Promise(function (res, rej) {
        if (window.google && google.accounts && google.accounts.oauth2) return res();
        var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = res; s.onerror = function () { rej(new Error('Impossible de charger la connexion Google. Vérifiez la connexion internet.')); };
        document.head.appendChild(s);
      });
    }
    function requestToken(prompt) {
      return loadGsi().then(function () {
        return new Promise(function (res, rej) {
          client = google.accounts.oauth2.initTokenClient({
            client_id: CFG.clientId, scope: SCOPE,
            callback: function (r) {
              if (r.error) return rej(new Error('Connexion refusée (' + r.error + ').'));
              token = r.access_token; expires = Date.now() + (r.expires_in - 60) * 1000;
              try { localStorage.setItem('agenda.signedin', '1'); } catch (e) {}
              res();
            },
            error_callback: function (e) { rej(new Error('Connexion annulée.')); }
          });
          client.requestAccessToken({ prompt: prompt });
        });
      });
    }
    function api(path, opt) {
      opt = opt || {};
      var go = function () {
        return fetch(BASE + path, {
          method: opt.method || 'GET',
          headers: Object.assign({ Authorization: 'Bearer ' + token }, opt.body ? { 'Content-Type': 'application/json' } : {}),
          body: opt.body ? JSON.stringify(opt.body) : undefined
        });
      };
      var ready = Date.now() < expires ? Promise.resolve() : requestToken('');
      return ready.then(go).then(function (r) {
        if (r.status === 401) return requestToken('').then(go);
        return r;
      }).then(function (r) {
        if (r.status === 204) return null;
        return r.json().then(function (j) {
          if (!r.ok) {
            var m = (j && j.error && j.error.message) || ('Erreur ' + r.status);
            if (r.status === 404) m = 'Agenda introuvable. Vérifiez que l\'agenda ' + CFG.calendarId + ' est bien partagé avec votre compte.';
            if (r.status === 403) m = 'Accès refusé. Votre compte doit avoir le droit « Apporter des modifications aux événements » sur cet agenda.';
            throw new Error(m);
          }
          return j;
        });
      });
    }
    function fromGoogle(g) {
      var p = (g.extendedProperties && g.extendedProperties.private) || {};
      if (!g.start || !g.start.dateTime) return null;
      var s = g.start.dateTime, e = g.end.dateTime;
      return {
        id: g.id, date: s.slice(0, 10), start: s.slice(11, 16), end: e.slice(11, 16),
        parts: p.parts ? p.parts.split(',') : [], title: p.title || g.summary || '', notes: g.description || ''
      };
    }
    function toGoogle(ev) {
      return {
        summary: prefixFn(ev.parts) + ev.title, description: ev.notes || '',
        start: { dateTime: ev.date + 'T' + ev.start + ':00', timeZone: CFG.timeZone },
        end: { dateTime: ev.date + 'T' + ev.end + ':00', timeZone: CFG.timeZone },
        extendedProperties: { private: { app: 'agenda-equipe', parts: ev.parts.join(','), title: ev.title } }
      };
    }
    function findConfig() {
      return api('/events?privateExtendedProperty=' + encodeURIComponent('kind=config') + '&maxResults=5').then(function (j) {
        return (j.items && j.items[0]) || null;
      });
    }
    return {
      mode: 'google',
      init: function () {
        var was = false; try { was = localStorage.getItem('agenda.signedin') === '1'; } catch (e) {}
        if (!was) return Promise.resolve({ needsLogin: true });
        return requestToken('').then(function () { return { needsLogin: false }; }, function () { return { needsLogin: true }; });
      },
      signIn: function () { return requestToken('select_account'); },
      signOut: function () {
        try { localStorage.removeItem('agenda.signedin'); } catch (e) {}
        if (token && window.google) google.accounts.oauth2.revoke(token, function () {});
        token = null; expires = 0; return Promise.resolve();
      },
      loadUsers: function () {
        return findConfig().then(function (c) {
          if (c) { configId = c.id; try { return JSON.parse(c.description); } catch (e) {} }
          return api('/events', { method: 'POST', body: {
            summary: '[Configuration] Équipe de l\'agenda — ne pas supprimer', description: JSON.stringify(DEFAULT_USERS),
            start: { date: '2000-01-01' }, end: { date: '2000-01-02' },
            extendedProperties: { private: { kind: 'config' } }, transparency: 'transparent'
          } }).then(function (c2) { configId = c2.id; return DEFAULT_USERS; });
        });
      },
      saveUsers: function (u) {
        return api('/events/' + configId, { method: 'PATCH', body: { description: JSON.stringify(u) } }).then(function () {});
      },
      list: function (from, to) {
        var min = new Date(from + 'T00:00:00').toISOString(), max = new Date(ds(addDays(new Date(to + 'T00:00:00'), 1)) + 'T00:00:00').toISOString();
        return api('/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=' + encodeURIComponent(min) + '&timeMax=' + encodeURIComponent(max))
          .then(function (j) { return (j.items || []).map(fromGoogle).filter(Boolean); });
      },
      save: function (ev) {
        var body = toGoogle(ev);
        return (ev.id ? api('/events/' + ev.id, { method: 'PUT', body: body }) : api('/events', { method: 'POST', body: body }))
          .then(function (g) { ev.id = g.id; return ev; });
      },
      remove: function (id) { return api('/events/' + id, { method: 'DELETE' }); }
    };
  }

  window.createStore = function (prefixFn) { return CFG.clientId ? googleStore(prefixFn) : demoStore(); };
  window.AGENDA_COLORS = COLORS;
})();
