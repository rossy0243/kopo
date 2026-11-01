// Parrainage : un joueur invite un ami avec son lien ; quand l'ami a un vrai compte (Google)
// et a joué assez de parties entre humains, les deux reçoivent un cadeau (retention.md §3.7).
//
// Contre les abus :
// - chaque compte Google vu par le serveur laisse une empreinte (HMAC de son identifiant Google
//   et de son adresse), gardée même après la suppression du compte. Un compte Google ne peut
//   être parrainé qu'une fois, à vie : supprimer son compte et revenir ne redonne rien ;
// - le filleul doit avoir un compte Google tout neuf pour le Kopo, créé il y a peu (joursCompte) ;
// - le parrain doit lui aussi être connecté avec Google, et ne peut pas se parrainer lui-même ;
// - seules comptent les parties finies, sans robot, avec au moins un autre humain que le parrain ;
// - plafond par mois (contre les fermes de faux comptes), levé par l'admin pour un créateur vérifié.
// Les gros parrains (influenceurs) sont récompensés par des paliers : 3, 10, 25… jusqu'à 1 000 amis.
'use strict';
const crypto = require('crypto');

const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const OBJET_AMBASSADEUR = 'cadre-ambassadeur';
// Paliers : nombre d'amis venus jouer (parrainages validés). Chacun ne se gagne qu'une fois.
const PALIERS = [
  { n: 3, objet: 'cadre-ambassadeur' },
  { n: 10, pieces: 1000, objet: 'av-ambassadeur', titre: 'Ambassadeur' },
  { n: 25, pieces: 2500, objet: 'dos-ambassadeur' },
  { n: 50, pieces: 5000, titre: 'Grand ambassadeur' },
  { n: 100, pieces: 10000, objet: 'cadre-ambassadeur-or', titre: "Ambassadeur d'or" },
  { n: 250, pieces: 20000, titre: 'Star du Kopo' },
  { n: 500, pieces: 30000, titre: 'Ambassadeur légendaire' },
  { n: 1000, pieces: 50000, titre: 'Légende du Kopo' },
];
const titreDe = (n) => PALIERS.filter((p) => p.titre && n >= p.n).map((p) => p.titre).pop() || null;
const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });

// Adresse Gmail ramenée à sa forme unique (points et +suffixe ignorés par Google).
function normaliserEmail(e) {
  const t = String(e || '').trim().toLowerCase();
  const m = /^([^@]+)@(gmail\.com|googlemail\.com)$/.exec(t);
  if (m) return m[1].split('+')[0].replace(/\./g, '') + '@gmail.com';
  return t.includes('@') ? t : '';
}

// Identifiants stables d'une connexion Supabase : l'identifiant Google (qui ne change pas,
// même si l'utilisateur Supabase est effacé puis recréé), l'adresse e-mail, le téléphone.
function identitesConnexion(payload) {
  const p = payload || {}, um = p.user_metadata || {}, am = p.app_metadata || {};
  const l = [];
  const fournisseur = am.provider || (um.provider_id || um.iss ? 'google' : null);
  const idFournisseur = um.provider_id || (fournisseur && um.sub && um.sub !== p.sub ? um.sub : null);
  if (fournisseur && idFournisseur) l.push(fournisseur + ':' + idFournisseur);
  const email = normaliserEmail(p.email || um.email);
  if (email) l.push('email:' + email);
  if (p.phone) l.push('tel:' + String(p.phone).replace(/[^\d]/g, ''));
  if (!l.length && p.sub) l.push('auth:' + p.sub); // dernier recours : l'identifiant Supabase
  return l;
}

