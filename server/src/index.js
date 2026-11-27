// Serveur du Kopo : API des joueurs, salles de jeu (Colyseus), tableau de bord admin.
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { Server, matchMaker } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { ouvrirBase } = require('./base');
const { creerAuth } = require('./auth');
const { creerReglages } = require('./reglages');
const { creerComptes, migrerPseudos } = require('./comptes');
const { routesJoueurs } = require('./api');
const { routesAdmin } = require('./admin');
const { SalleKopo, salles, reprendre, salleParCode } = require('./salle-kopo');
const { creerLigue } = require('./ligue');
const { creerSocial } = require('./social');
const { creerParcours } = require('./parcours');
const { creerParrainage } = require('./parrainage');
const { creerMatchJour } = require('./match-jour');
const { creerBande } = require('./bande');
const { creerFleuve } = require('./fleuve');
const { creerPush } = require('./push');
const { creerStickers } = require('./stickers');
const { creerBouquets } = require('./bouquets');
const { creerAbonnement } = require('./abonnement');
const { permis } = require('./limites');
const { creerLegal } = require('./legal');

async function demarrer({ port = Number(process.env.PORT || 2567), env = process.env } = {}) {
  const base = await ouvrirBase(env.DATABASE_URL);
  await migrerPseudos(base);
  const auth = creerAuth(env);
  const reglages = creerReglages(base);
  await reglages.charger();
  const comptes = creerComptes(base, reglages);
  const ligue = creerLigue(base, reglages, comptes);
  await ligue.assurerSaison(); // ouvre la saison 1 au premier démarrage
  // Chaque minute : la saison finie est clôturée (récompenses) et la suivante s'ouvre.
  const minuteurSaison = setInterval(() => ligue.assurerSaison().then((r) => r.cloturee && console.log(`Saison ${r.cloturee} clôturée, saison ${r.ouverte} ouverte.`)).catch((e) => console.error('Saison :', e.message)), 60e3);
  minuteurSaison.unref();
  const push = creerPush(base, reglages, env);
  if (!push.actif()) console.log('Notifications push éteintes (VAPID_PUBLIC et VAPID_PRIVE absents).');
  push.comptes = comptes; // relance des absents : pièces offertes
  const social = creerSocial(base, push);
  const parcours = creerParcours(base, reglages, comptes, ligue);
  // Cadres retirés : les cadres achetés en boutique sont remboursés (une seule fois par cadre).
  await parcours.rembourserCadres().then((r) => r.pieces && console.log(`Cadres remboursés : ${r.remboursements} achats, ${r.pieces} pièces.`)).catch((e) => console.error('Remboursement des cadres :', e.message));
  const parrainage = creerParrainage(base, reglages, comptes, social, env);
  const matchJour = creerMatchJour(base, reglages, env);
  const bande = creerBande(base, reglages, comptes, matchJour, social);
  const stickers = creerStickers(base, reglages, comptes);
  const fleuve = creerFleuve(base, reglages, comptes, social);
  await fleuve.nettoyer().catch((e) => console.error('Fleuve :', e.message)); // aucune étape n'a survécu au redémarrage
  fleuve.recalculerSeuils().catch((e) => console.error('Fleuve, seuils :', e.message)) // en tâche de fond, une seule fois
    .then(() => fleuve.reparerFinales()).catch((e) => console.error('Fleuve, finales :', e.message)); // puis les finales perdues d'avance
  const bouquets = creerBouquets(base, reglages, comptes);
  const legal = creerLegal(base); // pages légales (CGU, confidentialité) modifiables dans le tableau de bord
  await legal.charger();
  const abonnement = creerAbonnement(base, env);
  abonnement.prix = () => reglages.get('kopoPlus');
  require('./limites').appliquerLimites(reglages.get('limites'));
  if (!abonnement.microPret()) console.log('Micro éteint (LIVEKIT_URL, LIVEKIT_API_KEY et LIVEKIT_API_SECRET absents).');
  abonnement.majSalles = (id, jusqu) => { for (const s of salles) if (s.majAbonne) s.majAbonne(id, jusqu); };
  // La veille de la fin d'un abonnement (ou de l'essai) : une notification avec les prix.
  const minuteurRappels = setInterval(() => abonnement.rappels(social.notifier).catch((e) => console.error('Kopo+ :', e.message)), 10 * 60e3);
  minuteurRappels.unref();
  // Chaque minute : semaines de Bande finies (pot partagé), mises automatiques du lundi, rappel du soir.
  const minuteurBande = setInterval(() => bande.tic().catch((e) => console.error('Bande :', e.message)), 60e3);
  minuteurBande.unref();
  // Chaque minute : rappel du Match du jour en push (une fois, à 19 h à Kinshasa).
  // Chaque minute : la course de la semaine du Fleuve est réglée dès lundi minuit (Kinshasa).
  const minuteurFleuve = setInterval(() => fleuve.tic().catch((e) => console.error('Fleuve, course :', e.message)), 60e3);
  minuteurFleuve.unref();
  const minuteurPush = setInterval(() => push.tic().catch((e) => console.error('Push :', e.message)), 60e3);
  minuteurPush.unref();
  // Jouer en ligne ou entre amis demande un compte Google dès que la connexion Google est active.
  const googleObligatoire = env.CONNEXION_GOOGLE === '1' && !!env.SUPABASE_URL;
  SalleKopo.services = { base, auth, comptes, reglages, ligue, social, parcours, parrainage, matchJour, bande, fleuve, stickers, abonnement, googleObligatoire };

  const app = express();
  app.set('trust proxy', 1);
  // La page du jeu est servie ailleurs (GitHub Pages, application mobile) : on autorise ces origines.
  const origines = (env.ORIGINES || '*').split(',').map((o) => o.trim());
  app.use((req, res, next) => {
    const o = req.get('origin');
    if (o && (origines.includes('*') || origines.includes(o))) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); }
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Masano-Client');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  // version = commit déployé (Render le donne dans RENDER_GIT_COMMIT) : pour vérifier qu'une mise à jour est en ligne.
  app.get('/sante', (req, res) => res.json({ ok: true, salles: salles.size, version: (env.RENDER_GIT_COMMIT || '').slice(0, 7) || null }));
  // API des joueurs : /api (site) et /api/v1 (applis mobiles, version figée de l'API). Les deux servent les mêmes routes.
  const routes = routesJoueurs({ base, auth, comptes, reglages, ligue, social, parcours, parrainage, matchJour, bande, fleuve, push, stickers, bouquets, abonnement, legal, env });

  // Compteur en ligne et salles ouvertes (lu par l'accueil).
  routes.get('/en-ligne', async (req, res) => {
    let joueurs = 0; for (const s of salles) joueurs += s.clientsParId.size;
    const ouvertes = [...(await matchMaker.query({ name: 'kopo' })), ...(await matchMaker.query({ name: 'kopo-mise' })), ...(await matchMaker.query({ name: 'inter8' })), ...(await matchMaker.query({ name: 'inter8-mise' }))].filter((r) => r.metadata && r.metadata.publique && r.metadata.etat === 'salon' && !r.locked);
    res.json({ joueurs, sallesOuvertes: ouvertes.map((r) => ({ jeu: r.metadata.jeu || 'kopo', id: r.roomId, code: r.metadata.code, taille: r.metadata.taille, joueurs: r.clients, classee: !!r.metadata.classee, mise: r.metadata.mise ? r.metadata.mise.niveau : null })) });
  });

  // Quelle salle porte ce code (Kopo ou Inter (8)) ? Pour rejoindre un ami sans essayer les deux salles.
  routes.get('/salles/:code', (req, res) => {
    // Sécurité : pas plus de 60 codes essayés par minute depuis une même adresse (codes à 4 lettres devinables).
    if (!permis('codesIp', req.ip)) return res.status(429).json({ erreur: 'Trop de codes essayés. Réessaie dans une minute.' });
    const code = String(req.params.code || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return res.status(400).json({ erreur: 'Code invalide.' });
    const s = salleParCode(code);
    if (!s) return res.status(404).json({ erreur: 'Aucune table ouverte avec ce code.' });
    res.json(s);
  });

  // Reprendre sa place avec le code de la salle (page fermée par erreur, réseau perdu) : la salle d'une
  // partie commencée est verrouillée, le matchmaking ne la propose plus. Renvoie une réservation de place
  // (client.consumeSeatReservation), ou 404 si le joueur n'est assis à aucune table ouverte avec ce code.
  routes.post('/reprendre', async (req, res) => {
    try {
      const id = await auth.verifierJoueur((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
      const c = id && (await comptes.statut(id));
      if (!c || c.statut === 'supprime') return res.status(401).json({ erreur: 'Connexion requise.' });
      if (c.statut === 'banni' || c.statut === 'suspendu') return res.status(403).json({ erreur: c.statut === 'banni' ? 'Ce compte est banni.' : 'Compte suspendu.' });
      const code = String((req.body && req.body.code) || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return res.status(400).json({ erreur: 'Code invalide.' });
      const reservation = await reprendre(c, code);
      if (!reservation) return res.status(404).json({ erreur: 'Tu n\'es pas à cette table.' });
      res.json(reservation);
    } catch (e) { console.error('Reprendre :', e.message); res.status(500).json({ erreur: 'Erreur du serveur.' }); }
  });

  // Documentation de l'API (OpenAPI) pour les applis : lisible par Swagger UI, Postman, openapi-generator (Dart)…
  app.get('/api/openapi.yaml', (req, res) => { res.type('application/yaml'); res.sendFile(path.join(__dirname, '..', '..', 'docs', 'api', 'openapi.yaml')); });
  // Bibliothèque du micro pour le site (LiveKit, Apache 2.0) : chargée seulement quand un abonné ouvre le micro.
  app.get('/vendor/livekit-client.js', (req, res) => { res.set('Cache-Control', 'public, max-age=604800'); res.type('application/javascript'); res.sendFile(path.join(__dirname, '..', '..', 'vendor', 'livekit-client.umd.js')); });
  // Relais MQTT (MIT) : n'est plus dans la page du site, chargé seulement en mode de secours sans serveur de jeu.
  app.get('/vendor/mqtt.js', (req, res) => { res.set('Cache-Control', 'public, max-age=604800'); res.type('application/javascript'); res.sendFile(path.join(__dirname, '..', '..', 'vendor', 'mqtt.min.js')); });
  app.use('/api/v1', routes);
  app.use('/api', routes);
  app.use('/admin/api', routesAdmin({ base, auth, comptes, reglages, ligue, parcours, parrainage, bande, fleuve, push, stickers, bouquets, abonnement, legal, salles, demarrage: Date.now() }));
  app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-store'); res.set('X-Frame-Options', 'DENY'); res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')); });

  const serveurHttp = http.createServer(app);
  const jeu = new Server({ transport: new WebSocketTransport({ server: serveurHttp, pingInterval: 5000, pingMaxRetries: 3 }) });
  jeu.define('kopo', SalleKopo).filterBy(['code', 'publique', 'taille']);
  // Tables à mise : un autre nom de salle, pour qu'une ancienne version du jeu n'y entre jamais par erreur.
  jeu.define('kopo-mise', SalleKopo).filterBy(['publique', 'taille', 'mise']);
  // Match du jour : une salle par joueur, jamais proposée à quelqu'un d'autre.
  jeu.define('kopo-jour', SalleKopo);
  // Inter (8) : entre amis (code) et salles publiques gratuites, même salle que Kopo avec la logique d'Inter (8).
  jeu.define('inter8', SalleKopo).filterBy(['code', 'publique', 'taille']);
  // Inter (8) à mise (14/11) : mêmes niveaux et même partage du pot que Kopo.
  jeu.define('inter8-mise', SalleKopo).filterBy(['publique', 'taille', 'mise']);
  // Entraînement contre les robots (Kopo ou Inter (8), options.jeu) : une salle par joueur, sans compte Google.
  jeu.define('entrainement', SalleKopo);
  // Le Fleuve : une salle par étape jouée, un seul joueur (options.fleuve, options.numero).
  jeu.define('fleuve', SalleKopo);
  await new Promise((ok) => serveurHttp.listen(port, ok));
  const adresse = serveurHttp.address();
  console.log(`Kopo : serveur prêt sur le port ${adresse.port} (base : ${base.genre}).`);

  return {
    port: adresse.port, base, comptes, reglages, auth, ligue, social, parcours, parrainage, matchJour, bande, fleuve, push, abonnement, stickers, legal,
    async arreter() { clearInterval(minuteurSaison); clearInterval(minuteurBande); clearInterval(minuteurPush); clearInterval(minuteurRappels); await jeu.gracefullyShutdown(false).catch(() => {}); serveurHttp.close(); await base.fermer(); },
  };
}

if (require.main === module) {
  demarrer().catch((e) => { console.error(e.message); process.exit(1); });
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { demarrer };
