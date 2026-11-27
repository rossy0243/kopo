// Le Fleuve (fleuve.md) : les objectifs d'une étape, leur suivi pendant la partie et le score des étoiles.
// Le même suivi sert à la vraie partie (salle « fleuve ») et aux parties d'essai jouées par les robots
// (fleuve-generateur.js) : c'est ce qui rend les seuils d'étoiles justes.
'use strict';

// Objectifs connus. jeux : où ils existent. des : bief à partir duquel la recette peut les tirer (réglable dans
// l'admin). famille : deux objectifs de suite ne sont jamais de la même famille. limite(o) : nombre de manches
// jouées au plus (au-delà, l'étape s'arrête : une étape dure 2 à 4 minutes) ; Infinity = jusqu'au bout.
const OBJECTIFS = {
  manches: { famille: 'survivre', jeux: ['kopo', 'inter8'], des: 1, limite: (o) => o.n },
  finale: { famille: 'survivre', jeux: ['kopo', 'inter8'], des: 1, limite: () => Infinity },
  gagner: { famille: 'gagner', jeux: ['kopo', 'inter8'], des: 1, limite: () => Infinity },
  premier: { famille: 'sortir', jeux: ['kopo', 'inter8'], des: 1, limite: (o) => o.m },
  top: { famille: 'sortir', jeux: ['inter8'], des: 1, limite: () => Infinity },
  ramasser: { famille: 'propre', jeux: ['kopo'], des: 2, limite: (o) => o.m },
  attaque: { famille: 'attaquer', jeux: ['inter8'], des: 2, limite: (o) => o.m },
  pioche: { famille: 'proteger', jeux: ['inter8'], des: 2, limite: (o) => o.m },
  katapss: { famille: 'annonce', jeux: ['kopo'], des: 5, limite: (o) => o.m },
};

const pl = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
// Phrase affichée avant de jouer (« Qualifie-toi pour 3 manches »).
function texteObjectif(o) {
  if (!o) return '';
  const dans = o.m > 1 ? ` (en ${pl(o.m, 'manche')} au plus)` : o.m === 1 ? ' (dans la 1re manche)' : '';
  switch (o.type) {
    case 'manches': return o.n === 1 ? 'Qualifie-toi pour la manche suivante' : `Qualifie-toi pour ${pl(o.n, 'manche')}`;
    case 'finale': return 'Atteins la finale';
    case 'gagner': return 'Gagne la partie';
    case 'premier': return 'Sors le premier d\'une manche' + dans;
    case 'top': return `Finis parmi les ${o.n} premiers`;
    case 'ramasser': return o.n === 0 ? `Passe ${pl(o.m, 'manche')} sans jamais ramasser` : `Passe ${pl(o.m, 'manche')} en ramassant ${o.n} fois au plus`;
    case 'attaque': return `Fais piocher ${pl(o.n, 'carte')} aux autres` + dans;
    case 'pioche': return o.n === 0 ? `Passe ${pl(o.m, 'manche')} sans piocher une seule carte` : `Passe ${pl(o.m, 'manche')} en piochant ${pl(o.n, 'carte')} au plus`;
    case 'katapss': return 'Fais un Katapss' + dans;
    default: return '';
  }
}

// Score des 2e et 3e étoiles, le même pour toutes les étapes d'un jeu (fleuve.md, « Les étoiles ») :
// à chaque manche, quand tu sors : 1 point par adversaire encore en jeu ; +10 si tu gagnes la partie.
// Inter (8) : en plus, 1 point toutes les 2 cartes que tu fais piocher aux autres.
const POINTS_VICTOIRE = 10;

