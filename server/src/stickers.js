// Stickers animés (ergonomie/stickers/decisions-stickers.md) : on vend des utilisations d'un sticker.
// Un achat (plus tard) ou un cadeau de l'admin donne par exemple 20 ou 50 envois ; chaque envoi en décompte un,
// vérifié ici ; à 0 le sticker se reverrouille. Tant que l'interrupteur « stickers » est éteint, rien ne s'envoie.
// Lignes rouges (strategie-pieces.md) : pas de tirage au sort, seulement du cosmétique, jamais de pièces changées en argent.
'use strict';

// Les dessins (SVG en morceaux et leurs mouvements) sont dans le jeu ; le serveur ne connaît que les noms.
const STICKERS = {
  ouf: { nom: 'Ouf !', pack: 'emotions' },
  rire: { nom: 'Je t’ai eu !', pack: 'emotions' },
  louche: { nom: 'Bluff ?', pack: 'emotions' },
  encore: { nom: 'Encore moi…', pack: 'emotions' },
  katapss: { nom: 'Katapss !', pack: 'emotions' },
  grrr: { nom: 'Grrr…', pack: 'emotions' },
  danse: { nom: 'On danse !', pack: 'ambiance' },
  dodo: { nom: 'Tu dors ?', pack: 'ambiance' },
  supporter: { nom: 'Allez la RDC !', pack: 'supporters' },
};
const PACKS = {
  emotions: { nom: 'Émotions' },
  ambiance: { nom: 'Ambiance' },
  supporters: { nom: 'Supporters' },
};
const stickersDuPack = (p) => Object.keys(STICKERS).filter((id) => STICKERS[id].pack === p);
const ATTENTE_MS = 5000; // un sticker toutes les 5 secondes au plus par joueur (règle de foule du 11/11)
const UTILISATIONS_MAX = 500; // par cadeau
const MESSAGE_MIN = 5, MESSAGE_MAX = 200;

// Groupes de joueurs pour les cadeaux de l'admin. Chaque critère coché s'ajoute aux autres (ET).
// n : le nombre que l'admin choisit (jours, parties) ; texte : ce que le tableau de bord affiche.
const CRITERES = {
  anciennete: { texte: 'Inscrits depuis au moins N jours', n: [1, 3650], sql: (i) => `c.cree_le <= now() - make_interval(days => $${i})` },
  nouveaux: { texte: 'Inscrits depuis moins de N jours', n: [1, 365], sql: (i) => `c.cree_le > now() - make_interval(days => $${i})` },
  google: { texte: 'Connectés avec Google', sql: () => 'c.auth_id IS NOT NULL' },
  invites: { texte: 'Invités (sans compte Google)', sql: () => 'c.auth_id IS NULL' },
  actifs: { texte: 'Venus jouer ces N derniers jours', n: [1, 365], sql: (i) => `c.vu_le > now() - make_interval(days => $${i})` },
  absents: { texte: 'Pas revenus depuis N jours', n: [1, 3650], sql: (i) => `c.vu_le <= now() - make_interval(days => $${i})` },
  parties: { texte: 'Au moins N parties jouées', n: [1, 100000], sql: (i) => `(SELECT count(*) FROM participations p WHERE p.compte_id = c.id) >= $${i}` },
  kopoPlus: { texte: 'Abonnés Kopo+', sql: () => 'c.kopo_plus_jusqu > now()' },
  createurs: { texte: 'Créateurs vérifiés', sql: () => 'c.parrain_createur' },
  parrains: { texte: 'Ont fait venir au moins N amis (parrainages validés)', n: [1, 1000], sql: (i) => `(SELECT count(*) FROM parrainages f WHERE f.parrain_id = c.id AND f.statut = 'valide') >= $${i}` },
  pays: { texte: 'D\'un pays (code à 2 lettres, ex. CD)', pays: true, sql: (i) => `upper(c.pays) = $${i}` },
};

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });

