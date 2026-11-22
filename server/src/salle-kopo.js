// Salle Colyseus : fait tourner une partie de Kopo, ou d'Inter (8), sur le serveur.
// Toute la logique de jeu reste dans src/kopo-salle.js et src/inter8-salle.js (la même que sur le
// téléphone de l'hôte) : le serveur leur passe les messages des joueurs et envoie à chacun SA vue.
// Les salles « inter8 » sont des salles Inter (8) : entre amis (code) ou publiques gratuites.
// Pas encore de tables à mise, de Match du jour, de ligue ni de parcours pour Inter (8).
'use strict';
const { Room, matchMaker } = require('colyseus');
const SK = require('../../src/kopo-salle.js');
const SI = require('../../src/inter8-salle.js');
const K = require('../../moteur/kopo-moteur.js');
const { idAleatoire } = require('./comptes');
const { etatJeuPour, NOMS_JEUX, evenementEnCours, totauxCahier } = require('./reglages');
const ATTENTE_STICKER = require('./stickers').ATTENTE_MS;
const { permis, SALLES_MAX, actives: limitesActives } = require('./limites');
const FG = require('./fleuve-generateur');
const { creerSuivi } = require('./fleuve-suivi');

const salles = new Set(); // salles ouvertes (tableau de bord : en direct)
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ';
// Tables à mise (strategie-pieces §4.1) : un niveau se débloque quand on a 10 fois la mise.
const DEBLOCAGE = 10;
const NOMS_TABLES = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant' };
const ERREUR_GOOGLE = 'Connecte-toi avec Google pour jouer en ligne ou entre amis. Sans compte, tu peux jouer contre les robots.';
// Salles publiques complétées par des robots : leurs prénoms (toujours affichés « Robot <prénom> »).
const PRENOMS_ROBOTS = ['Amani', 'Kofi', 'Aïcha', 'Malaika', 'Moussa', 'Nala', 'Zola', 'Fatou', 'Jabari', 'Imani', 'Thandi', 'Sekou',
  'Mbuyi', 'Kalala', 'Ngalula', 'Ilunga', 'Makiese', 'Bintou', 'Kwame', 'Ayo', 'Nzinga', 'Tshala', 'Mwamba', 'Asha'];
const nouveauCode = () => Array.from({ length: 4 }, () => LETTRES[Math.floor(Math.random() * LETTRES.length)]).join('');

class SalleKopo extends Room {
  // Services (comptes, base, réglages) injectés au démarrage par index.js.
  static services = null;

