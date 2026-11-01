// Salle Colyseus : fait tourner une partie de Kopo sur le serveur.
// Toute la logique de jeu reste dans src/kopo-salle.js (la même que sur le téléphone de l'hôte) :
// le serveur lui passe les messages des joueurs et envoie à chacun SA vue.
'use strict';
const { Room } = require('colyseus');
const S = require('../../src/kopo-salle.js');
const { idAleatoire } = require('./comptes');

const salles = new Set(); // salles ouvertes (tableau de bord : en direct)
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const nouveauCode = () => Array.from({ length: 4 }, () => LETTRES[Math.floor(Math.random() * LETTRES.length)]).join('');

class SalleKopo extends Room {
  // Services (comptes, base, réglages) injectés au démarrage par index.js.
  static services = null;

  onCreate(options = {}) {
    this.maxClients = S.MAX;
    this.autoDispose = true;
    this.code = options.code && /^[A-Z]{4}$/.test(options.code) ? options.code : nouveauCode();
    this.publique = !!options.publique;
    this.salle = S.creerSalle(this.code);
    // Salle publique : N joueurs inconnus, elle démarre seule quand elle est pleine.
    this.taille = this.publique ? Math.min(S.MAX, Math.max(S.MIN, Number(options.taille) || S.MAX)) : null;
    if (this.publique) { S.rendrePublique(this.salle, this.taille); this.maxClients = this.taille; }
    // Les amis peuvent aussi rejoindre une salle publique avec son code.
    if (this.listing) this.listing.code = this.code;
    if (options.rapide && process.env.KOPO_TESTS === '1') this.salle.durees = { depart: 0, finTour: 0, mancheAuto: 1 }; // tests seulement
    this.clientsParId = new Map();
    this.comptes = new Map(); // id -> compte (au moment de l'entrée)
    this.partie = null; // { id, katapss: Map, abandons: Set, coupures: Set, classee, enregistree }
    // Ligue : seulement en salle publique (inconnus placés au hasard). Dès qu'un joueur entre
    // avec le code (un ami), la salle n'est plus classée : pas de complicité (strategie-pieces §6.3).
    this.classee = this.publique;
    this.setMetadata(this.meta('salon', 0));
    salles.add(this);

    this.onMessage('*', (client, type, msg) => this.recevoir(client, type, msg));
    this.setSimulationInterval(() => { if (S.tic(this.salle)) this.apresChangement(); }, 200);
  }

  async onAuth(client, options = {}) {
    const { auth, comptes } = SalleKopo.services;
    const id = await auth.verifierJoueur(options.jeton);
    if (!id) throw new Error('Connexion requise.');
    const c = await comptes.statut(id);
    if (!c || c.statut === 'supprime') throw new Error('Compte inconnu.');
    if (c.statut === 'banni') throw new Error('Ce compte est banni.');
    if (c.statut === 'suspendu') throw new Error('Compte suspendu jusqu\'au ' + new Date(c.suspendu_jusqu).toLocaleString('fr-FR') + '.');
    return c;
  }

  meta(etat, joueurs) { return { code: this.code, publique: this.publique, taille: this.taille, etat, joueurs, classee: this.classee }; }

  onJoin(client, options, compte) {
    const id = compte.id;
    if (this.publique && options && options.code && this.salle.etat === 'salon') this.classee = false;
    const ancien = this.clientsParId.get(id);
    if (ancien && ancien !== client) try { ancien.leave(4000); } catch (e) {} // même compte ouvert ailleurs
    const r = S.recevoir(this.salle, id, { type: 'rejoindre', nom: compte.pseudo });
    if (!r.ok) throw new Error(r.erreur);
    client.userData = { id };
    this.clientsParId.set(id, client);
    this.comptes.set(id, compte);
    this.apresChangement();
  }

  async onLeave(client, volontaire) {
    const id = client.userData && client.userData.id;
    if (!id) return;
    S.deconnecter(this.salle, id);
    if (volontaire && this.partie && this.salle.etat !== 'salon') this.partie.abandons.add(id);
    const partie = this.partie;
    if (!volontaire && partie && this.salle.etat !== 'salon') partie.coupures.add(id); // pas sa faute : pas de points perdus
    this.apresChangement();
    if (volontaire) return;
    try {
      await this.allowReconnection(client, 120); // 2 minutes pour revenir après une coupure réseau
      if (partie) partie.coupures.delete(id);
      S.reconnecter(this.salle, id);
      this.apresChangement();
    } catch (e) { /* pas revenu : un robot peut le remplacer (règle de la salle) */ }
  }

  onDispose() { salles.delete(this); }