// Réglage « stickers » : interrupteur (éteint au départ) et offres en vente, toutes inactives tant que les paiements
// ne sont pas branchés. Une offre donne `utilisations` envois de chaque sticker (d'un seul, ou de tout le pack),
// pour un prix en pièces et un prix en argent réel (francs congolais, mobile money).
const OFFRES_DEFAUT = {
  sticker: [{ utilisations: 20, pieces: 300, francs: 500 }, { utilisations: 50, pieces: 600, francs: 1000 }],
  pack: [{ utilisations: 20, pieces: 1200, francs: 2000 }, { utilisations: 50, pieces: 2500, francs: 4000 }],
};
function verifierReglage(v) {
  v = v || {};
  const out = { actif: v.actif === true, offres: {} };
  for (const genre of ['sticker', 'pack']) {
    const l = Array.isArray(v.offres && v.offres[genre]) ? v.offres[genre] : OFFRES_DEFAUT[genre];
    if (!l.length || l.length > 4) throw erreur(`Entre 1 et 4 offres par ${genre}.`);
    out.offres[genre] = l.map((o) => {
      const x = { utilisations: Math.trunc(Number(o && o.utilisations)), pieces: Math.trunc(Number(o && o.pieces)), francs: Math.trunc(Number(o && o.francs)) };
      if (!(x.utilisations >= 1 && x.utilisations <= UTILISATIONS_MAX)) throw erreur(`Utilisations entre 1 et ${UTILISATIONS_MAX}.`);
      if (!(x.pieces >= 0 && x.pieces <= 1e6) || !(x.francs >= 0 && x.francs <= 1e7)) throw erreur('Prix invalide.');
      return x;
    });
  }
  return out;
}

// cible : { type: 'joueur', joueur: 'Pseudo#1234' ou identifiant } | { type: 'tous' } | { type: 'groupe', criteres: { anciennete: 30, google: true, … } }
// Rend la condition SQL (sur comptes c) et ses paramètres ; seulement des comptes actifs.
async function conditionCible(base, cible) {
  cible = cible || {};
  if (cible.type === 'tous') return { sql: "c.statut = 'actif'", params: [], resume: { type: 'tous' } };
  if (cible.type === 'joueur') {
    const t = String(cible.joueur || '').trim();
    const m = /^(.*)#(\d{4})$/.exec(t);
    const c = (m ? await base.query('SELECT id, pseudo, numero FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2', [m[1], m[2]])
      : await base.query('SELECT id, pseudo, numero FROM comptes WHERE id = $1', [t])).rows[0];
    if (!c) throw erreur('Joueur introuvable. Écris Pseudo#1234.', 404);
    return { sql: "c.statut = 'actif' AND c.id = $1", params: [c.id], resume: { type: 'joueur', id: c.id, nom: `${c.pseudo}#${c.numero}` } };
  }
  if (cible.type === 'groupe') {
    const cr = cible.criteres && typeof cible.criteres === 'object' ? cible.criteres : {};
    const conds = ["c.statut = 'actif'"], params = [], resume = {};
    for (const [k, v] of Object.entries(cr)) {
      const d = CRITERES[k];
      if (!d) throw erreur('Critère inconnu : ' + k);
      if (v === false || v == null || v === '') continue;
      if (d.n) {
        const n = Math.trunc(Number(v));
        if (!(n >= d.n[0] && n <= d.n[1])) throw erreur(`${d.texte} : N entre ${d.n[0]} et ${d.n[1]}.`);
        params.push(n); resume[k] = n;
      } else if (d.pays) {
        const p = String(v).trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(p)) throw erreur('Pays : code à 2 lettres (ex. CD).');
        params.push(p); resume[k] = p;
      } else resume[k] = true;
      conds.push(d.sql(params.length));
    }
    if (!Object.keys(resume).length) throw erreur('Choisis au moins un critère pour le groupe.');
    if (resume.google && resume.invites) throw erreur('Un joueur ne peut pas être à la fois connecté avec Google et invité.');
    return { sql: conds.join(' AND '), params, resume: { type: 'groupe', criteres: resume } };
  }
  throw erreur('Cible : un joueur, tous les joueurs ou un groupe.');
}