  onCreate(options = {}) {
    // Entraînement (salles « entrainement ») : un joueur seul contre des robots, Kopo ou Inter (8) selon options.jeu.
    // Pour les applis qui ne font pas tourner le moteur sur le téléphone (appli Flutter). Sans compte Google,
    // sans pièces, sans ligue, sans XP de parcours : comme « Contre les robots » sur le site.
    this.entrainement = this.roomName === 'entrainement';
    // Le Fleuve (salles « fleuve ») : une étape, un joueur seul contre les robots fixés par l'étape. Le jeu suit le fleuve.
    this.fl = null;
    if (this.roomName === 'fleuve') {
      if (!FG.FLEUVES[options.fleuve]) throw new Error('Fleuve inconnu.');
      this.fl = { fleuve: options.fleuve, numero: Math.trunc(Number(options.numero)) || 0, compteId: null, essai: null, etape: null, suivi: null, termine: false };
    }
    this.jeu = this.roomName === 'inter8' || this.roomName === 'inter8-mise' || (this.entrainement && options.jeu === 'inter8') || (this.fl && FG.FLEUVES[this.fl.fleuve] === 'inter8') ? 'inter8' : 'kopo';
    this.S = this.jeu === 'inter8' ? SI : SK;
    this.maxClients = this.S.MAX;
    this.autoDispose = true;
    // Un code n'est jamais partagé par deux salles ouvertes, Kopo et Inter (8) confondus :
    // sinon un ami qui tape le code pourrait arriver dans la mauvaise partie.
    const pris = (c) => [...salles].some((x) => x.code === c);
    this.code = options.code && /^[A-Z]{4}$/.test(options.code) && !pris(options.code) ? options.code : nouveauCode();
    while (pris(this.code)) this.code = nouveauCode();
    this.publique = !!options.publique && !this.entrainement && !this.fl;
    // Match du jour (salles « kopo-jour ») : un joueur seul contre 8 robots, la même donne pour tous ce jour-là.
    this.jour = null;
    if (this.roomName === 'kopo-jour') {
      const mj = SalleKopo.services.matchJour;
      const d = mj.donneDu(mj.aujourdhui());
      this.publique = false;
      this.jour = { jour: d.jour, numero: d.numero, graine: d.graine, officiel: false, compteId: null, avance: 0, termine: false };
      this.salle = this.S.creerSalle(this.code, K.hasard((d.graine ^ 0x5bd1e995) >>> 0)); // robots reproductibles aussi
      this.salle.robots = d.robots;
      this.salle.niveauJoueur = d.niveauRobots;
      this.salle.sansPause = true; // même temps pour tous : pas de pause
    } else this.salle = this.S.creerSalle(this.code);
    // Rythme des parties réglé dans le tableau de bord (temps entre les coups) : figé pour la vie de la salle.
    if (SalleKopo.services) this.S.appliquerRythme(this.salle, (SalleKopo.services.reglages.get('rythme') || {})[this.jeu]);
    this.baremeAJour();
    // Inter (8) : le style choisi à la création (« Quelle partie ? »), modifiable ensuite dans le salon.
    // J retour en option, en simple comme en délire (22/11). Une ancienne appli qui ne l'envoie pas jouait le délire avec.
    if (this.jeu === 'inter8' && SI.MODES.includes(options.mode)) {
      this.salle.mode = options.mode;
      this.salle.jRetour = options.jRetour === undefined ? options.mode === 'delire' : options.jRetour === true;
    }
    // Inter (8), mode Cahier (14/11) : comptage des points, salons privés seulement.
    if (this.jeu === 'inter8' && !this.publique && options.formule === 'cahier') {
      this.salle.formule = 'cahier';
      const t = SI.totalCahierPour(this.salle.totauxCahier || SI.TOTAUX_CAHIER, options.total);
      if (t) this.salle.totalCahier = t;
    }
    // Salle publique : N joueurs inconnus, elle démarre seule quand elle est pleine.
    this.taille = this.publique ? Math.min(this.S.MAX, Math.max(this.S.MIN, Number(options.taille) || this.S.MAX)) : null;
    if (this.publique) { this.S.rendrePublique(this.salle, this.taille); this.maxClients = this.taille; }
    // Table à mise : salles « kopo-mise » et « inter8-mise », publiques seulement (inconnus placés au hasard, pas de code : strategie-pieces §6.3).
    // Le montant est fixé à l'ouverture de la salle (un changement dans le tableau de bord vaut pour les salles suivantes).
    this.mise = null;
    if (this.roomName === 'kopo-mise' || this.roomName === 'inter8-mise') {
      const tables = SalleKopo.services.reglages.get('tables') || {};
      const montant = Math.trunc(Number(tables[options.mise]));
      if (!this.publique || !NOMS_TABLES[options.mise] || !(montant > 0)) throw new Error('Table à mise inconnue.');
      this.mise = { niveau: options.mise, montant };
    }
    if (this.entrainement) {
      this.maxClients = 1;
      this.reglagesEntrainement = optionsEntrainement(this.S, options);
      this.proprietaire = null; // le compte qui a ouvert la salle : lui seul peut y entrer (et y revenir)
    }
    // Les amis peuvent aussi rejoindre une salle publique avec son code.
    if (this.listing) this.listing.code = this.code;
    const rapide = options.rapide && process.env.KOPO_TESTS === '1';
    // Salle publique gratuite (Kopo ou Inter (8)) : après une attente sans assez de joueurs, des robots complètent
    // la table (réglage robotsPublics, onglet Pilotage). Jamais aux tables à mise. Les robots restent affichés
    // comme robots ; avec eux la partie ne rapporte ni pièces, ni Ligue, ni XP de parcours (enregistrerPartie).
    this.robotsPublics = this.publique && !this.mise && !this.jour && !this.entrainement && !this.fl;
    this.attenteDepuis = null; // arrivée du premier joueur dans le salon
    this.attenteTest = rapide && Number(options.attenteRobots) >= 0 ? Number(options.attenteRobots) : null; // tests seulement (ms)
    if (rapide) { this.salle.durees = { depart: 0, finTour: 0, mancheAuto: 1 }; if (this.jour || this.entrainement || this.fl) this.salle.pauseRobot = 0; } // tests seulement
    this.clientsParId = new Map();
    this.comptes = new Map(); // id -> compte (au moment de l'entrée)
    this.attentes = new Map(); // id -> reconnexion en attente (allowReconnection), annulée si le joueur revient par le code
    this.partie = null; // { id, katapss: Map, abandons: Set, coupures: Set, classee, enregistree }
    // Ligue : seulement en salle publique (inconnus placés au hasard). Dès qu'un joueur entre
    // avec le code (un ami), la salle n'est plus classée : pas de complicité (strategie-pieces §6.3).
    this.classee = this.publique && !this.jour && !this.fl && this.jeu === 'kopo'; // ligue d'Inter (8) : plus tard, séparée
    this.setMetadata(this.meta('salon', 0));
    salles.add(this);

    this.onMessage('*', (client, type, msg) => this.recevoir(client, type, msg));
    this.setSimulationInterval(() => {
      const fini = () => (this.jour && this.jour.termine) || (this.fl && this.fl.termine);
      if (fini()) return; // Match du jour ou étape du Fleuve finis pour le joueur : les robots s'arrêtent
      if (this.robotsPublics && this.completerAvecRobots()) this.apresChangement();
      // Les robots jouent l'un après l'autre : en test, plusieurs coups par tour de boucle.
      for (let i = 0; i < (rapide && (this.jour || this.fl) ? 50 : 1); i++) { if (!this.S.tic(this.salle)) break; this.apresChangement(); if (fini()) break; }
    }, rapide && (this.jour || this.fl) ? 20 : 200);
  }

