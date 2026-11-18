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

function creerAbonnement(base_, env = process.env) {
  const livekit = env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
    ? { url: env.LIVEKIT_URL, cle: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET } : null;
  const offre = () => ({ paiement: false, micro: !!livekit, formules: FORMULES.map((f) => ({ ...f })), avantages: AVANTAGES.slice() });

  const api = {
    FORMULES, estAbonne,
    microPret: () => !!livekit,
    // Pour le joueur : son abonnement et les prix (en francs congolais).
    pourJoueur: (c) => ({ actif: estAbonne(c), jusqu: estAbonne(c) ? c.kopo_plus_jusqu : null, ...offre() }),
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

    // Tableau de bord : formules, abonnés en cours, francs encaissés sur 30 jours, dernières activations.
    async resumeAdmin() {
      const actifs = (await base_.query("SELECT count(*)::int AS n FROM comptes WHERE kopo_plus_jusqu > now() AND statut = 'actif'")).rows[0].n;
      const mois = (await base_.query("SELECT COALESCE(sum(francs), 0)::int AS f, count(*)::int AS n FROM abonnements WHERE cree_le > now() - interval '30 days'")).rows[0];
      const activations = (await base_.query(`SELECT a.id::int AS id, a.formule, a.francs, a.ref, a.jusqu, a.cree_le, c.id AS compte, c.pseudo, c.numero
        FROM abonnements a JOIN comptes c ON c.id = a.compte_id ORDER BY a.id DESC LIMIT 30`)).rows;
      return { ...offre(), actifs, francs30j: mois.f, activations30j: mois.n, activations };
    },

    // Salle : jeton du salon vocal de la table pour un abonné assis (vérifié par la salle). `parler` faux = sanction « micro ».
    jetonVocal({ compte, salon, parler }) {
      if (!livekit) throw erreur('Le micro arrive bientôt.', 503);
      return { url: livekit.url, jeton: jetonLiveKit({ cle: livekit.cle, secret: livekit.secret, identite: compte.id, nom: compte.pseudo, salon, parler }), salon, parler: !!parler };
    },
  };
  return api;
}

module.exports = { creerAbonnement, jetonLiveKit, estAbonne, FORMULES, AVANTAGES };
