// Service worker du Kopo : il rend le jeu installable (« Installer le jeu », icône sur l'écran d'accueil).
// Pas de hors ligne pour l'instant : rien n'est mis en cache, la page vient toujours du réseau
// (la vérification « Nouvelle version disponible » continue de marcher comme avant).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Les anciennes versions de Chrome n'acceptent d'installer que si le service worker répond aux pages.
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