  async onAuth(client, options = {}) {
    const { auth, comptes } = SalleKopo.services;
    const id = await auth.verifierJoueur(options.jeton);
    if (!id) throw new Error('Connexion requise.');
    const c = await comptes.statut(id);
    if (!c || c.statut === 'supprime') throw new Error('Compte inconnu.');
    if (c.statut === 'banni') throw new Error('Ce compte est banni.');
    if (c.statut === 'suspendu') throw new Error('Compte suspendu jusqu\'au ' + new Date(c.suspendu_jusqu).toLocaleString('fr-FR') + '.');
    // Limites (sécurité) : un compte ne tient pas plus de SALLES_MAX salles à la fois, et n'essaie pas plus de
    // 30 codes par minute (les codes à 4 lettres des tables entre amis se devinent sinon). Un retour à sa place passe toujours.
    const dejaAssis = this.salle && this.salle.joueurs.some((j) => j.id === c.id);
    if (!dejaAssis && limitesActives()) {
      const ailleurs = [...salles].filter((s) => s !== this && s.clientsParId.has(c.id)).length;
      const max = Math.trunc(Number((SalleKopo.services.reglages.get('limites') || {}).sallesMax)) || SALLES_MAX;
      if (ailleurs >= max) throw new Error('Tu as déjà trop de parties ouvertes. Quitte-en une pour en commencer une autre.');
    }
    if (!dejaAssis && options.code && !options.retour && !permis('codesCompte', c.id)) throw new Error('Trop de codes essayés. Réessaie dans une minute.');
    // Jeu en maintenance, ou réservé aux testeurs : on n'entre plus (sauf pour reprendre sa place).
    const etat = etatJeuPour(SalleKopo.services.reglages.get('jeux'), this.jeu, c.pseudo);
    const assis = this.salle && this.salle.joueurs.some((j) => j.id === c.id);
    if (!assis && etat === 'maintenance') throw new Error(`${NOMS_JEUX[this.jeu]} est en maintenance. On revient très vite !`);
    if (!assis && etat === 'ferme') throw new Error(`${NOMS_JEUX[this.jeu]} n'est pas encore ouvert.`);
    // En ligne et entre amis : compte Google obligatoire (quand la connexion Google est active).
    // Sans compte, on joue contre les robots, sur le téléphone. On laisse revenir un joueur déjà assis.
    if (!assis && !this.jour && !this.fl && !this.entrainement && SalleKopo.services.googleObligatoire && !c.auth_id) throw new Error(ERREUR_GOOGLE);
    if (this.entrainement) {
      if (this.proprietaire && this.proprietaire !== c.id) throw new Error('Cette partie n\'est pas la tienne.');
      this.proprietaire = c.id;
    }
    if (this.jour) {
      // Une seule personne par salle du jour : son retour après une coupure, ou rien.
      if (this.jour.compteId) { if (this.jour.compteId !== c.id) throw new Error('Cette partie n\'est pas la tienne.'); }
      else {
        const r = await SalleKopo.services.matchJour.commencer(c); // refuse sans Google, ou si un essai est déjà en cours
        if (this.jour.compteId) throw new Error('Cette partie n\'est pas la tienne.');
        this.jour.compteId = c.id;
        this.jour.officiel = r.officiel;
      }
    }
    if (this.fl) {
      // Une seule personne par étape : son retour après une coupure, ou rien. Tout est vérifié par le service
      // (Google, Fleuve ouvert, ordre des étapes, pagaies) ; une pagaie ne se perd qu'à l'échec.
      if (this.fl.compteId) { if (this.fl.compteId !== c.id) throw new Error('Cette partie n\'est pas la tienne.'); }
      else {
        const r = await SalleKopo.services.fleuve.commencer(c, this.fl.fleuve, this.fl.numero);
        if (this.fl.compteId) { SalleKopo.services.fleuve.annuler(c.id, r.essai).catch(() => {}); throw new Error('Cette partie n\'est pas la tienne.'); }
        Object.assign(this.fl, { compteId: c.id, essai: r.essai, etape: r.etape, adoucir: r.adoucir, public: r.public });
        this.salle.rng = K.hasard((r.etape.graine ^ 0x5bd1e995) >>> 0); // robots reproductibles, comme dans les essais
      }
    }
    if (this.mise) {
      if (options.code) throw new Error('Les tables à mise se jouent entre inconnus, sans code.');
      const il = this.mise.montant * DEBLOCAGE;
      if (Number(c.solde) < il) throw new Error(`Il te faut au moins ${il} pièces pour la table ${NOMS_TABLES[this.mise.niveau]}.`);
    }
    return c;
  }

  meta(etat, joueurs) { return { jeu: this.jeu, code: this.code, publique: this.publique, taille: this.taille, etat, joueurs, classee: this.classee, mise: this.mise }; }

  onJoin(client, options, compte) {
    const id = compte.id;
    if (this.publique && options && options.code && this.salle.etat === 'salon') this.classee = false;
    const ancien = this.clientsParId.get(id);
    const r = this.S.recevoir(this.salle, id, { type: 'rejoindre', nom: compte.pseudo });
    if (!r.ok) throw new Error(r.erreur);
    client.userData = { id };
    this.clientsParId.set(id, client); // avant d'écarter l'ancien : son départ ne touche plus à la place
    if (ancien && ancien !== client) try { ancien.leave(4000); } catch (e) {} // même compte ouvert ailleurs (ou ancienne page)
    if (this.partie) this.partie.coupures.delete(id);
    this.comptes.set(id, compte);
    if (this.jour && this.salle.etat === 'salon') this.lancerJour(id, client);
    if (this.fl && this.salle.etat === 'salon') this.lancerFleuve(id, client);
    if (this.entrainement && !ancien && this.salle.etat === 'salon' && !this.salle.joueurs.some((j) => j.robot)) this.preparerEntrainement(id);
    this.apresChangement();
  }

  // Inter (8), mode Cahier : barème des cartes de Pilotage. La salle ne le lit qu'au lancement d'une partie
  // (puis il reste figé jusqu'à la fin) : le changer dans Pilotage ne touche jamais une partie en cours.
  baremeAJour() {
    if (this.jeu !== 'inter8' || !SalleKopo.services) return;
    this.salle.baremeCahier = SalleKopo.services.reglages.get('cahier') || null;
    this.salle.totauxCahier = totauxCahier(SalleKopo.services.reglages.get('cahierTotaux')); // montants d'élimination proposés
  }

  // Entraînement : robots et réglages demandés à l'ouverture. Le joueur garde la main dans le salon
  // (ajouterRobot, niveauRobot, retirer, reglages), puis envoie « lancer ».
  preparerEntrainement(id) {
    this.baremeAJour();
    const o = this.reglagesEntrainement;
    const r = this.S.recevoir(this.salle, id, Object.assign({ type: 'reglages' }, o.reglages));
    if (!r.ok) console.error('Entraînement : réglages refusés', o.reglages);
    for (let i = 0; i < o.robots; i++) this.S.recevoir(this.salle, id, { type: 'ajouterRobot' });
    if (o.lancer) this.S.recevoir(this.salle, id, { type: 'lancer' });
  }

