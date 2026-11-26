// Le Fleuve, Kopo : la finale d'une étape doit pouvoir se gagner.
// La donne d'une étape est fixe (graine) : à chaque manche, le joueur reçoit toujours les mêmes 4 cartes, et son
// adversaire de la finale aussi, quel que soit le robot qui a survécu. Une donne peut donc rendre la finale perdue
// d'avance : quoi que joue le joueur, un adversaire qui joue bien sort le premier. Ici, on résout la finale coup par
// coup (deux mains connues, aucune pioche : le calcul est exact) et on dit si le joueur peut la gagner à coup sûr.
'use strict';
const K = require('../../moteur/kopo-moteur.js');
const SK = require('../../src/kopo-salle.js');

const MOI = 'moi', ADV = 'adv';
const cle = (m) => [m.mains[MOI].slice().sort().join(','), m.mains[ADV].slice().sort().join(','), m.phase, m.joueurCourant,
  m.couleurTour || '', m.couleurInterdite || '', m.table.map((p) => p.joueur + ':' + p.cartes.join('+') + (p.compte ? '' : '!')).join('|')].join('/');
const copie = (m) => ({ ...m, sieges: m.sieges.slice(), enJeu: m.enJeu.slice(), katapss: m.katapss.slice(), attente: m.attente.slice(),
  qualifies: m.qualifies.slice(), journal: [], vu: { sorties: [], ramassees: {} }, mains: { [MOI]: m.mains[MOI].slice(), [ADV]: m.mains[ADV].slice() },
  table: m.table.map((p) => ({ ...p, cartes: p.cartes.slice() })) });

// Le joueur gagne-t-il la finale à coup sûr ? mains : { moi, adv } (4 cartes chacun) ; ouvreur : 'moi' ou 'adv'.
// Katapss (4 cartes d'une couleur) : celui qui l'a sort tout de suite ; si les deux l'ont, le joueur peut l'annoncer
// avant le robot (qui attend son tour de réflexion) : on le compte gagné.
function finaleGagnable(mains, ouvreur) {
  const m0 = K.nouvelleManche([MOI, ADV], { [MOI]: mains.moi, [ADV]: mains.adv }, ouvreur === 'moi' ? MOI : ADV);
  if (m0.katapss.includes(MOI)) return true;
  if (m0.katapss.includes(ADV)) return false;
  const memo = new Map();
  const gagne = (m) => {
    if (m.phase === 'terminee') return m.elimine !== MOI;
    const k = cle(m);
    if (memo.has(k)) return memo.get(k);
    memo.set(k, false); // garde-fou (une manche finit toujours : les cartes ne font que sortir ou changer de main)
    const j = m.joueurCourant;
    const actions = K.actionsPossibles(m, j).filter((a) => a.type !== 'katapss');
    let r = j === MOI ? actions.some((a) => gagne(K.jouer(copie(m), a))) : actions.every((a) => gagne(K.jouer(copie(m), a)));
    if (!actions.length) r = false;
    memo.set(k, r);
    return r;
  };
  return gagne(m0);
}

// La finale d'une étape de Kopo (s'il y en a une : 3 joueurs ou plus, la finale est la manche joueurs - 1).
// Renvoie { mains, ouvreurs } : les deux mains et qui peut ouvrir selon le robot qui a survécu.
function finaleDe(etape) {
  const J = Math.min(SK.MAX, Math.max(2, etape.joueurs));
  const ordre = ['moi'].concat([...Array(J - 1)].map((_, i) => 'robot-' + (i + 1)));
  const ouvreurs = new Set();
  let mains = null;
  for (const r of ordre.slice(1)) {
    const s = { donne: { graine: etape.graine >>> 0, ordre, dernier: (etape.pieges || []).includes('dernier') ? 'moi' : undefined }, restants: ['moi', r], numeroManche: J - 2 };
    const d = SK.placerDonne(s);
    mains = { moi: d.mains.moi, adv: d.mains[r] };
    ouvreurs.add(d.premier === 'moi' ? 'moi' : 'adv');
  }
  return { mains, ouvreurs: [...ouvreurs] };
}

// L'étape laisse-t-elle la finale gagnable, quel que soit le robot qui l'atteint ? (Inter (8) : la pioche change
// les mains, rien à vérifier ici.)
function finaleOk(etape) {
  if (etape.jeu !== 'kopo') return true;
  const f = finaleDe(etape);
  return f.ouvreurs.every((o) => finaleGagnable(f.mains, o));
}

module.exports = { finaleGagnable, finaleDe, finaleOk };
