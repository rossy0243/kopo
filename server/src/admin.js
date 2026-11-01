// API du tableau de bord du super admin. Tout est réservé au jeton admin, et chaque action est tracée.
'use strict';
const express = require('express');
const { enveloppe, publicCompte } = require('./api');

function routesAdmin({ base, auth, comptes, reglages, ligue, parcours, salles, demarrage }) {
  const r = express.Router();
  r.use(express.json({ limit: '50kb' }));

  r.post('/connexion', enveloppe(async (req, res) => {
    const x = await auth.connexionAdmin(req.body.motDePasse, req.body.code, req.ip);
    res.status(x.ok ? 200 : 401).json(x);
  }));

  r.use(async (req, res, next) => {
    const jeton = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await auth.verifierAdmin(jeton))) return res.status(401).json({ erreur: 'Connexion admin requise.' });
    next();
  });
  const journal = (action, cible, details) => base.query('INSERT INTO journal_admin (action, cible, details) VALUES ($1,$2,$3)', [action, cible || null, details ? JSON.stringify(details) : null]);
  const n2 = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  const n = (rows) => rows.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));

  // --- En direct
  r.get('/direct', (req, res) => {
    const liste = [...salles];
    const parEtat = {};
    let joueurs = 0, enAttente = 0;
    for (const s of liste) {
      const h = s.clientsParId.size;
      joueurs += h;
      parEtat[s.salle.etat] = (parEtat[s.salle.etat] || 0) + 1;
      if (s.publique && s.salle.etat === 'salon') enAttente += h;
    }
    const m = process.memoryUsage();
    res.json({
      joueursConnectes: joueurs, salles: liste.length, sallesParEtat: parEtat, enAttenteAdversaires: enAttente,
      serveur: { demarreIl: Math.round((Date.now() - demarrage) / 1000), memoireMo: Math.round(m.rss / 1048576), base: base.genre },
      tables: liste.slice(0, 100).map((s) => ({ code: s.code, publique: s.publique, etat: s.salle.etat, manche: s.salle.numeroManche, joueurs: s.salle.joueurs.map((j) => ({ id: j.id, nom: j.nom, robot: !!j.robot, connecte: j.connecte !== false })) })),
    });
  });

  // --- Audience
  r.get('/audience', enveloppe(async (req, res) => {
    const q = async (sql, p) => n((await base.query(sql, p)).rows);
    const [actifs] = await q(`SELECT
        count(DISTINCT compte_id) FILTER (WHERE jour = current_date)::int AS jour,
        count(DISTINCT compte_id) FILTER (WHERE jour > current_date - 7)::int AS semaine,
        count(DISTINCT compte_id) FILTER (WHERE jour > current_date - 30)::int AS mois
      FROM presences WHERE jour > current_date - 30`);
    const [inscrits] = await q(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE cree_le >= current_date)::int AS aujourdhui,
        count(*) FILTER (WHERE cree_le > now() - interval '7 days')::int AS semaine,
        count(*) FILTER (WHERE auth_id IS NOT NULL)::int AS avec_connexion
      FROM comptes WHERE statut <> 'supprime'`);
    // Rétention à J1, J7, J30 : parmi les joueurs arrivés il y a J+1 à J+7 jours, part revenue le jour J.
    const retention = {};
    for (const j of [1, 7, 30]) {
      const [x] = await q(`SELECT count(*)::int AS cohorte, count(p.compte_id)::int AS revenus
        FROM comptes c LEFT JOIN presences p ON p.compte_id = c.id AND p.jour = (c.cree_le::date + $1::int)
        WHERE c.cree_le::date BETWEEN current_date - ($1::int + 7) AND current_date - ($1::int + 1)`, [j]);
      retention['j' + j] = { cohorte: x.cohorte, taux: x.cohorte ? Math.round((100 * x.revenus) / x.cohorte) : null };
    }
    const parJour = await q(`SELECT d::date AS jour,
        (SELECT count(*) FROM presences p WHERE p.jour = d::date)::int AS actifs,
        (SELECT count(*) FROM comptes c WHERE c.cree_le::date = d::date)::int AS nouveaux,
        (SELECT count(*) FROM parties x WHERE x.debut::date = d::date)::int AS parties,
        (SELECT count(*) FROM parties x WHERE x.debut::date = d::date AND x.avec_robots)::int AS parties_robots
      FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`);
    const [partiesInfo] = await q(`SELECT coalesce(round(avg(extract(epoch FROM fin - debut) / 60)::numeric, 1), 0)::float AS duree_min,
        coalesce(round(avg(nb_joueurs)::numeric, 1), 0)::float AS joueurs_moyens,
        (SELECT count(*) FROM participations WHERE abandon)::int AS abandons
      FROM parties WHERE fin IS NOT NULL AND debut > now() - interval '30 days'`);
    res.json({ actifs, inscrits, retention, parJour, parties: partiesInfo });
  }));

  // --- Économie des pièces (strategie-pieces §7)
  r.get('/economie', enveloppe(async (req, res) => {
    const q = async (sql, p) => n((await base.query(sql, p)).rows);
    const parJour = await q(`SELECT d::date AS jour,
        coalesce((SELECT sum(montant) FROM registre_pieces r WHERE r.cree_le::date = d::date AND montant > 0), 0)::int AS creees,
        coalesce((SELECT -sum(montant) FROM registre_pieces r WHERE r.cree_le::date = d::date AND montant < 0), 0)::int AS detruites
      FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`);
    const [soldes] = await q(`SELECT coalesce(round(avg(solde)), 0)::int AS moyen, coalesce(sum(solde), 0)::bigint AS en_circulation,
        coalesce(round(100.0 * count(*) FILTER (WHERE solde < 20) / nullif(count(*), 0)), 0)::int AS part_a_court
      FROM comptes WHERE statut = 'actif' AND vu_le > now() - interval '7 days'`);
    const parMotif = await q(`SELECT motif, sum(montant)::int AS total, count(*)::int AS operations FROM registre_pieces WHERE cree_le > now() - interval '7 days' GROUP BY motif ORDER BY abs(sum(montant)) DESC`);
    res.json({ parJour, soldes, parMotif });
  }));

  // --- Joueurs
  r.get('/joueurs', enveloppe(async (req, res) => {
    const t = String(req.query.q || '').trim();
    const m = /^(.*)#(\d{4})$/.exec(t);
    const rows = m
      ? (await base.query('SELECT * FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2 LIMIT 50', [m[1], m[2]])).rows
      : (await base.query('SELECT * FROM comptes WHERE $1 = \'\' OR lower(pseudo) LIKE lower($2) OR id = $1 ORDER BY vu_le DESC LIMIT 50', [t, '%' + t.replace(/[%_]/g, '') + '%'])).rows;
    res.json(n(rows).map((c) => ({ ...publicCompte(c), creeLe: c.cree_le, vuLe: c.vu_le, lie: !!c.auth_id, pays: c.pays })));
  }));

  r.get('/joueurs/:id', enveloppe(async (req, res) => {
    const c = await comptes.lire(req.params.id);
    if (!c) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    const q = async (sql) => n((await base.query(sql, [c.id])).rows);
    res.json({
      compte: { ...c, auth_id: c.auth_id ? 'lié' : null },
      stats: (await q(`SELECT count(*)::int AS parties, count(*) FILTER (WHERE place = 1)::int AS victoires, count(*) FILTER (WHERE abandon)::int AS abandons FROM participations WHERE compte_id = $1`))[0],
      parties: await q(`SELECT x.id, x.code, x.debut, x.nb_joueurs, x.avec_robots, p.place, p.abandon FROM participations p JOIN parties x ON x.id = p.partie_id WHERE p.compte_id = $1 ORDER BY x.debut DESC LIMIT 30`),
      pieces: await comptes.historique(c.id, 100),
      signalementsRecus: await q(`SELECT s.id, s.motif, s.details, s.statut, s.cree_le, a.pseudo AS auteur FROM signalements s JOIN comptes a ON a.id = s.auteur_id WHERE s.cible_id = $1 ORDER BY s.id DESC LIMIT 50`),
      sanctions: await q(`SELECT type, motif, jusqu, cree_le FROM sanctions WHERE compte_id = $1 ORDER BY id DESC`),
      // Joueurs souvent à la même table : aide à repérer la complicité (strategie-pieces §6.3).
      ligue: (await q(`SELECT l.saison, l.points, l.division, l.meilleure, l.parties, l.victoires FROM ligue l JOIN saisons s ON s.numero = l.saison WHERE l.compte_id = $1 AND s.statut = 'en_cours'`))[0] || null,
      titres: await q(`SELECT saison, titre, rang, pieces FROM recompenses_saison WHERE compte_id = $1 ORDER BY saison DESC`),
      inventaire: await q(`SELECT objet, source, cree_le FROM inventaire WHERE compte_id = $1 ORDER BY cree_le DESC`),
      parcours: (await q(`SELECT p.xp, cardinality(p.gratuits)::int AS gratuits, cardinality(p.plus)::int AS plus FROM parcours p JOIN saisons s ON s.numero = p.saison AND s.statut = 'en_cours' WHERE p.compte_id = $1`))[0] || null,
      partenaires: await q(`SELECT c2.id, c2.pseudo, c2.numero, count(*)::int AS ensemble FROM participations a JOIN participations b ON b.partie_id = a.partie_id AND b.compte_id <> a.compte_id JOIN comptes c2 ON c2.id = b.compte_id WHERE a.compte_id = $1 GROUP BY c2.id, c2.pseudo, c2.numero ORDER BY ensemble DESC LIMIT 5`),
    });
  }));

  // Avertir, couper le micro, suspendre, bannir, lever.
  r.post('/joueurs/:id/sanction', enveloppe(async (req, res) => {
    const { type, motif, jours } = req.body;
    const c = await comptes.lire(req.params.id);
    if (!c) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    if (!['avertissement', 'micro', 'suspension', 'bannissement', 'levee'].includes(type) || !motif) return res.status(400).json({ erreur: 'Type et motif obligatoires.' });
    const jusqu = type === 'suspension' ? new Date(Date.now() + Math.max(1, Number(jours) || 1) * 864e5) : null;
    await base.transaction(async (q) => {
      await q.query('INSERT INTO sanctions (compte_id, type, motif, jusqu) VALUES ($1,$2,$3,$4)', [c.id, type, motif, jusqu]);
      if (type === 'micro') await q.query('UPDATE comptes SET micro_coupe = true WHERE id = $1', [c.id]);
      if (type === 'suspension') await q.query("UPDATE comptes SET statut = 'suspendu', suspendu_jusqu = $2 WHERE id = $1", [c.id, jusqu]);
      if (type === 'bannissement') await q.query("UPDATE comptes SET statut = 'banni' WHERE id = $1", [c.id]);
      if (type === 'levee') await q.query("UPDATE comptes SET statut = 'actif', suspendu_jusqu = NULL, micro_coupe = false WHERE id = $1 AND statut <> 'supprime'", [c.id]);
    });
    if (type === 'suspension' || type === 'bannissement') for (const s of salles) s.exclure(c.id, type === 'bannissement' ? 'Ton compte a été banni.' : 'Ton compte est suspendu.');
    await journal('sanction:' + type, c.id, { motif, jusqu });
    res.json({ ok: true });
  }));

  // Corriger un solde (remboursement, erreur…). Le motif est obligatoire.
  r.post('/joueurs/:id/pieces', enveloppe(async (req, res) => {
    const montant = Math.trunc(Number(req.body.montant));
    if (!montant || !req.body.motif) return res.status(400).json({ erreur: 'Montant et motif obligatoires.' });
    const solde = await comptes.crediter(req.params.id, montant, 'admin', String(req.body.motif).slice(0, 200), true);
    await journal('pieces', req.params.id, { montant, motif: req.body.motif });
    res.json({ ok: true, solde });
  }));

  // Kopo+ (en attendant les paiements, phase 2) : jours offerts, 0 pour retirer.
  r.post('/joueurs/:id/kopo-plus', enveloppe(async (req, res) => {
    const jours = Math.trunc(Number(req.body.jours));
    if (!(jours >= 0 && jours <= 366)) return res.status(400).json({ erreur: 'Entre 0 et 366 jours.' });
    const jusqu = jours ? new Date(Date.now() + jours * 864e5) : null;
    const r2 = await base.query('UPDATE comptes SET kopo_plus_jusqu = $2 WHERE id = $1 RETURNING id', [req.params.id, jusqu]);
    if (!r2.rows.length) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    await journal('kopo-plus', req.params.id, { jours });
    res.json({ ok: true, jusqu });
  }));
  // Offrir une apparence (remerciement, correction…).
  r.post('/joueurs/:id/objet', enveloppe(async (req, res) => {
    if (!(await comptes.lire(req.params.id))) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    const ok = await parcours.donner(req.params.id, String(req.body.objet || ''), 'admin');
    await journal('objet', req.params.id, { objet: req.body.objet });
    res.json({ ok: true, nouveau: ok });
  }));

  // Cadeau à tous les joueurs actifs (ex. excuses après une panne).
  r.post('/cadeau', enveloppe(async (req, res) => {
    const montant = Math.trunc(Number(req.body.montant));
    if (!(montant > 0 && montant <= 10000) || !req.body.motif) return res.status(400).json({ erreur: 'Montant (1 à 10 000) et motif obligatoires.' });
    const n2 = await base.transaction(async (q) => {
      const r2 = await q.query(`INSERT INTO registre_pieces (compte_id, montant, motif, ref, par_admin) SELECT id, $1, 'cadeau', $2, true FROM comptes WHERE statut = 'actif' RETURNING compte_id`, [montant, String(req.body.motif).slice(0, 200)]);
      await q.query("UPDATE comptes SET solde = solde + $1 WHERE statut = 'actif'", [montant]);
      return r2.rows.length;
    });
    await journal('cadeau', null, { montant, motif: req.body.motif, joueurs: n2 });
    res.json({ ok: true, joueurs: n2 });
  }));

  // --- Modération
  r.get('/signalements', enveloppe(async (req, res) => {
    const statut = ['ouvert', 'traite', 'rejete'].includes(req.query.statut) ? req.query.statut : 'ouvert';
    res.json(n((await base.query(`SELECT s.*, a.pseudo AS auteur_pseudo, a.numero AS auteur_numero, c.pseudo AS cible_pseudo, c.numero AS cible_numero, c.statut AS cible_statut,
        (SELECT count(*) FROM signalements s2 WHERE s2.cible_id = s.cible_id)::int AS total_cible
      FROM signalements s JOIN comptes a ON a.id = s.auteur_id JOIN comptes c ON c.id = s.cible_id WHERE s.statut = $1 ORDER BY s.id DESC LIMIT 200`, [statut])).rows));
  }));
  r.post('/signalements/:id', enveloppe(async (req, res) => {
    const statut = req.body.statut === 'rejete' ? 'rejete' : 'traite';
    await base.query('UPDATE signalements SET statut = $2, decision = $3, traite_le = now() WHERE id = $1', [req.params.id, statut, req.body.decision || null]);
    await journal('signalement:' + statut, String(req.params.id), { decision: req.body.decision });
    res.json({ ok: true });
  }));

  // --- Ligue et saisons
  r.get('/ligue', enveloppe(async (req, res) => res.json(n2(await ligue.resume()))));
  r.put('/ligue/saison', enveloppe(async (req, res) => {
    const s = await ligue.modifierSaison(req.body || {});
    await journal('saison:modifier', String(s.numero), req.body);
    res.json({ ok: true, saison: s });
  }));
  // Clôturer la saison maintenant (récompenses versées, saison suivante ouverte). Irréversible.
  r.post('/ligue/cloturer', enveloppe(async (req, res) => {
    if (req.body.confirmation !== 'CLOTURER') return res.status(400).json({ erreur: 'Confirmation manquante.' });
    const x = await ligue.assurerSaison({ forcer: true });
    await journal('saison:cloturer', String(x.cloturee), x);
    res.json({ ok: true, ...x });
  }));

  // --- Pilotage : gains, bonus, tables, pot, annonce, maintenance
  r.get('/reglages', (req, res) => res.json(reglages.tout()));
  r.put('/reglages/:cle', enveloppe(async (req, res) => {
    const avant = reglages.get(req.params.cle);
    const v = await reglages.ecrire(req.params.cle, req.body.valeur);
    await journal('reglage:' + req.params.cle, null, { avant, apres: v });
    res.json({ ok: true, valeur: v });
  }));

  r.get('/journal', enveloppe(async (req, res) => res.json(n((await base.query('SELECT * FROM journal_admin ORDER BY id DESC LIMIT 200')).rows))));

  return r;
}

module.exports = { routesAdmin };