  // Salle publique gratuite : si personne d'autre n'arrive pendant l'attente réglée, des robots prennent les places
  // libres et la salle, pleine, démarre seule (tic). Renvoie true si des robots ont été ajoutés.
  completerAvecRobots() {
    const s = this.salle;
    if (s.etat !== 'salon') { this.attenteDepuis = null; return false; }
    if (!s.joueurs.some((j) => !j.robot)) { this.attenteDepuis = null; return false; }
    if (this.attenteDepuis === null) this.attenteDepuis = Date.now();
    const r = SalleKopo.services.reglages.get('robotsPublics') || {};
    if (!r.actif && this.attenteTest === null) return false;
    const attente = this.attenteTest !== null ? this.attenteTest : Math.max(10, Number(r.attente) || 45) * 1000;
    if (Date.now() - this.attenteDepuis < attente || s.joueurs.length >= this.taille) return false;
    // Prénoms africains tirés au hasard, toujours précédés de « Robot » (et l'icône robot sur le site et l'appli) :
    // la table a de la vie, sans faire passer les robots pour des joueurs.
    const libres = PRENOMS_ROBOTS.filter((p) => !s.joueurs.some((j) => j.nom === 'Robot ' + p));
    while (s.joueurs.length < this.taille) {
      const p = libres.length ? libres.splice(Math.floor(Math.random() * libres.length), 1)[0] : String(s.joueurs.length + 1);
      s.joueurs.push({ id: 'robot-' + Math.floor(Math.random() * 1e9), nom: 'Robot ' + p, connecte: true, robot: true, voix: false, muet: true });
    }
    s.robots = ['faciles', 'normaux', 'forts'].includes(r.robots) ? r.robots : 'normaux'; // réglé dans le tableau de bord
    s.niveauJoueur = Math.min(20, Math.max(1, Math.trunc(Number(r.force)) || 10)); // force 10 : ni trop facile, ni imbattable
    if (this.attenteTest !== null) s.pauseRobot = 0; // tests seulement
    this.classee = false;
    if (!this.locked) this.lock(); // plus de place : les inconnus suivants ouvrent une autre salle
    return true;
  }

  // Match du jour : 8 robots aux places fixes, puis la partie part tout de suite.
  lancerJour(id, client) {
    const { ROBOTS } = SalleKopo.services.matchJour;
    ROBOTS.forEach((r, i) => this.salle.joueurs.push({ id: r, nom: 'Robot ' + (i + 1), connecte: true, robot: true, voix: false, muet: true }));
    this.salle.donne = { graine: this.jour.graine, ordre: [id].concat(ROBOTS) };
    this.S.recevoir(this.salle, id, { type: 'lancer' });
    client.send('matchJour', { debut: true, numero: this.jour.numero, officiel: this.jour.officiel });
  }

  // Le Fleuve : les robots, la donne et les pièges de l'étape, puis la partie part tout de suite.
  lancerFleuve(id, client) {
    const f = this.fl, s = this.salle;
    s.joueurs = s.joueurs.filter((j) => j.id === id);
    s.hote = id;
    FG.placerRobots(s, f.etape, id, { adoucir: f.adoucir });
    f.suivi = creerSuivi(id, f.etape);
    s.surAction = f.suivi.surAction;
    const r = this.S.recevoir(s, id, { type: 'lancer' });
    if (!r.ok) console.error('Fleuve : lancement refusé', r.erreur);
    client.send('fleuve', { debut: true, etape: f.public, adoucir: f.adoucir > 0 });
  }

  // Suit l'étape : quand l'objectif est jugé (atteint, raté, ou partie finie), le résultat part au service.
  suivreFleuve() {
    const f = this.fl;
    if (!f || f.termine || !f.suivi) return;
    f.suivi.observer(this.salle);
    if (f.suivi.fini()) this.terminerFleuve();
  }

  terminerFleuve({ parti = false } = {}) {
    const f = this.fl;
    if (!f || f.termine || !f.compteId) return;
    f.termine = true;
    if (!f.suivi) { SalleKopo.services.fleuve.annuler(f.compteId, f.essai).catch(() => {}); return; } // jamais commencée : rien n'est perdu
    f.suivi.arreter();
    const resultat = f.suivi.resultat();
    const envoyer = (m) => { const c = this.clientsParId.get(f.compteId); if (c) try { c.send('fleuve', m); } catch (e) {} };
    return SalleKopo.services.fleuve.terminer(f.compteId, f.essai, resultat, { parti })
      .then((r) => { envoyer({ fin: true, ...r }); return r; })
      .catch((e) => { console.error('Fleuve :', e.message); envoyer({ fin: true, erreur: 'Résultat non enregistré. Réessaie.' }); });
  }

  // Manches passées par le joueur du Match du jour (si la partie s'arrête maintenant).
  manchesJour() {
    const s = this.salle, id = this.jour.compteId;
    const i = s.elimines.indexOf(id);
    if (i >= 0) return i;
    if (s.etat === 'finPartie') return s.numeroManche - 1; // vainqueur : toutes les manches avant la finale
    return s.etat === 'finManche' ? s.numeroManche : Math.max(0, s.numeroManche - 1);
  }

  // Suit le Match du jour : le score avance à chaque manche passée ; éliminé ou vainqueur, c'est fini.
  suivreJour() {
    const j = this.jour, s = this.salle;
    if (!j || j.termine || !j.compteId) return;
    const mj = SalleKopo.services.matchJour;
    const elimine = s.elimines.includes(j.compteId), gagne = s.etat === 'finPartie' && s.vainqueur === j.compteId;
    if (elimine || gagne) return this.terminerJour({ victoire: gagne });
    const m = this.manchesJour();
    if (j.officiel && m > j.avance) { j.avance = m; mj.avancer(j.compteId, j.jour, m).catch((e) => console.error('Match du jour :', e.message)); }
  }

  terminerJour({ victoire = false, parti = false } = {}) {
    const j = this.jour;
    if (!j || j.termine || !j.compteId) return;
    j.termine = true;
    const mj = SalleKopo.services.matchJour;
    const manches = this.manchesJour();
    const resultat = { fin: true, numero: j.numero, officiel: j.officiel, manches, victoire, score: mj.scoreDe(manches, victoire), parti };
    if (j.officiel) mj.terminer(j.compteId, j.jour, { manches, victoire }).catch((e) => console.error('Match du jour :', e.message));
    const c = this.clientsParId.get(j.compteId);
    if (c) try { c.send('matchJour', resultat); } catch (e) {}
    return resultat;
  }

