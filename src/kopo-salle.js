// Kopo — salle de jeu multijoueur (tourne sur le téléphone de l'hôte).
// L'hôte est la seule autorité : il applique le moteur de règles, puis envoie
// à chaque joueur une vue où seule SA main est visible.
// Indépendant du transport réseau : on lui passe des messages, il renvoie des vues.
(function (root) {
  'use strict';
  const K = typeof require !== 'undefined' ? require('../moteur/kopo-moteur.js') : root.Kopo;

  const MIN = 2, MAX = 9;
  const DELAIS = [0, 3, 5, 10, 15]; // secondes par tour (0 = sans chrono)
  const PAUSE_ROBOT = 1200; // un robot réfléchit 1,2 s avant de jouer

  // Hasard de qualité cryptographique quand le navigateur le permet.
  function hasardFort() {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (!c) return Math.random;
    const t = new Uint32Array(1);
    return () => (c.getRandomValues(t), t[0] / 4294967296);
  }

  function creerSalle(code, rng) {
    return {
      code,
      etat: 'salon', // 'salon' | 'manche' | 'finManche' | 'finPartie'
      joueurs: [], // { id, nom, connecte }
      hote: null,
      restants: [], // ids encore dans la partie
      elimines: [], // ids, dans l'ordre d'élimination
      numeroManche: 0,
      manche: null,
      vainqueur: null,
      delai: 5, // secondes pour jouer, réglables par l'hôte dans le salon
      echeance: null, // instant (ms) où le joueur courant aura épuisé son temps
      robotPret: null, // instant (ms) où un robot peut agir
      horloge: Date.now,
      rng: rng || hasardFort(),
    };
  }

  const estRobot = (s, id) => !!(s.joueurs.find((j) => j.id === id) || {}).robot;

  // Robot : annonce Katapss, pose tout dès qu'il peut, ouvre dans sa couleur la plus longue
  // avec sa plus petite carte, suit avec sa plus petite carte, bluffe rarement.
  function choixRobot(s, j) {
    const m = s.manche;
    const actions = K.actionsPossibles(m, j);
    const k = actions.find((a) => a.type === 'katapss');
    if (k) return k;
    if (j !== m.joueurCourant) return null;
    const tout = actions.find((a) => a.type === 'toutPoser');
    if (tout) return tout;
    const cartes = actions.filter((a) => a.type === 'jouer');
    if (!cartes.length) return actions.find((a) => a.type === 'ramasser') || null;
    if (m.phase === 'ouverture') {
      const main = m.mains[j];
      const nb = (c) => main.filter((x) => K.couleur(x) === c).length;
      cartes.sort((a, b) => nb(K.couleur(b.carte)) - nb(K.couleur(a.carte)) || K.valeur(a.carte) - K.valeur(b.carte));
      return cartes[0];
    }
    if (s.rng() < 0.05) return actions.find((a) => a.type === 'ramasser');
    cartes.sort((a, b) => K.valeur(a.carte) - K.valeur(b.carte));
    return cartes[0];
  }

  // Relance le chrono du joueur courant.
  function armerChrono(s) {
    const m = s.manche;
    const enCours = s.etat === 'manche' && m && m.phase !== 'terminee';
    s.echeance = s.delai && enCours ? s.horloge() + s.delai * 1000 : null;
    s.robotPret = enCours ? s.horloge() + PAUSE_ROBOT : null;
  }

  // Coup joué automatiquement quand le temps est écoulé (ou le joueur hors ligne) :
  // en suite il ramasse (pioche) ; en ouverture, où il n'y a rien à ramasser,
  // il pose sa plus petite carte autorisée, ou tout s'il n'a pas d'autre choix.
  function coupAutomatique(m, joueur) {
    const actions = K.actionsPossibles(m, joueur).filter((a) => a.type !== 'katapss');
    const ramasser = actions.find((a) => a.type === 'ramasser');
    if (ramasser) return ramasser;
    const cartes = actions.filter((a) => a.type === 'jouer').sort((a, b) => K.valeur(a.carte) - K.valeur(b.carte));
    if (cartes.length) return cartes[0];
    return actions.find((a) => a.type === 'toutPoser') || null;
  }

  // À appeler régulièrement par l'hôte. Renvoie true si un coup automatique a été joué.
  function tic(s) {
    if (s.etat !== 'manche') return false;
    const m = s.manche;
    // Les robots d'abord : un Katapss éventuel, sinon le robot dont c'est le tour.
    if (s.robotPret && s.horloge() >= s.robotPret) {
      const candidats = m.katapss.filter((j) => estRobot(s, j));
      if (estRobot(s, m.joueurCourant)) candidats.push(m.joueurCourant);
      for (const j of candidats) {
        const a = choixRobot(s, j);
        if (a) { K.jouer(m, a); finirMancheSiBesoin(s); armerChrono(s); return true; }
      }
    }
    if (!s.echeance || s.horloge() < s.echeance) return false;
    const j = m.joueurCourant;
    const action = coupAutomatique(m, j);
    if (!action) { armerChrono(s); return false; }
    m.journal.push(`Temps écoulé pour ${j} : coup automatique.`);
    K.jouer(m, action);
    finirMancheSiBesoin(s);
    armerChrono(s);
    return true;
  }

  const nomDe = (s, id) => (s.joueurs.find((j) => j.id === id) || {}).nom || '?';

  function nettoyerNom(nom) {
    return String(nom || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Joueur';
  }

  function demarrerManche(s) {
    const sieges = K.melanger(s.restants, s.rng);
    const paquet = K.melanger(K.nouveauPaquet(), s.rng);
    const mains = {};
    sieges.forEach((j, i) => (mains[j] = paquet.slice(i * 4, i * 4 + 4)));
    const premier = sieges[Math.floor(s.rng() * sieges.length)];
    s.numeroManche++;
    s.manche = K.nouvelleManche(sieges, mains, premier);
    s.etat = 'manche';
    armerChrono(s);
  }

  function finirMancheSiBesoin(s) {
    const m = s.manche;
    if (!m || m.phase !== 'terminee' || s.etat !== 'manche') return;
    s.elimines.push(m.elimine);
    s.restants = s.restants.filter((j) => j !== m.elimine);
    if (s.restants.length === 1) {
      s.vainqueur = s.restants[0];
      s.etat = 'finPartie';
    } else {
      s.etat = 'finManche';
    }
  }

  // Traite un message d'un joueur. Renvoie { ok, erreur? }.
  // msg : { type: 'rejoindre', nom } | { type: 'lancer' } | { type: 'action', action }
  //       | { type: 'mancheSuivante' } | { type: 'rejouer' } | { type: 'retirer', cible }
  function recevoir(s, id, msg) {
    const joueur = s.joueurs.find((j) => j.id === id);
    switch (msg && msg.type) {
      case 'rejoindre': {
        if (joueur) {
          if (joueur.robot && joueur.remplace) { joueur.robot = false; joueur.remplace = false; } // le joueur reprend sa place
          joueur.connecte = true;
          if (typeof msg.peerId === 'string') joueur.peerId = msg.peerId.slice(0, 64);
          if (msg.nom && s.etat === 'salon') joueur.nom = nettoyerNom(msg.nom);
          return { ok: true };
        }
        if (s.etat !== 'salon') return { ok: false, erreur: 'La partie a déjà commencé.' };
        if (s.joueurs.length >= MAX) return { ok: false, erreur: 'La table est pleine (9 joueurs).' };
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
        if (id !== s.hote || s.etat !== 'salon') return { ok: false, erreur: 'Impossible.' };
        if (s.joueurs.length >= MAX) return { ok: false, erreur: 'La table est pleine (9 joueurs).' };
        let n = 1;
        while (s.joueurs.some((j) => j.nom === 'Robot ' + n)) n++;
        s.joueurs.push({ id: 'robot-' + n + '-' + Math.floor(s.rng() * 1e6), nom: 'Robot ' + n, connecte: true, robot: true, voix: false, muet: true });
        return { ok: true };
      }
      case 'remplacerParRobot': {
        const cible = s.joueurs.find((j) => j.id === msg.cible);
        if (id !== s.hote || !cible || cible.id === s.hote || cible.robot) return { ok: false, erreur: 'Impossible.' };
        if (s.etat === 'salon') return { ok: false, erreur: 'Retire-le plutôt, puis ajoute un robot.' };
        cible.robot = true;
        cible.remplace = true; // il pourra reprendre sa place en revenant
        cible.connecte = true;
        armerChrono(s);
        return { ok: true };
      }
      case 'reglages': {
        if (id !== s.hote || s.etat !== 'salon' || !DELAIS.includes(msg.delai)) return { ok: false, erreur: 'Impossible.' };
        s.delai = msg.delai;
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
        if (s.etat !== 'salon') return { ok: false, erreur: 'Déjà lancée.' };
        if (s.joueurs.length < MIN) return { ok: false, erreur: 'Il faut au moins 2 joueurs.' };
        s.restants = s.joueurs.map((j) => j.id);
        demarrerManche(s);
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
        s.restants = [];
        s.elimines = [];
        s.numeroManche = 0;
        s.manche = null;
        s.vainqueur = null;
        s.echeance = null;
        return { ok: true };
      }
      case 'action': {
        if (s.etat !== 'manche' || !joueur) return { ok: false, erreur: 'Pas de manche en cours.' };
        const a = msg.action || {};
        // Le joueur ne peut agir que pour lui-même : on impose son id.
        const action = { type: a.type, joueur: id };
        if (a.carte) action.carte = a.carte;
        try {
          K.jouer(s.manche, action);
        } catch (e) {
          // Clic devenu périmé (ex. Katapss déjà annoncé par un autre) : on ignore.
          return { ok: false, erreur: 'Action impossible maintenant.' };
        }
        finirMancheSiBesoin(s);
        armerChrono(s);
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

  // Remplace les identifiants par les pseudos dans le journal.
  function journalLisible(s, m) {
    const ids = s.joueurs.map((j) => j.id).sort((a, b) => b.length - a.length);
    return m.journal.slice(-8).map((t) => {
      for (const id of ids) t = t.split(id).join(nomDe(s, id));
      return t;
    });
  }

  // Vue envoyée à un joueur : uniquement ce qu'il a le droit de voir.
  function vue(s, id) {
    const v = {
      code: s.code,
      etat: s.etat,
      moi: id,
      hote: s.hote,
      joueurs: s.joueurs.map((j) => ({ id: j.id, nom: j.nom, connecte: j.connecte, peerId: j.peerId || null, voix: !!j.voix, muet: j.muet !== false, robot: !!j.robot, remplace: !!j.remplace })),
      delai: s.delai,
      chrono: s.echeance && s.etat === 'manche' ? { resteMs: Math.max(0, s.echeance - s.horloge()), totalMs: s.delai * 1000 } : null,
      restants: s.restants.slice(),
      elimines: s.elimines.slice(),
      numeroManche: s.numeroManche,
      vainqueur: s.vainqueur,
    };
    const m = s.manche;
    if (m && s.etat !== 'salon') {
      v.manche = {
        sieges: m.sieges.slice(),
        enJeu: m.enJeu.slice(),
        nbCartes: Object.fromEntries(m.sieges.map((j) => [j, m.mains[j].length])),
        table: m.table.map((p) => ({ joueur: p.joueur, cartes: p.cartes.slice(), compte: p.compte })),
        couleurTour: m.couleurTour,
        couleurInterdite: m.couleurInterdite,
        phase: m.phase,
        joueurCourant: m.joueurCourant,
        qualifies: m.qualifies.map((q) => ({ joueur: q.joueur, raison: q.raison })),
        elimine: m.elimine,
        journal: journalLisible(s, m),
        main: m.mains[id] ? m.mains[id].slice() : [],
        actions: K.actionsPossibles(m, id).map((a) => ({ type: a.type, carte: a.carte })),
      };
    }
    return v;
  }

  // Sauvegarde / reprise (si l'hôte recharge sa page).
  function exporter(s) {
    const { rng, horloge, ...reste } = s;
    return JSON.stringify(reste);
  }
  function importer(texte, rng) {
    const s = JSON.parse(texte);
    s.rng = rng || hasardFort();
    s.horloge = Date.now;
    s.joueurs.forEach((j) => (j.connecte = !!j.robot));
    return s;
  }

  const KopoSalle = { MIN, MAX, DELAIS, PAUSE_ROBOT, creerSalle, choixRobot, tic, coupAutomatique, recevoir, deconnecter, vue, exporter, importer };
  if (typeof module !== 'undefined' && module.exports) module.exports = KopoSalle;
  else root.KopoSalle = KopoSalle;
})(typeof window !== 'undefined' ? window : globalThis);
