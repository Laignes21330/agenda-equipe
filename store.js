/* Couche de données : deux implémentations avec la même interface.
   - démo   : tout est gardé dans le navigateur (localStorage)
   - équipe : lit et écrit dans l'agenda de la mairie via un service Google Apps Script (code d'accès commun)
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
        { id: 'e5', parts: ['u4', 'u3'], title: 'Visite de la salle des fêtes', date: d(2), start: '11:00', end: '12:00', notes: '', location: 'Salle des fêtes' },
        { id: 'e6', parts: ['u1', 'u2'], title: 'Formation élus', date: d(4), allDay: true, endDate: d(4), start: '', end: '', notes: '', location: 'Dijon' }
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
        return Promise.resolve(all.filter(function (e) { return (e.endDate || e.date) >= from && e.date <= to; }));
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

  /* ---------- Mode équipe : service Apps Script rattaché au compte de la mairie ---------- */
  function scriptStore(prefixFn) {
    var KEY = 'agenda.code';
    var code = '';
    try { code = localStorage.getItem(KEY) || ''; } catch (e) {}
    function call(action, payload) {
      return fetch(CFG.scriptUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, code: code }, payload || {})) })
        .then(function (r) { return r.text(); }, function () { throw new Error('Connexion impossible. Vérifiez votre accès à internet, puis réessayez.'); })
        .then(function (t) {
          var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Le service d\'agenda ne répond pas. Réessayez dans un instant.'); }
          if (!j.ok) throw new Error(j.error || 'Erreur du service d\'agenda.');
          return j.data;
        });
    }
    function forget() { code = ''; try { localStorage.removeItem(KEY); } catch (e) {} }
    return {
      mode: 'script',
      init: function () {
        if (!code) return Promise.resolve({ needsLogin: true });
        return call('users').then(function () { return { needsLogin: false }; }, function (e) {
          if (/Code d.acc/.test(e.message)) forget();
          return { needsLogin: true };
        });
      },
      signIn: function (entered) {
        code = String(entered || '').trim();
        if (!code) return Promise.reject(new Error('Saisissez le code d\'accès.'));
        return call('users').then(function () { try { localStorage.setItem(KEY, code); } catch (e) {} }, function (e) { forget(); throw e; });
      },
      signOut: function () { forget(); return Promise.resolve(); },
      loadUsers: function () { return call('users'); },
      saveUsers: function (u) { return call('saveUsers', { users: u }).then(function () {}); },
      list: function (from, to) { return call('list', { from: from, to: to }); },
      save: function (ev) {
        return call('save', { event: Object.assign({}, ev, { summary: prefixFn(ev.parts) + ev.title }) }).then(function (r) { ev.id = r.id; return ev; });
      },
      remove: function (id) { return call('remove', { id: id }).then(function () {}); }
    };
  }

  window.createStore = function (prefixFn) { return CFG.scriptUrl ? scriptStore(prefixFn) : demoStore(); };
  window.AGENDA_COLORS = COLORS;
})();