  async onLeave(client, volontaire) {
    const id = client.userData && client.userData.id;
    if (!id) return;
    // Ancienne connexion d'un joueur revenu entre-temps (page rouverte, autre appareil) : sa place est déjà reprise.
    if (this.clientsParId.get(id) !== client) return;
    this.S.deconnecter(this.salle, id);
    if (this.jour && volontaire) { this.terminerJour({ parti: true }); return; } // quitter = le score s'arrête là
    if (this.fl && volontaire) { if (!this.fl.termine) this.terminerFleuve({ parti: true }); return; } // quitter l'étape = échec
    if (volontaire && this.partie && this.salle.etat !== 'salon') this.partie.abandons.add(id);
    const partie = this.partie;
    if (!volontaire && partie && this.salle.etat !== 'salon') partie.coupures.add(id); // pas sa faute : pas de points perdus
    this.apresChangement();
    if (volontaire) return;
    const attente = this.allowReconnection(client, 120); // 2 minutes pour revenir avec le jeton de reconnexion
    this.attentes.set(id, attente);
    try {
      const nouveau = await attente;
      this.clientsParId.set(id, nouveau);
      if (partie) partie.coupures.delete(id);
      this.S.reconnecter(this.salle, id);
      this.apresChangement();
    } catch (e) { /* pas revenu par le jeton : il garde sa place et peut revenir avec le code (reserverRetour) */ }
    finally { if (this.attentes.get(id) === attente) this.attentes.delete(id); }
  }

  // Retour d'un joueur déjà assis à la table (page fermée par erreur, réseau perdu, jeton de reconnexion
  // oublié ou expiré) : il reprend sa place, ses cartes et la partie en cours, même si la salle est
  // verrouillée (partie commencée) ou pleine. Renvoie la réservation à consommer, ou null s'il n'est pas assis ici.
  async reserverRetour(compte) {
    const id = compte.id;
    if (!this.salle.joueurs.some((j) => j.id === id && (!j.robot || j.remplace))) return null;
    const attente = this.attentes.get(id);
    if (attente) { // libère la place réservée pour l'ancienne connexion
      this.attentes.delete(id);
      attente.reject(new Error('retour par le code'));
      await new Promise((ok) => setImmediate(ok));
    }
    // L'ancienne connexion peut encore compter (coupure pas encore détectée) : une place de plus le temps qu'elle parte.
    if (this.hasReachedMaxClients()) this.maxClients = this.clients.length + Object.keys(this.reservedSeats).length + 1;
    const r = await matchMaker.reserveSeatFor(this.listing, { code: this.code, retour: true }, compte);
    return { room: { name: this.roomName, roomId: this.roomId, processId: r.room.processId, publicAddress: r.room.publicAddress }, sessionId: r.sessionId };
  }

  onDispose() {
    salles.delete(this);
    if (this.jour && !this.jour.termine) this.terminerJour({ parti: true }); // jamais revenu après une coupure
    if (this.fl && !this.fl.termine) this.terminerFleuve(); // jamais revenu : l'objectif est jugé sur ce qui est fait
  }

  recevoir(client, type, msg) {
    const id = client.userData && client.userData.id;
    if (!id) return;
    if (!permis('messages', client.sessionId)) return; // plus de 20 messages par seconde : ignorés (sécurité)
    msg = Object.assign({}, msg && typeof msg === 'object' ? msg : {}, { type });
    if (type === 'rejoindre') return; // l'entrée passe par onJoin
    // Match du jour : la table est fixée par le serveur (robots, donne), pas de revanche ni de réglages.
    if (this.fl && ['lancer', 'ajouterRobot', 'niveauRobot', 'retirer', 'remplacerParRobot', 'reglages', 'revanche', 'revancheNon', 'rejouer', 'passerFin', 'passerPause', 'enPause'].includes(type)) { client.send('erreur', 'Pas pendant une étape du Fleuve.'); return; }
    if (this.jour && ['lancer', 'ajouterRobot', 'niveauRobot', 'retirer', 'remplacerParRobot', 'reglages', 'revanche', 'revancheNon', 'rejouer', 'passerFin', 'passerPause', 'enPause'].includes(type)) { client.send('erreur', 'Pas pendant le Match du jour.'); return; }
    if (type === 'sync') { client.send('vue', this.vuePour(id)); return; } // la page demande sa vue dès qu'elle écoute
    if (type === 'reaction') { // chat : seulement les messages choisis dans le tableau de bord
      const liste = SalleKopo.services.reglages.get('messagesRapides') || [];
      if (!liste.includes(typeof msg.emoji === 'string' ? msg.emoji.trim() : '')) { client.send('erreur', 'Ce message n\'est plus proposé.'); return; }
    }
    if (type === 'sticker') { this.envoyerSticker(client, id, msg.sticker).catch((e) => { console.error('Sticker :', e.message); client.send('erreur', 'Sticker non envoyé.'); }); return; }
    if (type === 'vocal') { this.donnerVocal(client, id).catch((e) => { console.error('Vocal :', e.message); client.send('vocal', { refuse: 'erreur' }); }); return; }
    // Micro réservé aux abonnés Kopo+ (et coupé par la sanction « micro ») : le serveur décide, jamais le téléphone.
    if (type === 'micro') { const c = this.comptes.get(id); if (!this.abonne(id) || (c && c.micro_coupe)) { msg.voix = !!msg.voix && this.abonne(id); msg.muet = true; } }
    this.baremeAJour();
    const r = this.S.recevoir(this.salle, id, msg);
    if (!r.ok) { client.send('erreur', r.erreur); return; }
    if (r.evenement) { this.broadcast(r.evenement.type, r.evenement); return; } // émoji rapide : relayé à toute la table
    if (type === 'action' && msg.action && msg.action.type === 'katapss' && this.partie) this.partie.katapss.set(id, (this.partie.katapss.get(id) || 0) + 1);
    this.apresChangement();
  }

  abonne(id) { const { abonnement } = SalleKopo.services; return !!abonnement && abonnement.estAbonne(this.comptes.get(id)); }

  // Vue d'un joueur : celle de la salle, avec la couronne des abonnés Kopo+ (`plus`). Le micro passe par LiveKit :
  // plus d'identifiant PeerJS envoyé aux autres.
  vuePour(id) {
    const v = this.S.vue(this.salle, id);
    v.joueurs = v.joueurs.map((j) => Object.assign({}, j, { peerId: null }, this.abonne(j.id) ? { plus: true } : null));
    return v;
  }

