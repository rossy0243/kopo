// Rivalités (face-à-face), notifications dans le jeu et invitations entre amis (retention.md §3.7).
// Lignes rouges (§5.6) : au plus 1 notification de rivalité par jour, chaque type peut être coupé.
'use strict';

const TYPES = ['rivalite', 'invitation', 'ami'];
const paire = (x, y) => (x < y ? [x, y] : [y, x]);

function creerSocial(base) {
  async function veut(q, compteId, type) {
    const r = await q.query('SELECT notifs, statut FROM comptes WHERE id = $1', [compteId]);
    const c = r.rows[0];
    return !!c && c.statut !== 'supprime' && c.statut !== 'banni' && !(c.notifs && c.notifs[type] === false);
  }
  async function bloque(q, x, y) {
    return (await q.query('SELECT 1 FROM blocages WHERE (compte_id = $1 AND bloque_id = $2) OR (compte_id = $2 AND bloque_id = $1) LIMIT 1', [x, y])).rows.length > 0;
  }
  async function notifier(q, compteId, type, texte, donnees = null) {
    if (!(await veut(q, compteId, type))) return false;
    await q.query('INSERT INTO notifications (compte_id, type, texte, donnees) VALUES ($1,$2,$3,$4)', [compteId, type, texte, donnees ? JSON.stringify(donnees) : null]);
    return true;
  }

  const api = {
    TYPES,

    // Fin de partie : chaque paire de joueurs met à jour son face-à-face (celui qui finit devant gagne le duel ;
    // un abandon compte comme une défaite). Si l'un rattrape ou dépasse l'autre, l'autre est prévenu.
    // places : [{ id, place, abandon }]
    async apresPartie(places) {
      const js = places.filter((p) => p.place || p.abandon);
      const rang = (p) => (p.abandon ? 1e6 : p.place);
      const pseudos = new Map();
      if (js.length < 2) return [];
      for (const r of (await base.query('SELECT id, pseudo FROM comptes WHERE id = ANY($1)', [js.map((p) => p.id)])).rows) pseudos.set(r.id, r.pseudo);
      const envoyees = [];
      await base.transaction(async (q) => {
        for (let i = 0; i < js.length; i++) for (let k = i + 1; k < js.length; k++) {
          const x = js[i], y = js[k];
          if (rang(x) === rang(y)) continue; // deux abandons : pas de duel
          const gagnant = rang(x) < rang(y) ? x.id : y.id, perdant = gagnant === x.id ? y.id : x.id;
          const [a, b] = paire(x.id, y.id);
          await q.query('INSERT INTO face_a_face (a, b) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a, b]);
          const f = (await q.query(`UPDATE face_a_face SET victoires_a = victoires_a + $3, victoires_b = victoires_b + $4, maj_le = now() WHERE a = $1 AND b = $2 RETURNING victoires_a, victoires_b`,
            [a, b, gagnant === a ? 1 : 0, gagnant === b ? 1 : 0])).rows[0];
          const g = gagnant === a ? f.victoires_a : f.victoires_b, p = gagnant === a ? f.victoires_b : f.victoires_a;
          // Rattrapé (égalité) ou dépassé : seulement une vraie rivalité (au moins 3 duels gagnés chacun, ou amis).
          if (g !== p && g !== p + 1) continue;
          const amis = (await q.query('SELECT 1 FROM amis WHERE (compte_id = $1 AND ami_id = $2) OR (compte_id = $2 AND ami_id = $1) LIMIT 1', [gagnant, perdant])).rows.length > 0;
          if (!amis && p < 3) continue;
          if (g === p + 1 && p === 0) continue; // 1 – 0 n'est pas une rivalité
          if (await bloque(q, gagnant, perdant)) continue;
          const deja = await q.query("SELECT 1 FROM notifications WHERE compte_id = $1 AND type = 'rivalite' AND cree_le > now() - interval '1 day' LIMIT 1", [perdant]);
          if (deja.rows.length) continue; // au plus une par jour
          const nom = pseudos.get(gagnant) || 'Un joueur';
          const texte = g === p ? `${nom} t'a rattrapé : ${p} – ${g} !` : `${nom} passe devant toi : ${p} – ${g} !`;
          if (await notifier(q, perdant, 'rivalite', texte, { de: gagnant, pseudo: nom, toi: p, lui: g })) envoyees.push({ a: perdant, texte });
        }
      });
      return envoyees;
    },

    async notifier(compteId, type, texte, donnees) { return notifier(base, compteId, type, texte, donnees); },

    async liste(compteId) {
      const l = (await base.query('SELECT id, type, texte, donnees, lue, cree_le FROM notifications WHERE compte_id = $1 ORDER BY id DESC LIMIT 30', [compteId])).rows.map((n) => ({ ...n, id: Number(n.id) }));
      return { nonLues: l.filter((n) => !n.lue).length, liste: l };
    },
    async marquerLues(compteId, ids = null) {
      if (Array.isArray(ids) && ids.length) await base.query('UPDATE notifications SET lue = true WHERE compte_id = $1 AND id = ANY($2::bigint[])', [compteId, ids.map(Number).filter(Number.isFinite)]);
      else await base.query('UPDATE notifications SET lue = true WHERE compte_id = $1 AND NOT lue', [compteId]);
    },

    // Mes face-à-face les plus disputés.
    async rivaux(compteId, limite = 10) {
      const r = await base.query(`SELECT c.id, c.pseudo, c.numero, c.avatar,
          CASE WHEN f.a = $1 THEN f.victoires_a ELSE f.victoires_b END AS moi,
          CASE WHEN f.a = $1 THEN f.victoires_b ELSE f.victoires_a END AS lui
        FROM face_a_face f JOIN comptes c ON c.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
        WHERE (f.a = $1 OR f.b = $1) AND c.statut <> 'supprime'
        ORDER BY f.victoires_a + f.victoires_b DESC, f.maj_le DESC LIMIT $2`, [compteId, limite]);
      return r.rows;
    },

    // Invitation d'un ami dans ma salle (code à 4 lettres). Limites : 1 par ami toutes les 2 minutes, 15 par heure.
    async inviter(de, ami, code) {
      if (!/^[A-Z]{4}$/.test(String(code || ''))) throw Object.assign(new Error('Code de salle invalide.'), { statut: 400 });
      const lien = await base.query('SELECT 1 FROM amis WHERE compte_id = $1 AND ami_id = $2', [de.id, ami]);
      if (!lien.rows.length) throw Object.assign(new Error('Ce joueur n\'est pas dans tes amis.'), { statut: 404 });
      if (await bloque(base, de.id, ami)) throw Object.assign(new Error('Joueur introuvable.'), { statut: 404 });
      const recent = (await base.query(`SELECT count(*) FILTER (WHERE cree_le > now() - interval '1 hour')::int AS heure,
          count(*) FILTER (WHERE compte_id = $2 AND cree_le > now() - interval '2 minutes')::int AS ami
        FROM notifications WHERE type = 'invitation' AND donnees->>'de' = $1`, [de.id, ami])).rows[0];
      if (recent.ami) throw Object.assign(new Error('Invitation déjà envoyée, attends un peu.'), { statut: 429 });
      if (recent.heure >= 15) throw Object.assign(new Error('Trop d\'invitations. Réessaie plus tard.'), { statut: 429 });
      const ok = await notifier(base, ami, 'invitation', `${de.pseudo} t'invite à sa table`, { de: de.id, pseudo: de.pseudo, code });
      return { ok: true, envoyee: ok };
    },
  };
  return api;
}

module.exports = { creerSocial, TYPES };
