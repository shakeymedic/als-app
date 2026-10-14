// Registers the service worker so the app can be installed and used offline.
// Skipped when the page is shown inside another site (for example emevidence.org).
if ('serviceWorker' in navigator && window.top === window.self) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
