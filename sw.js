// Service worker de Masano (Kopo et Inter (8)) : il rend le jeu installable (« Installer le jeu », icône sur l'écran d'accueil)
// et affiche les notifications push (invitation d'un ami, demande d'ami, rappel du Match du jour, annonces).
// Pas de hors ligne pour l'instant : rien n'est mis en cache, la page vient toujours du réseau
// (la vérification « Nouvelle version disponible » continue de marcher comme avant).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Les anciennes versions de Chrome n'acceptent d'installer que si le service worker répond aux pages.
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});

// Message du serveur : { type, titre, texte, url, tag }. Toujours affiché (iPhone et Chrome l'exigent).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { texte: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'Masano', {
    body: d.texte || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: 'fr',
    data: { url: d.url || './', type: d.type || null },
  }));
});

// Notification touchée : on revient sur Masano s'il est ouvert (il ouvre la bonne fenêtre), sinon on l'ouvre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const f = fenetres.find((c) => c.url.startsWith(self.registration.scope));
    if (f) {
      try { await f.focus(); } catch (x) {}
      f.postMessage({ masano: 'ouvrir', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
