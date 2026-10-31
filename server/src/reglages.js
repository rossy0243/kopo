// Réglages du jeu modifiables depuis le tableau de bord (valeurs de départ : strategie-pieces.md v1.0).
'use strict';

const DEFAUTS = {
  gains: { bienvenue: 500, manche: 5, katapss: 10, victoire: 40, deuxieme: 15 },
  bonusJour: { depart: 50, pas: 10, plafond: 150 },
  remiseAFlot: { seuil: 20, niveau: 100 },
  pot: { vainqueur: 50, deuxieme: 25, troisieme: 10, maison: 15 },
  tables: { bronze: 50, argent: 200, or: 1000, diamant: 5000 },
  annonce: { texte: '', active: false },
  maintenance: { active: false, message: 'Le Kopo est en maintenance. On revient très vite !' },
  versionMin: '1.0',
};

function creerReglages(base) {
  let cache = JSON.parse(JSON.stringify(DEFAUTS));
  return {
    async charger() {
      const r = await base.query('SELECT cle, valeur FROM reglages_jeu');
      cache = JSON.parse(JSON.stringify(DEFAUTS));
      for (const l of r.rows) if (l.cle in cache) cache[l.cle] = typeof l.valeur === 'string' ? JSON.parse(l.valeur) : l.valeur;
      return cache;
    },
    tout: () => cache,
    get: (cle) => cache[cle],
    async ecrire(cle, valeur) {
      if (!(cle in DEFAUTS)) throw Object.assign(new Error('Réglage inconnu : ' + cle), { statut: 400 });
      if (typeof DEFAUTS[cle] === 'object' && (typeof valeur !== 'object' || valeur === null)) throw Object.assign(new Error('Valeur invalide.'), { statut: 400 });
      if (cle === 'pot') {
        const t = ['vainqueur', 'deuxieme', 'troisieme', 'maison'].reduce((s, k) => s + Number(valeur[k] || 0), 0);
        if (t !== 100) throw Object.assign(new Error('Les parts du pot doivent faire 100 %.'), { statut: 400 });
      }
      await base.query('INSERT INTO reglages_jeu (cle, valeur) VALUES ($1, $2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur', [cle, JSON.stringify(valeur)]);
      cache[cle] = valeur;
      return valeur;
    },
  };
}

module.exports = { creerReglages, DEFAUTS };
