var CACHE_TITLE = 'my-site-cache';
var CACHE_VERSION = 'v2';
var CACHE_NAME = CACHE_TITLE + '-' + CACHE_VERSION;
var urlsToCache = [
  '.',
  'images/clock.svg',
  'images/logo-60x50.png',
  'images/map-pin.svg',
  'style.css',
  'start.js'
];

self.addEventListener('install', function(event) {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});
self.addEventListener('activate', function(event) {

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
                    if(cacheName !== CACHE_NAME && cacheName.indexOf(CACHE_TITLE) === 0) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// caches.open(cacheName)
// //Opens the given cache and returns a promise that resolves to the cache
//
// cache.addAll(arrayOfUrls)
//Saves the provided files in the cache
//
// Manifest
// JSON file describing how your app should work when installed
//  {
//     name: "CDU Assignment Scheduler",
//     short_name: "CDU Scheduler",
//     icons: [
//         {
//             src: "images/icons/icon-128.png",
//             sizes: "128x128",
//             type: "image/png"
//         },
//         {
//             src: "images/icons/icon-512.png",
//             sizes: "512x512",
//             type: "image/png"
//         }
//     ],
//     start_url: ".",
//     display: "standalone",
//     background_color: "#FFF",
//     theme_color: "#123557"
// }
// Progressive Web Apps
// You have now build a progressive web app
// works offline
// Can install to android
