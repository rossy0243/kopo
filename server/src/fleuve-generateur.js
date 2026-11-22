// Le Fleuve : fabrique les étapes avec la recette réglée dans l'admin (fleuve.md, « Fabriquer plus de 1 000 étapes »).
// Pour chaque étape : une table, des robots, un objectif, parfois un piège, et une donne tirée au hasard puis fixée.
// La force des robots est cherchée en faisant jouer l'étape par des robots (un robot Fort à la place du joueur)
// jusqu'à obtenir le taux de réussite visé par la courbe ; les seuils des 2e et 3e étoiles viennent des mêmes essais.
'use strict';
const SK = require('../../src/kopo-salle.js');
const SI = require('../../src/inter8-salle.js');
const K = require('../../moteur/kopo-moteur.js');
const { OBJECTIFS, creerSuivi } = require('./fleuve-suivi');

const FLEUVES = { congo: 'kopo', niger: 'inter8' }; // le Congo se joue au Kopo, le Niger à l'Inter (8)
const ETAPES_PAR_BIEF = 50;
const ETAPES_PAR_VILLE = 10;
const MOI = 'moi';
const TYPES = ['faciles', 'normaux', 'forts'];
// Difficulté des robots de 1 à 60 : faciles 1 à 20, normaux 1 à 20, forts 1 à 20 (de plus en plus forts).
const niveauDe = (d) => { const x = Math.min(60, Math.max(1, Math.round(d))); return { robots: TYPES[Math.floor((x - 1) / 20)], force: ((x - 1) % 20) + 1 }; };
const sallePour = (jeu) => (jeu === 'inter8' ? SI : SK);
const DELAI = 10, DELAI_PIEGE = 5; // secondes par tour ; piège « chrono plus court »

// Pièges (fleuve.md, « Les pièges ») : ceux que cette version sait faire. des = bief à partir duquel ils sortent.
const PIEGES = {
  dernier: { jeux: ['kopo', 'inter8'], des: 4, texte: 'Tu joues en dernier dans la 1re manche' },
  chrono: { jeux: ['kopo', 'inter8'], des: 4, texte: 'Chrono plus court : 5 secondes pour jouer' },
  delire: { jeux: ['inter8'], des: 5, texte: 'Deux paquets (mode Délire)' },
  jretour: { jeux: ['inter8'], des: 5, texte: 'Le valet change le sens (J retour)' },
};

// Recette de départ (réglage « fleuveRecette », modifiable dans l'admin).
const RECETTE_DEFAUT = {
  courbe: { depart: 8, parBief: 6 }, // note de la 1re étape, et de combien tout le cycle monte à chaque bief
  cycle: [-6, -4, 0, 2, 4, 6, 8, 10, 14, 28], // décalage de chaque étape d'une ville (10 = l'escale, la plus dure)
  taux: { facile: 92, dur: 25 }, // réussite visée (robot Fort à la place du joueur) pour une note de 1 et de 100
  tolerance: 12, // écart accepté entre la réussite obtenue et la réussite visée (en points)
  etoiles: { deux: 50, trois: 15 }, // 2 étoiles : mieux que la moitié des essais ; 3 : parmi les 15 % meilleurs
  simulations: 200, // essais pour les seuils d'étoiles
  calibrage: 40, // essais par force essayée
  essais: 6, // étapes candidates au plus pour une même place
  des: Object.fromEntries([...Object.entries(OBJECTIFS).map(([k, o]) => ['objectif_' + k, o.des]), ...Object.entries(PIEGES).map(([k, p]) => ['piege_' + k, p.des])]),
  piege: { escale: 60, autre: 20 }, // chance (%) d'avoir un piège, une fois débloqué
  testeur: { niveau: 'forts', force: 20 }, // le robot qui joue à la place du joueur pendant les essais
};

function hasard(graine) { return K.hasard(graine >>> 0); }
const choisir = (rng, l) => l[Math.floor(rng() * l.length)];
const entre = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

// Note visée (1 à 100) d'une étape, et réussite visée qui va avec.
function noteVisee(numero, recette) {
  const r = recette || RECETTE_DEFAUT;
  const bief = Math.ceil(numero / ETAPES_PAR_BIEF), c = ((numero - 1) % ETAPES_PAR_VILLE);
  const n = r.courbe.depart + r.courbe.parBief * (bief - 1) + (r.cycle[c] || 0);
  return Math.max(1, Math.min(100, Math.round(n)));
}
function tauxVise(note, recette) {
  const t = (recette || RECETTE_DEFAUT).taux;
  return t.facile - ((t.facile - t.dur) * (note - 1)) / 99;
}