// Suivi d'un joueur pendant une étape. moi : son identifiant ; etape : { jeu, objectif }.
// La salle appelle surAction (à chaque coup, depuis kopo-salle.js / inter8-salle.js) et observer (après chaque
// changement). Quand fini() devient vrai, resultat() donne { reussi, score, ... }.
function creerSuivi(moi, etape) {
  const jeu = etape.jeu, o = etape.objectif || { type: 'gagner' };
  const def = OBJECTIFS[o.type] || OBJECTIFS.gagner;
  const limite = def.limite(o);
  const manches = new Map(); // objet manche -> { joueurs, rang (0 = sorti premier), tours, ramasse, katapss, piochees, faitPiocher, nulle }
  let elimine = false, gagne = false, fin = false, place = null, totalJoueurs = null, restants = null;
  const entree = (m) => {
    let e = manches.get(m);
    if (!e) { e = { joueurs: m.sieges.length, rang: null, tours: 0, ramasse: 0, katapss: 0, piochees: 0, faitPiocher: 0, nulle: false }; manches.set(m, e); }
    return e;
  };
  const rangDans = (m) => {
    const i = (m.qualifies || []).findIndex((q) => (q && typeof q === 'object' ? q.joueur : q) === moi);
    return i >= 0 ? i : null;
  };
  const passees = () => [...manches.values()].filter((e) => e.rang !== null && !e.nulle).length;

  const suivi = {
    // tailles : nombre de cartes de chacun avant le coup ; courant : joueur dont c'était le tour avant le coup.
    surAction(s, m, action, tailles, courant) {
      if (fin || !m || !m.mains) return;
      const e = entree(m);
      const apres = (j) => (m.mains[j] || []).length;
      if (tailles) {
        const d = apres(moi) - (tailles[moi] || 0);
        if (d > 0 && jeu === 'inter8') e.piochees += d; // au Kopo, ramasser se compte à part
        if (action.joueur === moi && (action.type === 'jouer' || action.type === 'contester')) {
          for (const j of Object.keys(tailles)) if (j !== moi) e.faitPiocher += Math.max(0, apres(j) - tailles[j]);
        }
      }
      if (action.joueur !== moi) return;
      if (action.type === 'ramasser') e.ramasse++;
      if (action.type === 'katapss') e.katapss++;
      // Un tour joué : c'était à moi, et la main passe (ou je suis sorti).
      if (courant === moi && (m.joueurCourant !== moi || !m.enJeu.includes(moi)) && action.type !== 'katapss') e.tours++;
    },
    observer(s) {
      if (fin) return;
      if (totalJoueurs === null && s.joueurs) totalJoueurs = s.joueurs.length;
      if (s.restants) restants = s.restants.length;
      const m = s.manche;
      if (m && m.sieges && m.sieges.includes(moi)) {
        const e = entree(m);
        if (e.rang === null) e.rang = rangDans(m);
        if (m.phase === 'nulle') { e.nulle = true; e.rang = null; }
      }
      // Les manches précédentes (une nulle est rejouée : ses sorties ne comptent pas).
      for (const [mm, e] of manches) if (mm !== m && e.rang === null && !e.nulle && mm.phase !== 'nulle') e.rang = rangDans(mm);
      elimine = (s.elimines || []).includes(moi);
      gagne = s.etat === 'finPartie' && s.vainqueur === moi;
      // Sorti le premier du duel final : la partie est gagnée, même si la salle ne l'a pas encore close. Un vrai
      // joueur sort pendant son coup, et l'étape peut s'arrêter là (limite de manches atteinte) avant la fin de partie.
      if (!gagne && [...manches.values()].some((e) => e.joueurs === 2 && e.rang === 0 && !e.nulle)) gagne = true;
      if (elimine) place = (totalJoueurs || s.joueurs.length) - s.elimines.indexOf(moi);
      if (gagne) place = 1;
      if (elimine || gagne || s.etat === 'finPartie' || passees() >= limite) fin = true;
    },
    fini: () => fin,
    // Arrêt forcé (joueur parti, coupure) : ce qui est fait est fait, l'objectif est jugé maintenant.
    arreter() { fin = true; },
    resultat() {
      const l = [...manches.values()].filter((e) => !e.nulle || e.rang !== null);
      const somme = (k) => l.reduce((t, e) => t + e[k], 0);
      const n = passees();
      const faitPiocher = somme('faitPiocher'), piochees = somme('piochees'), ramasse = somme('ramasse');
      let score = 0;
      for (const e of l) if (e.rang !== null && !e.nulle) score += Math.max(0, e.joueurs - 1 - e.rang);
      if (gagne) score += POINTS_VICTOIRE;
      if (jeu === 'inter8') score += Math.floor(faitPiocher / 2);
      const premierSorti = l.some((e) => e.rang === 0 && !e.nulle);
      let reussi = false;
      switch (o.type) {
        case 'manches': reussi = n >= o.n; break;
        case 'finale': reussi = gagne || l.some((e) => e.joueurs === 2 && !e.nulle); break; // assis à la table de la finale (duel)
        case 'gagner': reussi = gagne; break;
        case 'premier': reussi = premierSorti; break;
        case 'top': reussi = place !== null && place <= o.n; break;
        case 'ramasser': reussi = n >= o.m && ramasse <= o.n; break;
        case 'attaque': reussi = faitPiocher >= o.n; break;
        case 'pioche': reussi = n >= o.m && piochees <= o.n; break;
        case 'katapss': reussi = somme('katapss') > 0; break;
        default: reussi = false;
      }
      return { reussi, score, manches: n, gagne, elimine, place, ramasse, piochees, faitPiocher, premierSorti, katapss: somme('katapss') };
    },
    // Où en est l'étape, pour la jauge en direct (fleuve.md, « Les étoiles en direct ») : score provisoire,
    // avancée de l'objectif (texte court et part de 0 à 1) et état : en_cours, danger (encore un faux pas et c'est
    // raté), ok (objectif atteint) ou rate (plus aucune étoile possible). Même calcul que le verdict de la fin.
    direct() {
      const r = suivi.resultat();
      const tot = totalJoueurs || 0, reste = restants === null ? tot : restants;
      let prog = '', val = 0, etat = r.reussi ? 'ok' : 'en_cours';
      const pl = (k, x) => Math.max(0, Math.min(1, k ? x / k : 0));
      switch (o.type) {
        case 'manches': prog = `${Math.min(r.manches, o.n)}/${o.n}`; val = pl(o.n, r.manches); break;
        case 'finale': case 'gagner': {
          const cible = o.type === 'finale' ? 2 : 1;
          prog = r.reussi ? '✓' : `${reste} en jeu`; val = pl(tot - cible, tot - reste); break;
        }
        case 'top': prog = `${reste} en jeu`; val = pl(tot - o.n, tot - reste); break;
        case 'premier': prog = r.premierSorti ? '✓' : `${Math.min(r.manches + 1, o.m)}/${o.m}`; val = r.premierSorti ? 1 : 0; break;
        case 'ramasser': prog = `ramassé ${r.ramasse}/${o.n}`; val = pl(o.m, r.manches);
          if (r.ramasse > o.n) etat = 'rate'; else if (!r.reussi && o.n > 0 && r.ramasse === o.n) etat = 'danger'; break;
        case 'pioche': prog = `pioché ${r.piochees}/${o.n}`; val = pl(o.m, r.manches);
          if (r.piochees > o.n) etat = 'rate'; else if (!r.reussi && o.n > 0 && r.piochees === o.n) etat = 'danger'; break;
        case 'attaque': prog = `${Math.min(r.faitPiocher, o.n)}/${o.n}`; val = pl(o.n, r.faitPiocher); break;
        case 'katapss': prog = r.katapss > 0 ? '✓' : `${Math.min(r.manches + 1, o.m || 1)}/${o.m || 1}`; val = r.katapss > 0 ? 1 : 0; break;
        default: break;
      }
      if (r.reussi) { val = 1; if (!/✓/.test(prog)) prog += ' ✓'; }
      else if (fin || r.elimine) etat = 'rate';
      return { score: r.score, prog, val: Math.round(val * 100) / 100, etat };
    },
  };
  return suivi;
}

// Étoiles : 0 si l'objectif est manqué ; sinon 1, +1 au seuil de la 2e, +1 au seuil de la 3e.
function etoilesDe(r, seuils) {
  if (!r || !r.reussi) return 0;
  const s = seuils || {};
  return 1 + (r.score >= (s.deux || Infinity) ? 1 : 0) + (r.score >= (s.trois || Infinity) ? 1 : 0);
}

module.exports = { OBJECTIFS, texteObjectif, creerSuivi, etoilesDe, POINTS_VICTOIRE };
