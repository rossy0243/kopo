// Comptes, présence, pièces. Seul le serveur modifie un solde, toujours via le registre.
'use strict';
const crypto = require('crypto');

const jourUTC = (d = new Date()) => d.toISOString().slice(0, 10);
// Semaine ISO (2026-W45), pour le joker de série.
function semaineDe(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const an = t.getUTCFullYear(), n = Math.ceil(((t - Date.UTC(an, 0, 1)) / 864e5 + 1) / 7);
  return an + '-W' + String(n).padStart(2, '0');
}
const idAleatoire = (p) => p + crypto.randomBytes(9).toString('base64url');
const numeroAleatoire = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// Mots refusés dans les pseudos (liste de départ, complétée depuis le tableau de bord plus tard).
const MOTS_INTERDITS = ['admin', 'kopo', 'moderateur', 'pute', 'salope', 'connard', 'encule', 'nazi', 'hitler', 'fuck', 'shit', 'bitch', 'nigger', 'pd'];
function normaliser(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
// Pseudo en un seul mot : les espaces deviennent « _ », seuls lettres, chiffres, _ - . restent.
function nettoyerPseudo(p) {
  return String(p || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '');
}
function verifierPseudo(p) {
  const pseudo = nettoyerPseudo(p);
  if (pseudo.length < 3 || pseudo.length > 16) return { ok: false, erreur: 'Le pseudo fait entre 3 et 16 caractères, en un seul mot.' };
  const n = normaliser(pseudo);
  if (MOTS_INTERDITS.some((m) => n.includes(m))) return { ok: false, erreur: 'Ce pseudo n\'est pas autorisé.' };
  return { ok: true, pseudo };
}
const PSEUDO_PRIS = 'Ce pseudo est déjà pris, choisis-en un autre.';
// Règle du créateur : le pseudo se choisit une fois, puis se change 2 fois au plus sur 12 mois glissants.
const CHANGEMENTS_PSEUDO_PAR_AN = 2;
const doublon = (e) => e && e.code === '23505' && /pseudo/.test(String(e.constraint || e.message || ''));

// Pseudo pris (hors comptes supprimés), sans tenir compte des majuscules.
async function pseudoPris(q, pseudo, saufId = null) {
  const r = await q.query("SELECT 1 FROM comptes WHERE lower(pseudo) = lower($1) AND statut <> 'supprime' AND id IS DISTINCT FROM $2 LIMIT 1", [pseudo, saufId]);
  return r.rows.length > 0;
}
// Variante libre : Mundyo, puis Mundyo_4821, etc.
async function pseudoLibre(q, pseudo, saufId = null) {
  if (!(await pseudoPris(q, pseudo, saufId))) return pseudo;
  for (let i = 0; i < 30; i++) {
    const v = pseudo.slice(0, 11) + '_' + numeroAleatoire();
    if (!(await pseudoPris(q, v, saufId))) return v;
  }
  throw Object.assign(new Error(PSEUDO_PRIS), { statut: 409 });
}

// Migration au démarrage : espaces remplacés par « _ », puis doublons renommés
// (le plus ancien garde son pseudo), avant de poser l'index unique.
async function migrerPseudos(base) {
  await base.query("UPDATE comptes SET pseudo = regexp_replace(btrim(pseudo), '\\s+', '_', 'g') WHERE statut <> 'supprime' AND pseudo ~ '\\s'");
  const r = await base.query("SELECT id, pseudo, row_number() OVER (PARTITION BY lower(pseudo) ORDER BY cree_le, id) AS rang FROM comptes WHERE statut <> 'supprime'");
  for (const c of r.rows.filter((x) => Number(x.rang) > 1)) {
    await base.query('UPDATE comptes SET pseudo = $2 WHERE id = $1', [c.id, await pseudoLibre(base, c.pseudo, c.id)]);
  }
  await base.query("CREATE UNIQUE INDEX IF NOT EXISTS comptes_pseudo_unique ON comptes (lower(pseudo)) WHERE statut <> 'supprime'");
}

// Efface aussi l'utilisateur Supabase Auth (e-mail, nom, photo Google).
// Demande la clé secrète « service_role » dans SUPABASE_SERVICE_ROLE_KEY (Render).
async function supprimerUtilisateurSupabase(authId) {
  const url = process.env.SUPABASE_URL, cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) { console.warn('Compte supprimé : utilisateur Supabase ' + authId + ' à effacer à la main (SUPABASE_SERVICE_ROLE_KEY absent).'); return false; }
  try {
    const r = await fetch(new URL('/auth/v1/admin/users/' + encodeURIComponent(authId), url), { method: 'DELETE', headers: { apikey: cle, authorization: 'Bearer ' + cle } });
    if (!r.ok && r.status !== 404) console.warn('Suppression Supabase ' + authId + ' : ' + r.status);
    return r.ok || r.status === 404;
  } catch (e) { console.warn('Suppression Supabase ' + authId + ' : ' + e.message); return false; }
}

