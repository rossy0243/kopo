// Match du jour (competition-amis.md v1.3, validé le 2/11) : chaque jour, la même partie contre 8 robots
// pour tous les joueurs, un seul essai, un score sur 100. Seul le serveur la fait tourner et note le score.
'use strict';
const crypto = require('crypto');

const JOUR = 864e5;
const HEURE = 36e5;
const DECALAGE = HEURE; // heure de Kinshasa = UTC + 1 h, toute l'année
const PREMIER_JOUR = '2026-11-02'; // Match du jour n°1
const MANCHES_AVANT_FINALE = 7; // à 9 joueurs
const PAR_MANCHE = 10, VICTOIRE = 30;
const EN_COURS_MAX = 45 * 60e3; // un essai resté « en cours » (serveur redémarré) est clos au bout de 45 min
const ROBOTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'robot-' + n);

// Jour de Kinshasa (YYYY-MM-DD) d'un instant.
const jourDe = (d = new Date()) => new Date(d.getTime() + DECALAGE).toISOString().slice(0, 10);
// Instant (Date) du début d'un jour de Kinshasa : minuit à Kinshasa = 23 h UTC la veille.
const debutDu = (jour) => new Date(Date.parse(jour + 'T00:00:00Z') - DECALAGE);
const ajouterJours = (jour, n) => new Date(Date.parse(jour + 'T00:00:00Z') + n * JOUR).toISOString().slice(0, 10);
const numeroDu = (jour) => Math.round((Date.parse(jour) - Date.parse(PREMIER_JOUR)) / JOUR) + 1;
// Lundi de la semaine d'un jour (les semaines vont du lundi au dimanche).
function lundiDe(jour) {
  const d = new Date(jour + 'T00:00:00Z');
  return ajouterJours(jour, -((d.getUTCDay() + 6) % 7));
}

// Score sur 100 : +10 par manche passée (7 au plus avant la finale), +30 pour la victoire en finale.
const scoreDe = (manches, victoire) => PAR_MANCHE * Math.min(Math.max(0, manches | 0), MANCHES_AVANT_FINALE) + (victoire ? VICTOIRE : 0);

// Graine secrète du jour : impossible de deviner la donne à l'avance à partir du code.
function graineDu(jour, secret) {
  return crypto.createHmac('sha256', String(secret || 'kopo')).update('match-jour:' + jour).digest().readUInt32BE(0);
}

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });

