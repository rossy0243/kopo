// Kopo — moteur de règles (règlement v1.2)
// Utilisable dans le navigateur (window.Kopo) et avec Node (require).
// Une carte est une chaîne "valeur+couleur" : "10P" = 10 de pique.
// Couleurs : P = pique, C = cœur, K = carreau, T = trèfle.
(function (root) {
  'use strict';

  const COULEURS = ['P', 'C', 'K', 'T'];
  const NOMS_COULEURS = { P: 'pique', C: 'cœur', K: 'carreau', T: 'trèfle' };
  const SYMBOLES = { P: '♠', C: '♥', K: '♦', T: '♣' };

  const valeur = (carte) => parseInt(carte, 10);
  const couleur = (carte) => carte.slice(-1);
  const afficher = (carte) => valeur(carte) + SYMBOLES[couleur(carte)];

  function nouveauPaquet() {
    const paquet = [];
    for (const c of COULEURS) for (let v = 2; v <= 10; v++) paquet.push(v + c);
    return paquet;
  }

  // Générateur pseudo-aléatoire reproductible (mulberry32), pour les tests.
  function hasard(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function melanger(liste, rng) {
    const l = liste.slice();
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  }

  const uneSeuleCouleur = (main) => main.length > 0 && main.every((c) => couleur(c) === couleur(main[0]));

  // ---------------------------------------------------------------------------
  // Manche
  // ---------------------------------------------------------------------------

  // sieges : joueurs dans le sens des aiguilles d'une montre.
  // mains  : { joueur: [cartes] }. premier : joueur qui ouvre la manche.
  function nouvelleManche(sieges, mains, premier) {
    const m = {
      sieges: sieges.slice(),
      enJeu: sieges.slice(),
      mains: {},
      katapss: [], // joueurs pouvant encore annoncer Katapss
      table: [], // { joueur, cartes, compte }
      couleurTour: null,
      couleurInterdite: null,
      phase: 'ouverture', // 'ouverture' | 'suite' | 'terminee'
      joueurCourant: premier,
      meneur: premier,
      attente: [], // joueurs qui doivent encore suivre dans la séquence
      qualifies: [], // { joueur, raison }
      elimine: null,
      journal: [],
      // Ce que toute la table a vu : cartes sorties du jeu, et cartes ramassées (on sait qui les a).
      vu: { sorties: [], ramassees: {} },
    };
    for (const j of sieges) {
      m.mains[j] = mains[j].slice();
      if (m.mains[j].length === 4 && uneSeuleCouleur(m.mains[j])) m.katapss.push(j);
    }
    noter(m, `Début de la manche : ${sieges.length} joueurs, ${premier} ouvre.`);
    return m;
  }

  function noter(m, texte) {
    m.journal.push(texte);
  }

  function suivant(m, joueur) {
    const i = m.sieges.indexOf(joueur);
    for (let k = 1; k <= m.sieges.length; k++) {
      const j = m.sieges[(i + k) % m.sieges.length];
      if (m.enJeu.includes(j)) return j;
    }
    return null;
  }

  function aAgi(m, joueur) {
    m.katapss = m.katapss.filter((j) => j !== joueur);
  }

  // Retire un joueur qualifié. Renvoie true si la manche est terminée.
  function sortir(m, joueur, raison) {
    m.enJeu = m.enJeu.filter((j) => j !== joueur);
    m.attente = m.attente.filter((j) => j !== joueur);
    m.katapss = m.katapss.filter((j) => j !== joueur);
    m.qualifies.push({ joueur, raison });
    noter(m, `${joueur} se qualifie (${raison}).`);
    if (m.enJeu.length === 1) {
      m.elimine = m.enJeu[0];
      m.phase = 'terminee';
      m.joueurCourant = null;
      noter(m, `${m.elimine} reste seul en jeu : élimination.`);
      return true;
    }
    return false;
  }

  function nouvelleOuverture(m, meneur, interdite) {
    m.table = [];
    m.couleurTour = null;
    m.couleurInterdite = interdite;
    m.phase = 'ouverture';
    m.meneur = meneur;
    m.joueurCourant = meneur;
    m.attente = [];
    noter(m, `${meneur} ouvre la séquence suivante` + (interdite ? ` (interdit : ${NOMS_COULEURS[interdite]}).` : '.'));
  }

  function plusForte(m) {
    let meilleure = null;
    for (const pose of m.table) {
      if (!pose.compte) continue;
      for (const c of pose.cartes) {
        if (!meilleure || valeur(c) > valeur(meilleure.carte)) meilleure = { carte: c, joueur: pose.joueur };
      }
    }
    return meilleure;
  }

  function passerAuSuivant(m) {
    if (m.attente.length > 0) {
      m.joueurCourant = m.attente[0];
      return;
    }
    // Tout le monde a suivi : la plus forte carte qui compte donne la main.
    const forte = plusForte(m);
    noter(m, `Tout le monde a suivi. ${afficher(forte.carte)} est la plus forte : ${forte.joueur} reprend la main.`);
    nouvelleOuverture(m, forte.joueur, m.couleurTour);
  }

  // Mémoire publique de la manche : uniquement ce qu'un joueur attentif a pu voir.
  function memoriser(m, action) {
    if (!m.vu) m.vu = { sorties: [], ramassees: {} };
    const v = m.vu, j = action.joueur;
    const oublier = (c) => { if (v.ramassees[j]) v.ramassees[j] = v.ramassees[j].filter((x) => x !== c); };
    const sortir = (c) => { oublier(c); if (!v.sorties.includes(c)) v.sorties.push(c); };
    if (action.type === 'katapss' || action.type === 'toutPoser') m.mains[j].forEach(sortir);
    else if (action.type === 'jouer') sortir(action.carte);
    else if (action.type === 'ramasser') {
      const forte = plusForte(m);
      for (const p of m.table) for (const c of p.cartes) if (c !== forte.carte && !v.sorties.includes(c)) v.sorties.push(c);
      v.sorties = v.sorties.filter((c) => c !== forte.carte);
      (v.ramassees[j] = v.ramassees[j] || []).push(forte.carte);
    }
  }

  // Ce qu'un joueur a le droit de connaître : sa main, la table, le nombre de cartes de chacun,
  // et ce qui a été montré pendant la manche. Jamais les mains des autres.
  function vuePublique(m, joueur) {
    const vu = m.vu || { sorties: [], ramassees: {} };
    const ramassees = {};
    for (const [k, l] of Object.entries(vu.ramassees)) if (k !== joueur && m.enJeu.includes(k) && l.length) ramassees[k] = l.slice();
    return {
      moi: joueur,
      main: (m.mains[joueur] || []).slice(),
      nbCartes: Object.fromEntries(m.sieges.map((k) => [k, m.mains[k].length])),
      sieges: m.sieges.slice(),
      enJeu: m.enJeu.slice(),
      table: m.table.map((p) => ({ joueur: p.joueur, cartes: p.cartes.slice(), compte: p.compte })),
      couleurTour: m.couleurTour,
      couleurInterdite: m.couleurInterdite,
      phase: m.phase,
      joueurCourant: m.joueurCourant,
      meneur: m.meneur,
      attente: m.attente.slice(),
      sorties: vu.sorties.slice(),
      ramassees,
    };
  }

  // Actions possibles pour un joueur, dans l'état actuel.
  function actionsPossibles(m, joueur) {
    const actions = [];
    if (m.phase === 'terminee' || !m.enJeu.includes(joueur)) return actions;
    if (m.katapss.includes(joueur)) actions.push({ type: 'katapss', joueur });
    if (joueur !== m.joueurCourant) return actions;
    const main = m.mains[joueur];

    if (m.phase === 'ouverture') {
      if (uneSeuleCouleur(main)) actions.push({ type: 'toutPoser', joueur });
      if (main.length > 1) {
        for (const c of main) if (couleur(c) !== m.couleurInterdite) actions.push({ type: 'jouer', joueur, carte: c });
      }
    } else {
      const couleurOk = main.filter((c) => couleur(c) === m.couleurTour);
      if (couleurOk.length === main.length) actions.push({ type: 'toutPoser', joueur });
      if (main.length > 1) for (const c of couleurOk) actions.push({ type: 'jouer', joueur, carte: c });
      actions.push({ type: 'ramasser', joueur });
    }
    return actions;
  }

  function memeAction(a, b) {
    return a.type === b.type && a.joueur === b.joueur && (a.carte || null) === (b.carte || null);
  }

  function jouer(m, action) {
    const permises = actionsPossibles(m, action.joueur);
    if (!permises.some((a) => memeAction(a, action))) {
      throw new Error(`Action interdite : ${JSON.stringify(action)}`);
    }
    const j = action.joueur;
    const main = m.mains[j];
    memoriser(m, action);

    if (action.type === 'katapss') {
      noter(m, `${j} annonce KATAPSS ! (${main.map(afficher).join(' ')})`);
      const etaitCourant = j === m.joueurCourant;
      const phase = m.phase;
      m.mains[j] = [];
      if (sortir(m, j, 'Katapss')) return m;
      if (etaitCourant) {
        if (phase === 'ouverture') nouvelleOuverture(m, suivant(m, j), m.couleurInterdite);
        else passerAuSuivant(m);
      } else if (m.phase === 'suite' && m.attente.length === 0) {
        passerAuSuivant(m);
      }
      return m;
    }

    aAgi(m, j);

    if (m.phase === 'ouverture') {
      if (action.type === 'toutPoser') {
        // Le joueur suivant ouvre librement : il peut même jouer la couleur de sortie.
        noter(m, `${j} ouvre en posant toutes ses cartes : ${main.map(afficher).join(' ')}.`);
        m.mains[j] = [];
        if (sortir(m, j, 'main vide en ouvrant')) return m;
        nouvelleOuverture(m, suivant(m, j), null);
        return m;
      }
      // jouer une carte
      m.mains[j] = main.filter((c) => c !== action.carte);
      m.table = [{ joueur: j, cartes: [action.carte], compte: true }];
      m.couleurTour = couleur(action.carte);
      m.phase = 'suite';
      m.attente = [];
      for (let k = suivant(m, j); k !== j; k = suivant(m, k)) m.attente.push(k);
      noter(m, `${j} ouvre avec ${afficher(action.carte)}.`);
      m.joueurCourant = m.attente[0];
      return m;
    }

    // Phase « suite »
    if (action.type === 'ramasser') {
      const forte = plusForte(m);
      m.mains[j].push(forte.carte);
      noter(m, `${j} ramasse ${afficher(forte.carte)}. La séquence s'arrête.`);
      nouvelleOuverture(m, forte.joueur, m.couleurTour);
      return m;
    }
    m.attente = m.attente.filter((k) => k !== j);
    if (action.type === 'toutPoser') {
      m.table.push({ joueur: j, cartes: main.slice(), compte: false });
      noter(m, `${j} pose toutes ses cartes : ${main.map(afficher).join(' ')} (elles ne comptent pas).`);
      m.mains[j] = [];
      if (sortir(m, j, 'main vide')) return m;
    } else {
      m.mains[j] = main.filter((c) => c !== action.carte);
      m.table.push({ joueur: j, cartes: [action.carte], compte: true });
      noter(m, `${j} joue ${afficher(action.carte)}.`);
    }
    passerAuSuivant(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Partie complète (manches successives)
  // ---------------------------------------------------------------------------

  // strategie(manche, joueur, actions) -> une action parmi « actions ».
  function jouerPartie(joueurs, strategie, rng) {
    let restants = joueurs.slice();
    const manches = [];
    while (restants.length > 1) {
      const sieges = melanger(restants, rng);
      const paquet = melanger(nouveauPaquet(), rng);
      const mains = {};
      sieges.forEach((j, i) => (mains[j] = paquet.slice(i * 4, i * 4 + 4)));
      const premier = sieges[Math.floor(rng() * sieges.length)];
      const m = nouvelleManche(sieges, mains, premier);
      let coups = 0;
      while (m.phase !== 'terminee') {
        if (++coups > 10000) throw new Error('Manche bloquée');
        // Annonces Katapss éventuelles, puis le joueur courant agit.
        const candidats = [...m.katapss, m.joueurCourant];
        let fait = false;
        for (const j of candidats) {
          const actions = actionsPossibles(m, j);
          const choix = strategie(m, j, actions);
          if (choix) {
            jouer(m, choix);
            fait = true;
            break;
          }
        }
        if (!fait) throw new Error(`Le joueur ${m.joueurCourant} n'a pas agi`);
      }
      manches.push(m);
      restants = restants.filter((j) => j !== m.elimine);
    }
    return { vainqueur: restants[0], manches };
  }

  // Stratégie simple : annonce Katapss tout de suite, pose tout dès que possible,
  // sinon joue la plus petite carte possible, sinon ramasse.
  function strategieSimple(m, joueur, actions) {
    const k = actions.find((a) => a.type === 'katapss');
    if (k) return k;
    if (joueur !== m.joueurCourant) return null;
    const tout = actions.find((a) => a.type === 'toutPoser');
    if (tout) return tout;
    const cartes = actions.filter((a) => a.type === 'jouer').sort((a, b) => valeur(a.carte) - valeur(b.carte));
    if (cartes.length) return cartes[0];
    return actions.find((a) => a.type === 'ramasser');
  }

  // Stratégie au hasard (utile pour vérifier que le moteur ne bloque jamais).
  function strategieHasard(rng) {
    return function (m, joueur, actions) {
      if (joueur !== m.joueurCourant) return rng() < 0.3 ? actions[0] : null;
      return actions[Math.floor(rng() * actions.length)];
    };
  }

  const Kopo = {
    COULEURS, NOMS_COULEURS, SYMBOLES,
    valeur, couleur, afficher, nouveauPaquet, hasard, melanger,
    nouvelleManche, actionsPossibles, jouer, jouerPartie, vuePublique,
    strategieSimple, strategieHasard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kopo;
  else root.Kopo = Kopo;
})(typeof window !== 'undefined' ? window : globalThis);