// Prépare la salle d'une étape. joueur : { id, nom } du joueur (ou d'un robot Fort, pour les essais).
// L'appelant ajoute le joueur (rejoindre) avant, puis lance la partie.
function placerRobots(s, etape, joueurId, { adoucir = 0 } = {}) {
  const S = sallePour(etape.jeu);
  const { robots, force } = niveauDe((etape.d || 30) - adoucir);
  s.robots = robots;
  s.niveauJoueur = force;
  s.sansPause = true; // même temps pour tous
  s.delai = (etape.pieges || []).includes('chrono') ? DELAI_PIEGE : DELAI;
  if (etape.jeu === 'inter8') {
    s.mode = (etape.pieges || []).includes('delire') ? 'delire' : 'simple';
    s.jRetour = (etape.pieges || []).includes('jretour');
    s.formule = 'normale';
  }
  const ids = [];
  for (let i = 1; i < Math.min(S.MAX, Math.max(2, etape.joueurs)); i++) {
    const id = 'robot-' + i;
    s.joueurs.push({ id, nom: 'Robot ' + i, connecte: true, robot: true, voix: false, muet: true });
    ids.push(id);
  }
  s.donne = { graine: etape.graine >>> 0, ordre: [joueurId].concat(ids) };
  if ((etape.pieges || []).includes('dernier')) s.donne.dernier = joueurId;
  return s;
}

// Une partie d'essai : un robot Fort (force 20) à la place du joueur. Renvoie le résultat du suivi.
function essai(etape, graineRobots) {
  const S = sallePour(etape.jeu);
  const s = S.creerSalle('ESSAI', hasard(graineRobots));
  let t = 1e12;
  s.horloge = () => t;
  s.pauseRobot = 0;
  s.durees = { depart: 0, finTour: 0, mancheAuto: 1, revanche: 15000 };
  const tst = etape.testeur || RECETTE_DEFAUT.testeur;
  s.joueurs.push({ id: MOI, nom: 'Toi', connecte: true, robot: true, niveau: TYPES.includes(tst.niveau) ? tst.niveau : 'forts', force: Math.min(20, Math.max(1, tst.force | 0)) || 20, voix: false, muet: true });
  s.hote = MOI;
  placerRobots(s, etape, MOI);
  const suivi = creerSuivi(MOI, etape);
  s.surAction = suivi.surAction;
  const r = S.recevoir(s, MOI, { type: 'lancer' });
  if (!r.ok) throw new Error('Essai impossible : ' + r.erreur);
  for (let k = 0; k < 300000 && !suivi.fini(); k++) { t += 5000; S.tic(s); suivi.observer(s); }
  suivi.arreter();
  return suivi.resultat();
}

const pause = () => new Promise((ok) => setImmediate(ok));
// n essais d'une étape (avec des robots différents à chaque fois). Rend la main au serveur entre les essais.
async function essais(etape, n, graine) {
  const l = [];
  for (let i = 0; i < n; i++) {
    l.push(essai(etape, (graine + Math.imul(i + 1, 2654435761)) >>> 0));
    if (i % 4 === 3) await pause();
  }
  return l;
}
const tauxDe = (l) => (l.length ? (100 * l.filter((r) => r.reussi).length) / l.length : 0);

// Seuils des 2e et 3e étoiles : le score qu'atteignent au plus pct % des essais.
function seuil(scores, pct) {
  const tries = scores.slice().sort((a, b) => a - b), n = tries.length;
  if (!n) return 1;
  const max = tries[n - 1];
  for (let v = tries[0]; v <= max; v++) if (tries.filter((x) => x >= v).length / n <= pct / 100) return Math.max(1, v);
  return Math.max(1, max);
}
function seuilsDe(l, recette) {
  const e = (recette || RECETTE_DEFAUT).etoiles;
  const scores = l.map((r) => r.score);
  let deux = seuil(scores, e.deux), trois = seuil(scores, e.trois);
  // Toujours atteignables, et la 3e plus dure que la 2e quand les scores le permettent.
  const valeurs = [...new Set(scores)].sort((a, b) => a - b);
  if (trois <= deux) {
    const dessus = valeurs.find((v) => v > deux), dessous = valeurs.filter((v) => v < deux).pop();
    if (dessus !== undefined) trois = dessus;
    else if (dessous !== undefined && dessous >= 1) { trois = deux; deux = dessous; }
    else { trois = deux; deux = Math.max(1, deux - 1); } // tous les essais ont le même score : la 3e étoile demande ce score parfait
  }
  return { deux, trois };
}