function creerMatchJour(base, reglages, env = process.env) {
  const secret = env.SECRET_MATCH_JOUR || env.SECRET_SERVEUR || 'kopo';
  const cfg = () => reglages.get('matchJour') || {};
  let horloge = () => new Date(); // remplacée dans les tests

  async function lire(compteId, jour, q = base) {
    return (await q.query('SELECT score, manches, victoire, statut, debut, fin FROM match_jour WHERE compte_id = $1 AND jour = $2', [compteId, jour])).rows[0] || null;
  }

  const api = {
    jourDe, debutDu, ajouterJours, lundiDe, numeroDu, scoreDe, ROBOTS,
    regler(h) { horloge = h; },
    maintenant: () => horloge(),
    aujourdhui: () => jourDe(horloge()),

    // Tout ce qu'il faut pour préparer la salle du jour.
    donneDu(jour) {
      const c = cfg();
      return { jour, numero: numeroDu(jour), graine: graineDu(jour, secret), robots: c.robots || 'forts', niveauRobots: c.niveauRobots || 20 };
    },

    // Entrée dans la salle : premier essai = essai officiel. Ensuite, entraînement (rien n'est noté),
    // seulement une fois l'essai officiel terminé (sinon on pourrait découvrir la donne dans un autre onglet).
    async commencer(compte) {
      if (!cfg().actif) throw erreur('Le Match du jour est en pause. Reviens bientôt !');
      if (!compte.auth_id) throw erreur('Connecte-toi avec Google pour jouer le Match du jour.', 403);
      const jour = jourDe(horloge());
      const r = await base.query("INSERT INTO match_jour (compte_id, jour) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING jour", [compte.id, jour]);
      if (r.rows.length) return { jour, officiel: true };
      const x = await lire(compte.id, jour);
      if (x && x.statut === 'en_cours') {
        if (horloge() - new Date(x.debut) < EN_COURS_MAX) throw erreur('Ton Match du jour est déjà en cours sur un autre appareil.', 409);
        await base.query("UPDATE match_jour SET statut = 'fini', fin = now() WHERE compte_id = $1 AND jour = $2 AND statut = 'en_cours'", [compte.id, jour]);
      }
      return { jour, officiel: false };
    },

    // À chaque manche passée, le score avance (si la partie s'arrête net, il est déjà noté).
    async avancer(compteId, jour, manches) {
      await base.query("UPDATE match_jour SET manches = $3, score = $4 WHERE compte_id = $1 AND jour = $2 AND statut = 'en_cours' AND manches < $3", [compteId, jour, manches, scoreDe(manches, false)]);
    },

    // Fin de l'essai : éliminé, vainqueur, ou parti. Renvoie le résultat noté.
    async terminer(compteId, jour, { manches, victoire = false }) {
      const score = scoreDe(manches, victoire);
      const r = await base.query("UPDATE match_jour SET manches = greatest(manches, $3), victoire = $4, score = greatest(score, $5), statut = 'fini', fin = now() WHERE compte_id = $1 AND jour = $2 AND statut = 'en_cours' RETURNING score, manches, victoire",
        [compteId, jour, manches, !!victoire, score]);
      return r.rows[0] || (await lire(compteId, jour));
    },

    // Mon Match du jour : numéro, temps restant, mon résultat, mon rang du jour.
    async etat(compte) {
      const maintenant = horloge(), jour = jourDe(maintenant);
      const moi = await lire(compte.id, jour);
      let rang = null, joueurs = 0;
      const n = (await base.query("SELECT count(*)::int AS n FROM match_jour WHERE jour = $1 AND statut = 'fini'", [jour])).rows[0].n;
      joueurs = n;
      if (moi && moi.statut === 'fini') rang = (await base.query("SELECT count(*)::int + 1 AS r FROM match_jour WHERE jour = $1 AND statut = 'fini' AND score > $2", [jour, moi.score])).rows[0].r;
      return {
        actif: !!cfg().actif, numero: numeroDu(jour), jour, google: !!compte.auth_id,
        finA: debutDu(ajouterJours(jour, 1)).toISOString(), resteMs: debutDu(ajouterJours(jour, 1)) - maintenant,
        moi: moi && { score: moi.score, manches: moi.manches, victoire: moi.victoire, fini: moi.statut === 'fini' },
        rang, joueurs,
        regles: { parManche: PAR_MANCHE, victoire: VICTOIRE, manches: MANCHES_AVANT_FINALE },
      };
    },

    // Classement du jour : monde, pays, amis.
    async classement(compte, type = 'mondial', { jour = jourDe(horloge()), limite = 50 } = {}) {
      if (!['mondial', 'pays', 'amis'].includes(type)) throw erreur('Classement inconnu.');
      const lim = Math.min(100, Math.max(1, Number(limite) || 50));
      const filtre = type === 'pays' ? 'AND c.pays = $2' : type === 'amis' ? 'AND (c.id = $2 OR c.id IN (SELECT ami_id FROM amis WHERE compte_id = $2))' : '';
      const p = type === 'pays' ? [jour, compte.pays] : type === 'amis' ? [jour, compte.id] : [jour];
      if (type === 'pays' && !compte.pays) return { type, liste: [], moi: null };
      const r = await base.query(`SELECT c.id, c.pseudo, c.avatar, m.score, m.victoire, rank() OVER (ORDER BY m.score DESC)::int AS rang
        FROM match_jour m JOIN comptes c ON c.id = m.compte_id
        WHERE m.jour = $1 AND m.statut = 'fini' AND c.statut <> 'supprime' ${filtre}
        ORDER BY m.score DESC, m.fin LIMIT ${lim}`, p);
      const ligne = (x) => ({ id: x.id, pseudo: x.pseudo, avatar: x.avatar, score: x.score, victoire: x.victoire, rang: x.rang });
      const liste = r.rows.map(ligne);
      let moi = liste.find((x) => x.id === compte.id) || null;
      if (!moi) {
        const m = await lire(compte.id, jour);
        if (m && m.statut === 'fini') {
          const avant = (await base.query(`SELECT count(*)::int AS n FROM match_jour m JOIN comptes c ON c.id = m.compte_id WHERE m.jour = $1 AND m.statut = 'fini' AND c.statut <> 'supprime' ${filtre} AND m.score > ${Number(m.score)}`, p)).rows[0].n;
          moi = { id: compte.id, pseudo: compte.pseudo, avatar: compte.avatar, score: m.score, victoire: m.victoire, rang: avant + 1 };
        }
      }
      return { type, jour, numero: numeroDu(jour), liste, moi };
    },

    // Scores de plusieurs joueurs sur plusieurs jours (pour la Bande).
    async scores(ids, jours, q = base) {
      if (!ids.length || !jours.length) return [];
      return (await q.query("SELECT compte_id, to_char(jour, 'YYYY-MM-DD') AS jour, score, statut, debut, fin FROM match_jour WHERE compte_id = ANY($1) AND jour = ANY($2::date[])", [ids, jours])).rows;
    },
  };
  return api;
}

module.exports = { creerMatchJour, jourDe, debutDu, ajouterJours, lundiDe, numeroDu, scoreDe, graineDu, ROBOTS, PREMIER_JOUR };
