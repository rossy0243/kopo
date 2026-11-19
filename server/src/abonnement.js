// Abonnement Kopo+ (18/11) : le micro en salle, la couronne dorée et la voie Kopo+ du parcours de saison.
// Prix en francs congolais seulement : 2 500 FC le mois, 25 000 FC l'année (2 mois offerts).
// Même logique que les bouquets de pièces (bouquets.js) : le serveur fixe les prix, le paiement mobile money n'est pas
// encore branché, et l'admin active l'abonnement à la main depuis le tableau de bord (paiement reçu), avec une référence.
// Un abonnement activé avant la fin s'ajoute à la date de fin : rien n'est perdu.
//
// Micro : seuls les abonnés parlent et s'entendent. Le son passe par un serveur LiveKit ; ce serveur-ci donne un jeton
// d'accès au salon vocal de la table seulement à un abonné assis à cette table, sans sanction « micro ».
// Sans LIVEKIT_URL, LIVEKIT_API_KEY et LIVEKIT_API_SECRET, le micro reste « Bientôt » (l'abonnement marche quand même).
'use strict';
const crypto = require('crypto');

const FORMULES = [
  { id: 'mois', nom: '1 mois', francs: 2500, jours: 30, note: null },
  { id: 'an', nom: '1 an', francs: 25000, jours: 365, note: '2 mois offerts' },
];
const AVANTAGES = [
  'Parle et entends les autres abonnés de ta table',
  'Couronne dorée à côté de ton pseudo',
  'Voie Kopo+ du parcours de saison (apparences en plus)',
];
const ESSAI_JOURS = 7; // essai de bienvenue (19/11) : une fois par compte Google, lancé par le joueur
const DUREE_JETON = 6 * 3600; // un jeton vocal tient 6 heures (une longue soirée de jeu)

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });
const estAbonne = (c) => !!(c && c.kopo_plus_jusqu && new Date(c.kopo_plus_jusqu) > new Date());

// Jeton d'accès LiveKit (JWT signé HS256 avec le secret de l'API), sans dépendance.
// https://docs.livekit.io/home/get-started/authentication/
function jetonLiveKit({ cle, secret, identite, nom, salon, parler, duree = DUREE_JETON, maintenant = Date.now() }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(maintenant / 1000);
  const corps = {
    iss: cle, sub: identite, name: nom, nbf: t - 10, exp: t + duree,
    video: { room: salon, roomJoin: true, canSubscribe: true, canPublish: !!parler, canPublishData: false, canPublishSources: parler ? ['microphone'] : [] },
  };
  const tete = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(corps);
  return tete + '.' + crypto.createHmac('sha256', secret).update(tete).digest('base64url');
}

