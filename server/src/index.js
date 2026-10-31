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
const { creerComptes } = require('./comptes');
const { routesJoueurs } = require('./api');
const { routesAdmin } = require('./admin');
const { SalleKopo, salles } = require('./salle-kopo');

async function demarrer({ port = Number(process.env.PORT || 2567), env = process.env } = {}) {
  const base = await ouvrirBase(env.DATABASE_URL);
  const auth = creerAuth(env);
  const reglages = creerReglages(base);
  await reglages.charger();
  const comptes = creerComptes(base, reglages);
  SalleKopo.services = { base, auth, comptes, reglages };

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
  app.get('/sante', (req, res) => res.json({ ok: true, salles: salles.size }));
  app.use('/api', routesJoueurs({ base, auth, comptes, reglages }));
  app.use('/admin/api', routesAdmin({ base, auth, comptes, reglages, salles, demarrage: Date.now() }));
  app.get('/admin', (req, res) => { res.set('Cache-Control', 'no-store'); res.set('X-Frame-Options', 'DENY'); res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')); });

  // Compteur en ligne et salles ouvertes (lu par l'accueil).
  app.get('/api/en-ligne', async (req, res) => {
    let joueurs = 0; for (const s of salles) joueurs += s.clientsParId.size;
    const ouvertes = (await matchMaker.query({ name: 'kopo' })).filter((r) => r.metadata && r.metadata.publique && r.metadata.etat === 'salon' && !r.locked);
    res.json({ joueurs, sallesOuvertes: ouvertes.map((r) => ({ id: r.roomId, code: r.metadata.code, taille: r.metadata.taille, joueurs: r.clients })) });
  });

  const serveurHttp = http.createServer(app);
  const jeu = new Server({ transport: new WebSocketTransport({ server: serveurHttp, pingInterval: 5000, pingMaxRetries: 3 }) });
  jeu.define('kopo', SalleKopo).filterBy(['code', 'publique', 'taille']);
  await new Promise((ok) => serveurHttp.listen(port, ok));
  const adresse = serveurHttp.address();
  console.log(`Kopo : serveur prêt sur le port ${adresse.port} (base : ${base.genre}).`);

  return {
    port: adresse.port, base, comptes, reglages, auth,
    async arreter() { await jeu.gracefullyShutdown(false).catch(() => {}); serveurHttp.close(); await base.fermer(); },
  };
}

if (require.main === module) {
  demarrer().catch((e) => { console.error(e.message); process.exit(1); });
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { demarrer };
