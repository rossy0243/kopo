// Comptes, présence, pièces. Seul le serveur modifie un solde, toujours via le registre.
'use strict';
const crypto = require('crypto');

const jourUTC = (d = new Date()) => d.toISOString().slice(0, 10);
const idAleatoire = (p) => p + crypto.randomBytes(9).toString('base64url');
const numeroAleatoire = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// Mots refusés dans les pseudos (liste de départ, complétée depuis le tableau de bord plus tard).
const MOTS_INTERDITS = ['admin', 'kopo', 'moderateur', 'pute', 'salope', 'connard', 'encule', 'nazi', 'hitler', 'fuck', 'shit', 'bitch', 'nigger', 'pd'];
function normaliser(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function verifierPseudo(p) {
  const pseudo = String(p || '').replace(/[<>#]/g, '').trim();
  if (pseudo.length < 3 || pseudo.length > 16) return { ok: false, erreur: 'Le pseudo fait entre 3 et 16 caractères.' };
  const n = normaliser(pseudo);
  if (MOTS_INTERDITS.some((m) => n.includes(m))) return { ok: false, erreur: 'Ce pseudo n\'est pas autorisé.' };
  return { ok: true, pseudo };
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

    async creer({ pseudo, authId = null, pays = null } = {}) {
      const v = verifierPseudo(pseudo || 'Joueur' + numeroAleatoire());
      if (!v.ok) throw Object.assign(new Error(v.erreur), { statut: 400 });
      const id = idAleatoire('c_');
      return base.transaction(async (q) => {
        await q.query('INSERT INTO comptes (id, auth_id, pseudo, numero, pays) VALUES ($1, $2, $3, $4, $5)', [id, authId, v.pseudo, numeroAleatoire(), pays]);
        await mouvement(q, id, reglages.get('gains').bienvenue, 'bienvenue');
        return api.lire(id, q);
      });
    },

    async lire(id, q = base) {
      const r = await q.query('SELECT id, auth_id, pseudo, numero, avatar, solde, statut, suspendu_jusqu, micro_coupe, pays, serie_bonus, dernier_bonus, cree_le, vu_le FROM comptes WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async parAuth(authId) {
      const r = await base.query('SELECT id FROM comptes WHERE auth_id = $1', [authId]);
      return r.rows[0] ? api.lire(r.rows[0].id) : null;
    },

    // Rattache un compte invité à une connexion Google / téléphone.
    async lier(id, authId) {
      const deja = await api.parAuth(authId);
      if (deja && deja.id !== id) return deja; // ce compte Google existe déjà : on le reprend
      await base.query('UPDATE comptes SET auth_id = $2 WHERE id = $1', [id, authId]);
      return api.lire(id);
    },

    async changerProfil(id, { pseudo, avatar }) {
      if (pseudo !== undefined) {
        const v = verifierPseudo(pseudo);
        if (!v.ok) throw Object.assign(new Error(v.erreur), { statut: 400 });
        await base.query('UPDATE comptes SET pseudo = $2 WHERE id = $1', [id, v.pseudo]);
      }
      if (avatar !== undefined && /^a\d{1,2}$/.test(avatar)) await base.query('UPDATE comptes SET avatar = $2 WHERE id = $1', [id, avatar]);
      return api.lire(id);
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

    // Bonus du jour : 50, 60, 70… plafonné à 150 ; revient au départ si on saute un jour.
    async bonusDuJour(id) {
      const b = reglages.get('bonusJour');
      return base.transaction(async (q) => {
        const r = await q.query('SELECT serie_bonus, dernier_bonus FROM comptes WHERE id = $1 FOR UPDATE', [id]);
        const c = r.rows[0];
        if (!c) throw Object.assign(new Error('Compte inconnu.'), { statut: 404 });
        const auj = jourUTC();
        const dernier = c.dernier_bonus ? jourUTC(new Date(c.dernier_bonus)) : null;
        if (dernier === auj) return { dejaPris: true };
        const hier = jourUTC(new Date(Date.now() - 864e5));
        const serie = dernier === hier ? c.serie_bonus + 1 : 1;
        const montant = Math.min(b.depart + b.pas * (serie - 1), b.plafond);
        await q.query('UPDATE comptes SET serie_bonus = $2, dernier_bonus = $3 WHERE id = $1', [id, serie, auj]);
        const solde = await mouvement(q, id, montant, 'bonus_jour');
        return { montant, serie, solde };
      });
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
      await base.transaction(async (q) => {
        await q.query("UPDATE comptes SET statut = 'supprime', auth_id = NULL, pseudo = 'Joueur supprimé', pays = NULL WHERE id = $1", [id]);
        await q.query('DELETE FROM amis WHERE compte_id = $1 OR ami_id = $1', [id]);
        await q.query('DELETE FROM blocages WHERE compte_id = $1', [id]);
      });
    },
  };
  return api;
}

module.exports = { creerComptes, verifierPseudo, jourUTC, idAleatoire };