  // L'admin vient d'activer (ou de retirer) Kopo+ : la couronne suit tout de suite à la table.
  majAbonne(id, jusqu) {
    const c = this.comptes.get(id);
    if (!c) return;
    c.kopo_plus_jusqu = jusqu;
    for (const [i, cl] of this.clientsParId) cl.send('vue', this.vuePour(i));
    // Plus abonné : sorti du salon vocal tout de suite, pas à la fin de son jeton.
    const { abonnement } = SalleKopo.services;
    if (abonnement && !abonnement.estAbonne(c)) {
      abonnement.retirerDuVocal({ salon: 'table-' + this.roomId, identite: id }).catch(() => {});
      const cl = this.clientsParId.get(id);
      if (cl) cl.send('vocal', { fin: 'abonnement' });
    }
  }

  // Micro : jeton du salon vocal de cette table (LiveKit), pour un abonné Kopo+ assis ici. Un non-abonné reçoit les prix.
  // Le compte est relu en base : un abonnement activé pendant la partie compte tout de suite.
  async donnerVocal(client, id) {
    const { abonnement, comptes } = SalleKopo.services;
    if (!this.salle.joueurs.some((j) => j.id === id && !j.robot)) return;
    if (this.entrainement || this.jour || this.fl) { client.send('vocal', { refuse: 'seul' }); return; }
    const c = (await comptes.lire(id)) || this.comptes.get(id);
    if (c && this.comptes.has(id)) Object.assign(this.comptes.get(id), { kopo_plus_jusqu: c.kopo_plus_jusqu, micro_coupe: c.micro_coupe });
    if (!abonnement.estAbonne(c)) { client.send('vocal', { refuse: 'abonnement', ...abonnement.offre() }); return; }
    if (!abonnement.microPret()) { client.send('vocal', { refuse: 'bientot' }); return; }
    const coupeHote = this.salle.joueurs.some((j) => j.id === id && j.micCoupe); // l'hôte a coupé son micro (éliminé)
    client.send('vocal', Object.assign(abonnement.jetonVocal({ compte: c, salon: 'table-' + this.roomId, parler: !c.micro_coupe && !coupeHote }), coupeHote ? { coupeHote: true } : null));
  }

  // Sticker animé : interrupteur de l'admin allumé, joueur assis, un toutes les 5 s, et une utilisation à décompter
  // (vérifiée en base). Relayé à toute la table ; l'envoyeur reçoit ce qu'il lui reste.
  async envoyerSticker(client, id, sticker) {
    const { stickers } = SalleKopo.services;
    if (!stickers || !stickers.actif()) { client.send('erreur', 'Les stickers arrivent bientôt.'); return; }
    if (typeof sticker !== 'string' || !stickers.STICKERS[sticker]) { client.send('erreur', 'Sticker inconnu.'); return; }
    if (!this.salle.joueurs.some((j) => j.id === id)) return;
    this.derniersStickers = this.derniersStickers || new Map();
    const t = Date.now();
    if (t - (this.derniersStickers.get(id) || 0) < ATTENTE_STICKER) { client.send('erreur', 'Un sticker toutes les 5 secondes.'); return; }
    this.derniersStickers.set(id, t);
    const restants = await stickers.utiliser(id, sticker);
    if (restants === null) {
      this.derniersStickers.delete(id);
      client.send('stickers', { sticker, restants: 0 });
      client.send('erreur', 'Plus d\'utilisations pour ce sticker.');
      return;
    }
    this.broadcast('sticker', { type: 'sticker', joueur: id, sticker });
    client.send('stickers', { sticker, restants });
  }

  apresChangement() {
    const s = this.salle;
    if (this.jour || this.fl) { // pas de pièces de partie, de ligue ni de parcours : seulement le score du jour, ou l'étape
      if (this.jour) this.suivreJour(); else this.suivreFleuve();
      if (s.etat !== 'salon' && !this.locked) this.lock();
      for (const [id, c] of this.clientsParId) c.send('vue', this.vuePour(id));
      return;
    }
    // Temps d'attente en salle publique (tableau de bord) : de l'arrivée du premier humain au départ de la partie.
    if (this.publique && s.etat === 'salon' && !this.salonDepuis && s.joueurs.some((j) => !j.robot)) this.salonDepuis = Date.now();
    if (s.etat === 'manche' && s.numeroManche === 1 && (!this.partie || this.partie.enregistree)) {
      const humains = s.joueurs.filter((j) => !j.robot).length;
      const classee = this.classee && !s.joueurs.some((j) => j.robot) && humains >= SalleKopo.services.reglages.get('ligue').joueursMin;
      const attente = this.salonDepuis ? Math.round((Date.now() - this.salonDepuis) / 1000) : null;
      this.salonDepuis = null;
      this.partie = { id: idAleatoire('p_'), katapss: new Map(), abandons: new Set(), coupures: new Set(), classee, enregistree: false, debut: new Date(), payeurs: new Set(), attente };
      // La page peut afficher « Partie classée » dès le début.
      for (const c of this.clientsParId.values()) c.send('classee', { classee });
      // Table à mise : chaque joueur paie sa mise au début de chaque partie (revanche comprise).
      if (this.mise) this.partie.prelevement = this.preleverMises(this.partie).catch((e) => console.error('Mises :', e.message));
    }
    if (s.etat === 'finPartie' && this.partie && !this.partie.enregistree) {
      this.partie.enregistree = true;
      this.enregistrerPartie().catch((e) => console.error('Enregistrement de partie :', e.message));
    }
    // Une partie commencée ne reçoit plus de nouveaux joueurs (seulement les reconnexions).
    if (s.etat !== 'salon' && !this.locked) this.lock();
    const places = this.entrainement ? 1 : this.publique ? this.taille : this.S.MAX;
    if (s.etat === 'salon' && this.maxClients !== places) this.maxClients = places; // place ajoutée par reserverRetour
    if (s.etat === 'salon' && this.locked && s.joueurs.length < places) this.unlock();
    this.setMetadata(this.meta(s.etat, s.joueurs.filter((j) => !j.robot).length));
    this.suivreMicros();
    for (const [id, c] of this.clientsParId) c.send('vue', this.vuePour(id));
  }

