// API des joueurs (application web et mobile).
'use strict';
const express = require('express');

const MOTIFS = ['pseudo', 'insultes', 'triche', 'abandon', 'autre'];
const enveloppe = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.statut || 500).json({ erreur: e.statut ? e.message : 'Erreur du serveur.' }) && (e.statut || console.error(e)));
const publicCompte = (c) => c && { id: c.id, pseudo: c.pseudo, numero: c.numero, avatar: c.avatar, solde: c.solde, statut: c.statut, serieBonus: c.serie_bonus, dernierBonus: c.dernier_bonus, pays: c.pays || null, notifs: { rivalite: true, invitation: true, ami: true, ...(c.notifs || {}) }, kopoPlus: !!(c.kopo_plus_jusqu && new Date(c.kopo_plus_jusqu) > new Date()) };

// Pays déduit du réseau (en-tête posé par Cloudflare quand il existe), sinon choisi par le joueur.
const paysReseau = (req) => { const p = String(req.get('cf-ipcountry') || '').toUpperCase(); return /^[A-Z]{2}$/.test(p) && p !== 'XX' ? p : null; };

function routesJoueurs({ base, auth, comptes, reglages, ligue, social, parcours }) {
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));

  // Qui appelle ? (jeton Kopo dans l'en-tête Authorization: Bearer …)
  async function joueur(req, res, next) {
    const jeton = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const id = await auth.verifierJoueur(jeton);
    const c = id && (await comptes.statut(id));
    if (!c || c.statut === 'supprime') return res.status(401).json({ erreur: 'Connexion requise.' });
    if (c.statut === 'banni') return res.status(403).json({ erreur: 'Ce compte est banni.' });
    req.compte = c;
    next();
  }

  // Ce que l'application lit au démarrage : annonce, maintenance, version minimale.
  // Seule l'origine compte (https://xxxx.supabase.co) : un chemin collé par erreur
  // (/rest/v1, slash final) casserait l'adresse de connexion.
  function origineSupabase(u) {
    try { return new URL(/^https?:\/\//.test(u.trim()) ? u.trim() : 'https://' + u.trim()).origin; } catch (e) { return null; }
  }
  r.get('/config', (req, res) => {
    const t = reglages.tout();
    res.json({ annonce: t.annonce.active ? t.annonce.texte : null, maintenance: t.maintenance.active ? t.maintenance.message : null, versionMin: t.versionMin, tables: t.tables, messages: t.messagesRapides,
      // Connexion Google : active quand CONNEXION_GOOGLE=1 et que Google est activé dans Supabase.
      google: process.env.CONNEXION_GOOGLE === '1' && process.env.SUPABASE_URL ? origineSupabase(process.env.SUPABASE_URL) : null });
  });

  // Jouer sans compte (invité). Le compte pourra être rattaché à Google ou au téléphone ensuite.
  // Limite : 20 comptes invités par adresse et par heure (évite les créations en masse).
  const parIp = new Map();
  setInterval(() => parIp.clear(), 3600e3).unref();
  r.post('/invite', enveloppe(async (req, res) => {
    const n = (parIp.get(req.ip) || 0) + 1; parIp.set(req.ip, n);
    if (n > 20 && process.env.KOPO_TESTS !== '1') return res.status(429).json({ erreur: 'Trop de comptes créés depuis ce réseau. Réessaie plus tard.' });
    const c = await comptes.creer({ pseudo: req.body.pseudo, pays: paysReseau(req) });
    await comptes.presence(c.id);
    res.json({ jeton: await auth.jetonJoueur(c.id), compte: publicCompte(c) });
  }));

  // Connexion Google ou téléphone (jeton Supabase). Avec un jeton invité : rattache ce compte.
  r.post('/connexion', enveloppe(async (req, res) => {
    const s = await auth.verifierSupabase(req.body.jetonSupabase);
    if (!s || !s.sub) return res.status(401).json({ erreur: 'Connexion refusée.' });
    let c = await comptes.parAuth(s.sub);
    if (!c && req.body.jeton) {
      const idInvite = await auth.verifierJoueur(req.body.jeton);
      if (idInvite) c = await comptes.lier(idInvite, s.sub);
    }
    // Le nom Google n'est jamais repris comme pseudo (vie privée) : pseudo de l'appareil ou Joueur1234.
    if (!c) c = await comptes.creer({ pseudo: req.body.pseudo, authId: s.sub }).catch((e) => {
      if (e.statut === 400) return comptes.creer({ authId: s.sub }); // pseudo de l'appareil refusé : pseudo par défaut
      throw e;
    });
    if (c.statut === 'banni') return res.status(403).json({ erreur: 'Ce compte est banni.' });
    await comptes.presence(c.id);
    res.json({ jeton: await auth.jetonJoueur(c.id), compte: publicCompte(c) });
  }));

  r.get('/moi', joueur, enveloppe(async (req, res) => {
    await comptes.presence(req.compte.id);
    res.json({ compte: publicCompte(req.compte), lie: !!req.compte.auth_id, quotaPseudo: await comptes.quotaPseudo(req.compte.id) });
  }));
  r.patch('/moi', joueur, enveloppe(async (req, res) => {
    const compte = await comptes.changerProfil(req.compte.id, req.body);
    res.json({ compte: publicCompte(compte), quotaPseudo: await comptes.quotaPseudo(req.compte.id) });
  }));
  r.delete('/moi', joueur, enveloppe(async (req, res) => { await comptes.supprimer(req.compte.id); res.json({ ok: true }); }));

  // --- Parcours de saison, collection, boutique (apparences seulement)
  r.get('/parcours', joueur, enveloppe(async (req, res) => res.json(await parcours.etat(req.compte))));
  r.post('/parcours/recuperer', joueur, enveloppe(async (req, res) => res.json(await parcours.recuperer(req.compte, req.body.palier, req.body.voie))));
  r.get('/collection', joueur, enveloppe(async (req, res) => res.json(await parcours.collection(req.compte))));
  r.post('/collection/equiper', joueur, enveloppe(async (req, res) => res.json(await parcours.equiper(req.compte, req.body.objet))));
  r.get('/boutique', joueur, enveloppe(async (req, res) => res.json({ solde: req.compte.solde, objets: parcours.catalogue(), ...(await parcours.collection(req.compte)) })));
  r.post('/boutique/acheter', joueur, enveloppe(async (req, res) => res.json(await parcours.acheter(req.compte, req.body.objet))));

  // --- Ligue classée et saisons
  r.get('/ligue', joueur, enveloppe(async (req, res) => res.json(await ligue.etat(req.compte))));
  r.post('/ligue/vu', joueur, enveloppe(async (req, res) => { await ligue.marquerVu(req.compte.id); res.json({ ok: true }); }));
  r.get('/classement', joueur, enveloppe(async (req, res) => res.json(await ligue.classement(req.compte, String(req.query.type || 'mondial'), { pays: req.query.pays, limite: req.query.limite }))));

  r.post('/bonus-du-jour', joueur, enveloppe(async (req, res) => res.json(await comptes.bonusDuJour(req.compte.id))));
  r.post('/remise-a-flot', joueur, enveloppe(async (req, res) => res.json(await comptes.remiseAFlot(req.compte.id))));
  r.get('/pieces', joueur, enveloppe(async (req, res) => res.json({ solde: req.compte.solde, historique: await comptes.historique(req.compte.id) })));

  // Retrouver un joueur par pseudo#numéro (amis, signalement).
  async function cible(texte) {
    const m = /^(.{3,16})#(\d{4})$/.exec(String(texte || '').trim());
    if (m) return (await base.query("SELECT id, pseudo, numero, avatar FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2 AND statut <> 'supprime'", [m[1], m[2]])).rows[0];
    const t = String(texte || '').trim();
    return (await base.query("SELECT id, pseudo, numero, avatar FROM comptes WHERE (id = $1 OR lower(pseudo) = lower($1)) AND statut <> 'supprime' LIMIT 1", [t])).rows[0];
  }

  r.post('/signaler', joueur, enveloppe(async (req, res) => {
    const c = await cible(req.body.cible);
    if (!c || c.id === req.compte.id) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    if (!MOTIFS.includes(req.body.motif)) return res.status(400).json({ erreur: 'Motif inconnu.' });
    const recent = await base.query("SELECT count(*)::int AS n FROM signalements WHERE auteur_id = $1 AND cree_le > now() - interval '1 day'", [req.compte.id]);
    if (recent.rows[0].n >= 20) return res.status(429).json({ erreur: 'Trop de signalements aujourd\'hui.' });
    await base.query('INSERT INTO signalements (auteur_id, cible_id, motif, details, partie_id) VALUES ($1,$2,$3,$4,$5)', [req.compte.id, c.id, req.body.motif, String(req.body.details || '').slice(0, 500) || null, req.body.partie || null]);
    res.json({ ok: true });
  }));

  r.get('/bloques', joueur, enveloppe(async (req, res) => res.json((await base.query('SELECT c.id, c.pseudo, c.numero FROM blocages b JOIN comptes c ON c.id = b.bloque_id WHERE b.compte_id = $1', [req.compte.id])).rows)));
  r.post('/bloques', joueur, enveloppe(async (req, res) => {
    const c = await cible(req.body.cible);
    if (!c || c.id === req.compte.id) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    await base.query('INSERT INTO blocages (compte_id, bloque_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.compte.id, c.id]);
    await base.query('DELETE FROM amis WHERE (compte_id = $1 AND ami_id = $2) OR (compte_id = $2 AND ami_id = $1)', [req.compte.id, c.id]);
    res.json({ ok: true });
  }));
  r.delete('/bloques/:id', joueur, enveloppe(async (req, res) => { await base.query('DELETE FROM blocages WHERE compte_id = $1 AND bloque_id = $2', [req.compte.id, req.params.id]); res.json({ ok: true }); }));

  r.get('/amis', joueur, enveloppe(async (req, res) => res.json((await base.query("SELECT c.id, c.pseudo, c.numero, c.avatar, c.vu_le > now() - interval '2 minutes' AS en_ligne FROM amis a JOIN comptes c ON c.id = a.ami_id WHERE a.compte_id = $1 AND c.statut <> 'supprime' ORDER BY c.pseudo", [req.compte.id])).rows)));
  r.post('/amis', joueur, enveloppe(async (req, res) => {
    const c = await cible(req.body.cible);
    if (!c || c.id === req.compte.id) return res.status(404).json({ erreur: 'Joueur introuvable. Écris son pseudo#numéro, par exemple Kevin#1290.' });
    const bloque = await base.query('SELECT 1 FROM blocages WHERE compte_id = $1 AND bloque_id = $2', [c.id, req.compte.id]);
    if (bloque.rows.length) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    const nouveau = await base.query('INSERT INTO amis (compte_id, ami_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [req.compte.id, c.id]);
    if (nouveau.rows.length) await social.notifier(c.id, 'ami', `${req.compte.pseudo} t'a ajouté en ami`, { de: req.compte.id, pseudo: req.compte.pseudo, numero: req.compte.numero });
    res.json({ ok: true, ami: c });
  }));
  // Inviter un ami dans ma salle (il reçoit une notification avec le code).
  r.post('/amis/:id/inviter', joueur, enveloppe(async (req, res) => res.json(await social.inviter(req.compte, req.params.id, req.body.code))));

  // --- Rivalités et notifications
  r.get('/rivaux', joueur, enveloppe(async (req, res) => res.json(await social.rivaux(req.compte.id))));
  r.get('/notifications', joueur, enveloppe(async (req, res) => res.json(await social.liste(req.compte.id))));
  r.post('/notifications/lues', joueur, enveloppe(async (req, res) => { await social.marquerLues(req.compte.id, req.body.ids); res.json({ ok: true }); }));

  r.delete('/amis/:id', joueur, enveloppe(async (req, res) => { await base.query('DELETE FROM amis WHERE compte_id = $1 AND ami_id = $2', [req.compte.id, req.params.id]); res.json({ ok: true }); }));

  return r;
}

module.exports = { routesJoueurs, publicCompte, enveloppe };