  recevoir(client, type, msg) {
    const id = client.userData && client.userData.id;
    if (!id) return;
    msg = Object.assign({}, msg && typeof msg === 'object' ? msg : {}, { type });
    if (type === 'rejoindre') return; // l'entrée passe par onJoin
    if (type === 'sync') { client.send('vue', S.vue(this.salle, id)); return; } // la page demande sa vue dès qu'elle écoute
    if (type === 'reaction') { // chat : seulement les messages choisis dans le tableau de bord
      const liste = SalleKopo.services.reglages.get('messagesRapides') || [];
      if (!liste.includes(typeof msg.emoji === 'string' ? msg.emoji.trim() : '')) { client.send('erreur', 'Ce message n\'est plus proposé.'); return; }
    }
    if (type === 'micro' && this.comptes.get(id) && this.comptes.get(id).micro_coupe) msg.voix = false; // sanction
    const r = S.recevoir(this.salle, id, msg);
    if (!r.ok) { client.send('erreur', r.erreur); return; }
    if (r.evenement) { this.broadcast(r.evenement.type, r.evenement); return; } // émoji rapide : relayé à toute la table
    if (type === 'action' && msg.action && msg.action.type === 'katapss' && this.partie) this.partie.katapss.set(id, (this.partie.katapss.get(id) || 0) + 1);
    this.apresChangement();
  }

  apresChangement() {
    const s = this.salle;
    if (s.etat === 'manche' && s.numeroManche === 1 && (!this.partie || this.partie.enregistree)) {
      const humains = s.joueurs.filter((j) => !j.robot).length;
      const classee = this.classee && !s.joueurs.some((j) => j.robot) && humains >= SalleKopo.services.reglages.get('ligue').joueursMin;
      this.partie = { id: idAleatoire('p_'), katapss: new Map(), abandons: new Set(), coupures: new Set(), classee, enregistree: false, debut: new Date() };
      // La page peut afficher « Partie classée » dès le début.
      for (const c of this.clientsParId.values()) c.send('classee', { classee });
    }
    if (s.etat === 'finPartie' && this.partie && !this.partie.enregistree) {
      this.partie.enregistree = true;
      this.enregistrerPartie().catch((e) => console.error('Enregistrement de partie :', e.message));
    }
    // Une partie commencée ne reçoit plus de nouveaux joueurs (seulement les reconnexions).
    if (s.etat !== 'salon' && !this.locked) this.lock();
    if (s.etat === 'salon' && this.locked && s.joueurs.length < (this.publique ? this.taille : S.MAX)) this.unlock();
    this.setMetadata(this.meta(s.etat, s.joueurs.filter((j) => !j.robot).length));
    for (const [id, c] of this.clientsParId) c.send('vue', S.vue(s, id));
  }

  // Fin de partie : historique, places, gains (rien si la table avait des robots).
  async enregistrerPartie() {
    const { base, comptes, reglages, ligue, social, parcours, parrainage } = SalleKopo.services;
    const s = this.salle, p = this.partie;
    const humains = s.joueurs.filter((j) => !j.robot || j.remplace).map((j) => j.id).filter((id) => this.comptes.has(id));
    const avecRobots = s.joueurs.some((j) => j.robot && !j.remplace);
    // Classement : 1 = vainqueur, puis du dernier éliminé au premier.
    const ordre = [s.vainqueur, ...s.elimines.slice().reverse()];
    const place = (id) => ordre.indexOf(id) + 1 || null;
    const g = reglages.get('gains');
    await base.transaction(async (q) => {
      await q.query('INSERT INTO parties (id, code, publique, nb_joueurs, avec_robots, vainqueur, debut, fin, classee) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)',
        [p.id, this.code, this.publique, ordre.length, avecRobots, this.comptes.has(s.vainqueur) ? s.vainqueur : null, p.debut, p.classee && !avecRobots]);
      for (const id of humains) {
        const pl = place(id);
        await q.query('INSERT INTO participations (partie_id, compte_id, place, abandon) VALUES ($1,$2,$3,$4)', [p.id, id, pl, p.abandons.has(id)]);
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
    if (parcours && !avecRobots && humains.length >= 2) {
      xps = await parcours.enregistrerPartie(p.id, humains.map((id) => {
        const pl = place(id);
        return { id, place: pl, abandon: p.abandons.has(id), manchesSurvecues: !pl ? 0 : pl === 1 ? s.numeroManche : s.elimines.indexOf(id) };
      })).catch((e) => { console.error('Parcours :', e.message); return new Map(); });
    }
    // Parrainage : le filleul avance ; à sa dernière partie, son parrain et lui reçoivent leur cadeau.
    if (parrainage && !avecRobots && humains.length >= 2) await parrainage.apresPartie(humains).catch((e) => console.error('Parrainage :', e.message));
    // Face-à-face et notifications de rivalité (« Kevin t'a rattrapé : 7 – 7 ! »).
    if (social) await social.apresPartie(humains.map((id) => ({ id, place: place(id), abandon: p.abandons.has(id) }))).catch((e) => console.error('Rivalités :', e.message));
    for (const [id, c] of this.clientsParId) {
      const compte = await comptes.lire(id);
      // Face-à-face tenus par le serveur : les deux joueurs voient le même score (le téléphone ne compte que ce qu'il a vu).
      if (social && !avecRobots && humains.includes(id)) {
        const duels = await social.duels(id, humains.filter((x) => x !== id)).catch(() => []);
        if (duels.length) c.send('faceAFace', duels);
      }
      if (compte) c.send('solde', { solde: compte.solde });
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

module.exports = { SalleKopo, salles };