// Une étape candidate pour la place « numero » : table, robots, objectif, pièges, donne.
function candidat(fleuve, numero, recette, rng, familles) {
  const jeu = FLEUVES[fleuve];
  const bief = Math.ceil(numero / ETAPES_PAR_BIEF), c = ((numero - 1) % ETAPES_PAR_VILLE) + 1, escale = c === ETAPES_PAR_VILLE;
  const des = (k, defaut) => { const v = Number(recette.des && recette.des[k]); return Number.isFinite(v) ? v : defaut; };
  const MAX = sallePour(jeu).MAX;
  const maxT = Math.min(MAX, 3 + bief), minT = 3;
  let joueurs = escale ? maxT : entre(rng, minT, maxT);
  // Objectif : débloqué, jamais la même famille que l'étape d'avant, et au moins 3 familles par ville.
  const precedente = familles[familles.length - 1];
  const dansVille = familles.slice(-(c - 1) || familles.length);
  let types = Object.keys(OBJECTIFS).filter((k) => OBJECTIFS[k].jeux.includes(jeu) && bief >= des('objectif_' + k, OBJECTIFS[k].des) && OBJECTIFS[k].famille !== precedente);
  const nouvelles = types.filter((k) => !dansVille.includes(OBJECTIFS[k].famille));
  if (c >= 7 && new Set(dansVille).size < 3 && nouvelles.length) types = nouvelles;
  if (!types.length) types = ['manches'];
  const type = choisir(rng, types);
  // Parties complètes (finale, gagner, top) : 5 joueurs au plus, pour rester courtes.
  if (['finale', 'gagner', 'top'].includes(type)) joueurs = Math.min(joueurs, escale ? 6 : 5);
  if (type === 'finale' || type === 'top') joueurs = Math.max(joueurs, 3);
  const o = { type };
  if (type === 'manches') o.n = entre(rng, 1, Math.max(1, joueurs - 2));
  if (type === 'premier' || type === 'ramasser' || type === 'attaque' || type === 'pioche') o.m = entre(rng, 1, 2);
  if (type === 'katapss') o.m = 1;
  if (type === 'top') o.n = Math.ceil(joueurs / 2);
  if (type === 'ramasser') o.n = entre(rng, 0, 2);
  if (type === 'attaque') o.n = choisir(rng, [2, 4, 4, 6, 8].slice(0, Math.min(5, 2 + bief)));
  if (type === 'pioche') o.n = choisir(rng, [2, 4, 6]);
  // Piège : une fois débloqué, plus souvent sur l'escale.
  const pieges = [];
  const dispo = Object.keys(PIEGES).filter((k) => PIEGES[k].jeux.includes(jeu) && bief >= des('piege_' + k, PIEGES[k].des));
  if (dispo.length && rng() * 100 < (escale ? recette.piege.escale : recette.piege.autre)) pieges.push(choisir(rng, dispo));
  return { fleuve, numero, bief, jeu, joueurs, objectif: o, famille: OBJECTIFS[type].famille, pieges, graine: Math.floor(rng() * 4294967296) >>> 0, escale };
}

// Cherche la force des robots qui donne la réussite visée. Renvoie { d, taux } ou null si l'objectif est
// infaisable (trop dur même contre les robots les plus faibles).
async function calibrer(etape, cible, recette, graine) {
  const n = recette.calibrage;
  const mesurer = async (d) => tauxDe(await essais({ ...etape, d }, n, graine + d));
  let lo = 1, hi = 60;
  const tLo = await mesurer(lo);
  if (tLo < cible - recette.tolerance) return { d: lo, taux: tLo, infaisable: true };
  const tHi = await mesurer(hi);
  if (tHi >= cible) return { d: hi, taux: tHi };
  let meilleur = { d: lo, taux: tLo };
  for (let i = 0; i < 6 && hi - lo > 1; i++) {
    const mid = Math.round((lo + hi) / 2), t = await mesurer(mid);
    if (Math.abs(t - cible) < Math.abs(meilleur.taux - cible)) meilleur = { d: mid, taux: t };
    if (t >= cible) lo = mid; else hi = mid;
  }
  return meilleur;
}

