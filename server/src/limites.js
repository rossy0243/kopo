// Limites contre les demandes en masse (sécurité, 17/11) : larges, un vrai joueur ne les atteint jamais.
// Compteurs en mémoire, par fenêtre fixe (une minute, une seconde…) : simple et suffisant pour un seul serveur.
'use strict';

// Un limiteur : au plus `max` passages par `fenetreMs` pour une même clé (compte, adresse IP…).
// passer(cle) renvoie true si c'est permis, false si la limite est atteinte.
function creerLimiteur(max, fenetreMs) {
  const compteurs = new Map(); // cle -> { n, depuis }
  let nettoye = Date.now();
  const lim = {
    max, fenetreMs,
    passer(cle, maintenant = Date.now()) {
      // De temps en temps, on oublie les clés dont la fenêtre est finie (la mémoire ne grossit pas).
      if (maintenant - nettoye > Math.max(fenetreMs, 60e3)) {
        for (const [k, c] of compteurs) if (maintenant - c.depuis >= fenetreMs) compteurs.delete(k);
        nettoye = maintenant;
      }
      let c = compteurs.get(cle);
      if (!c || maintenant - c.depuis >= fenetreMs) { c = { n: 0, depuis: maintenant }; compteurs.set(cle, c); }
      c.n++;
      return c.n <= lim.max; // lim.max : réglable dans le tableau de bord (appliquerLimites)
    },
    vider() { compteurs.clear(); },
  };
  return lim;
}

// Les limites du jeu. Pendant les tests (KOPO_TESTS=1), elles sont coupées, sauf dans leurs propres tests.
const LIMITES = {
  apiCompte: { max: 120, fenetreMs: 60e3 }, // appels à l'API par compte et par minute
  apiIp: { max: 600, fenetreMs: 60e3 }, // par adresse IP et par minute (large : plusieurs joueurs partagent souvent une adresse en 4G)
  codesIp: { max: 60, fenetreMs: 60e3 }, // GET /api/salles/:code par adresse IP et par minute
  codesCompte: { max: 30, fenetreMs: 60e3 }, // entrées dans une salle avec un code, par compte et par minute
  messages: { max: 20, fenetreMs: 1000 }, // messages d'un joueur dans une salle, par seconde
};
const SALLES_MAX = 3; // salles où un même compte est connecté en même temps

const actives = () => process.env.KOPO_TESTS !== '1' || process.env.KOPO_LIMITES === '1';
const limiteurs = Object.fromEntries(Object.entries(LIMITES).map(([k, l]) => [k, creerLimiteur(l.max, l.fenetreMs)]));
// Réglages > Sécurité du tableau de bord : { apiCompte, apiIp, codesCompte } par minute (le reste garde sa valeur).
function appliquerLimites(r) {
  for (const k of ['apiCompte', 'apiIp', 'codesCompte']) { const n = Math.trunc(Number(r && r[k])); if (n > 0) limiteurs[k].max = n; }
}
function permis(nom, cle) { return !actives() || limiteurs[nom].passer(String(cle)); }

module.exports = { creerLimiteur, LIMITES, SALLES_MAX, permis, limiteurs, actives, appliquerLimites };