function creerComptes(base, reglages) {
  // Ajoute un mouvement au registre et met à jour le solde, dans une transaction.
  async function mouvement(q, compteId, montant, motif, ref, parAdmin = false) {
    if (!Number.isInteger(montant) || montant === 0) return null;
    const r = await q.query('UPDATE comptes SET solde = solde + $2 WHERE id = $1 AND solde + $2 >= 0 RETURNING solde', [compteId, montant]);
    if (!r.rows.length) throw Object.assign(new Error('Solde insuffisant.'), { statut: 400 });
    await q.query('INSERT INTO registre_pieces (compte_id, montant, motif, ref, par_admin) VALUES ($1, $2, $3, $4, $5)', [compteId, montant, motif, ref || null, parAdmin]);
    return r.rows[0].solde;
  }

  const api = {
    mouvement,
    crediter: (compteId, montant, motif, ref, parAdmin) => base.transaction((q) => mouvement(q, compteId, montant, motif, ref, parAdmin)),

    // Si le pseudo voulu est déjà pris, le compte reçoit une variante libre (Mundyo_4821).
    async creer({ pseudo, authId = null, pays = null } = {}, essai = 0) {
      const v = verifierPseudo(pseudo || 'Joueur' + numeroAleatoire());
      if (!v.ok) throw Object.assign(new Error(v.erreur), { statut: 400 });
      const id = idAleatoire('c_');
      return base.transaction(async (q) => {
        await q.query('INSERT INTO comptes (id, auth_id, pseudo, numero, pays) VALUES ($1, $2, $3, $4, $5)', [id, authId, await pseudoLibre(q, v.pseudo), numeroAleatoire(), pays]);
        await mouvement(q, id, reglages.get('gains').bienvenue, 'bienvenue');
        return api.lire(id, q);
      }).catch((e) => { if (doublon(e) && essai < 3) return api.creer({ pseudo, authId, pays }, essai + 1); throw e; });
    },

    async lire(id, q = base) {
      const r = await q.query('SELECT id, auth_id, pseudo, numero, avatar, solde, statut, suspendu_jusqu, micro_coupe, pays, serie_bonus, dernier_bonus, notifs, equipes, kopo_plus_jusqu, cree_le, vu_le FROM comptes WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async parAuth(authId) {
      const r = await base.query('SELECT id FROM comptes WHERE auth_id = $1', [authId]);
      return r.rows[0] ? api.lire(r.rows[0].id) : null;
    },

    // Rattache un compte invité à une connexion Google / téléphone.
    async lier(id, authId) {
      const deja = await api.parAuth(authId);
      // Un compte Google = un seul compte Kopo.
      if (deja) return deja; // ce compte Google est déjà lié : on reprend ce compte-là
      // Le compte de l'appareil est déjà lié à un autre compte Google : on n'y touche pas.
      const r = await base.query('UPDATE comptes SET auth_id = $2 WHERE id = $1 AND auth_id IS NULL RETURNING id', [id, authId]);
      return r.rows.length ? api.lire(id) : null;
    },

    async changerProfil(id, { pseudo, avatar, pays, notifs }) {
      // Types de notifications coupés : { rivalite: false, invitation: true, ami: true }.
      if (notifs !== undefined) {
        if (!notifs || typeof notifs !== 'object') throw Object.assign(new Error('Réglage invalide.'), { statut: 400 });
        const v = {};
        for (const t of ['rivalite', 'invitation', 'ami']) if (typeof notifs[t] === 'boolean') v[t] = notifs[t];
        await base.query('UPDATE comptes SET notifs = notifs || $2::jsonb WHERE id = $1', [id, JSON.stringify(v)]);
      }
      // Pays du classement : code à 2 lettres (CD, CI, SN…), ou null pour ne pas l'afficher.
      if (pays !== undefined) {
        const p = pays === null || pays === '' ? null : String(pays).toUpperCase();
        if (p !== null && !/^[A-Z]{2}$/.test(p)) throw Object.assign(new Error('Pays inconnu.'), { statut: 400 });
        await base.query('UPDATE comptes SET pays = $2 WHERE id = $1', [id, p]);
      }
      if (pseudo !== undefined) {
        const v = verifierPseudo(pseudo);
        if (!v.ok) throw Object.assign(new Error(v.erreur), { statut: 400 });
        const actuel = await api.lire(id);
        if (actuel && actuel.pseudo !== v.pseudo) {
          const quota = await api.quotaPseudo(id);
          if (quota.restants <= 0) {
            const date = new Date(quota.prochain).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
            throw Object.assign(new Error(`Tu as déjà changé ton pseudo ${CHANGEMENTS_PSEUDO_PAR_AN} fois cette année. Prochain changement possible le ${date}.`), { statut: 403 });
          }
          if (await pseudoPris(base, v.pseudo, id)) throw Object.assign(new Error(PSEUDO_PRIS), { statut: 409 });
          await base.transaction(async (q) => {
            await q.query('UPDATE comptes SET pseudo = $2 WHERE id = $1', [id, v.pseudo]);
            await q.query('INSERT INTO changements_pseudo (compte_id, ancien, nouveau) VALUES ($1, $2, $3)', [id, actuel.pseudo, v.pseudo]);
          }).catch((e) => { throw doublon(e) ? Object.assign(new Error(PSEUDO_PRIS), { statut: 409 }) : e; });
        }
      }
      if (avatar !== undefined && /^a\d{1,2}$/.test(avatar)) await base.query('UPDATE comptes SET avatar = $2 WHERE id = $1', [id, avatar]);
      return api.lire(id);
    },

    // Changements de pseudo encore permis sur les 12 derniers mois, et date du prochain si aucun.
    async quotaPseudo(id) {
      const r = await base.query("SELECT cree_le FROM changements_pseudo WHERE compte_id = $1 AND cree_le > now() - interval '1 year' ORDER BY cree_le", [id]);
      const restants = Math.max(0, CHANGEMENTS_PSEUDO_PAR_AN - r.rows.length);
      let prochain = null;
      if (!restants) { const d = new Date(r.rows[r.rows.length - CHANGEMENTS_PSEUDO_PAR_AN].cree_le); d.setUTCFullYear(d.getUTCFullYear() + 1); prochain = d.toISOString(); }
      return { restants, max: CHANGEMENTS_PSEUDO_PAR_AN, prochain };
    },

    // Le joueur a ouvert le jeu : présence du jour (joueurs actifs, rétention).
    async presence(id) {
      await base.query('UPDATE comptes SET vu_le = now() WHERE id = $1', [id]);
      await base.query('INSERT INTO presences (compte_id, jour) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, jourUTC()]);
    },

    // Statut effectif (une suspension expirée est levée).
    async statut(id) {
      const c = await api.lire(id);
      if (!c) return null;
      if (c.statut === 'suspendu' && c.suspendu_jusqu && new Date(c.suspendu_jusqu) <= new Date()) {
        await base.query("UPDATE comptes SET statut = 'actif', suspendu_jusqu = NULL WHERE id = $1", [id]);
        c.statut = 'actif'; c.suspendu_jusqu = null;
      }
      return c;
    },

    // Bonus du jour : 50, 60, 70… plafonné à 150. Un jour raté par semaine ne casse pas la série (joker, retention §3.3).
    async bonusDuJour(id) {
      const b = reglages.get('bonusJour');
      return base.transaction(async (q) => {
        const r = await q.query('SELECT serie_bonus, dernier_bonus, joker_semaine FROM comptes WHERE id = $1 FOR UPDATE', [id]);
        const c = r.rows[0];
        if (!c) throw Object.assign(new Error('Compte inconnu.'), { statut: 404 });
        const auj = jourUTC();
        const dernier = c.dernier_bonus ? jourUTC(new Date(c.dernier_bonus)) : null;
        if (dernier === auj) return { dejaPris: true, serie: c.serie_bonus };
        const hier = jourUTC(new Date(Date.now() - 864e5)), avantHier = jourUTC(new Date(Date.now() - 2 * 864e5));
        const semaine = semaineDe(new Date());
        let serie = 1, joker = false;
        if (dernier === hier) serie = c.serie_bonus + 1;
        else if (dernier === avantHier && c.serie_bonus && c.joker_semaine !== semaine) { serie = c.serie_bonus + 1; joker = true; }
        const montant = Math.min(b.depart + b.pas * (serie - 1), b.plafond);
        await q.query('UPDATE comptes SET serie_bonus = $2, dernier_bonus = $3, joker_semaine = CASE WHEN $4 THEN $5 ELSE joker_semaine END WHERE id = $1', [id, serie, auj, joker, semaine]);
        const solde = await mouvement(q, id, montant, 'bonus_jour');
        return { montant, gain: montant, serie, joker, prochain: Math.min(b.depart + b.pas * serie, b.plafond), solde, jokerLibre: joker ? false : c.joker_semaine !== semaine };
      });
    },

    // Récompenses calculées sur le téléphone (missions du jour, défi de la semaine, bienvenue 7 jours).
    // Le serveur ne peut pas tout vérifier : il plafonne (montant, nombre par jour / semaine) et refuse les doublons.
    async recompense(id, { motif, montant, ref }) {
      const L = { mission: { max: 100, parJour: 5 }, defi: { max: 300, parSemaine: 1 }, bienvenue: { max: 300, parJour: 1, total: 7 } }[motif];
      montant = Math.trunc(Number(montant));
      if (!L) throw Object.assign(new Error('Récompense inconnue.'), { statut: 400 });
      if (!(montant > 0 && montant <= L.max)) throw Object.assign(new Error('Montant invalide.'), { statut: 400 });
      ref = String(ref || '').slice(0, 80);
      if (motif === 'bienvenue') motif = 'bienvenue7'; // « bienvenue » est déjà le cadeau de création du compte
      return base.transaction(async (q) => {
        await q.query('SELECT 1 FROM comptes WHERE id = $1 FOR UPDATE', [id]);
        const n = (await q.query(`SELECT count(*) FILTER (WHERE cree_le >= date_trunc('day', now()))::int AS jour,
            count(*) FILTER (WHERE cree_le >= date_trunc('week', now()))::int AS semaine, count(*)::int AS total,
            count(*) FILTER (WHERE ref = $3 AND $3 <> '')::int AS meme
          FROM registre_pieces WHERE compte_id = $1 AND motif = $2`, [id, motif, ref])).rows[0];
        if (n.meme || (L.parJour && n.jour >= L.parJour) || (L.parSemaine && n.semaine >= L.parSemaine) || (L.total && n.total >= L.total)) return { ok: false, erreur: 'Déjà reçu.' };
        const solde = await mouvement(q, id, montant, motif, ref || null);
        return { ok: true, montant, solde };
      });
    },

    // Cadeau de fondateur : le dos de cartes « Les Fondateurs », une fois par compte, tant que l'admin le laisse actif.
    async cadeauFondateur(id) {
      if (!(reglages.get('cadeauFondateur') || {}).actif) return { ok: false, erreur: 'Le cadeau de fondateur n\'est plus distribué.' };
      const r = await base.query("INSERT INTO inventaire (compte_id, objet, source) VALUES ($1, 'dos-fondateurs', 'fondateur') ON CONFLICT DO NOTHING RETURNING 1", [id]);
      return { ok: true, nouveau: r.rows.length > 0, objet: 'dos-fondateurs' };
    },

    // Remise à flot : si le solde passe sous le seuil, une fois par jour.
    async remiseAFlot(id) {
      const { seuil, niveau } = reglages.get('remiseAFlot');
      return base.transaction(async (q) => {
        const c = (await q.query('SELECT solde FROM comptes WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!c || c.solde >= seuil) return { ok: false, erreur: 'Ton solde est suffisant.' };
        const deja = await q.query("SELECT 1 FROM registre_pieces WHERE compte_id = $1 AND motif = 'remise_a_flot' AND cree_le >= date_trunc('day', now())", [id]);
        if (deja.rows.length) return { ok: false, erreur: 'Déjà utilisée aujourd\'hui.' };
        const solde = await mouvement(q, id, niveau - c.solde, 'remise_a_flot');
        return { ok: true, solde };
      });
    },

    async historique(id, limite = 50) {
      return (await base.query('SELECT montant, motif, ref, par_admin, cree_le FROM registre_pieces WHERE compte_id = $1 ORDER BY id DESC LIMIT $2', [id, limite])).rows;
    },

    // Suppression demandée par le joueur (exigée par Google Play et l'App Store) :
    // on efface ce qui l'identifie, on garde les lignes anonymes pour les statistiques.
    async supprimer(id) {
      const avant = await api.lire(id);
      await base.transaction(async (q) => {
        await q.query("UPDATE comptes SET statut = 'supprime', auth_id = NULL, pseudo = 'Joueur supprimé', pays = NULL WHERE id = $1", [id]);
        await q.query('DELETE FROM amis WHERE compte_id = $1 OR ami_id = $1', [id]);
        await q.query('DELETE FROM blocages WHERE compte_id = $1', [id]);
      });
      if (avant && avant.auth_id) await supprimerUtilisateurSupabase(avant.auth_id);
    },
  };
  return api;
}

module.exports = { creerComptes, verifierPseudo, nettoyerPseudo, migrerPseudos, jourUTC, idAleatoire };