function creerParrainage(base, reglages, comptes, social, env = process.env) {
  const cfg = () => reglages.get('parrainage');
  const secret = env.SECRET_EMPREINTES || env.SECRET_SERVEUR || 'secret-de-developpement-a-ne-pas-utiliser';
  const empreinte = (identite) => crypto.createHmac('sha256', secret).update('kopo-empreinte:' + identite).digest('base64url');

  // Parties qui comptent pour un filleul : finies sans abandon, sans robot, et avec au moins
  // un autre humain que son parrain (jouer à deux avec son parrain ne compte pas).
  const SQL_PARTIES = `SELECT count(*)::int AS n FROM participations p JOIN parties x ON x.id = p.partie_id
    WHERE p.compte_id = $1 AND NOT p.abandon AND p.place IS NOT NULL AND NOT x.avec_robots AND x.fin IS NOT NULL AND x.debut >= $3
      AND EXISTS (SELECT 1 FROM participations o WHERE o.partie_id = p.partie_id AND o.compte_id <> $1 AND o.compte_id <> $2)`;

  async function codeDe(q, compteId) {
    const r = await q.query('SELECT code_parrain FROM comptes WHERE id = $1', [compteId]);
    if (r.rows[0] && r.rows[0].code_parrain) return r.rows[0].code_parrain;
    for (let i = 0; i < 20; i++) {
      const code = Array.from(crypto.randomBytes(6), (b) => LETTRES[b % LETTRES.length]).join('');
      const u = await q.query('UPDATE comptes SET code_parrain = $2 WHERE id = $1 AND code_parrain IS NULL AND NOT EXISTS (SELECT 1 FROM comptes WHERE code_parrain = $2) RETURNING code_parrain', [compteId, code]);
      if (u.rows.length) return code;
      const deja = await q.query('SELECT code_parrain FROM comptes WHERE id = $1', [compteId]);
      if (deja.rows[0] && deja.rows[0].code_parrain) return deja.rows[0].code_parrain;
    }
    throw erreur('Code impossible à créer, réessaie.', 500);
  }

  // Parrainages récompensés du parrain : ce mois-ci (30 jours glissants) et au total.
  async function compteur(q, parrainId) {
    return (await q.query(`SELECT count(*) FILTER (WHERE pieces_parrain > 0 AND valide_le > now() - interval '30 days')::int AS mois,
        count(*) FILTER (WHERE pieces_parrain > 0)::int AS total FROM parrainages WHERE parrain_id = $1`, [parrainId])).rows[0];
  }

  // Un parrainage en cours dont le délai est passé devient « expiré ».
  async function expirer(q) {
    await q.query("UPDATE parrainages SET statut = 'expire' WHERE statut = 'en_cours' AND expire_le < now()");
  }

  const api = {
    empreinte,
    identitesConnexion,
    OBJET_AMBASSADEUR,
    PALIERS,
    // Tableau de bord : un créateur vérifié (influenceur) n'a plus de plafond par mois.
    async createur(compteId, actif) {
      const r = await base.query('UPDATE comptes SET parrain_createur = $2 WHERE id = $1 RETURNING id', [compteId, !!actif]);
      return r.rows.length > 0;
    },

    // À chaque connexion Google / téléphone : l'empreinte est notée pour ce compte (la première fois seulement).
    // Elle n'est jamais effacée : c'est elle qui empêche de se faire parrainer à nouveau après une suppression.
    async noterConnexion(compteId, payload) {
      const emps = identitesConnexion(payload).map(empreinte);
      for (const e of emps) await base.query('INSERT INTO empreintes (empreinte, compte_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [e, compteId]);
      // Une seule identité déjà vue sur un autre compte (même Google, même adresse) suffit : ce compte n'est pas neuf.
      const autre = await base.query('SELECT 1 FROM empreintes WHERE empreinte = ANY($1) AND compte_id <> $2 LIMIT 1', [emps, compteId]);
      if (autre.rows.length) await base.query('UPDATE comptes SET identite_connue = true WHERE id = $1', [compteId]);
    },

    // Rattache le filleul à son parrain (code du lien d'invitation). Renvoie { ok, erreur? }.
    async lier(filleulId, code) {
      const c = cfg();
      if (!c.actif) return { ok: false, erreur: 'Le parrainage est en pause.' };
      code = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return { ok: false, erreur: 'Code de parrainage inconnu.' };
      return base.transaction(async (q) => {
        const f = (await q.query("SELECT id, auth_id, statut, cree_le, identite_connue FROM comptes WHERE id = $1 FOR UPDATE", [filleulId])).rows[0];
        if (!f || f.statut !== 'actif') return { ok: false, erreur: 'Compte indisponible.' };
        const p = (await q.query("SELECT id, auth_id, statut, pseudo FROM comptes WHERE code_parrain = $1", [code])).rows[0];
        if (!p || p.statut === 'supprime' || p.statut === 'banni') return { ok: false, erreur: 'Code de parrainage inconnu.' };
        if (p.id === f.id) return { ok: false, erreur: 'Tu ne peux pas te parrainer toi-même.' };
        if (!p.auth_id) return { ok: false, erreur: `${p.pseudo} doit se connecter avec Google pour pouvoir parrainer.` };
        if (!f.auth_id) return { ok: false, erreur: 'Connecte-toi avec Google pour que ton parrainage compte.' };
        if ((await q.query('SELECT 1 FROM parrainages WHERE filleul_id = $1', [f.id])).rows.length) return { ok: false, erreur: 'Tu as déjà un parrain.' };
        // Le compte Google doit être nouveau pour le Kopo : sa première empreinte appartient à ce compte-ci.
        const emp = (await q.query('SELECT empreinte FROM empreintes WHERE compte_id = $1', [f.id])).rows;
        if (!emp.length || f.identite_connue) return { ok: false, erreur: 'Ce compte Google a déjà été utilisé sur le Kopo : le parrainage est réservé aux nouveaux joueurs.' };
        if (new Date(f.cree_le) < new Date(Date.now() - c.joursCompte * 864e5)) return { ok: false, erreur: 'Le parrainage est réservé aux nouveaux joueurs.' };
        // Le même compte Google des deux côtés (impossible en temps normal, gardé par prudence).
        const memes = await q.query('SELECT 1 FROM empreintes a JOIN empreintes b ON a.empreinte = b.empreinte WHERE a.compte_id = $1 AND b.compte_id = $2', [f.id, p.id]);
        if (memes.rows.length) return { ok: false, erreur: 'Tu ne peux pas te parrainer toi-même.' };
        // Pas de parrainage croisé : on ne parraine pas son propre parrain.
        if ((await q.query('SELECT 1 FROM parrainages WHERE parrain_id = $1 AND filleul_id = $2', [f.id, p.id])).rows.length) return { ok: false, erreur: 'Tu ne peux pas parrainer ton parrain.' };
        await q.query("INSERT INTO parrainages (parrain_id, filleul_id, expire_le) VALUES ($1, $2, now() + make_interval(days => $3))", [p.id, f.id, c.joursPourJouer]);
        return { ok: true, parrain: p.pseudo };
      });
    },

    // Fin de partie : les filleuls de la table avancent ; à la dernière partie, les cadeaux partent.
    async apresPartie(compteIds) {
      const c = cfg();
      if (!c.actif || !compteIds.length) return [];
      await expirer(base);
      const enCours = (await base.query("SELECT filleul_id FROM parrainages WHERE statut = 'en_cours' AND filleul_id = ANY($1)", [compteIds])).rows;
      const valides = [];
      for (const { filleul_id } of enCours) {
        const r = await api.avancer(filleul_id).catch((e) => { console.error('Parrainage :', e.message); return null; });
        if (r && r.valide) valides.push(r);
      }
      return valides;
    },

    // Recompte les parties du filleul et donne les cadeaux une fois le compte atteint (une seule fois).
    async avancer(filleulId) {
      const c = cfg();
      const res = await base.transaction(async (q) => {
        const pa = (await q.query("SELECT * FROM parrainages WHERE filleul_id = $1 AND statut = 'en_cours' AND expire_le >= now() FOR UPDATE", [filleulId])).rows[0];
        if (!pa) return null;
        const n = (await q.query(SQL_PARTIES, [filleulId, pa.parrain_id, pa.cree_le])).rows[0].n;
        await q.query('UPDATE parrainages SET parties = $2 WHERE filleul_id = $1', [filleulId, Math.min(n, c.parties)]);
        if (n < c.parties) return { valide: false, parties: n };
        const parrain = (await q.query('SELECT id, pseudo, statut, auth_id, parrain_createur FROM comptes WHERE id = $1 FOR UPDATE', [pa.parrain_id])).rows[0];
        const filleul = (await q.query('SELECT id, pseudo, statut FROM comptes WHERE id = $1', [filleulId])).rows[0];
        // Plafonds du parrain ; le filleul reçoit son cadeau même si le parrain a atteint le sien.
        const k = await compteur(q, pa.parrain_id);
        let raison = null;
        if (!parrain || parrain.statut === 'supprime' || parrain.statut === 'banni' || !parrain.auth_id) raison = 'parrain indisponible';
        else if (c.total > 0 && k.total >= c.total) raison = 'plafond total';
        else if (!parrain.parrain_createur && k.mois >= c.parMois) raison = 'plafond du mois';
        const piecesParrain = raison ? 0 : c.piecesParrain;
        const piecesFilleul = filleul && filleul.statut === 'actif' ? c.piecesFilleul : 0;
        await q.query("UPDATE parrainages SET statut = 'valide', valide_le = now(), pieces_parrain = $2, pieces_filleul = $3, note = $4 WHERE filleul_id = $1", [filleulId, piecesParrain, piecesFilleul, raison]);
        if (piecesParrain) await comptes.mouvement(q, pa.parrain_id, piecesParrain, 'parrainage', filleulId);
        if (piecesFilleul) await comptes.mouvement(q, filleulId, piecesFilleul, 'parrainage_filleul', pa.parrain_id);
        // Paliers : tous les amis venus jouer comptent, même au-delà du plafond du mois.
        const paliers = [];
        if (parrain && raison !== 'parrain indisponible') {
          const amis = (await q.query("SELECT count(*)::int AS n FROM parrainages WHERE parrain_id = $1 AND statut = 'valide'", [pa.parrain_id])).rows[0].n;
          for (const pl of PALIERS.filter((x) => x.n <= amis)) {
            const neuf = await q.query('INSERT INTO parrainage_paliers (compte_id, palier) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [pa.parrain_id, pl.n]);
            if (!neuf.rows.length) continue;
            if (pl.pieces) await comptes.mouvement(q, pa.parrain_id, pl.pieces, 'parrainage_palier', 'palier:' + pl.n);
            if (pl.objet) await q.query('INSERT INTO inventaire (compte_id, objet, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [pa.parrain_id, pl.objet, 'parrainage:' + pl.n]);
            paliers.push(pl);
          }
        }
        return { valide: true, parrainId: pa.parrain_id, filleulId, parrain: parrain && parrain.pseudo, filleul: filleul && filleul.pseudo, piecesParrain, piecesFilleul, paliers, raison };
      });
      if (res && res.valide) {
        if (res.piecesParrain) await social.notifier(res.parrainId, 'parrainage', `${res.filleul} a joué ses ${c.parties} parties : tu gagnes ${res.piecesParrain} pièces !`, { filleul: res.filleul, pieces: res.piecesParrain });
        else if (res.raison && res.raison.startsWith('plafond')) await social.notifier(res.parrainId, 'parrainage', `${res.filleul} a joué ses ${c.parties} parties. Tu as atteint le plafond de ${res.raison === 'plafond du mois' ? c.parMois + ' parrainages récompensés ce mois-ci' : 'parrainages récompensés'} ; il compte quand même pour tes paliers.`, { filleul: res.filleul, pieces: 0 });
        for (const pl of res.paliers) {
          const quoi = [pl.pieces ? pl.pieces + ' pièces' : null, pl.objet ? 'une apparence exclusive' : null, pl.titre ? 'le titre « ' + pl.titre + ' »' : null].filter(Boolean).join(', ');
          await social.notifier(res.parrainId, 'parrainage', `${pl.n} amis venus jouer grâce à toi : tu gagnes ${quoi} !`, { palier: pl.n, pieces: pl.pieces || 0, objet: pl.objet || null, titre: pl.titre || null });
        }
        if (res.piecesFilleul) await social.notifier(res.filleulId, 'parrainage', `Merci d'avoir rejoint le Kopo avec ${res.parrain} : tu gagnes ${res.piecesFilleul} pièces !`, { parrain: res.parrain, pieces: res.piecesFilleul });
      }
      return res;
    },

    // Écran « Inviter des amis » : mon lien, mes filleuls, mon parrain, les règles.
    async etat(compte) {
      const c = cfg();
      await expirer(base);
      const lie = !!compte.auth_id;
      const code = lie ? await codeDe(base, compte.id) : null;
      const k = await compteur(base, compte.id);
      const amis = (await base.query("SELECT count(*)::int AS n FROM parrainages WHERE parrain_id = $1 AND statut = 'valide'", [compte.id])).rows[0].n;
      const extra = (await base.query('SELECT parrain_createur, identite_connue FROM comptes WHERE id = $1', [compte.id])).rows[0] || {};
      const filleuls = (await base.query(`SELECT c.pseudo, c.numero, c.avatar, p.statut, p.parties, p.pieces_parrain, p.cree_le, p.expire_le, p.valide_le
        FROM parrainages p JOIN comptes c ON c.id = p.filleul_id WHERE p.parrain_id = $1 ORDER BY p.cree_le DESC LIMIT 50`, [compte.id])).rows;
      const moi = (await base.query(`SELECT c.pseudo, c.numero, p.statut, p.parties, p.expire_le, p.pieces_filleul FROM parrainages p JOIN comptes c ON c.id = p.parrain_id WHERE p.filleul_id = $1`, [compte.id])).rows[0] || null;
      const peutEtreParraine = !moi && lie && new Date(compte.cree_le) >= new Date(Date.now() - c.joursCompte * 864e5)
        && !extra.identite_connue && (await base.query('SELECT 1 FROM empreintes WHERE compte_id = $1 LIMIT 1', [compte.id])).rows.length > 0;
      return {
        actif: !!c.actif, lie, code,
        regles: { parties: c.parties, piecesParrain: c.piecesParrain, piecesFilleul: c.piecesFilleul, parMois: extra.parrain_createur ? null : c.parMois, total: c.total || null, joursPourJouer: c.joursPourJouer },
        recompenses: { mois: k.mois, total: k.total },
        amis, titre: titreDe(amis), createur: !!extra.parrain_createur,
        paliers: PALIERS.map((p) => ({ ...p, atteint: amis >= p.n })),
        filleuls,
        parrain: moi,
        peutEtreParraine,
      };
    },

    // Tableau de bord : parrainages d'un joueur (comme parrain et comme filleul).
    async resumeAdmin(compteId) {
      return (await base.query(`SELECT p.statut, p.parties, p.pieces_parrain, p.pieces_filleul, p.note, p.cree_le, p.valide_le,
          p.parrain_id, cp.pseudo AS parrain, cp.numero AS parrain_numero, p.filleul_id, cf.pseudo AS filleul, cf.numero AS filleul_numero
        FROM parrainages p JOIN comptes cp ON cp.id = p.parrain_id JOIN comptes cf ON cf.id = p.filleul_id
        WHERE p.parrain_id = $1 OR p.filleul_id = $1 ORDER BY p.cree_le DESC LIMIT 100`, [compteId])).rows;
    },
  };
  return api;
}

module.exports = { creerParrainage, identitesConnexion, normaliserEmail, OBJET_AMBASSADEUR, PALIERS, titreDe };
