// Pages légales : le texte à jour vient du serveur (tableau de bord, rubrique « Pages légales »), sans redéployer
// le site ni mettre à jour les applis. Le texte écrit dans la page reste affiché si le serveur ne répond pas.
(function () {
  var script = document.currentScript;
  var q = new URLSearchParams(location.search);
  var cle = (script && script.getAttribute('data-cle')) || q.get('p') || '';
  var appli = q.get('appli') === '1';
  // ?serveur= pour les essais en local seulement (comme le jeu).
  var essai = q.get('serveur');
  var serveur = essai && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(essai) ? essai.replace(/\/$/, '') : 'https://kopo-serveur.onrender.com';
  var suite = (appli ? '?appli=1' : '') + (essai && serveur !== 'https://kopo-serveur.onrender.com' ? (appli ? '&' : '?') + 'serveur=' + encodeURIComponent(serveur) : '');

  // Ouverte depuis une appli des stores (?appli=1) : pas de lien vers le reste du site, seulement entre les pages légales.
  function liensAppli() {
    var logo = document.querySelector('a.logo');
    if (appli && logo) logo.removeAttribute('href');
    if (!suite) return;
    document.querySelectorAll('a[href*=".html"]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (/^https?:/i.test(h) && h.indexOf(location.host) < 0) return;
      a.setAttribute('href', h.replace(/\.html(\?[^#]*)?/, function (m, qs) { return '.html' + (qs ? qs + suite.replace('?', '&') : suite); }));
    });
  }
  function texte(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function lienPage(p) { return (p.lien || '').replace(/^legal\//, ''); }

  liensAppli();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(cle)) { if (!document.getElementById('contenu').textContent.trim()) texte('contenu', 'Page introuvable.'); return; }
  var ctrl = window.AbortController ? new AbortController() : null;
  var minuteur = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
  fetch(serveur + '/api/legal/' + cle, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (p) {
      clearTimeout(minuteur);
      texte('titre', p.titre);
      texte('version', 'Version du ' + p.versionTexte);
      document.title = 'Masano — ' + p.titre;
      // HTML déjà nettoyé par le serveur à l'enregistrement (aucun script, aucun attribut on…).
      document.getElementById('contenu').innerHTML = p.html;
      var nav = document.getElementById('autres');
      if (nav && p.autres && p.autres.length) {
        nav.innerHTML = '';
        p.autres.forEach(function (x, i) {
          if (i) nav.appendChild(document.createTextNode(' · '));
          var a = document.createElement('a'); a.href = lienPage(x); a.textContent = x.titre; nav.appendChild(a);
        });
      }
      liensAppli();
      if (location.hash) { var cible = document.getElementById(location.hash.slice(1)); if (cible) cible.scrollIntoView(); }
    })
    .catch(function () {
      clearTimeout(minuteur);
      var c = document.getElementById('contenu');
      if (c && !c.textContent.trim()) { texte('titre', 'Page indisponible'); c.textContent = 'Le serveur ne répond pas. Réessaie dans une minute.'; }
    });
})();
