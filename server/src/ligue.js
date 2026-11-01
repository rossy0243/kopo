// Ligue classée, saisons de 4 semaines et classements (retention.md §3.4, v1.0 validée).
// Seul le serveur calcule les points : le téléphone ne fait qu'afficher.
'use strict';
const { DIVISIONS } = require('./reglages');

const NOMS = { bois: 'Bois', bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant', legende: 'Légende' };
// Saison 1 : « Les Fondateurs ». Ensuite, une ville par saison (thème validé le 31/10), sauf si l'admin choisit.
const VILLES = ['Kinshasa', 'Lubumbashi', 'Abidjan', 'Dakar', 'Douala', 'Brazzaville', 'Goma', 'Yaoundé', 'Bamako', 'Kisangani'];
const JOUR = 864e5;
const rang = (d) => DIVISIONS.indexOf(d);

// Division correspondant à un nombre de points.
function divisionPour(points, seuils) {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (points >= seuils[x]) d = x;
  return d;
}

// Points gagnés ou perdus selon la place (1 = vainqueur) et le nombre de joueurs au départ.
// - 1er, 2e, 3e (le 3e seulement à 5 joueurs ou plus) gagnent ; dernier (dès 4 joueurs) et avant-dernier (dès 6) perdent.
// - Petites tables (moins de 5) : gains réduits en proportion, une victoire à 3 vaut moins qu'à 9.
// - Abandon volontaire : pénalité. Coupure réseau sans retour : ni gain ni perte (retention.md §4).
function calculerPoints({ place, n, abandon = false, coupure = false }, pts) {
  if (abandon) return pts.abandon;
  if (coupure || !place) return 0;
  let v = 0;
  if (place === 1) v = pts.premier;
  else if (place === 2) v = pts.deuxieme;
  else if (place === 3 && n >= 5) v = pts.troisieme;
  else if (place === n && n >= 4) v = pts.dernier;
  else if (place === n - 1 && n >= 6) v = pts.avantDernier;
  if (v > 0 && n < 5) v = Math.round((v * n) / 5);
  return v;
}

// Fin de saison : le dimanche à 19 h UTC (20 h à Kinshasa) le plus proche de « début + durée ».
function finDeSaison(debut, dureeJours) {
  const cible = new Date(debut.getTime() + dureeJours * JOUR);
  const f = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), cible.getUTCDate(), 19));
  f.setUTCDate(f.getUTCDate() - f.getUTCDay()); // dimanche de la même semaine
  if (cible - f > 3.5 * JOUR) f.setUTCDate(f.getUTCDate() + 7);
  if (f - debut < 7 * JOUR) f.setUTCDate(f.getUTCDate() + 7);
  return f;
}

const publicSaison = (s) => s && { numero: s.numero, nom: s.nom, theme: s.theme, debut: s.debut, fin: s.fin, statut: s.statut, titre: `Saison ${s.numero} : ${s.nom}` };