// Fabrique une étape complète. familles : familles d'objectifs des étapes d'avant (variété).
async function fabriquerEtape(fleuve, numero, { recette = RECETTE_DEFAUT, graine = (Math.random() * 4294967296) >>> 0, familles = [] } = {}) {
  const rng = hasard(graine ^ Math.imul(numero, 0x85ebca6b));
  const note = noteVisee(numero, recette), cible = tauxVise(note, recette);
  let meilleure = null;
  for (let k = 0; k < Math.max(1, recette.essais); k++) {
    const e = { ...candidat(fleuve, numero, recette, rng, familles), testeur: recette.testeur };
    // Katapss : seulement sur une donne où il est possible (les essais doivent le réussir assez souvent).
    const cal = await calibrer(e, cible, recette, e.graine);
    if (cal.infaisable) continue;
    const ecart = Math.abs(cal.taux - cible);
    if (!meilleure || ecart < meilleure.ecart) meilleure = { e, cal, ecart };
    if (ecart <= recette.tolerance) break;
  }
  if (!meilleure) { // rien de faisable : l'objectif le plus simple, robots les plus faibles
    const e = candidat(fleuve, numero, { ...recette, des: Object.fromEntries(Object.keys(OBJECTIFS).map((k) => ['objectif_' + k, k === 'manches' ? 1 : 999])), piege: { escale: 0, autre: 0 } }, rng, []);
    meilleure = { e: { ...e, testeur: recette.testeur }, cal: { d: 1, taux: 0 }, ecart: 100 };
  }
  const etape = { ...meilleure.e, d: meilleure.cal.d };
  const l = await essais(etape, recette.simulations, (etape.graine ^ 0x27d4eb2d) >>> 0);
  const taux = Math.round(tauxDe(l));
  return { ...etape, ...niveauDe(etape.d), note, vise: Math.round(cible), taux, seuils: seuilsDe(l, recette), horsCible: Math.abs(taux - cible) > recette.tolerance };
}

// Recette enregistrée avant l'ajout d'un champ : le champ manquant prend sa valeur de départ.
function completerRecette(r) {
  const d = RECETTE_DEFAUT, x = r && typeof r === 'object' ? r : {};
  const sous = (k) => ({ ...d[k], ...(x[k] && typeof x[k] === 'object' ? x[k] : {}) });
  return { ...d, ...x, courbe: sous('courbe'), taux: sous('taux'), etoiles: sous('etoiles'), des: sous('des'), piege: sous('piege'), testeur: sous('testeur'), cycle: Array.isArray(x.cycle) && x.cycle.length === ETAPES_PAR_VILLE ? x.cycle : d.cycle };
}
// Vérifie la recette envoyée par l'admin (bornes de chaque champ).
function verifierRecette(v) {
  const err = (m) => { throw Object.assign(new Error('Recette : ' + m), { statut: 400 }); };
  const r = completerRecette(v);
  const n = (x, a, b, nom) => { const y = Number(x); if (!Number.isFinite(y) || y < a || y > b) err(`${nom} entre ${a} et ${b}.`); return Math.round(y); };
  const out = {
    courbe: { depart: n(r.courbe.depart, 1, 100, 'note de départ'), parBief: n(r.courbe.parBief, 0, 50, 'montée par bief') },
    cycle: r.cycle.map((x, i) => n(x, -50, 80, `décalage de l'étape ${i + 1}`)),
    taux: { facile: n(r.taux.facile, 5, 100, 'réussite visée (facile)'), dur: n(r.taux.dur, 1, 100, 'réussite visée (dur)') },
    tolerance: n(r.tolerance, 1, 50, 'tolérance'),
    etoiles: { deux: n(r.etoiles.deux, 5, 95, '2e étoile (%)'), trois: n(r.etoiles.trois, 1, 90, '3e étoile (%)') },
    simulations: n(r.simulations, 20, 1000, 'essais pour les étoiles'),
    calibrage: n(r.calibrage, 10, 400, 'essais par force'),
    essais: n(r.essais, 1, 20, 'candidates par étape'),
    des: {},
    piege: { escale: n(r.piege.escale, 0, 100, 'piège sur l\'escale (%)'), autre: n(r.piege.autre, 0, 100, 'piège ailleurs (%)') },
    testeur: { niveau: TYPES.includes(r.testeur.niveau) ? r.testeur.niveau : err('testeur : faciles, normaux ou forts.'), force: n(r.testeur.force, 1, 20, 'force du testeur') },
  };
  if (out.taux.dur >= out.taux.facile) err('la réussite visée « dur » doit être plus basse que « facile ».');
  if (out.etoiles.trois >= out.etoiles.deux) err('la 3e étoile doit être plus rare que la 2e.');
  for (const k of Object.keys(RECETTE_DEFAUT.des)) out.des[k] = n(r.des[k], 1, 999, `débloqué au bief (${k})`);
  return out;
}

module.exports = { completerRecette, verifierRecette, FLEUVES, ETAPES_PAR_BIEF, ETAPES_PAR_VILLE, PIEGES, RECETTE_DEFAUT, TYPES, niveauDe, noteVisee, tauxVise, placerRobots, essai, essais, seuilsDe, candidat, calibrer, fabriquerEtape, sallePour, DELAI, DELAI_PIEGE };
