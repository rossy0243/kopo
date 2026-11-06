// Inter (8) — moteur de règles (règlement v1.0 du 06/11/2026)
// Utilisable dans le navigateur (window.Inter8) et avec Node (require).
// Indépendant du moteur de Kopo : aucun fichier de Kopo n'est touché.
//
// Une carte est une chaîne "valeur+couleur" : "7C" = 7 de cœur, "AP" = as de pique,
// "VK" = valet de carreau, "DT" = dame de trèfle, "RC" = roi de cœur.
// Couleurs : P = pique, C = cœur, K = carreau, T = trèfle.
// Jokers : "XR" (rouge) et "XN" (noir).
// Avec deux paquets, les cartes du second paquet finissent par "*" : "7C*", "XR*".
(function (root) {
  'use strict';

  const COULEURS = ['P', 'C', 'K', 'T'];
  const NOMS_COULEURS = { P: 'pique', C: 'cœur', K: 'carreau', T: 'trèfle' };
  const SYMBOLES = { P: '♠', C: '♥', K: '♦', T: '♣' };
  const VALEURS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  const JOKER = 'X';
  // Cartes de pénalité : nombre de cartes que le joueur suivant pioche, par carte posée.
  const PENALITES = { 2: 2, 10: 4, X: 5 };
  const MAX_JOUEURS = 8;

  const brut = (carte) => carte.replace('*', '');
  const valeur = (carte) => (brut(carte)[0] === JOKER ? JOKER : brut(carte).slice(0, -1));
  const couleur = (carte) => (valeur(carte) === JOKER ? null : brut(carte).slice(-1));
  const NOMS_VALEURS = { A: 'A', V: 'J', D: 'Q', R: 'K' }; // à l'écran : J (valet), Q (dame), K (roi), comme sur les cartes
  function afficher(carte) {
    if (valeur(carte) === JOKER) return 'Joker';
    return (NOMS_VALEURS[valeur(carte)] || valeur(carte)) + SYMBOLES[couleur(carte)];
  }

  // 1 paquet de 54 cartes de 2 à 4 joueurs, 2 paquets (108 cartes) de 5 à 8 joueurs.
  const nombrePaquets = (nbJoueurs) => (nbJoueurs >= 5 ? 2 : 1);

  function nouveauPaquet(nbPaquets) {
    const paquet = [];
    for (let p = 0; p < (nbPaquets || 1); p++) {
      const suffixe = p === 0 ? '' : '*';
      for (const c of COULEURS) for (const v of VALEURS) paquet.push(v + c + suffixe);
      paquet.push('XR' + suffixe, 'XN' + suffixe);
    }
    return paquet;
  }

  // Générateur pseudo-aléatoire reproductible (mulberry32), comme pour Kopo.
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

  // La main peut partir en un seul coup : une carte, ou des cartes toutes de même valeur.
  const finissable = (main) => main.length > 0 && main.every((c) => valeur(c) === valeur(main[0]));

  // ---------------------------------------------------------------------------
  // Manche
  // ---------------------------------------------------------------------------

  // Distribue 4 cartes à chacun. Renvoie { mains, pioche } (la pioche se tire par la fin).
  function distribuer(sieges, nbPaquets, rng) {
    const paquet = melanger(nouveauPaquet(nbPaquets), rng);
    const mains = {};
    sieges.forEach((j) => (mains[j] = paquet.splice(paquet.length - 4, 4)));
    return { mains, pioche: paquet };
  }

  // sieges : joueurs dans le sens des aiguilles d'une montre. mains : { joueur: [cartes] }.
  // pioche : cartes restantes (on tire par la fin). premier : joueur qui commence.
  // options : { mode: 'simple' | 'delire', graine } (la graine sert à remélanger la défausse).
  function nouvelleManche(sieges, mains, pioche, premier, options) {
    const o = options || {};
    const m = {
      sieges: sieges.slice(),
      enJeu: sieges.slice(),
      mains: {},
      pioche: pioche.slice(),
      defausse: [], // la dernière carte est la carte de référence
      mode: o.mode === 'delire' ? 'delire' : 'simple',
      sens: 1, // 1 = aiguilles d'une montre, -1 = sens inverse (J retour, mode délire)
      libre: false, // le joueur courant pose la carte de son choix
      demande: null, // { valeur, par } : « Inter demande »
      joueurCourant: premier,
      aPioche: null, // carte piochée par le joueur courant pendant ce tour
      annonces: [], // joueurs qui ont annoncé
      contestables: [], // joueurs qui n'ont pas annoncé et peuvent être contestés
      qualifies: [],
      elimine: null,
      phase: 'jeu', // 'jeu' | 'terminee' | 'nulle'
      graine: (o.graine >>> 0) || 1,
      journal: [],
      // Ce que toute la table a vu : cartes posées, et qui a pioché pendant une demande.
      vu: { posees: [], piochesDemande: [] },
    };
    for (const j of sieges) m.mains[j] = mains[j].slice();
    // Carte de départ : jamais un 8 (on le remet sous la pioche et on prend la suivante).
    let depart = m.pioche.pop();
    for (let n = 0; valeur(depart) === '8' && n < 20; n++) {
      m.pioche.unshift(depart);
      depart = m.pioche.pop();
    }
    m.defausse.push(depart);
    m.vu.posees.push(depart);
    noter(m, `Début de la manche : ${sieges.length} joueurs, mode ${m.mode}. Carte de départ : ${afficher(depart)}. ${premier} commence.`);
    // Une carte de départ spéciale agit sur le premier joueur, comme si elle venait d'être jouée.
    effetsDepart(m, depart, premier);
    return m;
  }

  function noter(m, texte) {
    m.journal.push(texte);
  }

  // Joueurs encore en jeu, autres que « joueur », dans le sens du jeu en partant du suivant.
  // « joueur » peut ne plus être en jeu (il vient de sortir).
  function ordreDepuis(m, joueur) {
    const n = m.sieges.length;
    const i = m.sieges.indexOf(joueur);
    const ordre = [];
    for (let k = 1; k < n; k++) {
      const j = m.sieges[(((i + k * m.sens) % n) + n) % n];
      if (m.enJeu.includes(j) && j !== joueur) ordre.push(j);
    }
    return ordre;
  }
  const suivant = (m, joueur) => ordreDepuis(m, joueur)[0];

  function remelanger(m) {
    if (m.defausse.length <= 1) return false;
    const dessus = m.defausse.pop();
    const rng = hasard(m.graine);
    m.pioche = melanger(m.defausse, rng).concat(m.pioche);
    m.graine = Math.floor(rng() * 4294967296) >>> 0 || 1;
    m.defausse = [dessus];
    noter(m, 'La pioche est vide : on remélange la défausse.');
    return true;
  }

  // Pioche n cartes (moins s'il n'en reste pas assez). Piocher annule l'annonce.
  function piocherCartes(m, joueur, n) {
    const tirees = [];
    for (let k = 0; k < n; k++) {
      if (!m.pioche.length && !remelanger(m)) break;
      tirees.push(m.pioche.pop());
    }
    m.mains[joueur].push(...tirees);
    if (tirees.length) m.annonces = m.annonces.filter((j) => j !== joueur);
    return tirees;
  }

  function sortir(m, joueur) {
    m.enJeu = m.enJeu.filter((j) => j !== joueur);
    m.annonces = m.annonces.filter((j) => j !== joueur);
    m.qualifies.push(joueur);
    noter(m, `${joueur} pose sa dernière carte : qualifié !`);
    if (m.enJeu.length === 1) {
      m.elimine = m.enJeu[0];
      m.phase = 'terminee';
      m.joueurCourant = null;
      noter(m, `${m.elimine} est le dernier à garder des cartes : éliminé.`);
      return true;
    }
    return false;
  }

  // Joueurs qu'on peut contester : ils peuvent finir au prochain coup sans avoir annoncé.
  // (Une partie sauvegardée avant les listes avait un seul « contestable ».)
  function contestables(m) {
    const liste = m.contestables || (m.contestable ? [m.contestable] : []);
    return liste.filter((j) => m.enJeu.includes(j) && !m.annonces.includes(j) && finissable(m.mains[j]));
  }
  function majContestables(m) {
    m.contestables = contestables(m);
    delete m.contestable;
  }

  // Fin du tour de « joueur » : s'il peut finir au prochain coup sans avoir annoncé,
  // les autres peuvent le contester jusqu'à son prochain tour (même si d'autres ont joué entre-temps).
  function finDeTour(m, joueur, prochain) {
    m.aPioche = null;
    majContestables(m);
    if (m.enJeu.includes(joueur) && !m.annonces.includes(joueur) && finissable(m.mains[joueur]) && !m.contestables.includes(joueur)) m.contestables.push(joueur);
    m.joueurCourant = prochain;
  }

  // Le joueur « cible » pioche une pénalité et passe son tour. Renvoie le joueur d'après.
  function penaliser(m, cible, n) {
    const tirees = piocherCartes(m, cible, n);
    noter(m, `${cible} pioche ${tirees.length} carte${tirees.length > 1 ? 's' : ''} et passe son tour.`);
    return suivant(m, cible);
  }

  // As : chaque As fait passer le tour d'un joueur, en boucle, sans jamais sauter le poseur.
  function apresAs(m, poseur, n) {
    const autres = ordreDepuis(m, poseur);
    const cycle = m.enJeu.includes(poseur) ? autres.concat(poseur) : autres;
    const sautes = [];
    for (let k = 0; k < n; k++) sautes.push(autres[k % autres.length]);
    noter(m, `Tour${n > 1 ? 's' : ''} sauté${n > 1 ? 's' : ''} : ${sautes.join(', ')}.`);
    const dernier = sautes[sautes.length - 1];
    return cycle[(cycle.indexOf(dernier) + 1) % cycle.length];
  }

  function effetsDepart(m, carte, premier) {
    const v = valeur(carte);
    if (PENALITES[v]) {
      if (v === JOKER) m.libre = true;
      m.joueurCourant = penaliser(m, premier, PENALITES[v]);
    } else if (v === 'A') {
      // Le premier joueur passe son tour.
      noter(m, `Tour sauté : ${premier}.`);
      m.joueurCourant = suivant(m, premier);
    } else if (v === 'V' && m.mode === 'delire' && m.enJeu.length > 2) {
      m.sens = -m.sens;
      noter(m, 'J retour : le sens du jeu change.');
    }
  }

  // Valeurs qu'un joueur peut demander avec un 8 : toutes sauf le 8 (et pas le joker),
  // à condition d'en garder au moins une en main.
  function valeursDemandables(resteMain) {
    const vs = new Set(resteMain.map(valeur));
    return VALEURS.filter((v) => v !== '8' && vs.has(v));
  }

  // Vérifie un coup « jouer ». Renvoie null s'il est permis, sinon la raison.
  function refus(m, joueur, cartes, demande) {
    if (m.phase !== 'jeu') return 'La manche est finie.';
    if (joueur !== m.joueurCourant) return "Ce n'est pas ton tour.";
    if (!Array.isArray(cartes) || !cartes.length) return 'Aucune carte.';
    const reste = m.mains[joueur].slice();
    for (const c of cartes) {
      const i = reste.indexOf(c);
      if (i < 0) return "Tu n'as pas cette carte.";
      reste.splice(i, 1);
    }
    const v = valeur(cartes[0]);
    if (!cartes.every((c) => valeur(c) === v)) return 'Plusieurs cartes ensemble doivent avoir la même valeur.';
    if (m.aPioche && !cartes.includes(m.aPioche)) return 'Après avoir pioché, tu ne peux poser que la carte piochée.';
    if (v === '8') {
      if (cartes.length > 1 && reste.length) return 'Un seul 8 à la fois, sauf pour sortir avec tes derniers 8.';
      if (reste.length && !valeursDemandables(reste).includes(demande)) return 'Demande une valeur que tu as en main (pas le 8).';
    }
    if (m.demande) {
      if (joueur === m.demande.par) {
        if (v !== m.demande.valeur) return `Pose la valeur que tu as demandée (${m.demande.valeur}).`;
      } else if (m.aPioche) {
        if (v !== m.demande.valeur) return `Seule la valeur demandée (${m.demande.valeur}) peut être posée.`;
      } else if (v !== m.demande.valeur && v !== '8' && v !== JOKER) {
        return `Inter demande ${m.demande.valeur} : pose ce ${m.demande.valeur}, un 8 ou un joker, sinon pioche.`;
      }
      return changeCouleur(m, cartes);
    }
    if (v === '8' || v === JOKER || m.libre) return changeCouleur(m, cartes);
    const ref = m.defausse[m.defausse.length - 1];
    if (v === valeur(ref) || couleur(cartes[0]) === couleur(ref)) return changeCouleur(m, cartes);
    return 'Pose une carte de même couleur ou de même valeur.';
  }

  // Plusieurs cartes ensemble : la dernière doit changer la couleur du centre. Exceptions : les
  // doublons du 2e paquet de la couleur du centre (deux 5♦ sur du carreau), et les derniers 8
  // posés pour sortir (le suivant joue de toute façon la carte de son choix).
  function changeCouleur(m, cartes) {
    if (cartes.length < 2 || valeur(cartes[0]) === '8') return null;
    const coul = couleur(m.defausse[m.defausse.length - 1]);
    if (coul && couleur(cartes[cartes.length - 1]) === coul && !cartes.every((c) => couleur(c) === coul)) {
      return `Avec plusieurs cartes, la dernière doit changer la couleur (pas de ${NOMS_COULEURS[coul]} en dernier).`;
    }
    return null;
  }

  // Coups « jouer » proposés (pour les robots et pour savoir si le joueur peut jouer) :
  // chaque carte seule, et chaque groupe de cartes d'une même valeur.
  function coupsJouer(m, joueur) {
    const main = m.mains[joueur];
    const coups = [];
    const vus = new Set();
    const ajouter = (cartes) => {
      const reste = main.slice();
      cartes.forEach((c) => reste.splice(reste.indexOf(c), 1));
      const demandes = valeur(cartes[0]) === '8' && reste.length ? valeursDemandables(reste) : [undefined];
      for (const d of demandes) {
        const cle = cartes.join(',') + '|' + d;
        if (vus.has(cle) || refus(m, joueur, cartes, d)) continue;
        vus.add(cle);
        const a = { type: 'jouer', joueur, cartes: cartes.slice() };
        if (d) a.demande = d;
        coups.push(a);
      }
    };
    const groupes = {};
    for (const c of main) (groupes[valeur(c)] = groupes[valeur(c)] || []).push(c);
    for (const groupe of Object.values(groupes)) {
      // Chaque sous-ensemble de la valeur (on peut garder des cartes en main), avec chaque
      // première carte possible et chaque dernière (c'est elle qui donne la couleur).
      for (let masque = 1; masque < 1 << groupe.length; masque++) {
        const sous = groupe.filter((_, i) => masque & (1 << i));
        if (sous.length === 1) { ajouter(sous); continue; }
        for (const premiere of sous) {
          for (const derniere of sous) {
            if (derniere === premiere) continue;
            ajouter([premiere, ...sous.filter((c) => c !== premiere && c !== derniere), derniere]);
          }
        }
      }
    }
    return coups;
  }

  // Actions possibles pour un joueur, dans l'état actuel.
  function actionsPossibles(m, joueur) {
    const actions = [];
    if (m.phase !== 'jeu' || !m.enJeu.includes(joueur)) return actions;
    if (!m.annonces.includes(joueur) && finissable(m.mains[joueur])) actions.push({ type: 'annoncer', joueur });
    for (const c of contestables(m)) if (c !== joueur) actions.push({ type: 'contester', joueur, cible: c });
    if (joueur !== m.joueurCourant) return actions;
    const coups = coupsJouer(m, joueur);
    actions.push(...coups);
    if (m.aPioche) actions.push({ type: 'passer', joueur });
    else if (!coups.length) actions.push({ type: 'piocher', joueur });
    return actions;
  }

  function jouer(m, action) {
    const j = action.joueur;
    if (m.phase !== 'jeu' || !m.enJeu.includes(j)) throw new Error(`Action interdite : ${JSON.stringify(action)}`);

    if (action.type === 'annoncer') {
      if (m.annonces.includes(j) || !finissable(m.mains[j])) throw new Error(`Action interdite : ${JSON.stringify(action)}`);
      m.annonces.push(j);
      majContestables(m);
      noter(m, `${j} annonce : il peut sortir au prochain coup.`);
      return m;
    }
    if (action.type === 'contester') {
      const liste = contestables(m).filter((c) => c !== j);
      const cible = action.cible || liste[0];
      if (!cible || !liste.includes(cible)) throw new Error(`Action interdite : ${JSON.stringify(action)}`);
      piocherCartes(m, cible, 1);
      // Une seule amende par oubli, même s'il peut encore finir avec la carte piochée.
      m.contestables = contestables(m).filter((c) => c !== cible);
      delete m.contestable;
      noter(m, `${j} conteste : ${cible} n'avait pas annoncé et pioche 1 carte d'amende.`);
      return m;
    }

    if (j !== m.joueurCourant) throw new Error(`Action interdite : ${JSON.stringify(action)}`);
    // Son propre tour revient : on ne peut plus le contester pour l'oubli précédent.
    m.contestables = contestables(m).filter((c) => c !== j);
    delete m.contestable;

    if (action.type === 'piocher') {
      if (m.aPioche || coupsJouer(m, j).length) throw new Error(`Action interdite : ${JSON.stringify(action)}`);
      const tirees = piocherCartes(m, j, 1);
      if (!tirees.length) {
        m.phase = 'nulle';
        m.joueurCourant = null;
        noter(m, 'Plus de pioche ni de défausse : match nul, la manche est rejouée.');
        return m;
      }
      if (m.demande) m.vu.piochesDemande.push({ joueur: j, valeur: m.demande.valeur });
      m.aPioche = tirees[0];
      noter(m, `${j} pioche une carte.`);
      if (!coupsJouer(m, j).length) finDeTour(m, j, suivant(m, j));
      return m;
    }
    if (action.type === 'passer') {
      if (!m.aPioche) throw new Error(`Action interdite : ${JSON.stringify(action)}`);
      noter(m, `${j} garde sa carte et passe.`);
      finDeTour(m, j, suivant(m, j));
      return m;
    }
    if (action.type !== 'jouer') throw new Error(`Action inconnue : ${JSON.stringify(action)}`);

    const cartes = action.cartes;
    const pourquoi = refus(m, j, cartes, action.demande);
    if (pourquoi) throw new Error(pourquoi);
    const v = valeur(cartes[0]);
    for (const c of cartes) m.mains[j].splice(m.mains[j].indexOf(c), 1);
    m.defausse.push(...cartes);
    m.vu.posees.push(...cartes);
    m.vu.dernier = j; // qui a posé la carte du centre (affichage)
    m.libre = false;
    const finit = m.mains[j].length === 0;
    noter(m, `${j} pose ${cartes.map(afficher).join(' ')}${v === '8' && !finit ? ` : « Inter demande ${NOMS_VALEURS[action.demande] || action.demande} »` : ''}.`);

    // La demande en cours s'arrête dès que la valeur demandée est posée, ou qu'un joker la coupe.
    if (m.demande && (v === m.demande.valeur || v === JOKER)) m.demande = null;
    if (v === '8') {
      m.demande = finit ? null : { valeur: action.demande, par: j };
      if (finit) m.libre = true; // finir sur un 8 : le suivant pose la carte de son choix
    }
    if (v === JOKER) m.libre = true;

    if (finit && sortir(m, j)) return m;

    let prochain;
    if (PENALITES[v]) {
      const total = PENALITES[v] * cartes.length;
      prochain = penaliser(m, suivant(m, j), total);
    } else if (v === 'A') {
      prochain = apresAs(m, j, cartes.length);
    } else {
      if (v === 'V' && m.mode === 'delire' && m.enJeu.length > 2 && cartes.length % 2 === 1) {
        m.sens = -m.sens;
        noter(m, 'J retour : le sens du jeu change.');
      }
      prochain = suivant(m, j);
    }
    finDeTour(m, j, prochain);
    return m;
  }

  // Ce qu'un joueur a le droit de connaître. Jamais les mains des autres.
  function vuePublique(m, joueur) {
    return {
      moi: joueur,
      main: (m.mains[joueur] || []).slice(),
      nbCartes: Object.fromEntries(m.sieges.map((k) => [k, m.mains[k].length])),
      sieges: m.sieges.slice(),
      enJeu: m.enJeu.slice(),
      reference: m.defausse[m.defausse.length - 1] || null,
      libre: m.libre,
      demande: m.demande ? { ...m.demande } : null,
      sens: m.sens,
      mode: m.mode,
      paquets: Math.round((m.pioche.length + m.defausse.length + Object.values(m.mains).reduce((t, l) => t + l.length, 0)) / 54),
      pioche: m.pioche.length,
      joueurCourant: m.joueurCourant,
      aPioche: m.joueurCourant === joueur ? m.aPioche : null,
      annonces: m.annonces.slice(),
      contestables: contestables(m),
      qualifies: m.qualifies.slice(),
      phase: m.phase,
      posees: m.vu.posees.slice(),
      dernier: m.vu.dernier || null,
      piochesDemande: m.vu.piochesDemande.map((p) => ({ ...p })),
    };
  }

  // ---------------------------------------------------------------------------
  // Partie complète (manches successives)
  // ---------------------------------------------------------------------------

  // strategie(manche, joueur, actions) -> une action parmi « actions », ou null.
  // options : { mode: 'simple' | 'delire' }. Le nombre de paquets est fixé au début de la partie.
  function jouerPartie(joueurs, strategie, rng, options) {
    const mode = (options && options.mode) || 'simple';
    const nbPaquets = nombrePaquets(joueurs.length);
    let restants = joueurs.slice();
    const manches = [];
    let nulles = 0;
    while (restants.length > 1) {
      const sieges = melanger(restants, rng);
      const { mains, pioche } = distribuer(sieges, nbPaquets, rng);
      const premier = sieges[Math.floor(rng() * sieges.length)];
      const m = nouvelleManche(sieges, mains, pioche, premier, { mode, graine: Math.floor(rng() * 4294967296) });
      let coups = 0;
      while (m.phase === 'jeu') {
        if (++coups > 20000) throw new Error('Manche bloquée');
        // Annonces et contestations éventuelles, puis le joueur courant agit.
        const candidats = m.enJeu.filter((j) => j !== m.joueurCourant).concat(m.joueurCourant);
        let fait = false;
        for (const j of candidats) {
          const choix = strategie(m, j, actionsPossibles(m, j));
          if (choix) {
            jouer(m, choix);
            fait = true;
            break;
          }
        }
        if (!fait) throw new Error(`Le joueur ${m.joueurCourant} n'a pas agi`);
      }
      manches.push(m);
      if (m.phase === 'nulle') {
        if (++nulles > 50) throw new Error('Trop de manches nulles');
        continue;
      }
      restants = restants.filter((j) => j !== m.elimine);
    }
    return { vainqueur: restants[0], manches };
  }

  // Stratégie simple : annonce et conteste toujours, sort dès que possible,
  // sinon pose le plus de cartes possible, sinon pioche, sinon passe.
  function strategieSimple(m, joueur, actions) {
    const autre = actions.find((a) => a.type === 'annoncer' || a.type === 'contester');
    if (autre) return autre;
    if (joueur !== m.joueurCourant) return null;
    const coups = actions.filter((a) => a.type === 'jouer');
    if (coups.length) return coups.reduce((a, b) => (b.cartes.length > a.cartes.length ? b : a));
    return actions.find((a) => a.type === 'piocher') || actions.find((a) => a.type === 'passer');
  }

  // Stratégie au hasard (utile pour vérifier que le moteur ne bloque jamais).
  function strategieHasard(rng) {
    return function (m, joueur, actions) {
      if (joueur !== m.joueurCourant) return actions.length && rng() < 0.3 ? actions[Math.floor(rng() * actions.length)] : null;
      return actions[Math.floor(rng() * actions.length)];
    };
  }

  const Inter8 = {
    COULEURS, NOMS_COULEURS, SYMBOLES, VALEURS, PENALITES, MAX_JOUEURS,
    valeur, couleur, afficher, finissable, nombrePaquets, nouveauPaquet, hasard, melanger, distribuer,
    nouvelleManche, actionsPossibles, refus, jouer, jouerPartie, vuePublique,
    strategieSimple, strategieHasard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Inter8;
  else root.Inter8 = Inter8;
})(typeof window !== 'undefined' ? window : globalThis);