  // Micro coupé par l'hôte (joueur éliminé) : LiveKit lui retire tout de suite le droit de parler, et le lui rend
  // quand l'hôte change d'avis ou qu'une nouvelle partie commence. Le joueur est prévenu (message « vocal »).
  suivreMicros() {
    this.micsCoupes = this.micsCoupes || new Set();
    const { abonnement } = SalleKopo.services;
    for (const j of this.salle.joueurs) {
      const coupe = !!j.micCoupe, avant = this.micsCoupes.has(j.id);
      if (coupe === avant) continue;
      if (coupe) this.micsCoupes.add(j.id); else this.micsCoupes.delete(j.id);
      const c = this.comptes.get(j.id), parler = !coupe && !(c && c.micro_coupe);
      if (abonnement && abonnement.permissionVocal) abonnement.permissionVocal({ salon: 'table-' + this.roomId, identite: j.id, parler }).catch(() => {});
      const cl = this.clientsParId.get(j.id);
      if (cl) cl.send('vocal', { coupeHote: coupe, parler });
    }
    for (const id of [...this.micsCoupes]) if (!this.salle.joueurs.some((j) => j.id === id)) this.micsCoupes.delete(id); // parti de la table
  }

  // Mises : prélevées au début de la partie. Un joueur qui n'a plus assez (dépensé entre-temps)
  // joue quand même, mais ne peut rien gagner du pot.
  async preleverMises(p) {
    const { base, comptes } = SalleKopo.services;
    const { montant } = this.mise;
    for (const j of this.salle.joueurs) {
      if (j.robot || !this.comptes.has(j.id)) continue;
      const c = this.clientsParId.get(j.id);
      try {
        const solde = await base.transaction((q) => comptes.mouvement(q, j.id, -montant, 'mise', p.id));
        p.payeurs.add(j.id);
        if (c) c.send('solde', { solde });
      } catch (e) {
        if (c) c.send('erreur', 'Solde insuffisant pour la mise : tu joues cette partie sans pouvoir gagner le pot.');
      }
    }
    const pot = montant * p.payeurs.size;
    for (const id of p.payeurs) { const c = this.clientsParId.get(id); if (c) c.send('mise', { niveau: this.mise.niveau, mise: montant, pot }); }
  }

  // Partage du pot : vainqueur, 2e, 3e selon le tableau de bord ; la part de la maison est détruite,
  // comme la part d'une place tenue par un joueur qui a abandonné ou qui n'a pas payé.
  potParPlace(p, ordre) {
    const parts = SalleKopo.services.reglages.get('pot') || {};
    const pot = this.mise.montant * p.payeurs.size;
    const gains = new Map();
    [parts.vainqueur, parts.deuxieme, parts.troisieme].forEach((pct, i) => {
      const id = ordre[i];
      if (!id || !p.payeurs.has(id) || p.abandons.has(id)) return;
      const g = Math.floor((pot * (Number(pct) || 0)) / 100);
      if (g > 0) gains.set(id, g);
    });
    return { pot, gains };
  }

  // Fin de partie : historique, places, gains (rien si la table avait des robots).
  async enregistrerPartie() {
    const { base, comptes, reglages, ligue, social, parcours, parrainage } = SalleKopo.services;
    const s = this.salle, p = this.partie;
    if (p.prelevement) await p.prelevement;
    const humains = s.joueurs.filter((j) => !j.robot || j.remplace).map((j) => j.id).filter((id) => this.comptes.has(id));
    const avecRobots = s.joueurs.some((j) => j.robot && !j.remplace);
    // Classement : 1 = vainqueur, puis du dernier éliminé au premier.
    const ordre = [s.vainqueur, ...s.elimines.slice().reverse()];
    const place = (id) => ordre.indexOf(id) + 1 || null;
    const g = reglages.get('gains');
    const ev = evenementEnCours(reglages.get('evenement')); // événement en cours (Pilotage) : gains multipliés
    const fois = ev ? ev.pieces : 1;
    const partage = this.mise ? this.potParPlace(p, ordre) : null;
    await base.transaction(async (q) => {
      await q.query('INSERT INTO parties (id, code, publique, nb_joueurs, avec_robots, vainqueur, debut, fin, classee, jeu, attente_s) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8, $9, $10)',
        [p.id, this.code, this.publique, ordre.length, avecRobots, this.comptes.has(s.vainqueur) ? s.vainqueur : null, p.debut, p.classee && !avecRobots, this.jeu, p.attente === undefined ? null : p.attente]);
      // Plafond du tableau de bord : pièces gagnées au plus par jour (Kinshasa) aux tables gratuites (0 = sans plafond).
      const plafond = Math.max(0, Math.trunc(Number(g.plafondJour)) || 0);
      const dejaGagne = async (id) => Number((await q.query(`SELECT coalesce(sum(montant), 0)::int AS n FROM registre_pieces WHERE compte_id = $1
        AND motif IN ('manche', 'katapss', 'victoire', 'deuxieme') AND cree_le >= date_trunc('day', now() + interval '1 hour') - interval '1 hour'`, [id])).rows[0].n);
      for (const id of humains) {
        const pl = place(id);
        await q.query('INSERT INTO participations (partie_id, compte_id, place, abandon) VALUES ($1,$2,$3,$4)', [p.id, id, pl, p.abandons.has(id)]);
        if (partage) { // table à mise : le pot remplace les gains des tables gratuites
          if (partage.gains.has(id)) await comptes.mouvement(q, id, partage.gains.get(id), 'pot', p.id);
          continue;
        }
        if (avecRobots || p.abandons.has(id) || !pl) continue; // pas de gains contre les robots (strategie-pieces §3)
        // Mode Cahier : une donne n'est pas une manche, le vainqueur « survit » à chaque éliminé (sinon trop de pièces).
        const manchesSurvecues = pl === 1 ? (s.cahier ? s.elimines.length : s.numeroManche) : s.elimines.indexOf(id);
        const gains = [
          [manchesSurvecues * g.manche, 'manche'],
          [(p.katapss.get(id) || 0) * g.katapss, 'katapss'],
          [pl === 1 ? g.victoire : 0, 'victoire'],
          [pl === 2 ? g.deuxieme : 0, 'deuxieme'],
        ];
        let reste = plafond ? Math.max(0, plafond - (await dejaGagne(id))) : Infinity;
        for (const [montant, motif] of gains) {
          const m = Math.min(Math.round(montant * fois), reste);
          if (m > 0) { await comptes.mouvement(q, id, m, motif, p.id); reste -= m; }
        }
      }
    });
    // Ligue : points selon la place, envoyés à chacun pour l'écran de fin.
    let resultats = new Map();
    if (p.classee && !avecRobots) {
      resultats = await ligue.enregistrerPartie({
        partieId: p.id, n: ordre.length,
        joueurs: humains.map((id) => ({ id, place: place(id), abandon: p.abandons.has(id), coupure: p.coupures.has(id) && !p.abandons.has(id) })),
      }).catch((e) => { console.error('Ligue :', e.message); return new Map(); });
    }
    // Parcours de saison : XP pour les parties entre humains (pas de robots, comme pour les pièces).
    let xps = new Map();
    if (parcours && !avecRobots && humains.length >= 2) { // Kopo et Inter (8) : un seul parcours de saison, partagé
      xps = await parcours.enregistrerPartie(p.id, humains.map((id) => {
        const pl = place(id);
        return { id, place: pl, abandon: p.abandons.has(id), manchesSurvecues: !pl ? 0 : pl === 1 ? (s.cahier ? s.elimines.length : s.numeroManche) : s.elimines.indexOf(id) };
      })).catch((e) => { console.error('Parcours :', e.message); return new Map(); });
    }
    // Parrainage : le filleul avance ; à sa dernière partie, son parrain et lui reçoivent leur cadeau.
    if (parrainage && !avecRobots && humains.length >= 2) await parrainage.apresPartie(humains).catch((e) => console.error('Parrainage :', e.message));
    // Face-à-face et notifications de rivalité (« Kevin t'a rattrapé : 7 – 7 ! ») : seulement un vrai duel, deux humains
    // seuls à la table (Kopo et Inter (8), un seul score par paire). Une partie à 3 ou plus ne compte pas, comme sur le téléphone.
    const duel = !avecRobots && ordre.length === 2 && humains.length === 2;
    if (social && duel) await social.apresPartie(humains.map((id) => ({ id, place: place(id), abandon: p.abandons.has(id) }))).catch((e) => console.error('Rivalités :', e.message));
    for (const [id, c] of this.clientsParId) {
      const compte = await comptes.lire(id);
      // Face-à-face tenus par le serveur : les deux joueurs voient le même score (le téléphone ne compte que ce qu'il a vu).
      if (social && duel && humains.includes(id)) {
        const duels = await social.duels(id, humains.filter((x) => x !== id)).catch(() => []);
        if (duels.length) c.send('faceAFace', duels);
      }
      if (compte) c.send('solde', { solde: compte.solde });
      if (partage && p.payeurs.has(id)) c.send('pot', { pot: partage.pot, gain: partage.gains.get(id) || 0, place: place(id) });
      if (resultats.has(id)) c.send('ligue', resultats.get(id));
      if (xps.has(id)) c.send('parcours', xps.get(id));
    }
  }