// « https://x.livekit.cloud/ », « x.livekit.cloud » ou « wss://x.livekit.cloud » donnent tous wss://x.livekit.cloud.
function adresseLiveKit(v) {
  if (!v) return '';
  let u = v.replace(/\/+$/, '');
  if (/^https:\/\//i.test(u)) u = 'wss://' + u.slice(8);
  else if (/^http:\/\//i.test(u)) u = 'ws://' + u.slice(7);
  else if (!/^wss?:\/\//i.test(u)) u = 'wss://' + u;
  return u;
}

function creerAbonnement(base_, env = process.env) {
  // Valeurs copiées-collées dans Render : on enlève espaces et guillemets, et l'adresse devient wss:// si besoin.
  const net = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
  const url = adresseLiveKit(net(env.LIVEKIT_URL)), cle = net(env.LIVEKIT_API_KEY), secretLk = net(env.LIVEKIT_API_SECRET);
  const livekit = url && cle && secretLk ? { url, cle, secret: secretLk } : null;
  const offre = () => ({ paiement: false, micro: !!livekit, formules: FORMULES.map((f) => ({ ...f })), avantages: AVANTAGES.slice() });

  const etatEssai = (c) => {
    const raison = !c ? 'google' : c.kopo_plus_essai ? 'deja' : !c.auth_id ? 'google' : estAbonne(c) ? 'abonne' : null;
    return { jours: ESSAI_JOURS, possible: !raison, raison, enCours: !!(c && c.kopo_plus_essai && estAbonne(c) && new Date(c.kopo_plus_jusqu) - new Date(c.kopo_plus_essai) <= (ESSAI_JOURS + 1) * 864e5) };
  };

  const api = {
    FORMULES, ESSAI_JOURS, estAbonne,
    // Salles ouvertes, pour que la couronne apparaisse tout de suite (branché par index.js).
    majSalles: () => {},

    // Le joueur lance son essai : 7 jours de Kopo+ (micro, couronne), une seule fois, avec un compte Google
    // (sinon on recréerait des comptes invités pour enchaîner les essais). Noté avec les activations, à 0 FC.
    async essayer(compte) {
      const e = etatEssai(compte);
      if (!e.possible) {
        throw erreur(e.raison === 'deja' ? 'Tu as déjà profité de ton essai Kopo+.' : e.raison === 'abonne' ? 'Tu es déjà abonné à Kopo+.' : 'Connecte-toi avec Google pour profiter de l\'essai gratuit.', e.raison === 'google' ? 403 : 409);
      }
      const jusqu = await base_.transaction(async (q) => {
        const r = await q.query(`UPDATE comptes SET kopo_plus_jusqu = now() + make_interval(days => $2), kopo_plus_essai = now()
          WHERE id = $1 AND kopo_plus_essai IS NULL AND auth_id IS NOT NULL AND (kopo_plus_jusqu IS NULL OR kopo_plus_jusqu <= now()) RETURNING kopo_plus_jusqu`, [compte.id, ESSAI_JOURS]);
        if (!r.rows.length) throw erreur('Tu as déjà profité de ton essai Kopo+.', 409);
        const fin = r.rows[0].kopo_plus_jusqu;
        await q.query("INSERT INTO abonnements (compte_id, formule, francs, jours, ref, jusqu) VALUES ($1, 'essai', 0, $2, 'Essai de bienvenue', $3)", [compte.id, ESSAI_JOURS, fin]);
        const date = new Date(fin).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Kinshasa' });
        await q.query("INSERT INTO notifications (compte_id, type, texte, donnees) VALUES ($1, 'cadeau', $2, $3)",
          [compte.id, `Ton essai Kopo+ commence : micro et couronne dorée jusqu'au ${date}. Parle avec les autres abonnés de ta table !`, JSON.stringify({ abonnement: 'essai', jusqu: fin })]);
        return fin;
      });
      api.majSalles(compte.id, jusqu);
      return { ok: true, jusqu, jours: ESSAI_JOURS };
    },

    // Toutes les 10 minutes : la veille de la fin d'un abonnement (essai compris), une notification avec les prix.
    async rappels(notifier) {
      const l = (await base_.query(`UPDATE comptes SET kopo_plus_rappel = kopo_plus_jusqu
        WHERE kopo_plus_jusqu > now() AND kopo_plus_jusqu <= now() + interval '24 hours' AND kopo_plus_rappel IS DISTINCT FROM kopo_plus_jusqu AND statut = 'actif'
        RETURNING id, kopo_plus_jusqu, kopo_plus_essai`)).rows;
      for (const c of l) {
        const essai = c.kopo_plus_essai && new Date(c.kopo_plus_jusqu) - new Date(c.kopo_plus_essai) <= (ESSAI_JOURS + 1) * 864e5;
        const texte = (essai ? 'Ton essai Kopo+ se termine demain.' : 'Ton abonnement Kopo+ se termine demain.')
          + ` Pour garder le micro et la couronne : 2 500 FC le mois, ou 25 000 FC l'année (2 mois offerts).`;
        await notifier(c.id, 'cadeau', texte, { abonnement: 'rappel', jusqu: c.kopo_plus_jusqu }).catch(() => {});
      }
      return l.length;
    },
    microPret: () => !!livekit,
    // Pour le joueur : son abonnement et les prix (en francs congolais).
    // essai : 7 jours offerts une fois. raison du refus : 'deja' (déjà pris), 'google' (compte invité), 'abonne'.
    pourJoueur: (c) => ({ actif: estAbonne(c), jusqu: estAbonne(c) ? c.kopo_plus_jusqu : null, essai: etatEssai(c), ...offre() }),
    offre,

    // Tableau de bord : abonnement activé à la main (paiement mobile money reçu), avec la référence du paiement.
    // Ajouté à la date de fin s'il en reste un, sinon à partir de maintenant. Notification au joueur dans la même transaction.
    async activer({ joueur, formule, message }) {
      const f = FORMULES.find((x) => x.id === formule);
      if (!f) throw erreur('Formule inconnue.');
      const msg = String(message || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (msg.length < 3) throw erreur('Écris une référence (ex. le numéro de la transaction mobile money).');
      const t = String(joueur || '').trim(), m = /^(.*)#(\d{4})$/.exec(t);
      const c = (m ? await base_.query('SELECT id, pseudo, numero, statut FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2', [m[1], m[2]])
        : await base_.query('SELECT id, pseudo, numero, statut FROM comptes WHERE id = $1', [t])).rows[0];
      if (!c) throw erreur('Joueur introuvable. Écris Pseudo#1234.', 404);
      if (c.statut !== 'actif') throw erreur('Ce compte n\'est pas actif.');
      const jusqu = await base_.transaction(async (q) => {
        const r = await q.query(`UPDATE comptes SET kopo_plus_jusqu = GREATEST(COALESCE(kopo_plus_jusqu, now()), now()) + make_interval(days => $2)
          WHERE id = $1 RETURNING kopo_plus_jusqu`, [c.id, f.jours]);
        const fin = r.rows[0].kopo_plus_jusqu;
        await q.query('INSERT INTO abonnements (compte_id, formule, francs, jours, ref, jusqu) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, f.id, f.francs, f.jours, msg, fin]);
        const date = new Date(fin).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });
        await q.query("INSERT INTO notifications (compte_id, type, texte, donnees) VALUES ($1, 'cadeau', $2, $3)",
          [c.id, `Merci ! Ton abonnement Kopo+ (${f.nom}) est actif jusqu'au ${date}. Le micro est à toi.`, JSON.stringify({ abonnement: f.id, jusqu: fin })]);
        return fin;
      });
      return { ok: true, jusqu, joueur: { id: c.id, nom: `${c.pseudo}#${c.numero}` }, formule: f };
    },

    // Tableau de bord : annuler une activation (essai, erreur). Ses jours sont retirés de la date de fin (plus d'abonnement
    // si elle est passée) et ses francs sortent du total. Une activation ne s'annule qu'une fois.
    async annuler(id) {
      const n = Math.trunc(Number(id));
      if (!(n > 0)) throw erreur('Activation inconnue.', 404);
      return base_.transaction(async (q) => {
        const a = (await q.query('UPDATE abonnements SET annule_le = now() WHERE id = $1 AND annule_le IS NULL RETURNING compte_id, formule, francs, jours', [n])).rows[0];
        if (!a) throw erreur('Activation introuvable ou déjà annulée.', 404);
        const r = await q.query(`UPDATE comptes SET kopo_plus_jusqu = CASE WHEN kopo_plus_jusqu - make_interval(days => $2) > now()
          THEN kopo_plus_jusqu - make_interval(days => $2) ELSE NULL END WHERE id = $1 RETURNING kopo_plus_jusqu, pseudo, numero`, [a.compte_id, a.jours]);
        const c = r.rows[0];
        return { ok: true, compte: a.compte_id, joueur: `${c.pseudo}#${c.numero}`, formule: a.formule, francs: a.francs, jusqu: c.kopo_plus_jusqu };
      });
    },

    // Salle : couper tout de suite le micro d'un joueur qui n'est plus abonné (RoomService.RemoveParticipant de LiveKit).
    async retirerDuVocal({ salon, identite }, fetcher = globalThis.fetch) {
      if (!livekit) return false;
      const t = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const tete = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ iss: livekit.cle, sub: 'kopo-serveur', nbf: t - 10, exp: t + 60, video: { room: salon, roomAdmin: true } });
      const jeton = tete + '.' + crypto.createHmac('sha256', livekit.secret).update(tete).digest('base64url');
      try {
        const r = await fetcher(livekit.url.replace(/^ws/i, 'http') + '/twirp/livekit.RoomService/RemoveParticipant', {
          method: 'POST', headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: salon, identity: identite }), signal: AbortSignal.timeout(8000) });
        return r.ok;
      } catch { return false; }
    },

    // Tableau de bord : formules, abonnés en cours, francs encaissés sur 30 jours, dernières activations.
    async resumeAdmin() {
      const actifs = (await base_.query("SELECT count(*)::int AS n FROM comptes WHERE kopo_plus_jusqu > now() AND statut = 'actif'")).rows[0].n;
      const mois = (await base_.query("SELECT COALESCE(sum(francs), 0)::int AS f, count(*)::int AS n FROM abonnements WHERE cree_le > now() - interval '30 days' AND annule_le IS NULL AND formule <> 'essai'")).rows[0];
      const activations = (await base_.query(`SELECT a.id::int AS id, a.formule, a.francs, a.ref, a.jusqu, a.cree_le, a.annule_le, c.id AS compte, c.pseudo, c.numero
        FROM abonnements a JOIN comptes c ON c.id = a.compte_id ORDER BY a.id DESC LIMIT 30`)).rows;
      const essais30j = (await base_.query("SELECT count(*)::int AS n FROM abonnements WHERE formule = 'essai' AND cree_le > now() - interval '30 days'")).rows[0].n;
      return { ...offre(), essaiJours: ESSAI_JOURS, actifs, francs30j: mois.f, activations30j: mois.n, essais30j, activations };
    },

    // Tableau de bord : LiveKit accepte-t-il nos réglages ? Un jeton d'essai est présenté à /rtc/validate du serveur vocal.
    async verifierLiveKit(fetcher = globalThis.fetch) {
      if (!livekit) return { ok: false, raison: 'LIVEKIT_URL, LIVEKIT_API_KEY ou LIVEKIT_API_SECRET absent sur Render.' };
      const jeton = jetonLiveKit({ cle: livekit.cle, secret: livekit.secret, identite: 'verif-admin', nom: 'Vérification', salon: 'verification', parler: false, duree: 60 });
      const base = livekit.url.replace(/^ws/i, 'http');
      try {
        const r = await fetcher(`${base}/rtc/validate?access_token=${encodeURIComponent(jeton)}`, { signal: AbortSignal.timeout(8000) });
        const texte = String(await r.text()).trim().slice(0, 200);
        if (r.ok) return { ok: true, url: livekit.url };
        if (r.status === 401 || r.status === 403) return { ok: false, url: livekit.url, raison: `LiveKit refuse la clé : vérifie LIVEKIT_API_KEY et LIVEKIT_API_SECRET (la clé et son secret doivent aller ensemble). Réponse : ${texte}` };
        return { ok: false, url: livekit.url, raison: `LiveKit répond ${r.status} : vérifie LIVEKIT_URL. ${texte}` };
      } catch (e) {
        return { ok: false, url: livekit.url, raison: `Serveur vocal injoignable à ${livekit.url} : vérifie LIVEKIT_URL (ex. wss://ton-projet.livekit.cloud). ${String(e.message || e).slice(0, 120)}` };
      }
    },

    // Salle : jeton du salon vocal de la table pour un abonné assis (vérifié par la salle). `parler` faux = sanction « micro ».
    jetonVocal({ compte, salon, parler }) {
      if (!livekit) throw erreur('Le micro arrive bientôt.', 503);
      return { url: livekit.url, jeton: jetonLiveKit({ cle: livekit.cle, secret: livekit.secret, identite: compte.id, nom: compte.pseudo, salon, parler }), salon, parler: !!parler };
    },
  };
  return api;
}

module.exports = { ESSAI_JOURS, creerAbonnement, jetonLiveKit, adresseLiveKit, estAbonne, FORMULES, AVANTAGES };
