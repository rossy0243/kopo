// Notifications push (Web Push) : le téléphone est prévenu même quand Masano est fermé.
// Quatre types, chacun coupable par le joueur (Paramètres > Notifications) :
//   invitation : un ami t'invite à sa table (expire après 10 min) ;
//   ami        : demande d'ami reçue, demande acceptée ;
//   match      : rappel du Match du jour à 19 h (Kinshasa), si pas encore joué, pour les habitués et les Bandes ;
//   annonce    : message envoyé depuis le tableau de bord admin.
// Rien entre 22 h et 8 h (Kinshasa), sauf les invitations (l'ami qui invite est réveillé) et les annonces (choix de l'admin).
// Sans clés VAPID (VAPID_PUBLIC, VAPID_PRIVE), tout est éteint : le jeu marche comme avant.
'use strict';
const webpush = require('web-push');
const { jourDe, lundiDe, numeroDu } = require('./match-jour');

const HEURE = 36e5;
const TYPES_PUSH = ['invitation', 'ami', 'match', 'annonce'];
const APPAREILS_MAX = 10; // par compte : au-delà, les plus anciens sont oubliés
const PAQUET = 50; // envois en parallèle (annonces, rappels)
const heureKinshasa = (d) => new Date(d.getTime() + HEURE).getUTCHours();
const nuit = (d) => { const h = heureKinshasa(d); return h >= 22 || h < 8; };
const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });
const texteCourt = (t, max) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, max);

