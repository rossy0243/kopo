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
const { SalleKopo, salles, reprendre } = require('./salle-kopo');
const { creerLigue } = require('./ligue');
const { creerSocial } = require('./social');
const { creerParcours } = require('./parcours');
const { creerParrainage } = require('./parrainage');
const { creerMatchJour } = require('./match-jour');
const { creerBande } = require('./bande');

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
  const social = creerSocial(base);
  const parcours = creerParcours(base, reglages, comptes, ligue);
  const parrainage = creerParrainage(base, reglages, comptes, social, env);
  const matchJour = creerMatchJour(base, reglages, env);
  const bande = creerBande(base, reglages, comptes, matchJour, social);
  // Chaque minute : semaines de Bande finies (pot partagé), mises automatiques du lundi, rappel du soir.
  const minuteurBande = setInterval(() => bande.tic().catch((e) => console.error('Bande :', e.message)), 60e3);
  minuteurBande.unref();
  SalleKopo.services = { base, auth, comptes, reglages, ligue, social, parcours, parrainage, matchJour, bande };

  const app = express();
  app.set('trust proxy', 1);
  // La page du jeu est servie ailleurs (GitHub Pages, application mobile) : on autorise ces origines.
  const origines = (env.ORIGINES || '*').split(',').map((o) => o.trim());
  app.use((req, res, next) => {
    const o = req.get('origin');
    if (o && (origines.includes('*') || origines.includes(o))) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); }
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  // version = commit déployé (Render le donne dans RENDER_GIT_COMMIT) : pour vérifier qu'une mise à jour est en ligne.
  app.get('/sante', (req, res) => res.json({ ok: true, salles: salles.size, version: (env.RENDER_GIT_COMMIT || '').slice(0, 7) || null }));
  app.use('/api', routesJoueurs({ base, auth, comptes, reglages, ligue, social, parcours, parrainage, matchJour, bande }));
  app.use('/admin/api', routesAdmin({ base, auth, comptes, reglages, ligue, parcours, parrainage, bande, salles, demarrage: Date.now() }));
  app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-store'); res.set('X-Frame-Options', 'DENY'); res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')); });

  // Compteur en ligne et salles ouvertes (lu par l'accueil).
  app.get('/api/en-ligne', async (req, res) => {
    let joueurs = 0; for (const s of salles) joueurs += s.clientsParId.size;
    const ouvertes = [...(await matchMaker.query({ name: 'kopo' })), ...(await matchMaker.query({ name: 'kopo-mise' }))].filter((r) => r.metadata && r.metadata.publique && r.metadata.etat === 'salon' && !r.locked);
    res.json({ joueurs, sallesOuvertes: ouvertes.map((r) => ({ id: r.roomId, code: r.metadata.code, taille: r.metadata.taille, joueurs: r.clients, classee: !!r.metadata.classee, mise: r.metadata.mise ? r.metadata.mise.niveau : null })) });
  });

  // Reprendre sa place avec le code de la salle (page fermée par erreur, réseau perdu) : la salle d'une
  // partie commencée est verrouillée, le matchmaking ne la propose plus. Renvoie une réservation de place
  // (client.consumeSeatReservation), ou 404 si le joueur n'est assis à aucune table ouverte avec ce code.
  app.post('/api/reprendre', express.json({ limit: '4kb' }), async (req, res) => {
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

  const serveurHttp = http.createServer(app);
  const jeu = new Server({ transport: new WebSocketTransport({ server: serveurHttp, pingInterval: 5000, pingMaxRetries: 3 }) });
  jeu.define('kopo', SalleKopo).filterBy(['code', 'publique', 'taille']);
  // Tables à mise : un autre nom de salle, pour qu'une ancienne version du jeu n'y entre jamais par erreur.
  jeu.define('kopo-mise', SalleKopo).filterBy(['publique', 'taille', 'mise']);
  // Match du jour : une salle par joueur, jamais proposée à quelqu'un d'autre.
  jeu.define('kopo-jour', SalleKopo);
  await new Promise((ok) => serveurHttp.listen(port, ok));
  const adresse = serveurHttp.address();
  console.log(`Kopo : serveur prêt sur le port ${adresse.port} (base : ${base.genre}).`);

  return {
    port: adresse.port, base, comptes, reglages, auth, ligue, social, parcours, parrainage, matchJour, bande,
    async arreter() { clearInterval(minuteurSaison); clearInterval(minuteurBande); await jeu.gracefullyShutdown(false).catch(() => {}); serveurHttp.close(); await base.fermer(); },
  };
}

if (require.main === module) {
  demarrer().catch((e) => { console.error(e.message); process.exit(1); });
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { demarrer };
