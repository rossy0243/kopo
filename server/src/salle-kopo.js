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
const { etatJeuPour, NOMS_JEUX } = require('./reglages');

const salles = new Set(); // salles ouvertes (tableau de bord : en direct)
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ';
// Tables à mise (strategie-pieces §4.1) : un niveau se débloque quand on a 10 fois la mise.
const DEBLOCAGE = 10;
const NOMS_TABLES = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant' };
const nouveauCode = () => Array.from({ length: 4 }, () => LETTRES[Math.floor(Math.random() * LETTRES.length)]).join('');

class SalleKopo extends Room {
  // Services (comptes, base, réglages) injectés au démarrage par index.js.
  static services = null;

  onCreate(options = {}) {
    this.jeu = this.roomName === 'inter8' ? 'inter8' : 'kopo';
    this.S = this.jeu === 'inter8' ? SI : SK;
    this.maxClients = this.S.MAX;
    this.autoDispose = true;
    // Un code n'est jamais partagé par deux salles ouvertes, Kopo et Inter (8) confondus :
    // sinon un ami qui tape le code pourrait arriver dans la mauvaise partie.
    const pris = (c) => [...salles].some((x) => x.code === c);
    this.code = options.code && /^[A-Z]{4}$/.test(options.code) && !pris(options.code) ? options.code : nouveauCode();
    while (pris(this.code)) this.code = nouveauCode();
    this.publique = !!options.publique;
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
    } else this.salle = this.S.creerSalle(this.code);
    // Inter (8) : le style choisi à la création (« Quelle partie ? »), modifiable ensuite dans le salon.
    if (this.jeu === 'inter8' && SI.MODES.includes(options.mode)) this.salle.mode = options.mode;
    // Salle publique : N joueurs inconnus, elle démarre seule quand elle est pleine.
    this.taille = this.publique ? Math.min(this.S.MAX, Math.max(this.S.MIN, Number(options.taille) || this.S.MAX)) : null;
    if (this.publique) { this.S.rendrePublique(this.salle, this.taille); this.maxClients = this.taille; }
    // Table à mise : salles « kopo-mise », publiques seulement (inconnus placés au hasard, pas de code : strategie-pieces §6.3).
    // Le montant est fixé à l'ouverture de la salle (un changement dans le tableau de bord vaut pour les salles suivantes).
    this.mise = null;
    if (this.roomName === 'kopo-mise') {
      const tables = SalleKopo.services.reglages.get('tables') || {};
      const montant = Math.trunc(Number(tables[options.mise]));
      if (!this.publique || !NOMS_TABLES[options.mise] || !(montant > 0)) throw new Error('Table à mise inconnue.');
      this.mise = { niveau: options.mise, montant };
    }
    // Les amis peuvent aussi rejoindre une salle publique avec son code.
    if (this.listing) this.listing.code = this.code;
    const rapide = options.rapide && process.env.KOPO_TESTS === '1';
    if (rapide) { this.salle.durees = { depart: 0, finTour: 0, mancheAuto: 1 }; if (this.jour) this.salle.pauseRobot = 0; } // tests seulement
    this.clientsParId = new Map();
    this.comptes = new Map(); // id -> compte (au moment de l'entrée)
    this.attentes = new Map(); // id -> reconnexion en attente (allowReconnection), annulée si le joueur revient par le code
    this.partie = null; // { id, katapss: Map, abandons: Set, coupures: Set, classee, enregistree }
    // Ligue : seulement en salle publique (inconnus placés au hasard). Dès qu'un joueur entre
    // avec le code (un ami), la salle n'est plus classée : pas de complicité (strategie-pieces §6.3).
    this.classee = this.publique && !this.jour && this.jeu === 'kopo'; // ligue d'Inter (8) : plus tard, séparée
    this.setMetadata(this.meta('salon', 0));
    salles.add(this);

