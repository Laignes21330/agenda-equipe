/* Service worker : garde l'application disponible hors connexion.
   Les fichiers de l'application sont toujours demandés au réseau d'abord (pour recevoir les mises à jour),
   puis lus depuis la mémoire si le réseau est indisponible. Les appels à Google ne sont pas interceptés. */
var CACHE = 'agenda-equipe-v12';
var FILES = ['./', 'index.html', 'style.css', 'config.js', 'store.js', 'app.js', 'manifest.webmanifest', 'blason.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res;
  }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('index.html'); }); }));
});