function creerPush(base, reglages, env = process.env) {
  const cle = env.VAPID_PUBLIC || '', prive = env.VAPID_PRIVE || '';
  let actif = !!(cle && prive);
  if (actif) {
    try { webpush.setVapidDetails(env.VAPID_CONTACT || 'https://kopo-d655.onrender.com/', cle, prive); }
    catch (e) { console.error('Push : clés VAPID refusées :', e.message); actif = false; }
  }
  let envoyeur = (abonnement, charge, options) => webpush.sendNotification(abonnement, charge, options);
  let horloge = () => new Date();
  const rappelsFaits = new Set(); // jours où le rappel du Match du jour est déjà parti (en plus de push_rappels)

  async function prefsDe(compteId) {
    const c = (await base.query('SELECT push_prefs, statut FROM comptes WHERE id = $1', [compteId])).rows[0];
    if (!c) return null;
    return { statut: c.statut, prefs: Object.fromEntries(TYPES_PUSH.map((t) => [t, !(c.push_prefs && c.push_prefs[t] === false)])) };
  }

  // Envoie un message à une liste d'appareils ; oublie ceux que le navigateur dit périmés. Renvoie le nombre d'envois réussis.
  async function envoyerA(appareils, message, { ttl = 3600, urgence = 'normal' } = {}) {
    if (!actif || !appareils.length) return 0;
    const charge = JSON.stringify(message);
    let ok = 0;
    for (let i = 0; i < appareils.length; i += PAQUET) {
      await Promise.all(appareils.slice(i, i + PAQUET).map(async (a) => {
        try {
          await envoyeur({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, charge, { TTL: ttl, urgency: urgence });
          ok++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) await base.query('DELETE FROM push_abonnements WHERE endpoint = $1', [a.endpoint]).catch(() => {});
          else console.error('Push :', e.statusCode || '', e.message);
        }
      }));
    }
    return ok;
  }
  const appareilsDe = async (ids) => (await base.query('SELECT endpoint, p256dh, auth FROM push_abonnements WHERE compte_id = ANY($1)', [ids])).rows;

  const api = {
    TYPES: TYPES_PUSH,
    actif: () => actif,
    cle: () => (actif ? cle : null),
    regler({ envoi, maintenant } = {}) { if (envoi) { envoyeur = envoi; actif = true; } if (maintenant) horloge = maintenant; }, // tests

    // --- Côté joueur
    async etat(compteId) {
      const p = await prefsDe(compteId);
      const n = (await base.query('SELECT count(*)::int AS n FROM push_abonnements WHERE compte_id = $1', [compteId])).rows[0].n;
      return { actif, cle: api.cle(), prefs: p ? p.prefs : null, appareils: n };
    },
    async abonner(compteId, abonnement, appareil) {
      if (!actif) throw erreur('Les notifications ne sont pas encore ouvertes.', 503);
      const a = abonnement || {}, k = a.keys || {};
      let url;
      try { url = new URL(String(a.endpoint || '')); } catch (e) { throw erreur('Abonnement invalide.'); }
      if (url.protocol !== 'https:' || String(a.endpoint).length > 1000 || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) throw erreur('Abonnement invalide.');
      await base.query(`INSERT INTO push_abonnements (endpoint, compte_id, p256dh, auth, appareil) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (endpoint) DO UPDATE SET compte_id = $2, p256dh = $3, auth = $4, appareil = $5, vu_le = now()`,
      [a.endpoint, compteId, k.p256dh, k.auth, texteCourt(appareil, 40) || null]);
      await base.query(`DELETE FROM push_abonnements WHERE compte_id = $1 AND endpoint NOT IN
        (SELECT endpoint FROM push_abonnements WHERE compte_id = $1 ORDER BY vu_le DESC LIMIT ${APPAREILS_MAX})`, [compteId]);
      return { ok: true };
    },
    async desabonner(compteId, endpoint) {
      await base.query('DELETE FROM push_abonnements WHERE compte_id = $1 AND endpoint = $2', [compteId, String(endpoint || '')]);
      return { ok: true };
    },
    async changerPrefs(compteId, p) {
      if (!p || typeof p !== 'object') throw erreur('Réglage invalide.');
      const v = {};
      for (const t of TYPES_PUSH) if (typeof p[t] === 'boolean') v[t] = p[t];
      await base.query('UPDATE comptes SET push_prefs = push_prefs || $2::jsonb WHERE id = $1', [compteId, JSON.stringify(v)]);
      return { ok: true, prefs: (await prefsDe(compteId)).prefs };
    },
    async oublier(compteId) { await base.query('DELETE FROM push_abonnements WHERE compte_id = $1', [compteId]); },

    // Envoi à un joueur, en respectant ses réglages et la nuit. Renvoie le nombre d'appareils prévenus.
    async envoyer(compteId, type, message, options = {}) {
      if (!actif || !TYPES_PUSH.includes(type)) return 0;
      const p = await prefsDe(compteId);
      if (!p || p.statut === 'supprime' || p.statut === 'banni' || !p.prefs[type]) return 0;
      if (nuit(horloge()) && type !== 'invitation' && type !== 'annonce') return 0;
      return envoyerA(await appareilsDe([compteId]), { type, ...message }, options);
    },

    // Appelé pour chaque notification du jeu (social.notifier) : certaines partent aussi en push.
    async depuisNotification(compteId, type, texte, d = {}) {
      d = d || {};
      if (type === 'invitation' && d.code) {
        return api.envoyer(compteId, 'invitation', { titre: 'Invitation à jouer', texte: texte + ' · code ' + d.code, url: './#' + d.code, tag: 'invitation-' + d.de },
          { ttl: 600, urgence: 'high' });
      }
      if (type === 'ami' && (d.demande || d.accepte)) {
        return api.envoyer(compteId, 'ami', { titre: d.demande ? 'Demande d\'ami' : 'Nouvel ami', texte, url: './?ouvrir=amis', tag: 'ami-' + d.de }, { ttl: 24 * HEURE / 1000 });
      }
      return 0;
    },

    // --- Rappel du Match du jour, à 19 h (Kinshasa) : joueurs abonnés qui ne l'ont pas joué aujourd'hui, et qui
    // l'ont joué au moins une fois ces 7 derniers jours ou sont inscrits dans une Bande cette semaine. Un par jour au plus.
    async rappelMatchJour() {
      const mj = reglages.get('matchJour') || {};
      if (!actif || !mj.actif) return 0;
      const jour = jourDe(horloge()), lundi = lundiDe(jour);
      const l = (await base.query(`SELECT DISTINCT a.compte_id,
          EXISTS (SELECT 1 FROM bande_inscriptions i JOIN bande_semaines s ON s.bande_id = i.bande_id AND s.semaine = i.semaine
            WHERE i.compte_id = a.compte_id AND s.semaine = $2 AND s.statut = 'ouverte') AS bande
        FROM push_abonnements a JOIN comptes c ON c.id = a.compte_id
        WHERE c.statut NOT IN ('supprime', 'banni') AND coalesce(c.push_prefs->>'match', 'true') <> 'false'
          AND NOT EXISTS (SELECT 1 FROM match_jour j WHERE j.compte_id = a.compte_id AND j.jour = $1)
          AND NOT EXISTS (SELECT 1 FROM push_rappels r WHERE r.compte_id = a.compte_id AND r.jour = $1)
          AND (EXISTS (SELECT 1 FROM match_jour j WHERE j.compte_id = a.compte_id AND j.jour >= $1::date - 7)
            OR EXISTS (SELECT 1 FROM bande_inscriptions i JOIN bande_semaines s ON s.bande_id = i.bande_id AND s.semaine = i.semaine
              WHERE i.compte_id = a.compte_id AND s.semaine = $2 AND s.statut = 'ouverte'))`, [jour, lundi])).rows;
      let n = 0;
      for (const x of l) {
        const pris = await base.query('INSERT INTO push_rappels (compte_id, jour) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [x.compte_id, jour]);
        if (!pris.rows.length) continue;
        const texte = x.bande ? 'Ta Bande compte sur toi : joue ton Match du jour avant minuit !' : `Le Match du jour n°${numeroDu(jour)} t'attend : un seul essai, avant minuit.`;
        n += await envoyerA(await appareilsDe([x.compte_id]), { type: 'match', titre: 'Match du jour', texte, url: './?ouvrir=match', tag: 'match-' + jour }, { ttl: 4 * 3600 });
      }
      return n;
    },
    // Chaque minute : le rappel part une fois entre 19 h et 20 h (Kinshasa).
    async tic() {
      const maintenant = horloge(), jour = jourDe(maintenant);
      if (heureKinshasa(maintenant) !== 19 || rappelsFaits.has(jour)) return 0;
      rappelsFaits.add(jour);
      return api.rappelMatchJour();
    },

    // --- Annonces de l'admin
    // public : {} (tous) ou { pays: 'CD' }. Joueurs touchés : abonnés qui n'ont pas coupé les annonces.
    filtrePublic(p = {}) {
      const pays = p && p.pays ? String(p.pays).toUpperCase() : null;
      if (pays && !/^[A-Z]{2}$/.test(pays)) throw erreur('Pays inconnu.');
      return { pays };
    },
    async compter(p) {
      const { pays } = api.filtrePublic(p);
      const r = (await base.query(`SELECT count(DISTINCT a.compte_id)::int AS joueurs, count(*)::int AS appareils FROM push_abonnements a JOIN comptes c ON c.id = a.compte_id
        WHERE c.statut NOT IN ('supprime', 'banni') AND coalesce(c.push_prefs->>'annonce', 'true') <> 'false' AND ($1::text IS NULL OR c.pays = $1)`, [pays])).rows[0];
      return r;
    },
    async annonce({ titre, texte, public: p, url }) {
      titre = texteCourt(titre, 60) || 'Masano'; texte = texteCourt(texte, 200);
      if (!texte) throw erreur('Écris le texte de l\'annonce.');
      if (!actif) throw erreur('Notifications push éteintes : ajoute les clés VAPID dans Render.', 503);
      const { pays } = api.filtrePublic(p);
      const recente = (await base.query("SELECT 1 FROM push_annonces WHERE cree_le > now() - interval '10 minutes' LIMIT 1")).rows.length;
      if (recente) throw erreur('Une annonce est partie il y a moins de 10 minutes. Attends un peu.', 429);
      const appareils = (await base.query(`SELECT a.compte_id, a.endpoint, a.p256dh, a.auth FROM push_abonnements a JOIN comptes c ON c.id = a.compte_id
        WHERE c.statut NOT IN ('supprime', 'banni') AND coalesce(c.push_prefs->>'annonce', 'true') <> 'false' AND ($1::text IS NULL OR c.pays = $1)`, [pays])).rows;
      const joueurs = new Set(appareils.map((a) => a.compte_id)).size;
      const id = (await base.query('INSERT INTO push_annonces (titre, texte, public, joueurs) VALUES ($1,$2,$3,$4) RETURNING id', [titre, texte, JSON.stringify({ pays }), joueurs])).rows[0].id;
      const envoyees = await envoyerA(appareils, { type: 'annonce', titre, texte, url: url || './', tag: 'annonce-' + id }, { ttl: 24 * 3600 });
      await base.query('UPDATE push_annonces SET envoyees = $2 WHERE id = $1', [id, envoyees]);
      return { ok: true, joueurs, appareils: appareils.length, envoyees };
    },
    // Essai : à un seul joueur (le sien, en général), sans tenir compte de ses réglages ni de la limite.
    async essai(compteId, { titre, texte }) {
      if (!actif) throw erreur('Notifications push éteintes : ajoute les clés VAPID dans Render.', 503);
      const appareils = await appareilsDe([compteId]);
      if (!appareils.length) throw erreur('Ce joueur n\'a pas activé les notifications sur son téléphone.', 404);
      const envoyees = await envoyerA(appareils, { type: 'annonce', titre: texteCourt(titre, 60) || 'Masano', texte: texteCourt(texte, 200) || 'Essai', url: './', tag: 'annonce-essai' }, { ttl: 3600 });
      return { ok: true, appareils: appareils.length, envoyees };
    },
    async resume() {
      const r = (await base.query('SELECT count(DISTINCT compte_id)::int AS joueurs, count(*)::int AS appareils FROM push_abonnements')).rows[0];
      const annonces = (await base.query('SELECT id::int AS id, titre, texte, public, joueurs, envoyees, cree_le FROM push_annonces ORDER BY id DESC LIMIT 20')).rows;
      return { actif, ...r, annonces };
    },
  };
  return api;
}

module.exports = { creerPush, TYPES_PUSH, nuit, heureKinshasa };
