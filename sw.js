var CACHE_NAME = 'prj-garments-v3';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/data-layer.js',
  './js/utils.js',
  './js/theme.js',
  './js/printer.js',
  './js/settings.js',
  './js/inventory.js',
  './js/vendor.js',
  './js/billing.js',
  './js/sales-engine.js',
  './js/reports.js',
  './js/expense.js',
  './js/employee.js',
  './js/attendance.js',
  './js/barcode-printer.js',
  './js/import-export.js',
  './js/transaction-history.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Skip non-GET and Firebase/external API requests
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      return cached || fetch(event.request).then(function(response) {
        if (response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      });
    }).catch(function() {
      if (event.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
