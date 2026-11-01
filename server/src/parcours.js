// Parcours de saison (retention.md §3.5) et collection d'apparences (§3.6), gardés par le serveur.
// Se termine en jouant environ 3 à 4 parties par jour, 4 jours par semaine (≈ 55 parties en 4 semaines).
'use strict';
const { OBJETS, DE_BASE, contenuParcours } = require('./catalogue');

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });

function creerParcours(base, reglages, comptes, ligue) {
  const cfg = () => reglages.get('parcours');
  const kopoPlus = (c) => !!(c && c.kopo_plus_jusqu && new Date(c.kopo_plus_jusqu) > new Date());

  async function possedes(q, compteId) {
    return new Set([...DE_BASE, ...(await q.query('SELECT objet FROM inventaire WHERE compte_id = $1', [compteId])).rows.map((r) => r.objet)]);
  }
  async function donner(q, compteId, objet, source) {
    if (!OBJETS[objet]) throw erreur('Objet inconnu.');
    const r = await q.query('INSERT INTO inventaire (compte_id, objet, source) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [compteId, objet, source]);
    return r.rows.length > 0;
  }

  const api = {
    // XP de saison d'une partie : base + manches survécues + victoire (abandon : rien).
    xpPartie({ place, manchesSurvecues = 0, abandon = false }) {
      if (abandon || !place) return 0;
      const c = cfg();
      return c.xpPartie + c.xpManche * manchesSurvecues + (place === 1 ? c.xpVictoire : 0);
    },

    // Fin de partie (avec au moins 2 humains, sans robot) : XP pour chaque joueur, une seule fois par partie.
    async enregistrerPartie(partieId, joueurs) {
      const s = await ligue.saisonCourante();
      const res = new Map();
      if (!s) return res;
      const c = cfg();
      await base.transaction(async (q) => {
        for (const j of joueurs) {
          const xp = api.xpPartie(j);
          if (!xp) continue;
          const ins = await q.query('INSERT INTO parcours_parties (partie_id, compte_id, xp) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [partieId, j.id, xp]);
          if (!ins.rows.length) continue;
          const avant = (await q.query('INSERT INTO parcours (saison, compte_id, xp) VALUES ($1,$2,$3) ON CONFLICT (saison, compte_id) DO UPDATE SET xp = parcours.xp + EXCLUDED.xp, maj_le = now() RETURNING xp', [s.numero, j.id, xp])).rows[0].xp - xp;
          const total = avant + xp;
          const palier = (x) => Math.min(c.paliers, Math.floor(x / c.xpPalier));
          res.set(j.id, { xp, total, palier: palier(total), nouveaux: palier(total) - palier(avant), xpPalier: c.xpPalier, paliers: c.paliers });
        }
      });
      return res;
    },

    async etat(compte) {
      const s = await ligue.saisonCourante();
      const c = cfg();
      const p = s ? (await base.query('SELECT xp, gratuits, plus FROM parcours WHERE saison = $1 AND compte_id = $2', [s.numero, compte.id])).rows[0] : null;
      const xp = p ? p.xp : 0, palier = Math.min(c.paliers, Math.floor(xp / c.xpPalier));
      const g = new Set(p ? p.gratuits : []), pl = new Set(p ? p.plus : []);
      return {
        saison: s ? ligue.publicSaison(s) : null,
        xp, palier, xpPalier: c.xpPalier, paliersMax: c.paliers, kopoPlus: kopoPlus(compte),
        paliers: contenuParcours(c.paliers).map((x) => ({
          ...x,
          gratuit: { ...x.gratuit, ...(x.gratuit.objet ? { nom: OBJETS[x.gratuit.objet].nom, type: OBJETS[x.gratuit.objet].type } : {}), recupere: g.has(x.n) },
          plus: x.plus && { ...x.plus, nom: OBJETS[x.plus.objet].nom, type: OBJETS[x.plus.objet].type, recupere: pl.has(x.n) },
          atteint: x.n <= palier,
        })),
      };
    },

    // Récupérer un palier atteint. Voie Kopo+ : seulement avec Kopo+ (et récupérable plus tard dans la saison).
    async recuperer(compte, n, voie = 'gratuit') {
      const s = await ligue.saisonCourante();
      if (!s) throw erreur('Aucune saison en cours.');
      const c = cfg();
      const x = contenuParcours(c.paliers).find((p) => p.n === Number(n));
      if (!x) throw erreur('Palier inconnu.');
      if (voie !== 'gratuit' && voie !== 'plus') throw erreur('Voie inconnue.');
      const r = voie === 'plus' ? x.plus : x.gratuit;
      if (!r) throw erreur('Rien à récupérer sur ce palier.');
      if (voie === 'plus' && !kopoPlus(compte)) throw erreur('Réservé à Kopo+.', 403);
      return base.transaction(async (q) => {
        const p = (await q.query('SELECT xp, gratuits, plus FROM parcours WHERE saison = $1 AND compte_id = $2 FOR UPDATE', [s.numero, compte.id])).rows[0];
        if (!p || Math.floor(p.xp / c.xpPalier) < x.n) throw erreur('Palier pas encore atteint.');
        const col = voie === 'plus' ? 'plus' : 'gratuits';
        if (p[col].includes(x.n)) throw erreur('Déjà récupéré.', 409);
        await q.query(`UPDATE parcours SET ${col} = array_append(${col}, $3) WHERE saison = $1 AND compte_id = $2`, [s.numero, compte.id, x.n]);
        let solde = null, objet = null;
        if (r.pieces) solde = await comptes.mouvement(q, compte.id, r.pieces, 'parcours', `saison:${s.numero}:${x.n}`);
        if (r.objet) { await donner(q, compte.id, r.objet, `parcours:${s.numero}`); objet = { id: r.objet, ...OBJETS[r.objet] }; }
        return { ok: true, pieces: r.pieces || 0, solde, objet };
      });
    },

    // --- Collection
    async collection(compte) {
      const p = await possedes(base, compte.id);
      const e = Object.assign({ avatar: 'av-laiton', dos: 'dos-laiton', cadre: null }, compte.equipes || {});
      return { possedes: [...p], equipes: e };
    },
    async equiper(compte, objet) {
      const o = OBJETS[objet];
      if (!o) throw erreur('Objet inconnu.');
      const p = await possedes(base, compte.id);
      const e = Object.assign({ avatar: 'av-laiton', dos: 'dos-laiton', cadre: null }, compte.equipes || {});
      if (o.type === 'cadre' && e.cadre === objet) e.cadre = null; // retirer le cadre
      else { if (!p.has(objet)) throw erreur('Tu ne possèdes pas cet objet.', 403); e[o.type] = objet; }
      await base.query('UPDATE comptes SET equipes = $2 WHERE id = $1', [compte.id, JSON.stringify(e)]);
      return { possedes: [...p], equipes: e };
    },
    // Boutique : acheter un objet à prix affiché (strategie-pieces §4.3). Pas de hasard, pas de fausse urgence.
    async acheter(compte, objet) {
      const o = OBJETS[objet];
      if (!o || o.prix == null) throw erreur('Cet objet n\'est pas en vente.');
      return base.transaction(async (q) => {
        const deja = await q.query('SELECT 1 FROM inventaire WHERE compte_id = $1 AND objet = $2', [compte.id, objet]);
        if (deja.rows.length || DE_BASE.includes(objet)) throw erreur('Tu as déjà cet objet.', 409);
        const solde = await comptes.mouvement(q, compte.id, -o.prix, 'boutique', objet);
        await donner(q, compte.id, objet, 'boutique');
        return { ok: true, solde, objet: { id: objet, ...o } };
      });
    },
    catalogue() { return Object.entries(OBJETS).map(([id, o]) => ({ id, ...o })); },
    donner: (compteId, objet, source) => donner(base, compteId, objet, source),
    kopoPlus,
  };
  return api;
}

module.exports = { creerParcours };