  // Tableau de bord : exclure un joueur banni ou suspendu en pleine partie.
  exclure(id, raison) {
    const c = this.clientsParId.get(id);
    if (!c) return false;
    try { c.send('exclu', raison); c.leave(4001); } catch (e) {}
    return true;
  }
}

// Options d'ouverture d'une salle d'entraînement, vérifiées (valeurs par défaut sinon) :
// { jeu: 'kopo'|'inter8', robots: 1..MAX-1, niveau: 'faciles'|'normaux'|'forts'|'gentils', niveauJoueur: 1..1000,
//   delai: secondes (DELAIS du jeu), mode: 'simple'|'delire', jRetour: bool (Inter (8)), lancer: bool }.
function optionsEntrainement(S, o = {}) {
  const robots = Math.min(S.MAX - 1, Math.max(1, Math.trunc(Number(o.robots)) || 2));
  const reglages = {};
  if (S.NIVEAUX_ROBOTS.concat('gentils').includes(o.niveau)) {
    reglages.robots = o.niveau;
    if (Number.isInteger(o.niveauJoueur) && o.niveauJoueur >= 1 && o.niveauJoueur <= 1000) reglages.niveau = o.niveauJoueur;
  }
  if (o.delai !== undefined && S.DELAIS.includes(o.delai)) reglages.delai = o.delai;
  else if (reglages.robots === undefined) reglages.delai = S.DELAIS.includes(5) ? 5 : S.DELAIS[1];
  if (S === SI && SI.MODES.includes(o.mode)) {
    reglages.mode = o.mode;
    if (typeof o.jRetour === 'boolean') reglages.jRetour = o.jRetour;
    if (SI.FORMULES.includes(o.formule)) reglages.formule = o.formule;
    if (Number.isInteger(o.total)) reglages.total = o.total; // vérifié par la salle (montants de Pilotage)
  }
  return { robots, reglages, lancer: o.lancer === true };
}

// Retrouver la place d'un joueur avec le code de la salle (POST /api/reprendre).
async function reprendre(compte, code) {
  for (const salle of salles) {
    if (salle.code !== code) continue;
    const r = await salle.reserverRetour(compte);
    if (r) return r;
  }
  return null;
}

// Quelle salle ouverte porte ce code ? (GET /api/salles/:code) Les salles d'entraînement et du Match du jour ne se rejoignent pas.
function salleParCode(code) {
  for (const s of salles) {
    if (s.code !== code || s.entrainement || s.jour || s.fl) continue;
    return { code, jeu: s.jeu, salle: s.roomName, roomId: s.roomId, etat: s.salle.etat, publique: s.publique, mise: s.mise ? s.mise.niveau : null, mode: s.jeu === 'inter8' ? s.salle.mode : null, joueurs: s.salle.joueurs.filter((j) => !j.robot).length, places: s.publique ? s.taille : s.S.MAX, pleine: s.salle.joueurs.length >= (s.publique ? s.taille : s.S.MAX) };
  }
  return null;
}

module.exports = { SalleKopo, salles, DEBLOCAGE, reprendre, salleParCode, optionsEntrainement };
