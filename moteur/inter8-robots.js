// Inter (8) — robots (niveaux validés le 06/11/2026, voir robots-inter8.md)
// Chaque robot ne voit que ce qu'un joueur voit (Inter8.vuePublique) : sa main, la carte de
// référence, le nombre de cartes de chacun, les cartes déjà posées. Jamais les mains des autres.
// Même principe que les robots de Kopo : 3 niveaux, et une force qui monte avec le niveau du joueur.
(function (root) {
  'use strict';
  const I = typeof module !== 'undefined' && module.exports ? require('./inter8-moteur.js') : root.Inter8;

  const NIVEAUX_ROBOTS = ['faciles', 'normaux', 'forts'];
  // Force de 0 (gentil) à 2 (fort). Niveau 1 du joueur : bas de la plage ; niveau 20 et plus : haut.
  const PLAGES_FORCE = { faciles: [0, 0.7], normaux: [1, 1.5], forts: [1.6, 2] };
  function forceRobots(niveauRobots, niveauJoueur) {
    if (niveauRobots === 'gentils') return 0;
    const plage = PLAGES_FORCE[niveauRobots] || PLAGES_FORCE.normaux;
    const n = niveauJoueur > 1 ? niveauJoueur : 1;
    return plage[0] + (plage[1] - plage[0]) * Math.min(1, (n - 1) / 19);
  }

  const SPECIALES = new Set(['2', '10', 'X', 'A', '8']);
  const coups = (actions) => actions.filter((a) => a.type === 'jouer');
  const sort = (v, a) => a.cartes.length === v.main.length;
  const valeurDe = (a) => I.valeur(a.cartes[0]);

  // Joueur qui jouera après moi (dans le sens actuel).
  function prochain(v) {
    const n = v.sieges.length, i = v.sieges.indexOf(v.moi);
    for (let k = 1; k < n; k++) {
      const j = v.sieges[(((i + k * v.sens) % n) + n) % n];
      if (v.enJeu.includes(j) && j !== v.moi) return j;
    }
    return null;
  }
  // Joueur qui jouerait après moi si le sens changeait.
  function precedent(v) {
    return prochain({ ...v, sens: -v.sens });
  }
  // Le prochain joueur est dangereux : il a annoncé ou n'a presque plus de cartes.
  const menace = (v, j) => !!j && (v.annonces.includes(j) || v.contestable === j || v.nbCartes[j] <= 2);

  // Annonces et contestations (hors de son tour aussi).
  function horsTour(actions, annonce, conteste, rng) {
    const an = actions.find((a) => a.type === 'annoncer');
    if (an && rng() < annonce) return an;
    const co = actions.find((a) => a.type === 'contester');
    if (co && rng() < conteste) return co;
    return null;
  }

  // Robot gentil (première partie guidée, et robots faciles) : il pose une carte au hasard,
  // lâche ses pénalités sans viser, oublie parfois d'annoncer et ne conteste presque jamais.
  function robotGentil(v, actions, rng) {
    const h = horsTour(actions, 0.5, 0.1, rng);
    if (h) return h;
    if (v.moi !== v.joueurCourant) return null;
    const c = coups(actions);
    if (c.length) {
      if (v.aPioche && rng() < 0.3) return actions.find((a) => a.type === 'passer');
      const seules = c.filter((a) => a.cartes.length === 1);
      const liste = seules.length && rng() < 0.8 ? seules : c;
      return liste[Math.floor(rng() * liste.length)];
    }
    return actions.find((a) => a.type === 'piocher') || actions.find((a) => a.type === 'passer') || null;
  }

  // Robot normal : annonce toujours, conteste quand il le voit, sort dès qu'il peut, pose ensemble
  // ses cartes de même valeur, garde ses pénalités pour le joueur qui va sortir,
  // et demande avec le 8 la valeur qu'il a en plus grand nombre.
  function robotNormal(v, actions) {
    const h = horsTour(actions, 1, 1, () => 0);
    if (h) return h;
    if (v.moi !== v.joueurCourant) return null;
    const c = coups(actions);
    if (!c.length) return actions.find((a) => a.type === 'piocher') || actions.find((a) => a.type === 'passer') || null;
    const sortie = c.find((a) => sort(v, a));
    if (sortie) return sortie;
    const danger = menace(v, prochain(v));
    const nb = (val) => v.main.filter((x) => I.valeur(x) === val).length;
    let choix = null, meilleur = -Infinity;
    for (const a of c) {
      const val = valeurDe(a);
      let score = a.cartes.length * 10;
      if (SPECIALES.has(val)) score += danger && val !== '8' ? 40 : -30;
      if (val === '8') score += (a.demande ? nb(a.demande) : 0) * 3 - 10;
      if (!SPECIALES.has(val) && a.cartes.length === nb(val)) score += 5; // vide toute la valeur
      if (score > meilleur) { meilleur = score; choix = a; }
    }
    return choix;
  }

  // Robot fort : il compte les cartes déjà posées, demande avec le 8 une valeur que les autres
  // n'ont probablement plus, vise le joueur qui va sortir, prépare sa sortie et conteste toujours.
  // En mode délire, il se sert du J retour pour éloigner le tour d'un joueur qui va sortir.
  function robotFort(v, actions) {
    const h = horsTour(actions, 1, 1, () => 0);
    if (h) return h;
    if (v.moi !== v.joueurCourant) return null;
    const c = coups(actions);
    if (!c.length) return actions.find((a) => a.type === 'piocher') || actions.find((a) => a.type === 'passer') || null;
    const sortie = c.find((a) => sort(v, a));
    if (sortie) return sortie;

    // Cartes que je ne connais pas : chez les autres ou dans la pioche.
    const connues = {};
    for (const x of v.main.concat(v.posees)) connues[x] = true;
    const inconnues = I.nouveauPaquet(v.paquets || 1).filter((x) => !connues[x]);
    const restantes = (val) => inconnues.filter((x) => I.valeur(x) === val).length;
    const manquees = (val) => v.piochesDemande.filter((p) => p.valeur === val).length;
    const nb = (val) => v.main.filter((x) => I.valeur(x) === val).length;

    const suivantJ = prochain(v);
    const danger = menace(v, suivantJ);
    const dangerDerriere = menace(v, precedent(v));
    let choix = null, meilleur = -Infinity;
    for (const a of c) {
      const val = valeurDe(a);
      const reste = v.main.slice();
      a.cartes.forEach((x) => reste.splice(reste.indexOf(x), 1));
      let score = a.cartes.length * 8;
      // Préparer la sortie : une main qui pourra partir en un seul coup.
      if (I.finissable(reste)) score += 60;
      if (val === '2' || val === '10' || val === 'X' || val === 'A') {
        score += danger ? 70 + a.cartes.length * 10 : 20; // une carte de moins, et le suivant pioche ou passe
        if (val === 'X' && reste.length > 2) score -= 15; // garde un joker en sécurité
      } else if (val === '8') {
        // Le 8 se garde pour ne jamais devoir piocher. Quand il part, il demande une valeur
        // rare chez les autres, que d'autres ont déjà manquée.
        score += -40 + manquees(a.demande) * 12 - restantes(a.demande) * 6 + nb(a.demande) * 4;
      } else if (val === 'V' && v.mode === 'delire' && v.enJeu.length > 2) {
        score += danger && !dangerDerriere && a.cartes.length % 2 === 1 ? 60 : 0;
      } else {
        // Carte ordinaire : se débarrasser des valeurs que les autres peuvent encore suivre le moins.
        score += 4 - restantes(val) * 0.5;
        if (a.cartes.length === nb(val)) score += 4;
        // Laisser au suivant une couleur qu'il a peu de chances de suivre.
        const fin = a.cartes[a.cartes.length - 1];
        score -= inconnues.filter((x) => I.couleur(x) === I.couleur(fin)).length * 1;
      }
      if (score > meilleur) { meilleur = score; choix = a; }
    }
    return choix;
  }

  // À chaque coup, le robot joue comme le niveau du dessous ou du dessus de sa force :
  // force 1,3 = coup normal 7 fois sur 10, coup fort 3 fois sur 10.
  function choixRobot(m, j, niveauRobots, niveauJoueur, rng) {
    const v = I.vuePublique(m, j);
    const actions = I.actionsPossibles(m, j);
    const f = forceRobots(niveauRobots, niveauJoueur);
    const cerveau = f < 1 ? (rng() < f ? robotNormal : robotGentil) : (rng() < f - 1 ? robotFort : robotNormal);
    return cerveau(v, actions, rng);
  }

  // Coup joué automatiquement quand le temps est écoulé (ou le joueur hors ligne) :
  // il pioche, ou passe après avoir pioché, sinon pose le coup le plus simple.
  function coupAutomatique(m, joueur) {
    if (joueur !== m.joueurCourant) return null;
    const actions = I.actionsPossibles(m, joueur);
    return actions.find((a) => a.type === 'piocher') || actions.find((a) => a.type === 'passer') || coups(actions)[0] || null;
  }

  const Inter8Robots = { NIVEAUX_ROBOTS, PLAGES_FORCE, forceRobots, robotGentil, robotNormal, robotFort, choixRobot, coupAutomatique };
  if (typeof module !== 'undefined' && module.exports) module.exports = Inter8Robots;
  else root.Inter8Robots = Inter8Robots;
})(typeof window !== 'undefined' ? window : globalThis);
