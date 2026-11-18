// Bouquets de pièces (18/11) : l'endroit où l'on achète des pièces avec de l'argent réel (francs congolais, mobile money).
// Même logique que les stickers (stickers.js) : le serveur fixe les prix, jamais le téléphone ; les francs et les pièces
// suivent le taux de la stratégie (strategie-pieces §5.3 : 200 pièces ≈ 500 FC, soit 2,5 FC la pièce).
// Plus le bouquet est gros, plus il donne de pièces en bonus. Le plus cher : 40 000 FC.
// Le paiement mobile money n'est pas encore branché : les bouquets s'affichent (« Bientôt »), et l'admin peut livrer
// un bouquet à un joueur depuis le tableau de bord (paiement reçu à la main), avec un message au joueur.
// Lignes rouges (strategie-pieces §5.4) : jamais de retrait ni d'échange de pièces, pas de tirage au sort.
'use strict';

const FC_PAR_PIECE = 2.5; // le même taux que les stickers (stickers.js)
const FRANCS_MAX = 40000;
const BOUQUETS_MAX = 8;

// Du moins cher au plus cher. `pieces` compte le bonus ; la base est francs / 2,5.
const NOMS = ['Poignée', 'Petit sac', 'Sac', 'Coffret', 'Malle', 'Trésor', 'Grand trésor', 'Fortune'];
const BOUQUETS_DEFAUT = [
  { francs: 500, pieces: 200 }, // base 200, pas de bonus
  { francs: 2000, pieces: 850 }, // base 800, +50 (6 %)
  { francs: 5000, pieces: 2250 }, // base 2 000, +250 (12 %)
  { francs: 10000, pieces: 4800 }, // base 4 000, +800 (20 %)
  { francs: 20000, pieces: 10000 }, // base 8 000, +2 000 (25 %)
  { francs: 40000, pieces: 21000 }, // base 16 000, +5 000 (31 %)
];

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });
const base = (francs) => Math.round(francs / FC_PAR_PIECE);

// Ce que voit le joueur : nom, pièces (bonus compris), bonus en pièces et en %, prix en francs congolais.
function detailler(liste) {
  return liste.map((b, i) => {
    const bonus = b.pieces - base(b.francs);
    return { id: i, nom: NOMS[i], francs: b.francs, pieces: b.pieces, bonus, bonusPct: Math.round((100 * bonus) / base(b.francs)) };
  });
}

// Réglage « bouquets » : la liste des bouquets (modifiable par l'admin). Toujours du moins cher au plus cher,
// au plus 40 000 FC, jamais moins de pièces que le taux, et un bonus en % qui ne baisse jamais d'un bouquet au suivant.
function verifierReglage(v) {
  v = v || {};
  const l = Array.isArray(v.bouquets) ? v.bouquets : BOUQUETS_DEFAUT;
  if (!l.length || l.length > BOUQUETS_MAX) throw erreur(`Entre 1 et ${BOUQUETS_MAX} bouquets.`);
  const out = l.map((b) => ({ francs: Math.trunc(Number(b && b.francs)), pieces: Math.trunc(Number(b && b.pieces)) }));
  let avant = null;
  for (const b of out) {
    if (!(b.francs >= 100 && b.francs <= FRANCS_MAX) || b.francs % 100) throw erreur(`Prix en francs entre 100 et ${FRANCS_MAX} FC, par centaines.`);
    if (!(b.pieces >= base(b.francs) && b.pieces <= 1e6)) throw erreur(`${b.francs} FC donnent au moins ${base(b.francs)} pièces (200 pièces ≈ 500 FC).`);
    if (avant) {
      if (b.francs <= avant.francs) throw erreur('Les bouquets vont du moins cher au plus cher.');
      if (b.pieces / base(b.francs) < avant.pieces / base(avant.francs)) throw erreur('Le bonus ne baisse jamais d\'un bouquet au suivant.');
    }
    avant = b;
  }
  return { bouquets: out };
}

function creerBouquets(base_, reglages, comptes) {
  const reglage = () => { const r = reglages.get('bouquets'); return r && Array.isArray(r.bouquets) && r.bouquets.length ? r : { bouquets: BOUQUETS_DEFAUT }; };
  const liste = () => detailler(reglage().bouquets);

  return {
    liste,
    // Pour le joueur. `paiement` : faux tant que le mobile money n'est pas branché (les prix sont affichés, rien ne se paie).
    pourJoueur: () => ({ paiement: false, taux: { piecesPour500FC: 200 }, bouquets: liste() }),

    // Tableau de bord : un bouquet livré à un joueur (paiement reçu à la main). Pièces au registre (motif « achat_pieces »)
    // et une notification au joueur, dans la même transaction.
    async livrer({ joueur, bouquet, message }) {
      const b = liste()[Math.trunc(Number(bouquet))];
      if (!b) throw erreur('Bouquet inconnu.');
      const msg = String(message || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (msg.length < 3) throw erreur('Écris une référence (ex. le numéro de la transaction mobile money).');
      const t = String(joueur || '').trim(), m = /^(.*)#(\d{4})$/.exec(t);
      const c = (m ? await base_.query('SELECT id, pseudo, numero, statut FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2', [m[1], m[2]])
        : await base_.query('SELECT id, pseudo, numero, statut FROM comptes WHERE id = $1', [t])).rows[0];
      if (!c) throw erreur('Joueur introuvable. Écris Pseudo#1234.', 404);
      if (c.statut !== 'actif') throw erreur('Ce compte n\'est pas actif.');
      const solde = await base_.transaction(async (q) => {
        const s = await comptes.mouvement(q, c.id, b.pieces, 'achat_pieces', `bouquet:${b.id}:${b.francs}FC:${msg}`.slice(0, 200), true);
        await q.query("INSERT INTO notifications (compte_id, type, texte, donnees) VALUES ($1, 'cadeau', $2, $3)",
          [c.id, `Merci ! Ton bouquet « ${b.nom} » est arrivé : +${b.pieces} pièces.`, JSON.stringify({ bouquet: b.id, pieces: b.pieces, francs: b.francs })]);
        return s;
      });
      return { ok: true, solde, joueur: { id: c.id, nom: `${c.pseudo}#${c.numero}` }, bouquet: b };
    },

    // Tableau de bord : les bouquets et les dernières livraisons.
    async resumeAdmin() {
      const livraisons = (await base_.query(`SELECT r.id::int AS id, r.montant::int AS pieces, r.ref, r.cree_le, c.id AS compte, c.pseudo, c.numero
        FROM registre_pieces r JOIN comptes c ON c.id = r.compte_id WHERE r.motif = 'achat_pieces' ORDER BY r.id DESC LIMIT 30`)).rows;
      return { bouquets: liste(), paiement: false, livraisons };
    },
  };
}

module.exports = { creerBouquets, verifierReglage, detailler, BOUQUETS_DEFAUT, FC_PAR_PIECE, FRANCS_MAX };
