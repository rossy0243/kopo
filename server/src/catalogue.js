// Catalogue des apparences (thème des pays depuis le 02/11) et contenu du parcours de saison.
// Les identifiants sont les mêmes que dans la page (classes CSS). Rien n'aide à gagner.
'use strict';

// prix : en pièces dans la boutique (null = ne s'achète pas : défi, saison, Kopo+…).
// Rangement par catégorie : dos de cartes (les plus chers), puis avatars, puis cadres.
// Thème actuel : les pays (02/11). Les objets « ville » (Lubumbashi, Goma) ne sont plus vendus ;
// ils restent valables pour ceux qui les ont déjà, et pour le parcours de saison en cours.
// Les identifiants ne changent pas (ils sont dans les collections des joueurs et les classes CSS).
const PRIX = { dos: 2500, avatar: 1500, cadre: 1000 };
const OBJETS = {
  'av-laiton': { type: 'avatar', nom: 'Laiton', collection: 'base', prix: null },
  'av-nuit': { type: 'avatar', nom: 'Nuit', collection: 'base', prix: 1200 },
  'av-fleuve': { type: 'avatar', nom: 'Fleuve', collection: 'base', prix: 1200 },
  'av-kinshasa': { type: 'avatar', nom: 'RD Congo', collection: 'rdc', prix: PRIX.avatar },
  'av-abidjan': { type: 'avatar', nom: "Côte d'Ivoire", collection: 'cote-ivoire', prix: PRIX.avatar },
  'av-dakar': { type: 'avatar', nom: 'Sénégal', collection: 'senegal', prix: PRIX.avatar },
  'av-douala': { type: 'avatar', nom: 'Cameroun', collection: 'cameroun', prix: PRIX.avatar },
  'av-brazzaville': { type: 'avatar', nom: 'Congo', collection: 'congo', prix: PRIX.avatar },
  'av-lubumbashi': { type: 'avatar', nom: 'Lubumbashi', collection: 'lubumbashi', prix: null, ville: true },
  'av-goma': { type: 'avatar', nom: 'Goma', collection: 'goma', prix: null, ville: true },
  'av-fondateur': { type: 'avatar', nom: 'Fondateur', collection: 'saison-1', prix: null },
  'dos-laiton': { type: 'dos', nom: 'Laiton', collection: 'base', prix: null },
  'dos-kinshasa': { type: 'dos', nom: 'RD Congo', collection: 'rdc', prix: PRIX.dos },
  'dos-abidjan': { type: 'dos', nom: "Côte d'Ivoire", collection: 'cote-ivoire', prix: PRIX.dos },
  'dos-dakar': { type: 'dos', nom: 'Sénégal', collection: 'senegal', prix: PRIX.dos },
  'dos-douala': { type: 'dos', nom: 'Cameroun', collection: 'cameroun', prix: PRIX.dos },
  'dos-lubumbashi': { type: 'dos', nom: 'Lubumbashi', collection: 'lubumbashi', prix: null, ville: true },
  'dos-fondateurs': { type: 'dos', nom: 'Les Fondateurs', collection: 'fondateurs', prix: null }, // cadeau de fondateur
  'dos-goma': { type: 'dos', nom: 'Goma', collection: 'saison-1', prix: null, ville: true },
  'cadre-kinshasa': { type: 'cadre', nom: 'RD Congo', collection: 'rdc', prix: PRIX.cadre },
  'cadre-abidjan': { type: 'cadre', nom: "Côte d'Ivoire", collection: 'cote-ivoire', prix: PRIX.cadre },
  'cadre-dakar': { type: 'cadre', nom: 'Sénégal', collection: 'senegal', prix: PRIX.cadre },
  'cadre-douala': { type: 'cadre', nom: 'Cameroun', collection: 'cameroun', prix: PRIX.cadre },
  'cadre-brazzaville': { type: 'cadre', nom: 'Congo', collection: 'congo', prix: PRIX.cadre },
  'cadre-lubumbashi': { type: 'cadre', nom: 'Lubumbashi', collection: 'lubumbashi', prix: null, ville: true },
  'cadre-fondateurs': { type: 'cadre', nom: 'Les Fondateurs', collection: 'saison-1', prix: null },
  'cadre-legende': { type: 'cadre', nom: 'Légende', collection: 'saison-1', prix: null },
  // Paliers du parrainage (amis venus jouer) : ne s'achètent pas.
  'cadre-ambassadeur': { type: 'cadre', nom: 'Ambassadeur', collection: 'parrainage', prix: null },
  'av-ambassadeur': { type: 'avatar', nom: 'Ambassadeur', collection: 'parrainage', prix: null },
  'dos-ambassadeur': { type: 'dos', nom: 'Ambassadeur', collection: 'parrainage', prix: null },
  'cadre-ambassadeur-or': { type: 'cadre', nom: "Ambassadeur d'or", collection: 'parrainage', prix: null },
};
const DE_BASE = ['av-laiton', 'dos-laiton'];

// Parcours de saison : 30 paliers. Voie gratuite : pièces à chaque palier, apparences tous les 5 ;
// le dos de cartes de saison (Goma) au bout. Voie Kopo+ : apparences en plus, jamais de pièces ni d'avantage.
function contenuParcours(paliers = 30) {
  const gratuitObjets = { 3: 'av-lubumbashi', 6: 'cadre-lubumbashi', 10: 'dos-lubumbashi', 15: 'av-dakar', 20: 'dos-dakar', 25: 'av-abidjan', 30: 'dos-goma' };
  const plusObjets = { 1: 'av-fondateur', 4: 'cadre-fondateurs', 8: 'dos-abidjan', 12: 'av-douala', 16: 'dos-douala', 20: 'av-brazzaville', 24: 'av-goma', 28: 'cadre-brazzaville', 30: 'cadre-legende' };
  const l = [];
  for (let n = 1; n <= paliers; n++) {
    const g = gratuitObjets[n] ? { objet: gratuitObjets[n] } : { pieces: n % 10 === 0 ? 300 : n % 5 === 0 ? 150 : 60 };
    l.push({ n, gratuit: g, plus: plusObjets[n] ? { objet: plusObjets[n] } : null });
  }
  return l;
}

module.exports = { OBJETS, PRIX, DE_BASE, contenuParcours };
