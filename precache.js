// 08-precache.js
// Improved precache registration with friendly logging and update handling
(function () {
  // guard: service workers only available on secure contexts (https or localhost)
  if (!('serviceWorker' in navigator)) {
    console.warn('[Abrox] Service Worker not supported in this browser.');
    return;
  }

  // allow callers to override the path by setting window._abrox && window._abrox.swPath
  const SW_PATH = (window._abrox && window._abrox.swPath) || '/sw.js';
  const SW_SCOPE = (window._abrox && window._abrox.swScope) || '/';

  function registerServiceWorker(){
    return navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE })
      .then(reg => {
        console.log('[Abrox] Service Worker registered:', reg.scope);

        // If there's an active controller, the page is already controlled by a SW
        if (navigator.serviceWorker.controller) {
          console.log('[Abrox] Page currently controlled by service worker.');
        }

        // listen for updates found (new SW installing)
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          console.log('[Abrox] Service Worker update found.');
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            console.log('[Abrox] Service Worker state:', newWorker.state);
            // optional: notify clients when the new SW is installed/activated
            if (newWorker.state === 'installed') {
              // when there's an existing controller, this means new content is available
              if (navigator.serviceWorker.controller) {
                console.info('[Abrox] New content available — consider prompting user to refresh.');
              } else {
                console.info('[Abrox] Content cached for offline use.');
              }
            }
          });
        });

        return reg;
      })
      .catch(err => {
        console.error('[Abrox] Service Worker registration failed:', err);
        throw err;
      });
  }

  // Register on load, but allow immediate registration in dev if desired
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // use microtask to avoid blocking
    setTimeout(registerServiceWorker, 50);
  } else {
    window.addEventListener('load', () => setTimeout(registerServiceWorker, 50));
  }

  // expose a small helper to re-register / update (useful during dev)
  window._abrox = window._abrox || {};
  window._abrox.recheckServiceWorker = function(){
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('sw-not-supported'));
    return registerServiceWorker();
  };
})();