function creerLigue(base, reglages, comptes) {
  const cfg = () => reglages.get('ligue');

  let planUtilise = false;
  async function saisonCourante(q = base) {
    return (await q.query("SELECT * FROM saisons WHERE statut = 'en_cours' LIMIT 1")).rows[0] || null;
  }

  // Ouvre la saison suivante (ou la première).
  async function ouvrirSaison(q, debut = new Date()) {
    const der = (await q.query('SELECT coalesce(max(numero), 0)::int AS n FROM saisons')).rows[0].n;
    const numero = der + 1;
    const prevue = reglages.get('prochaineSaison') || {};
    const nom = prevue.nom || (numero === 1 ? 'Les Fondateurs' : VILLES[(numero - 2) % VILLES.length]);
    const theme = prevue.theme || (numero === 1 ? 'fondateurs' : prevue.nom ? null : 'ville');
    const fin = finDeSaison(debut, cfg().dureeJours);
    await q.query("INSERT INTO saisons (numero, nom, theme, debut, fin, statut) VALUES ($1,$2,$3,$4,$5,'en_cours')", [numero, nom, theme, debut, fin]);
    if (prevue.nom || prevue.theme) planUtilise = true; // remis à zéro après la transaction
    return numero;
  }

  // Clôture : récompenses selon la division atteinte, titre « Diamant S1 », rang final,
  // puis chaque joueur repart 1 ou 2 divisions plus bas dans la saison suivante.
  async function cloturer(q, s) {
    const c = cfg();
    const noms = DIVISIONS.map((d) => NOMS[d]);
    const pieces = DIVISIONS.map((d) => c.recompenses[d]);
    // Récompense seulement pour ceux qui ont joué au moins une partie classée cette saison (et pas bannis).
    await q.query(`INSERT INTO recompenses_saison (saison, compte_id, division, meilleure, titre, pieces, rang)
      SELECT l.saison, l.compte_id, l.division, l.meilleure,
        ($2::text[])[array_position($4::text[], l.meilleure)] || ' S' || l.saison,
        ($3::int[])[array_position($4::text[], l.meilleure)],
        row_number() OVER (ORDER BY l.points DESC, l.maj_le, l.compte_id)
      FROM ligue l JOIN comptes c ON c.id = l.compte_id
      WHERE l.saison = $1 AND l.parties > 0 AND c.statut IN ('actif', 'suspendu')
      ON CONFLICT DO NOTHING`, [s.numero, noms, pieces, DIVISIONS]);
    await q.query(`INSERT INTO registre_pieces (compte_id, montant, motif, ref)
      SELECT compte_id, pieces, 'saison', 'saison:' || saison FROM recompenses_saison WHERE saison = $1 AND pieces > 0`, [s.numero]);
    await q.query(`UPDATE comptes c SET solde = c.solde + r.pieces FROM recompenses_saison r WHERE r.saison = $1 AND r.compte_id = c.id AND r.pieces > 0`, [s.numero]);
    await q.query("UPDATE saisons SET statut = 'terminee', cloturee_le = now() WHERE numero = $1", [s.numero]);
    const suivante = await ouvrirSaison(q, new Date(Math.max(Date.now(), new Date(s.fin).getTime())));
    const descente = DIVISIONS.map((d) => c.descente[d]);
    const seuils = DIVISIONS.map((d) => c.seuils[d]);
    // Départ de la nouvelle saison, avec la protection de début (on ne retombe pas tout de suite).
    await q.query(`INSERT INTO ligue (saison, compte_id, points, division, meilleure, protection)
      SELECT $2, l.compte_id, ($4::int[])[x.i], ($5::text[])[x.i], ($5::text[])[x.i], $6
      FROM ligue l JOIN comptes c ON c.id = l.compte_id
      CROSS JOIN LATERAL (SELECT greatest(1, array_position($5::text[], l.division) - ($3::int[])[array_position($5::text[], l.division)]) AS i) x
      WHERE l.saison = $1 AND c.statut IN ('actif', 'suspendu') AND ($4::int[])[x.i] > 0
      ON CONFLICT DO NOTHING`, [s.numero, suivante, descente, seuils, DIVISIONS, c.protection]);
    return suivante;
  }

  // Appelé au démarrage puis chaque minute : ouvre la première saison, clôture celle qui est finie.
  // Le verrou évite une double clôture si deux serveurs tournent en même temps.
  async function assurerSaison({ forcer = false } = {}) {
    planUtilise = false;
    const r = await base.transaction(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(4242)');
      const s = await saisonCourante(q);
      if (!s) return { ouverte: await ouvrirSaison(q) };
      if (forcer || new Date(s.fin) <= new Date()) {
        if (forcer) await q.query('UPDATE saisons SET fin = now() WHERE numero = $1', [s.numero]);
        const fin = forcer ? new Date() : s.fin;
        return { cloturee: s.numero, ouverte: await cloturer(q, { ...s, fin }) };
      }
      return {};
    });
    if (planUtilise) await reglages.ecrire('prochaineSaison', { nom: '', theme: '' });
    return r;
  }

  // Fin d'une partie classée. joueurs : [{ id, place, abandon, coupure }], n : joueurs au départ.
  // Renvoie, pour chaque joueur, ce que l'écran de fin affiche.
  async function enregistrerPartie({ partieId, n, joueurs }) {
    const c = cfg();
    const res = new Map();
    await base.transaction(async (q) => {
      const s = await saisonCourante(q);
      if (!s) return;
      for (const j of joueurs) {
        await q.query('INSERT INTO ligue (saison, compte_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.numero, j.id]);
        const l = (await q.query('SELECT * FROM ligue WHERE saison = $1 AND compte_id = $2 FOR UPDATE', [s.numero, j.id])).rows[0];
        const brut = calculerPoints({ ...j, n }, c.points);
        let points = Math.max(0, l.points + brut);
        if (brut < 0 && l.protection > 0) points = Math.max(points, Math.min(l.points, c.seuils[l.division])); // palier de protection
        const division = divisionPour(points, c.seuils);
        const promu = rang(division) > rang(l.division), relegue = rang(division) < rang(l.division);
        const protection = promu ? c.protection : Math.max(0, l.protection - 1);
        const meilleure = rang(division) > rang(l.meilleure) ? division : l.meilleure;
        const delta = points - l.points;
        const ins = await q.query('INSERT INTO ligue_parties (partie_id, compte_id, saison, place, nb_joueurs, delta, points_apres, division_apres) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING 1',
          [partieId, j.id, s.numero, j.place || null, n, delta, points, division]);
        if (!ins.rows.length) continue; // déjà comptée
        await q.query('UPDATE ligue SET points = $3, division = $4, meilleure = $5, protection = $6, parties = parties + 1, victoires = victoires + $7, maj_le = now() WHERE saison = $1 AND compte_id = $2',
          [s.numero, j.id, points, division, meilleure, protection, j.place === 1 && !j.abandon ? 1 : 0]);
        const suivante = DIVISIONS[rang(division) + 1];
        res.set(j.id, {
          classee: true, delta, points, division, divisionAvant: l.division, promu, relegue, protection,
          prochaine: suivante ? { division: suivante, seuil: c.seuils[suivante], manque: c.seuils[suivante] - points } : null,
          saison: { numero: s.numero, nom: s.nom },
        });
      }
    });
    return res;
  }

  // Rang dans un classement (mondial ou pays), parmi ceux qui ont joué cette saison.
  async function rangDe(saison, compteId, pays = null) {
    const r = await base.query(`WITH moi AS (SELECT points, maj_le FROM ligue WHERE saison = $1 AND compte_id = $2 AND parties > 0)
      SELECT CASE WHEN (SELECT count(*) FROM moi) = 0 THEN NULL ELSE 1 + (SELECT count(*) FROM ligue l JOIN comptes c ON c.id = l.compte_id, moi
        WHERE l.saison = $1 AND l.parties > 0 AND c.statut IN ('actif', 'suspendu') AND ($3::text IS NULL OR c.pays = $3)
          AND (l.points > moi.points OR (l.points = moi.points AND l.maj_le < moi.maj_le))) END::int AS rang`, [saison, compteId, pays]);
    return r.rows[0].rang;
  }
  async function totalClasses(saison, pays = null) {
    return (await base.query(`SELECT count(*)::int AS n FROM ligue l JOIN comptes c ON c.id = l.compte_id WHERE l.saison = $1 AND l.parties > 0 AND c.statut IN ('actif', 'suspendu') AND ($2::text IS NULL OR c.pays = $2)`, [saison, pays])).rows[0].n;
  }

  const ligneClassement = (l, i) => ({ rang: l.rang != null ? Number(l.rang) : i + 1, id: l.id, pseudo: l.pseudo, numero: l.numero, avatar: l.avatar, points: l.points, division: l.division, parties: l.parties });

  const api = {
    NOMS, VILLES, calculerPoints, divisionPour, finDeSaison, saisonCourante, assurerSaison, enregistrerPartie, publicSaison,

    divisions() {
      const c = cfg();
      return DIVISIONS.map((d) => ({ id: d, nom: NOMS[d], seuil: c.seuils[d], recompense: c.recompenses[d] }));
    },

    // Ce que l'écran Ligue affiche pour un joueur.
    async etat(compte) {
      const s = await saisonCourante();
      const c = cfg();
      const l = s && (await base.query('SELECT * FROM ligue WHERE saison = $1 AND compte_id = $2', [s.numero, compte.id])).rows[0];
      const moi = l || { points: 0, division: 'bois', meilleure: 'bois', parties: 0, victoires: 0, protection: 0 };
      const suivante = DIVISIONS[rang(moi.division) + 1];
      const recompense = (await base.query(`SELECT r.saison, s.nom, r.division, r.meilleure, r.titre, r.pieces, r.rang FROM recompenses_saison r JOIN saisons s ON s.numero = r.saison
        WHERE r.compte_id = $1 AND NOT r.vue ORDER BY r.saison DESC LIMIT 1`, [compte.id])).rows[0] || null;
      const titres = (await base.query('SELECT saison, titre, meilleure AS division, rang FROM recompenses_saison WHERE compte_id = $1 ORDER BY saison DESC', [compte.id])).rows;
      return {
        saison: publicSaison(s),
        divisions: api.divisions(),
        points: c.points,
        moi: {
          points: moi.points, division: moi.division, meilleure: moi.meilleure, parties: moi.parties, victoires: moi.victoires, protection: moi.protection,
          prochaine: suivante ? { division: suivante, seuil: c.seuils[suivante], manque: c.seuils[suivante] - moi.points } : null,
          rangMondial: s ? await rangDe(s.numero, compte.id) : null,
          rangPays: s && compte.pays ? await rangDe(s.numero, compte.id, compte.pays) : null,
          pays: compte.pays || null,
        },
        dernieres: (await base.query('SELECT partie_id, place, nb_joueurs, delta, points_apres, division_apres, cree_le FROM ligue_parties WHERE compte_id = $1 ORDER BY cree_le DESC LIMIT 10', [compte.id])).rows,
        recompense, titres,
      };
    },

    async marquerVu(compteId) {
      await base.query('UPDATE recompenses_saison SET vue = true WHERE compte_id = $1 AND NOT vue', [compteId]);
    },

    // Classements de la saison en cours : mondial, pays, amis (retention.md §3.4).
    async classement(compte, type = 'mondial', { pays = null, limite = 100 } = {}) {
      const s = await saisonCourante();
      if (!s) return { saison: null, type, liste: [], moi: null };
      limite = Math.min(200, Math.max(1, Number(limite) || 100));
      let liste;
      if (type === 'amis') {
        // Moi + mes amis, même ceux qui n'ont pas encore joué cette saison (0 point, Bois).
        liste = (await base.query(`SELECT c.id, c.pseudo, c.numero, c.avatar, coalesce(l.points, 0) AS points, coalesce(l.division, 'bois') AS division, coalesce(l.parties, 0) AS parties
          FROM comptes c LEFT JOIN ligue l ON l.compte_id = c.id AND l.saison = $1
          WHERE c.statut <> 'supprime' AND (c.id = $2 OR c.id IN (SELECT ami_id FROM amis WHERE compte_id = $2))
          ORDER BY coalesce(l.points, 0) DESC, l.maj_le NULLS LAST, c.pseudo LIMIT $3`, [s.numero, compte.id, limite])).rows.map(ligneClassement);
        const moi = liste.find((x) => x.id === compte.id) || null;
        return { saison: publicSaison(s), type, liste, moi, total: liste.length };
      }
      if (type === 'pays') {
        pays = /^[A-Z]{2}$/.test(String(pays || '').toUpperCase()) ? String(pays).toUpperCase() : compte.pays;
        if (!pays) return { saison: publicSaison(s), type, pays: null, liste: [], moi: null, total: 0 };
      } else { type = 'mondial'; pays = null; }
      liste = (await base.query(`SELECT c.id, c.pseudo, c.numero, c.avatar, l.points, l.division, l.parties
        FROM ligue l JOIN comptes c ON c.id = l.compte_id
        WHERE l.saison = $1 AND l.parties > 0 AND c.statut IN ('actif', 'suspendu') AND ($2::text IS NULL OR c.pays = $2)
        ORDER BY l.points DESC, l.maj_le, c.id LIMIT $3`, [s.numero, pays, limite])).rows.map(ligneClassement);
      let moi = liste.find((x) => x.id === compte.id) || null;
      if (!moi && (!pays || pays === compte.pays)) {
        const r = await rangDe(s.numero, compte.id, pays);
        const l = r && (await base.query('SELECT points, division, parties FROM ligue WHERE saison = $1 AND compte_id = $2', [s.numero, compte.id])).rows[0];
        if (l) moi = { rang: r, id: compte.id, pseudo: compte.pseudo, numero: compte.numero, avatar: compte.avatar, ...l };
      }
      return { saison: publicSaison(s), type, pays, liste, moi, total: await totalClasses(s.numero, pays) };
    },

    // Tableau de bord : saison en cours, répartition, meilleurs joueurs, saisons passées.
    async resume() {
      const s = await saisonCourante();
      const parDivision = s ? (await base.query('SELECT division, count(*)::int AS joueurs FROM ligue WHERE saison = $1 AND parties > 0 GROUP BY division', [s.numero])).rows : [];
      const [activite] = (await base.query(`SELECT count(DISTINCT partie_id)::int AS parties_7j, count(DISTINCT compte_id)::int AS joueurs_7j FROM ligue_parties WHERE cree_le > now() - interval '7 days'`)).rows;
      const top = s ? (await api.classement({ id: null, pays: null }, 'mondial', { limite: 20 })).liste : [];
      const passees = (await base.query(`SELECT s.numero, s.nom, s.theme, s.debut, s.fin, s.cloturee_le,
          (SELECT count(*) FROM recompenses_saison r WHERE r.saison = s.numero)::int AS joueurs,
          (SELECT coalesce(sum(pieces), 0) FROM recompenses_saison r WHERE r.saison = s.numero)::int AS pieces,
          (SELECT c.pseudo || '#' || c.numero FROM recompenses_saison r JOIN comptes c ON c.id = r.compte_id WHERE r.saison = s.numero AND r.rang = 1) AS champion
        FROM saisons s WHERE s.statut = 'terminee' ORDER BY s.numero DESC LIMIT 24`)).rows;
      return {
        saison: publicSaison(s), joueurs: parDivision.reduce((t, x) => t + x.joueurs, 0),
        parDivision: DIVISIONS.map((d) => ({ division: d, nom: NOMS[d], joueurs: (parDivision.find((x) => x.division === d) || {}).joueurs || 0 })),
        activite, top, passees, prochaine: reglages.get('prochaineSaison'), reglages: cfg(),
      };
    },

    async modifierSaison({ nom, theme, fin }) {
      const s = await saisonCourante();
      if (!s) throw Object.assign(new Error('Aucune saison en cours.'), { statut: 404 });
      const n = nom !== undefined ? String(nom).replace(/[<>]/g, '').trim().slice(0, 40) : s.nom;
      if (!n) throw Object.assign(new Error('Le nom ne peut pas être vide.'), { statut: 400 });
      const t = theme !== undefined ? String(theme).replace(/[<>]/g, '').trim().slice(0, 40) || null : s.theme;
      let f = s.fin;
      if (fin !== undefined) {
        f = new Date(fin);
        if (Number.isNaN(f.getTime()) || f <= new Date()) throw Object.assign(new Error('La fin doit être dans le futur.'), { statut: 400 });
        if (f - new Date(s.debut) > 91 * JOUR) throw Object.assign(new Error('Une saison dure au plus 91 jours.'), { statut: 400 });
      }
      await base.query('UPDATE saisons SET nom = $2, theme = $3, fin = $4 WHERE numero = $1', [s.numero, n, t, f]);
      return publicSaison(await saisonCourante());
    },
  };
  return api;
}

module.exports = { creerLigue, calculerPoints, divisionPour, finDeSaison, NOMS };