    this.onMessage('*', (client, type, msg) => this.recevoir(client, type, msg));
    this.setSimulationInterval(() => {
      if (this.jour && this.jour.termine) return; // Match du jour fini pour le joueur : les robots s'arrêtent
      // Les robots jouent l'un après l'autre : en test, plusieurs coups par tour de boucle.
      for (let i = 0; i < (rapide && this.jour ? 50 : 1); i++) { if (!this.S.tic(this.salle)) break; this.apresChangement(); if (this.jour && this.jour.termine) break; }
    }, rapide && this.jour ? 20 : 200);
  }

  async onAuth(client, options = {}) {
    const { auth, comptes } = SalleKopo.services;
    const id = await auth.verifierJoueur(options.jeton);
    if (!id) throw new Error('Connexion requise.');
    const c = await comptes.statut(id);
    if (!c || c.statut === 'supprime') throw new Error('Compte inconnu.');
    if (c.statut === 'banni') throw new Error('Ce compte est banni.');
    if (c.statut === 'suspendu') throw new Error('Compte suspendu jusqu\'au ' + new Date(c.suspendu_jusqu).toLocaleString('fr-FR') + '.');
    // Jeu en maintenance, ou réservé aux testeurs : on n'entre plus (sauf pour reprendre sa place).
    const etat = etatJeuPour(SalleKopo.services.reglages.get('jeux'), this.jeu, c.pseudo);
    const assis = this.salle && this.salle.joueurs.some((j) => j.id === c.id);
    if (!assis && etat === 'maintenance') throw new Error(`${NOMS_JEUX[this.jeu]} est en maintenance. On revient très vite !`);
    if (!assis && etat === 'ferme') throw new Error(`${NOMS_JEUX[this.jeu]} n'est pas encore ouvert.`);
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
    this.apresChangement();
  }

  // Match du jour : 8 robots aux places fixes, puis la partie part tout de suite.
  lancerJour(id, client) {
    const { ROBOTS } = SalleKopo.services.matchJour;
    ROBOTS.forEach((r, i) => this.salle.joueurs.push({ id: r, nom: 'Robot ' + (i + 1), connecte: true, robot: true, voix: false, muet: true }));
    this.salle.donne = { graine: this.jour.graine, ordre: [id].concat(ROBOTS) };
    this.S.recevoir(this.salle, id, { type: 'lancer' });
    client.send('matchJour', { debut: true, numero: this.jour.numero, officiel: this.jour.officiel });
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
  }

  recevoir(client, type, msg) {
    const id = client.userData && client.userData.id;
    if (!id) return;
    msg = Object.assign({}, msg && typeof msg === 'object' ? msg : {}, { type });
    if (type === 'rejoindre') return; // l'entrée passe par onJoin
    // Match du jour : la table est fixée par le serveur (robots, donne), pas de revanche ni de réglages.
    if (this.jour && ['lancer', 'ajouterRobot', 'retirer', 'remplacerParRobot', 'reglages', 'revanche', 'revancheNon', 'rejouer'].includes(type)) { client.send('erreur', 'Pas pendant le Match du jour.'); return; }
    if (type === 'sync') { client.send('vue', this.S.vue(this.salle, id)); return; } // la page demande sa vue dès qu'elle écoute
    if (type === 'reaction') { // chat : seulement les messages choisis dans le tableau de bord
      const liste = SalleKopo.services.reglages.get('messagesRapides') || [];
      if (!liste.includes(typeof msg.emoji === 'string' ? msg.emoji.trim() : '')) { client.send('erreur', 'Ce message n\'est plus proposé.'); return; }
    }
    if (type === 'micro' && this.comptes.get(id) && this.comptes.get(id).micro_coupe) msg.voix = false; // sanction
    const r = this.S.recevoir(this.salle, id, msg);
    if (!r.ok) { client.send('erreur', r.erreur); return; }
    if (r.evenement) { this.broadcast(r.evenement.type, r.evenement); return; } // émoji rapide : relayé à toute la table
    if (type === 'action' && msg.action && msg.action.type === 'katapss' && this.partie) this.partie.katapss.set(id, (this.partie.katapss.get(id) || 0) + 1);
    this.apresChangement();
  }

  apresChangement() {
    const s = this.salle;
    if (this.jour) { // pas de pièces, de ligue ni de parcours : seulement le score du jour
      this.suivreJour();
      if (s.etat !== 'salon' && !this.locked) this.lock();
      for (const [id, c] of this.clientsParId) c.send('vue', this.S.vue(s, id));
      return;
    }
    if (s.etat === 'manche' && s.numeroManche === 1 && (!this.partie || this.partie.enregistree)) {
      const humains = s.joueurs.filter((j) => !j.robot).length;
      const classee = this.classee && !s.joueurs.some((j) => j.robot) && humains >= SalleKopo.services.reglages.get('ligue').joueursMin;
      this.partie = { id: idAleatoire('p_'), katapss: new Map(), abandons: new Set(), coupures: new Set(), classee, enregistree: false, debut: new Date(), payeurs: new Set() };
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
    const places = this.publique ? this.taille : this.S.MAX;
    if (s.etat === 'salon' && this.maxClients !== places) this.maxClients = places; // place ajoutée par reserverRetour
    if (s.etat === 'salon' && this.locked && s.joueurs.length < places) this.unlock();
    this.setMetadata(this.meta(s.etat, s.joueurs.filter((j) => !j.robot).length));
    for (const [id, c] of this.clientsParId) c.send('vue', this.S.vue(s, id));
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
    const partage = this.mise ? this.potParPlace(p, ordre) : null;
    await base.transaction(async (q) => {
      await q.query('INSERT INTO parties (id, code, publique, nb_joueurs, avec_robots, vainqueur, debut, fin, classee, jeu) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8, $9)',
        [p.id, this.code, this.publique, ordre.length, avecRobots, this.comptes.has(s.vainqueur) ? s.vainqueur : null, p.debut, p.classee && !avecRobots, this.jeu]);
      for (const id of humains) {
        const pl = place(id);
        await q.query('INSERT INTO participations (partie_id, compte_id, place, abandon) VALUES ($1,$2,$3,$4)', [p.id, id, pl, p.abandons.has(id)]);
        if (partage) { // table à mise : le pot remplace les gains des tables gratuites
          if (partage.gains.has(id)) await comptes.mouvement(q, id, partage.gains.get(id), 'pot', p.id);
          continue;
        }
        if (avecRobots || p.abandons.has(id) || !pl) continue; // pas de gains contre les robots (strategie-pieces §3)
        const manchesSurvecues = pl === 1 ? s.numeroManche : s.elimines.indexOf(id);
        const gains = [
          [manchesSurvecues * g.manche, 'manche'],
          [(p.katapss.get(id) || 0) * g.katapss, 'katapss'],
          [pl === 1 ? g.victoire : 0, 'victoire'],
          [pl === 2 ? g.deuxieme : 0, 'deuxieme'],
        ];
        for (const [montant, motif] of gains) if (montant > 0) await comptes.mouvement(q, id, montant, motif, p.id);
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
    if (parcours && this.jeu === 'kopo' && !avecRobots && humains.length >= 2) { // Inter (8) : à l'étape de la progression
      xps = await parcours.enregistrerPartie(p.id, humains.map((id) => {
        const pl = place(id);
        return { id, place: pl, abandon: p.abandons.has(id), manchesSurvecues: !pl ? 0 : pl === 1 ? s.numeroManche : s.elimines.indexOf(id) };
      })).catch((e) => { console.error('Parcours :', e.message); return new Map(); });
    }
    // Parrainage : le filleul avance ; à sa dernière partie, son parrain et lui reçoivent leur cadeau.
    if (parrainage && !avecRobots && humains.length >= 2) await parrainage.apresPartie(humains).catch((e) => console.error('Parrainage :', e.message));
    // Face-à-face et notifications de rivalité (« Kevin t'a rattrapé : 7 – 7 ! ») : entre humains seulement, comme sur le téléphone.
    if (social && this.jeu === 'kopo' && !avecRobots) await social.apresPartie(humains.map((id) => ({ id, place: place(id), abandon: p.abandons.has(id) }))).catch((e) => console.error('Rivalités :', e.message));
    for (const [id, c] of this.clientsParId) {
      const compte = await comptes.lire(id);
      // Face-à-face tenus par le serveur : les deux joueurs voient le même score (le téléphone ne compte que ce qu'il a vu).
      if (social && this.jeu === 'kopo' && !avecRobots && humains.includes(id)) {
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

// Retrouver la place d'un joueur avec le code de la salle (POST /api/reprendre).
async function reprendre(compte, code) {
  for (const salle of salles) {
    if (salle.code !== code) continue;
    const r = await salle.reserverRetour(compte);
    if (r) return r;
  }
  return null;
}

module.exports = { SalleKopo, salles, DEBLOCAGE, reprendre };