function creerStickers(base, reglages) {
  const reglage = () => reglages.get('stickers') || { actif: false, offres: OFFRES_DEFAUT };
  const catalogue = () => Object.entries(STICKERS).map(([id, s]) => ({ id, nom: s.nom, pack: s.pack }));
  const packs = () => Object.entries(PACKS).map(([id, p]) => ({ id, nom: p.nom, stickers: stickersDuPack(id) }));

  async function soldes(compteId) {
    const r = await base.query('SELECT sticker, restants FROM stickers_soldes WHERE compte_id = $1 AND restants > 0', [compteId]);
    return Object.fromEntries(r.rows.map((l) => [l.sticker, Number(l.restants)]));
  }

  // Ce qu'on offre : un sticker, ou tous les stickers d'un pack, `utilisations` fois chacun.
  function contenu({ sticker, pack, utilisations }) {
    const n = Math.trunc(Number(utilisations));
    if (!(n >= 1 && n <= UTILISATIONS_MAX)) throw erreur(`Utilisations entre 1 et ${UTILISATIONS_MAX}.`);
    if (pack) { if (!PACKS[pack]) throw erreur('Pack inconnu.'); return { ids: stickersDuPack(pack), n, quoi: `du pack « ${PACKS[pack].nom} »` }; }
    if (!STICKERS[sticker]) throw erreur('Sticker inconnu.');
    return { ids: [sticker], n, quoi: `du sticker « ${STICKERS[sticker].nom} »` };
  }

  return {
    STICKERS, PACKS, CRITERES,
    reglage, catalogue, packs, soldes,
    actif: () => reglage().actif === true,

    // Pour le joueur : catalogue, offres (pas encore en vente) et ses utilisations restantes.
    async pourJoueur(compteId) {
      const r = reglage();
      return { actif: r.actif === true, vente: false, stickers: catalogue(), packs: packs(), offres: r.offres || OFFRES_DEFAUT, soldes: compteId ? await soldes(compteId) : {} };
    },

    async compter(cible) {
      const c = await conditionCible(base, cible);
      return { joueurs: (await base.query(`SELECT count(*)::int AS n FROM comptes c WHERE ${c.sql}`, c.params)).rows[0].n, cible: c.resume };
    },

    // Cadeau de l'admin : utilisations ajoutées à chaque joueur de la cible, et une notification avec le message
    // (obligatoire) qui explique pourquoi. Tout ou rien.
    async offrir({ cible, sticker, pack, utilisations, message }) {
      const msg = String(message || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
      if (msg.length < MESSAGE_MIN || msg.length > MESSAGE_MAX) throw erreur(`Écris aux joueurs pourquoi tu leur offres ces stickers (${MESSAGE_MIN} à ${MESSAGE_MAX} caractères).`);
      const { ids, n, quoi } = contenu({ sticker, pack, utilisations });
      const c = await conditionCible(base, cible);
      return base.transaction(async (q) => {
        const comptes = (await q.query(`SELECT c.id FROM comptes c WHERE ${c.sql}`, c.params)).rows.map((l) => l.id);
        if (!comptes.length) throw erreur('Aucun joueur dans cette cible.');
        const cadeau = (await q.query('INSERT INTO stickers_cadeaux (cible, stickers, utilisations, message, joueurs) VALUES ($1,$2,$3,$4,$5) RETURNING id', [JSON.stringify(c.resume), ids, n, msg, comptes.length])).rows[0].id;
        const ref = 'cadeau-' + cadeau;
        for (const id of ids) {
          await q.query(`INSERT INTO stickers_soldes (compte_id, sticker, restants) SELECT x, $2, $3 FROM unnest($1::text[]) x
            ON CONFLICT (compte_id, sticker) DO UPDATE SET restants = stickers_soldes.restants + EXCLUDED.restants, maj_le = now()`, [comptes, id, n]);
          await q.query("INSERT INTO stickers_mouvements (compte_id, sticker, nombre, motif, ref) SELECT x, $2, $3, 'cadeau', $4 FROM unnest($1::text[]) x", [comptes, id, n, ref]);
        }
        const texte = `🎁 ${msg} Tu reçois ${n} utilisation${n > 1 ? 's' : ''} ${quoi}.`;
        await q.query("INSERT INTO notifications (compte_id, type, texte, donnees) SELECT x, 'cadeau', $2, $3 FROM unnest($1::text[]) x",
          [comptes, texte, JSON.stringify({ stickers: ids, utilisations: n, pack: pack || null, message: msg })]);
        return { id: Number(cadeau), joueurs: comptes.length, stickers: ids, utilisations: n, cible: c.resume };
      });
    },

    // Un envoi à la table : une utilisation de moins, seulement s'il en reste (vérifié en une seule requête).
    // Rend le nombre restant, ou null s'il n'en restait pas.
    async utiliser(compteId, sticker) {
      const r = await base.query('UPDATE stickers_soldes SET restants = restants - 1, utilises = utilises + 1, maj_le = now() WHERE compte_id = $1 AND sticker = $2 AND restants > 0 RETURNING restants', [compteId, sticker]);
      return r.rows.length ? Number(r.rows[0].restants) : null;
    },

    // Tableau de bord : cadeaux récents et utilisations en circulation par sticker.
    async resumeAdmin() {
      const cadeaux = (await base.query('SELECT id::int AS id, cible, stickers, utilisations, message, joueurs, cree_le FROM stickers_cadeaux ORDER BY id DESC LIMIT 30')).rows;
      const parSticker = (await base.query('SELECT sticker, sum(restants)::int AS restants, sum(utilises)::int AS utilises, count(*) FILTER (WHERE restants > 0)::int AS joueurs FROM stickers_soldes GROUP BY sticker')).rows;
      return { reglage: reglage(), stickers: catalogue(), packs: packs(), criteres: Object.entries(CRITERES).map(([id, d]) => ({ id, texte: d.texte, n: d.n || null, pays: !!d.pays })), cadeaux, parSticker };
    },
  };
}

module.exports = { creerStickers, verifierReglage, STICKERS, PACKS, CRITERES, OFFRES_DEFAUT, ATTENTE_MS };
