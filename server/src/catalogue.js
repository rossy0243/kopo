// Catalogue des apparences (thème des villes, validé le 31/10) et contenu du parcours de saison.
// Les identifiants sont les mêmes que dans la page (classes CSS). Rien n'aide à gagner.
'use strict';

// prix : en pièces dans la boutique (null = ne s'achète pas : défi, saison, Kopo+…).
const OBJETS = {
  'av-laiton': { type: 'avatar', nom: 'Laiton', collection: 'base', prix: null },
  'av-nuit': { type: 'avatar', nom: 'Nuit', collection: 'base', prix: 500 },
  'av-fleuve': { type: 'avatar', nom: 'Fleuve', collection: 'kinshasa', prix: 800 },
  'av-kinshasa': { type: 'avatar', nom: 'Kinshasa', collection: 'kinshasa', prix: 1200 },
  'av-lubumbashi': { type: 'avatar', nom: 'Lubumbashi', collection: 'lubumbashi', prix: 1200 },
  'av-abidjan': { type: 'avatar', nom: 'Abidjan', collection: 'abidjan', prix: 1200 },
  'av-dakar': { type: 'avatar', nom: 'Dakar', collection: 'dakar', prix: 1200 },
  'av-douala': { type: 'avatar', nom: 'Douala', collection: 'douala', prix: 1200 },
  'av-brazzaville': { type: 'avatar', nom: 'Brazzaville', collection: 'brazzaville', prix: 1200 },
  'av-goma': { type: 'avatar', nom: 'Goma', collection: 'goma', prix: null },
  'av-fondateur': { type: 'avatar', nom: 'Fondateur', collection: 'saison-1', prix: null },
  'dos-laiton': { type: 'dos', nom: 'Laiton', collection: 'base', prix: null },
  'dos-kinshasa': { type: 'dos', nom: 'Kinshasa', collection: 'kinshasa', prix: 2500 },
  'dos-lubumbashi': { type: 'dos', nom: 'Lubumbashi', collection: 'lubumbashi', prix: 2500 },
  'dos-abidjan': { type: 'dos', nom: 'Abidjan', collection: 'abidjan', prix: 2500 },
  'dos-dakar': { type: 'dos', nom: 'Dakar', collection: 'dakar', prix: 2500 },
  'dos-douala': { type: 'dos', nom: 'Douala', collection: 'douala', prix: 2500 },
  'dos-fondateurs': { type: 'dos', nom: 'Les Fondateurs', collection: 'saison-1', prix: null },
  'cadre-kinshasa': { type: 'cadre', nom: 'Kinshasa', collection: 'kinshasa', prix: 1500 },
  'cadre-lubumbashi': { type: 'cadre', nom: 'Lubumbashi', collection: 'lubumbashi', prix: 1500 },
  'cadre-abidjan': { type: 'cadre', nom: 'Abidjan', collection: 'abidjan', prix: 1500 },
  'cadre-dakar': { type: 'cadre', nom: 'Dakar', collection: 'dakar', prix: 1500 },
  'cadre-douala': { type: 'cadre', nom: 'Douala', collection: 'douala', prix: 1500 },
  'cadre-brazzaville': { type: 'cadre', nom: 'Brazzaville', collection: 'brazzaville', prix: 1500 },
  'cadre-fondateurs': { type: 'cadre', nom: 'Les Fondateurs', collection: 'saison-1', prix: null },
  'cadre-legende': { type: 'cadre', nom: 'Légende', collection: 'saison-1', prix: null },
};
const DE_BASE = ['av-laiton', 'dos-laiton'];

// Parcours de saison : 30 paliers. Voie gratuite : pièces à chaque palier, apparences tous les 5 ;
// le dos de cartes de saison au bout. Voie Kopo+ : apparences en plus, jamais de pièces ni d'avantage.
function contenuParcours(paliers = 30) {
  const gratuitObjets = { 3: 'av-lubumbashi', 6: 'cadre-lubumbashi', 10: 'dos-lubumbashi', 15: 'av-dakar', 20: 'dos-dakar', 25: 'av-abidjan', 30: 'dos-fondateurs' };
  const plusObjets = { 1: 'av-fondateur', 4: 'cadre-fondateurs', 8: 'dos-abidjan', 12: 'av-douala', 16: 'dos-douala', 20: 'av-brazzaville', 24: 'av-goma', 28: 'cadre-brazzaville', 30: 'cadre-legende' };
  const l = [];
  for (let n = 1; n <= paliers; n++) {
    const g = gratuitObjets[n] ? { objet: gratuitObjets[n] } : { pieces: n % 10 === 0 ? 300 : n % 5 === 0 ? 150 : 60 };
    l.push({ n, gratuit: g, plus: plusObjets[n] ? { objet: plusObjets[n] } : null });
  }
  return l;
}

module.exports = { OBJETS, DE_BASE, contenuParcours };
