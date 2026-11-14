// Inter (8) — salle de jeu multijoueur (tourne sur le téléphone de l'hôte, ou sur le serveur).
// Même interface que la salle de Kopo (src/kopo-salle.js) : creerSalle, recevoir, tic, vue,
// exporter, importer… pour que l'appli et le serveur puissent brancher l'un ou l'autre jeu.
// L'hôte est la seule autorité : il applique le moteur de règles, puis envoie à chaque joueur
// une vue où seule SA main est visible. Indépendant du transport réseau.
(function (root) {
  'use strict';
  const enNode = typeof module !== 'undefined' && module.exports;
  const I = enNode ? require('../moteur/inter8-moteur.js') : root.Inter8;
  const R = enNode ? require('../moteur/inter8-robots.js') : root.Inter8Robots;

  const JEU = 'inter8';
  const MIN = 2, MAX = I.MAX_JOUEURS; // 8 joueurs au plus
  const MODES = ['simple', 'delire'];
  // Formule de la partie : 'normale' (le dernier à garder des cartes est éliminé à chaque manche)
  // ou 'cahier' (comptage des points : on écrit les points de chaque donne, celui qui atteint le
  // total choisi par l'hôte est éliminé, le dernier qui reste gagne). Décision du 14/11.
  const FORMULES = ['normale', 'cahier'];
  const TOTAUX_CAHIER = I.TOTAUX_CAHIER;
  const TOTAL_CAHIER = 500;
  const DELAIS = [0, 5, 10, 15, 20]; // secondes par tour (0 = sans chrono)
  const PAUSE_ROBOT = 1800; // un robot réfléchit 1,8 s avant de jouer : le temps de voir chaque coup
  const PAUSE_EVENTAIL = 1400; // en plus, après plusieurs cartes posées d'un coup (l'éventail se voit)
  const DUREES = { depart: 5000, mancheAuto: 10000, revanche: 15000 };
  const DELAI_ABSENT = 5;
  const DELAI_ANNONCE = 3000; // temps laissé pour annoncer avant qu'un robot ne conteste
  // Robots entre eux (plus aucun humain dans la manche) : tout va plus vite, on voit encore les coups.
  const RAPIDE = { pauseRobot: 400, eventail: 400, annonce: 1000, depart: 1500, mancheAuto: 3000 };
  const { NIVEAUX_ROBOTS, PLAGES_FORCE, forceRobots, coupAutomatique } = R;

  function hasardFort() {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (!c) return Math.random;
    const t = new Uint32Array(1);
    return () => (c.getRandomValues(t), t[0] / 4294967296);
  }

  function creerSalle(code, rng) {
    return {
      jeu: JEU,
      code,
      etat: 'salon', // 'salon' | 'manche' | 'finManche' | 'finPartie'
      mode: 'simple', // 'simple' (1 paquet) | 'delire' (2 paquets), choisi par l'hôte dans le salon
      jRetour: false, // option du mode délire : le valet change le sens du jeu
      formule: 'normale', // 'normale' | 'cahier' (salons privés et contre les robots)
      totalCahier: TOTAL_CAHIER, // mode Cahier : total qui élimine
      cahier: null, // mode Cahier en cours : { total, scores: { id: points }, donnes: [{ numero, sorti, points, mains, elimines }] }
      paquets: 1, // fixé au lancement selon le mode
      joueurs: [],
      hote: null,
      restants: [],
      elimines: [],
      numeroManche: 0,
      nulles: 0, // manches nulles rejouées (pioche et défausse vides)
      manche: null,
      vainqueur: null,
      delai: 10,
      echeance: null,
      robotPret: null,
      pause: null, // { type: 'depart', jusqua, total }
      durees: Object.assign({}, DUREES),
      expirations: {},
      chronoTotal: 0,
      suiteA: null,
      publique: false,
      taille: null,
      robots: 'normaux',
      niveauJoueur: 1,
      revanche: null,
      revancheRatee: false,
      dernierDuel: null,
      horloge: Date.now,
      rng: rng || hasardFort(),
    };
  }

  const estRobot = (s, id) => !!(s.joueurs.find((j) => j.id === id) || {}).robot;
  // Un robot qui remplace un joueur parti compte comme un humain : le joueur peut revenir.
  const vraiRobot = (s, id) => { const j = s.joueurs.find((x) => x.id === id); return !!j && j.robot && !j.remplace; };
  // Robots entre eux : les humains sont éliminés, sortis de la manche ou spectateurs.
  // En fin de manche, il faut aussi qu'aucun humain ne joue la manche suivante.
  function entreRobots(s) {
    if (s.etat === 'manche' && s.manche) return s.manche.phase === 'jeu' && s.manche.enJeu.every((id) => vraiRobot(s, id));
    if (s.etat === 'finManche') return s.restants.every((id) => vraiRobot(s, id));
    return false;
  }
  // Chaque robot ajouté peut avoir son propre niveau (j.niveau) ; sinon, celui de la table
  // (s.robots), par exemple pour un robot qui remplace un joueur parti. Robots gentils : tous gentils.
  function niveauDuRobot(s, j) {
    if (s.robots === 'gentils') return 'gentils';
    const r = s.joueurs.find((x) => x.id === j);
    return r && !r.remplace && NIVEAUX_ROBOTS.includes(r.niveau) ? r.niveau : s.robots;
  }
  const choixRobot = (s, j) => R.choixRobot(s.manche, j, niveauDuRobot(s, j), s.niveauJoueur, s.rng);

  function estAbsent(s, id) {
    const j = s.joueurs.find((x) => x.id === id);
    return !!j && !j.robot && (!j.connecte || (s.expirations[id] || 0) >= 2);
  }
  function delaiPour(s, id) {
    if (!estAbsent(s, id)) return s.delai;
    return s.delai ? Math.min(s.delai, DELAI_ABSENT) : DELAI_ABSENT;
  }
  function revenu(s, id) { s.expirations[id] = 0; }

  function armerChrono(s) {
    const m = s.manche;
    const enCours = s.etat === 'manche' && m && m.phase === 'jeu' && !s.pause;
    const d = enCours ? delaiPour(s, m.joueurCourant) : 0;
    s.echeance = d ? s.horloge() + d * 1000 : null;
    s.chronoTotal = d * 1000;
    const pause = s.pauseRobot >= 0 ? s.pauseRobot : entreRobots(s) ? RAPIDE.pauseRobot : PAUSE_ROBOT;
    s.robotPret = enCours ? s.horloge() + pause : null;
  }

  // Applique une action du moteur, puis fait suivre la salle (fin de manche, chrono).
  function appliquer(s, action) {
    const courantAvant = s.manche.joueurCourant;
    const contestablesAvant = (s.manche.contestables || []).slice();
    I.jouer(s.manche, action);
    finirMancheSiBesoin(s);
    // Annoncer ou contester ne change pas le joueur courant : on ne relance pas son chrono.
    if (s.manche && (s.manche.joueurCourant !== courantAvant || action.type === 'jouer' || action.type === 'piocher' || s.etat !== 'manche')) armerChrono(s);
    // Un joueur (humain) peut être contesté : on lui laisse le temps de toucher « J'annonce »
    // avant que les robots ne jouent ou ne contestent.
    const m = s.manche;
    // Plusieurs cartes posées d'un coup : elles sont d'abord montrées en éventail à toute la table.
    if (action.type === 'jouer' && action.cartes.length > 1 && s.robotPret && !(s.pauseRobot >= 0)) s.robotPret += entreRobots(s) ? RAPIDE.eventail : PAUSE_EVENTAIL;
    // Pendant ces 3 s, personne (humain ou robot) ne peut contester ; ensuite, tout le monde peut,
    // jusqu'au prochain tour du joueur (même si d'autres ont joué entre-temps). Les robots ont
    // droit aux mêmes 3 s que les humains (règle, section 9).
    const nouveaux = m ? (m.contestables || []).filter((j) => !contestablesAvant.includes(j)) : [];
    const garder = ([j]) => m && (m.contestables || []).includes(j);
    s.graces = Object.fromEntries(Object.entries(s.graces || {}).filter(garder));
    s.oublis = Object.fromEntries(Object.entries(s.oublis || {}).filter(garder));
    const annonce = entreRobots(s) ? RAPIDE.annonce : DELAI_ANNONCE;
    for (const j of nouveaux) s.graces[j] = s.horloge() + annonce;
    // Un robot annonce dans la foulée de son coup, sans attendre sa pause de réflexion.
    // Un robot facile peut oublier : il ne se rattrape pas, on pourra le contester après les 3 s.
    for (const j of nouveaux.filter((x) => estRobot(s, x))) {
      if (R.robotAnnonce(niveauDuRobot(s, j), s.niveauJoueur, s.rng)) {
        I.jouer(m, { type: 'annoncer', joueur: j });
        delete s.graces[j];
      } else s.oublis[j] = true;
    }
    if (nouveaux.some((j) => !estRobot(s, j)) && s.robotPret) s.robotPret = Math.max(s.robotPret, s.horloge() + DELAI_ANNONCE);
  }

  function lancer(s) {
    s.restants = s.joueurs.map((j) => j.id);
    s.paquets = I.nombrePaquets(s.mode);
    if (s.publique) s.formule = 'normale';
    s.cahier = s.formule === 'cahier' ? { total: s.totalCahier, scores: Object.fromEntries(s.restants.map((id) => [id, 0])), donnes: [] } : null;
    demarrerManche(s);
  }
  function rendrePublique(s, taille) {
    if (!(taille >= MIN && taille <= MAX)) throw new Error('Taille de salle invalide');
    s.publique = true;
    s.taille = taille;
  }


  // Pause (partie contre les robots) : seul humain de la table, il peut tout arrêter.
  // Pendant la pause rien n'avance ; à la reprise, toutes les échéances sont décalées du temps passé.
  const seulHumain = (s, id) => { const h = s.joueurs.filter((j) => !j.robot || j.remplace); return h.length === 1 && h[0].id === id && !s.publique && !s.sansPause; }; // sansPause : Match du jour (même temps pour tous)
  const maintenant = (s) => (s.enPause ? s.enPause.depuis : s.horloge());
  function reprendre(s) {
    const d = s.horloge() - s.enPause.depuis;
    s.enPause = null;
    if (d <= 0) return;
    for (const k of ['echeance', 'robotPret', 'suiteA']) if (s[k]) s[k] += d;
    if (s.pause && s.pause.jusqua) s.pause.jusqua += d;
    if (s.revanche && s.revanche.jusqua) s.revanche.jusqua += d;
    if (s.graces) for (const j of Object.keys(s.graces)) s.graces[j] += d;
  }

  function tic(s) {
    if (s.enPause) return false;
    // Fin des 3 s pour annoncer : le bouton « Contester » apparaît chez les autres (la vue change).
    const finies = Object.keys(s.graces || {}).filter((j) => s.horloge() >= s.graces[j]);
    finies.forEach((j) => delete s.graces[j]);
    const finAnnonce = finies.length > 0;
    return avancer(s) || finAnnonce;
  }
  function avancer(s) {
    if (s.etat === 'salon' && s.publique) {
      if (s.joueurs.length >= s.taille) { lancer(s); return true; }
      return false;
    }
    if (s.etat === 'finManche' && s.suiteA && s.horloge() >= s.suiteA) { demarrerManche(s); return true; }
    if (s.etat === 'finPartie') return verifierRevanche(s);
    if (s.etat !== 'manche') return false;
    const m = s.manche;
    if (s.pause) {
      if (s.horloge() < s.pause.jusqua) return false;
      s.pause = null;
      I.appliquerDepart(m);
      armerChrono(s);
      return true;
    }
    // Les robots d'abord : annonces et contestations, puis le robot dont c'est le tour.
    if (s.robotPret && s.horloge() >= s.robotPret) {
      const candidats = m.enJeu.filter((j) => j !== m.joueurCourant && estRobot(s, j));
      if (estRobot(s, m.joueurCourant)) candidats.push(m.joueurCourant);
      for (const j of candidats) {
        const a = choixRobot(s, j);
        if (a && a.type === 'contester' && enGrace(s, a.cible || (m.contestables || [])[0])) continue; // il attend la fin des 3 s
        if (a && a.type === 'annoncer' && s.oublis && s.oublis[j] && j !== m.joueurCourant) continue; // il a oublié
        if (a) { appliquer(s, a); return true; }
      }
    }
    if (m.joueurCourant && estAbsent(s, m.joueurCourant)) {
      const limite = s.horloge() + delaiPour(s, m.joueurCourant) * 1000;
      if (!s.echeance || s.echeance > limite) { s.echeance = limite; s.chronoTotal = delaiPour(s, m.joueurCourant) * 1000; }
    }
    if (!s.echeance || s.horloge() < s.echeance) return false;
    const j = m.joueurCourant;
    s.expirations[j] = (s.expirations[j] || 0) + 1;
    const action = coupAutomatique(m, j);
    if (!action) { armerChrono(s); return false; }
    m.journal.push(`Temps écoulé pour ${j} : coup automatique.`);
    appliquer(s, action);
    return true;
  }

  const nomDe = (s, id) => (s.joueurs.find((j) => j.id === id) || {}).nom || '?';
  function nettoyerNom(nom) {
    return String(nom || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Joueur';
  }

  // Premier joueur : au hasard, sauf en duel où les deux mêmes joueurs commencent à tour de rôle.
  // Mode Cahier (créateur, 14/11) : commence celui qui a pris le plus de points à la donne précédente ;
  // à égalité, le plus gros total au cahier ; encore à égalité, au hasard. Première donne : au hasard.
  function choisirPremier(s, sieges) {
    const derniere = s.cahier && s.cahier.donnes[s.cahier.donnes.length - 1];
    if (derniere) {
      const cle = (j) => [derniere.points[j] || 0, s.cahier.scores[j] || 0];
      let meilleurs = [];
      for (const j of sieges) {
        const [a, b] = cle(j), m = meilleurs[0] && cle(meilleurs[0]);
        if (!m || a > m[0] || (a === m[0] && b > m[1])) meilleurs = [j];
        else if (a === m[0] && b === m[1]) meilleurs.push(j);
      }
      return meilleurs[Math.floor(s.rng() * meilleurs.length)];
    }
    const auHasard = sieges[Math.floor(s.rng() * sieges.length)];
    if (sieges.length !== 2 || s.numeroManche !== 0) return auHasard;
    const paire = sieges.slice().sort().join('|');
    const d = s.dernierDuel;
    const premier = d && d.paire === paire && sieges.includes(d.ouvreur) ? sieges.find((j) => j !== d.ouvreur) : auHasard;
    s.dernierDuel = { paire, ouvreur: premier };
    return premier;
  }

  function demarrerManche(s) {
    const sieges = I.melanger(s.restants, s.rng);
    const { mains, pioche } = I.distribuer(sieges, s.paquets, s.rng);
    const premier = choisirPremier(s, sieges);
    s.numeroManche++;
    s.suiteA = null;
    s.graces = {};
    s.oublis = {};
    // Avec une distribution animée, l'effet de la carte de départ (pénalité, tour sauté, J retour)
    // attend la fin du compte à rebours : le joueur sanctionné reçoit ses cartes après les autres.
    const differerDepart = s.durees.depart > 0;
    s.manche = I.nouvelleManche(sieges, mains, pioche, premier, { mode: s.mode, jRetour: s.jRetour, graine: Math.floor(s.rng() * 4294967296), differerDepart, cahier: !!s.cahier });
    s.etat = 'manche';
    const depart = entreRobots(s) ? Math.min(s.durees.depart, RAPIDE.depart) : s.durees.depart;
    s.pause = depart > 0 ? { type: 'depart', jusqua: s.horloge() + depart, total: depart } : null;
    armerChrono(s);
  }

  // « Passer à la fin » : les robots finissent entre eux tout de suite, exactement comme ils l'auraient
  // fait à l'écran (même salle, mêmes coups). On avance une horloge fictive jusqu'à ce qu'un humain
  // doive rejouer (manche suivante) ou que la partie soit finie.
  function passerEntreRobots(s) {
    const vraie = s.horloge;
    let t = vraie();
    s.horloge = () => (t += 10000);
    try { for (let i = 0; i < 50000 && entreRobots(s); i++) tic(s); }
    finally { s.horloge = vraie; }
    // Les échéances posées pendant l'avance sont dans le temps fictif : on les recale.
    s.graces = {};
    if (s.etat === 'finManche') { s.suiteA = s.durees.mancheAuto > 0 ? vraie() + s.durees.mancheAuto : null; s.suiteTotal = s.durees.mancheAuto; }
    if (s.etat === 'manche') { if (s.pause) s.pause.jusqua = vraie() + s.pause.total; armerChrono(s); }
  }

  function reinitialiser(s) {
    s.enPause = null;
    s.restants = [];
    s.elimines = [];
    s.cahier = null;
    s.numeroManche = 0;
    s.nulles = 0;
    s.manche = null;
    s.vainqueur = null;
    s.echeance = null;
    s.pause = null;
    s.suiteA = null;
    s.revanche = null;
    s.revancheRatee = false;
    s.expirations = {};
    s.joueurs.forEach((j) => delete j.pret);
  }

  const humainsPresents = (s) => s.joueurs.filter((j) => !j.robot && j.connecte);
  function verifierRevanche(s) {
    const r = s.revanche;
    if (!r) return false;
    const presents = humainsPresents(s);
    const tousOntRepondu = presents.every((j) => r.oui.includes(j.id) || r.non.includes(j.id));
    const finTemps = r.jusqua && s.horloge() >= r.jusqua;
    if (!tousOntRepondu && !finTemps) return false;
    const partants = s.joueurs.filter((j) => (j.robot && !j.remplace) || (r.oui.includes(j.id) && j.connecte && !j.robot));
    if (partants.length < MIN || !partants.some((j) => !j.robot)) {
      s.revanche = null;
      s.revancheRatee = true;
      return true;
    }
    s.joueurs = partants;
    if (!partants.some((j) => j.id === s.hote)) s.hote = partants.find((j) => !j.robot).id;
    reinitialiser(s);
    lancer(s);
    return true;
  }

  function finirMancheSiBesoin(s) {
    const m = s.manche;
    if (!m || s.etat !== 'manche') return;
    if (m.phase === 'nulle') {
      // Match nul : la manche est rejouée avec les mêmes joueurs.
      s.nulles++;
      s.numeroManche--;
      s.etat = 'finManche';
      suiteAuto(s, true);
      return;
    }
    if (m.phase !== 'terminee') return;
    let sortants;
    if (s.cahier) sortants = noterDonne(s, m);
    else sortants = [m.elimine];
    s.elimines.push(...sortants);
    s.restants = s.restants.filter((j) => !sortants.includes(j));
    if (s.restants.length === 1) {
      s.vainqueur = s.restants[0];
      s.etat = 'finPartie';
      s.revanche = null;
      s.revancheRatee = false;
    } else {
      s.etat = 'finManche';
      suiteAuto(s, sortants.length > 0 && sortants.every((j) => vraiRobot(s, j)));
    }
  }
  // Mode Cahier : écrit les points de la donne et renvoie les joueurs qui atteignent le total.
  // Plusieurs éliminés à la même donne : le plus gros total sort le premier (il finit plus bas au
  // classement). Celui qui est sorti marque 0, donc il reste toujours au moins un joueur.
  function noterDonne(s, m) {
    const c = s.cahier;
    const mains = {};
    for (const j of m.sieges) {
      c.scores[j] = (c.scores[j] || 0) + m.points[j];
      if (j !== m.sorti) mains[j] = m.mains[j].slice();
    }
    const sortants = m.sieges.filter((j) => c.scores[j] >= c.total).sort((a, b) => c.scores[b] - c.scores[a] || m.points[b] - m.points[a]);
    c.donnes.push({ numero: c.donnes.length + 1, sorti: m.sorti, points: Object.assign({}, m.points), mains, elimines: sortants.slice() });
    return sortants;
  }
  // Manche suivante automatique : vite entre robots (sauf juste après l'élimination d'un humain).
  function suiteAuto(s, robotSorti) {
    const auto = entreRobots(s) && robotSorti ? Math.min(s.durees.mancheAuto, RAPIDE.mancheAuto) : s.durees.mancheAuto;
    s.suiteA = auto > 0 ? s.horloge() + auto : null;
    s.suiteTotal = auto;
  }

  // Ne garde d'une action envoyée par un joueur que ce que le moteur attend.
  function actionDe(id, a) {
    const action = { type: a.type, joueur: id };
    if (a.type === 'jouer') {
      if (!Array.isArray(a.cartes) || a.cartes.length > 16 || !a.cartes.every((c) => typeof c === 'string' && c.length <= 4)) return null;
      action.cartes = a.cartes.slice();
      if (typeof a.demande === 'string') action.demande = a.demande.slice(0, 2);
    } else if (!['piocher', 'passer', 'annoncer', 'contester'].includes(a.type)) return null;
    if (a.type === 'contester' && typeof a.cible === 'string') action.cible = a.cible.slice(0, 64);
    return action;
  }

  // Traite un message d'un joueur. Renvoie { ok, erreur? }. Mêmes messages que la salle de Kopo,
  // plus le style de partie dans les réglages : { type: 'reglages', mode: 'simple' | 'delire', jRetour: bool }.
  // Une ancienne appli envoie « délire » sans jRetour : c'était le délire avec J retour.
  function recevoir(s, id, msg) {
    const joueur = s.joueurs.find((j) => j.id === id);
    switch (msg && msg.type) {
      case 'rejoindre': {
        if (joueur) {
          revenu(s, id);
          if (joueur.robot && joueur.remplace) { joueur.robot = false; joueur.remplace = false; }
          joueur.connecte = true;
          if (typeof msg.peerId === 'string') joueur.peerId = msg.peerId.slice(0, 64);
          if (msg.nom && s.etat === 'salon') joueur.nom = nettoyerNom(msg.nom);
          return { ok: true };
        }
        if (s.etat !== 'salon') return { ok: false, erreur: 'La partie a déjà commencé.' };
        if (s.joueurs.length >= (s.publique ? s.taille : MAX)) return { ok: false, erreur: 'La table est pleine.' };
        s.joueurs.push({ id, nom: nettoyerNom(msg.nom), connecte: true, peerId: typeof msg.peerId === 'string' ? msg.peerId.slice(0, 64) : null, voix: false, muet: true });
        if (!s.hote) s.hote = id;
        return { ok: true };
      }
      case 'retirer': {
        if (id !== s.hote || s.etat !== 'salon' || msg.cible === s.hote) return { ok: false, erreur: 'Impossible.' };
        s.joueurs = s.joueurs.filter((j) => j.id !== msg.cible);
        return { ok: true };
      }
      case 'ajouterRobot': {
        if (id !== s.hote || s.etat !== 'salon' || s.publique) return { ok: false, erreur: 'Impossible.' };
        if (s.joueurs.length >= MAX) return { ok: false, erreur: `La table est pleine (${MAX} joueurs).` };
        let n = 1;
        while (s.joueurs.some((j) => j.nom === 'Robot ' + n)) n++;
        if (msg.niveau !== undefined && !NIVEAUX_ROBOTS.includes(msg.niveau)) return { ok: false, erreur: 'Impossible.' };
        const robot = { id: 'robot-' + n + '-' + Math.floor(s.rng() * 1e6), nom: 'Robot ' + n, connecte: true, robot: true, voix: false, muet: true };
        if (msg.niveau) robot.niveau = msg.niveau; // sinon, le niveau de la table
        s.joueurs.push(robot);
        return { ok: true };
      }
      case 'niveauRobot': { // l'hôte change le niveau d'un robot ajouté, dans le salon
        const cible = s.joueurs.find((j) => j.id === msg.cible);
        if (id !== s.hote || s.etat !== 'salon' || s.publique || !cible || !cible.robot || cible.remplace || !NIVEAUX_ROBOTS.includes(msg.niveau)) return { ok: false, erreur: 'Impossible.' };
        cible.niveau = msg.niveau;
        return { ok: true };
      }
      case 'remplacerParRobot': {
        const cible = s.joueurs.find((j) => j.id === msg.cible);
        if (id !== s.hote || !cible || cible.id === s.hote || cible.robot) return { ok: false, erreur: 'Impossible.' };
        if (s.etat === 'salon') return { ok: false, erreur: 'Retire-le plutôt, puis ajoute un robot.' };
        cible.robot = true;
        cible.remplace = true;
        cible.connecte = true;
        armerChrono(s);
        return { ok: true };
      }
      case 'reaction': {
        if (!joueur) return { ok: false, erreur: 'Inconnu.' };
        const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim() : '';
        if (!emoji || emoji.length > 40 || /[<>]/.test(emoji)) return { ok: false, erreur: 'Réaction invalide.' };
        s.reactions = s.reactions || {};
        const t = s.horloge();
        if (id in s.reactions && t - s.reactions[id] < 1000) return { ok: false, erreur: 'Doucement !' };
        s.reactions[id] = t;
        return { ok: true, evenement: { type: 'reaction', joueur: id, emoji } };
      }
      case 'pret': {
        if (!joueur || joueur.robot || s.etat !== 'salon') return { ok: false, erreur: 'Impossible.' };
        joueur.pret = !!msg.pret;
        return { ok: true };
      }
      case 'reglages': {
        if (id !== s.hote || s.etat !== 'salon') return { ok: false, erreur: 'Impossible.' };
        if (msg.mode !== undefined) {
          if (!MODES.includes(msg.mode)) return { ok: false, erreur: 'Impossible.' };
          s.mode = msg.mode;
          if (msg.jRetour === undefined) s.jRetour = s.mode === 'delire';
        }
        if (msg.jRetour !== undefined) {
          if (typeof msg.jRetour !== 'boolean') return { ok: false, erreur: 'Impossible.' };
          s.jRetour = msg.jRetour;
        }
        if (s.mode !== 'delire') s.jRetour = false;
        if (msg.formule !== undefined) {
          if (!FORMULES.includes(msg.formule) || (s.publique && msg.formule !== 'normale')) return { ok: false, erreur: 'Impossible.' };
          s.formule = msg.formule;
        }
        if (msg.total !== undefined) {
          if (!TOTAUX_CAHIER.includes(msg.total)) return { ok: false, erreur: 'Impossible.' };
          s.totalCahier = msg.total;
        }
        if (msg.robots !== undefined) {
          if (s.publique || !NIVEAUX_ROBOTS.concat('gentils').includes(msg.robots)) return { ok: false, erreur: 'Impossible.' };
          s.robots = msg.robots;
          if (msg.niveau !== undefined) {
            if (!Number.isInteger(msg.niveau) || msg.niveau < 1 || msg.niveau > 1000) return { ok: false, erreur: 'Impossible.' };
            s.niveauJoueur = msg.niveau;
          }
        }
        if (msg.delai !== undefined) {
          if (!DELAIS.includes(msg.delai)) return { ok: false, erreur: 'Impossible.' };
          s.delai = msg.delai;
        }
        return { ok: true };
      }
      case 'micro': {
        if (!joueur) return { ok: false, erreur: 'Inconnu.' };
        joueur.voix = !!msg.voix;
        if (typeof msg.peerId === 'string') joueur.peerId = msg.peerId.slice(0, 64);
        joueur.muet = !!msg.muet;
        return { ok: true };
      }
      case 'lancer': {
        if (id !== s.hote) return { ok: false, erreur: "Seul l'hôte peut lancer." };
        if (s.publique) return { ok: false, erreur: 'La salle démarre seule quand elle est pleine.' };
        if (s.etat !== 'salon') return { ok: false, erreur: 'Déjà lancée.' };
        if (s.joueurs.length < MIN) return { ok: false, erreur: 'Il faut au moins 2 joueurs.' };
        lancer(s);
        return { ok: true };
      }
      case 'mancheSuivante': {
        if (id !== s.hote || s.etat !== 'finManche') return { ok: false, erreur: 'Impossible.' };
        demarrerManche(s);
        return { ok: true };
      }
      case 'rejouer': {
        if (id !== s.hote || s.etat !== 'finPartie') return { ok: false, erreur: 'Impossible.' };
        s.etat = 'salon';
        reinitialiser(s);
        return { ok: true };
      }
      case 'revanche':
      case 'revancheNon': {
        if (s.etat !== 'finPartie' || !joueur || joueur.robot) return { ok: false, erreur: 'Impossible.' };
        if (s.revancheRatee && msg.type === 'revanche') s.revancheRatee = false;
        const duree = s.durees.revanche === undefined ? DUREES.revanche : s.durees.revanche;
        if (!s.revanche) s.revanche = { oui: [], non: [], jusqua: duree > 0 ? s.horloge() + duree : null };
        const r = s.revanche;
        r.oui = r.oui.filter((x) => x !== id); r.non = r.non.filter((x) => x !== id);
        (msg.type === 'revanche' ? r.oui : r.non).push(id);
        verifierRevanche(s);
        return { ok: true };
      }
      case 'enPause': { // { pause: true | false } : contre les robots seulement
        if (!joueur || !seulHumain(s, id) || s.etat === 'salon') return { ok: false, erreur: 'La pause, c\'est seulement contre les robots.' };
        if (msg.pause && !s.enPause) s.enPause = { depuis: s.horloge() };
        else if (!msg.pause && s.enPause) reprendre(s);
        return { ok: true };
      }
      case 'passerFin': { // un humain qui ne joue plus : les robots finissent tout de suite
        if (!joueur || joueur.robot || !entreRobots(s)) return { ok: false, erreur: 'Impossible.' };
        passerEntreRobots(s);
        return { ok: true };
      }
      case 'action': {
        if (s.etat !== 'manche' || !joueur) return { ok: false, erreur: 'Pas de manche en cours.' };
        if (s.enPause) return { ok: false, erreur: 'La partie est en pause.' };
        if (s.pause) return { ok: false, erreur: 'Attends la fin du compte à rebours.' };
        // Le joueur ne peut agir que pour lui-même : on impose son id.
        const action = actionDe(id, msg.action || {});
        if (!action) return { ok: false, erreur: 'Action impossible maintenant.' };
        if (action.type === 'contester') {
          // Sans cible précise : le premier joueur qu'on peut déjà contester.
          if (!action.cible) action.cible = (s.manche.contestables || []).find((c) => c !== id && !enGrace(s, c));
          if (!action.cible || enGrace(s, action.cible)) return { ok: false, erreur: 'Laisse-lui 3 secondes pour annoncer.' };
        }
        try {
          appliquer(s, action);
          revenu(s, id);
        } catch (e) {
          return { ok: false, erreur: action.type === 'jouer' && e && e.message && !/^Action/.test(e.message) ? e.message : 'Action impossible maintenant.' };
        }
        return { ok: true };
      }
      default:
        return { ok: false, erreur: 'Message inconnu.' };
    }
  }

  function deconnecter(s, id) {
    const j = s.joueurs.find((x) => x.id === id);
    if (j && !j.robot) j.connecte = false;
  }
  function reconnecter(s, id) {
    const j = s.joueurs.find((x) => x.id === id);
    if (j && !j.robot) { j.connecte = true; revenu(s, id); }
  }

  function journalLisible(s, m) {
    const ids = s.joueurs.map((j) => j.id).sort((a, b) => b.length - a.length);
    return m.journal.slice(-8).map((t) => {
      for (const id of ids) t = t.split(id).join(nomDe(s, id));
      return t.replace('mode delire avec J retour', 'mode délire (J retour)').replace('mode delire', 'mode délire');
    });
  }

  // Le joueur « j » a encore ses 3 s pour annoncer : personne ne peut le contester.
  const enGrace = (s, j) => !!(j && s.graces && s.graces[j] && maintenant(s) < s.graces[j]);

  // Vue envoyée à un joueur : uniquement ce qu'il a le droit de voir.
  function vue(s, id) {
    const v = {
      jeu: JEU,
      code: s.code,
      etat: s.etat,
      moi: id,
      hote: s.hote,
      mode: s.mode,
      jRetour: !!s.jRetour,
      formule: s.formule || 'normale',
      totalCahier: s.totalCahier || TOTAL_CAHIER,
      cahier: s.cahier ? { total: s.cahier.total, scores: Object.assign({}, s.cahier.scores), donnes: s.cahier.donnes.map((d) => ({ numero: d.numero, sorti: d.sorti, points: Object.assign({}, d.points), mains: d.mains /* cartes retournées en fin de donne : tout le monde les a vues */, elimines: d.elimines.slice() })) } : null,
      joueurs: s.joueurs.map((j) => ({ id: j.id, nom: j.nom, connecte: j.connecte, peerId: j.peerId || null, voix: !!j.voix, muet: j.muet !== false, robot: !!j.robot, niveau: j.robot && !j.remplace ? niveauDuRobot(s, j.id) : null, pret: !!j.pret || !!j.robot, remplace: !!j.remplace, absent: estAbsent(s, j.id) })),
      delai: s.delai,
      publique: !!s.publique,
      taille: s.taille,
      chrono: s.echeance && s.etat === 'manche' ? { resteMs: Math.max(0, s.echeance - maintenant(s)), totalMs: s.chronoTotal || s.delai * 1000 } : null,
      suite: s.etat === 'finManche' && s.suiteA ? { resteMs: Math.max(0, s.suiteA - maintenant(s)), totalMs: s.suiteTotal || s.durees.mancheAuto } : null,
      revanche: s.etat === 'finPartie' && s.revanche ? { oui: s.revanche.oui.slice(), non: s.revanche.non.slice(), resteMs: s.revanche.jusqua ? Math.max(0, s.revanche.jusqua - maintenant(s)) : null, totalMs: s.durees.revanche === undefined ? DUREES.revanche : s.durees.revanche } : null,
      revancheRatee: s.etat === 'finPartie' && !!s.revancheRatee,
      robots: s.robots || 'normaux',
      entreRobots: entreRobots(s), // les robots jouent vite ; un humain peut passer à la fin
      restants: s.restants.slice(),
      elimines: s.elimines.slice(),
      numeroManche: s.numeroManche,
      vainqueur: s.vainqueur,
      enPause: !!s.enPause,
      pausePossible: seulHumain(s, id) && s.etat !== 'salon',
    };
    const m = s.manche;
    if (m && s.etat !== 'salon') {
      const p = I.vuePublique(m, id);
      v.manche = {
        sieges: p.sieges,
        enJeu: p.enJeu,
        nbCartes: p.nbCartes,
        reference: p.reference,
        libre: p.libre,
        demande: p.demande,
        sens: p.sens,
        pioche: p.pioche,
        piochable: p.piochable,
        annonces: p.annonces,
        contestables: p.contestables,
        aPioche: p.aPioche,
        phase: m.phase,
        nulle: m.phase === 'nulle',
        joueurCourant: m.joueurCourant,
        qualifies: m.qualifies.map((j) => ({ joueur: j, raison: 'main vide' })), // même forme que Kopo
        elimine: m.elimine,
        sorti: m.sorti || null, // mode Cahier : celui qui a fini la donne
        journal: journalLisible(s, m),
        main: p.main,
        posees: p.posees, // dernières cartes posées (animations côté téléphone)
        nbPosees: p.nbPosees,
        dernier: p.dernier, // qui a posé la carte du centre
        piocheVide: p.piocheVide, // { joueur, motif, n } : il a passé faute de cartes à piocher
        paquets: p.paquets,
        pause: s.pause ? { type: s.pause.type, resteMs: Math.max(0, s.pause.jusqua - maintenant(s)), totalMs: s.pause.total } : null,
        enGrace: (p.contestables || []).filter((j) => enGrace(s, j)), // pas encore contestables (3 s pour annoncer)
        actions: s.pause ? [] : I.actionsPossibles(m, id).filter((a) => !(a.type === 'contester' && enGrace(s, a.cible))).map((a) => {
          const r = { type: a.type };
          if (a.cartes) r.cartes = a.cartes.slice();
          if (a.demande) r.demande = a.demande;
          if (a.cible) r.cible = a.cible;
          return r;
        }),
      };
    }
    return v;
  }

  function exporter(s) {
    const { rng, horloge, ...reste } = s;
    return JSON.stringify(reste);
  }
  function importer(texte, rng) {
    const s = JSON.parse(texte);
    s.rng = rng || hasardFort();
    s.horloge = Date.now;
    s.joueurs.forEach((j) => (j.connecte = !!j.robot));
    // Partie enregistrée avant l'option J retour : le délire se jouait avec.
    if (s.jRetour === undefined) s.jRetour = s.mode === 'delire';
    if (s.manche && s.manche.jRetour === undefined) s.manche.jRetour = s.manche.mode === 'delire';
    if (!s.formule) s.formule = 'normale';
    if (!s.totalCahier) s.totalCahier = TOTAL_CAHIER;
    if (s.cahier === undefined) s.cahier = null;
    return s;
  }

  const Inter8Salle = { JEU, MIN, MAX, MODES, FORMULES, TOTAUX_CAHIER, TOTAL_CAHIER, DELAIS, PAUSE_ROBOT, DUREES, DELAI_ABSENT, DELAI_ANNONCE, RAPIDE, entreRobots, NIVEAUX_ROBOTS, PLAGES_FORCE, forceRobots, niveauDuRobot, creerSalle, rendrePublique, choixRobot, reconnecter, tic, coupAutomatique, recevoir, deconnecter, vue, exporter, importer };
  if (enNode) module.exports = Inter8Salle;
  else root.Inter8Salle = Inter8Salle;
})(typeof window !== 'undefined' ? window : globalThis);
