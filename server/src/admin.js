// API du tableau de bord du super admin. Tout est réservé au jeton admin, et chaque action est tracée.
'use strict';
const { conditionCible } = require('./stickers');
const express = require('express');
const { enveloppe, publicCompte } = require('./api');
const { emailSupabase } = require('./comptes');

function routesAdmin({ base, auth, comptes, reglages, ligue, parcours, parrainage, bande, fleuve, push, stickers, bouquets, abonnement, salles, demarrage }) {
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
      tables: liste.slice(0, 100).map((s) => ({ jeu: s.jeu || 'kopo', code: s.code, publique: s.publique, etat: s.salle.etat, manche: s.salle.numeroManche, joueurs: s.salle.joueurs.map((j) => ({ id: j.id, nom: j.nom, robot: !!j.robot, connecte: j.connecte !== false })) })),
    });
  });

  // --- Tableau de bord (page d'accueil de l'admin) : chiffres clés de la période (aujourd'hui, 7 ou 30 jours) comparés
  // à la période d'avant, courbes sur 30 jours, rétention, heures de jeu, parties, pièces, compétition, appareils, alertes.
  // Jours en UTC (comme les présences) ; heures de jeu à l'heure de Kinshasa (UTC+1).
  r.get('/tableau', enveloppe(async (req, res) => {
    const q = async (sql, p) => n((await base.query(sql, p)).rows);
    const jours = { jour: 1, '7': 7, '30': 30 }[req.query.periode] || 7;
    const P = [jours]; // $1 : longueur de la période ; période = [current_date - ($1 - 1), maintenant], précédente juste avant
    const dans = (col) => `${col} >= current_date - ($1::int - 1)`;
    const avant = (col) => `${col} >= current_date - (2 * $1::int - 1) AND ${col} < current_date - ($1::int - 1)`;
    // En ce moment (salles ouvertes)
    let connectes = 0, enCours = 0, enAttente = 0;
    for (const s of salles) { connectes += s.clientsParId.size; if (s.salle.etat === 'manche' || s.salle.etat === 'finManche') enCours++; if (s.publique && s.salle.etat === 'salon') enAttente += s.clientsParId.size; }
    const [cles] = await q(`SELECT
        (SELECT count(DISTINCT compte_id) FROM presences WHERE ${dans('jour')})::int AS actifs,
        (SELECT count(DISTINCT compte_id) FROM presences WHERE ${avant('jour')})::int AS actifs_avant,
        (SELECT count(*) FROM comptes WHERE ${dans('cree_le')} AND statut <> 'supprime')::int AS nouveaux,
        (SELECT count(*) FROM comptes WHERE ${avant('cree_le')} AND statut <> 'supprime')::int AS nouveaux_avant,
        (SELECT count(*) FROM comptes WHERE ${dans('cree_le')} AND statut <> 'supprime' AND auth_id IS NOT NULL)::int AS nouveaux_google,
        (SELECT count(*) FROM parties WHERE ${dans('debut')})::int AS parties,
        (SELECT count(*) FROM parties WHERE ${avant('debut')})::int AS parties_avant,
        (SELECT count(*) FROM parties WHERE ${dans('debut')} AND avec_robots)::int AS parties_robots,
        (SELECT count(*) FROM comptes WHERE kopo_plus_jusqu > now())::int AS kopo_plus,
        (SELECT count(*) FROM comptes WHERE kopo_plus_jusqu > now() AND kopo_plus_jusqu < now() + interval '3 days')::int AS kopo_plus_fin,
        (SELECT count(*) FROM abonnements WHERE ${dans('cree_le')} AND annule_le IS NULL AND francs > 0)::int AS kopo_plus_nouveaux`, P);
    // Argent réel encaissé : bouquets livrés (francs écrits dans la référence) et activations Kopo+ (hors essais et annulations).
    const ventes = `(SELECT cree_le, compte_id, coalesce(substring(ref from ':([0-9]+)FC:')::int, 0) AS francs, 'bouquets' AS source FROM registre_pieces WHERE motif = 'achat_pieces'
        UNION ALL SELECT cree_le, compte_id, francs, 'kopoPlus' FROM abonnements WHERE annule_le IS NULL AND francs > 0) v`;
    const [argent] = await q(`SELECT
        coalesce(sum(francs) FILTER (WHERE ${dans('cree_le')}), 0)::int AS revenus,
        coalesce(sum(francs) FILTER (WHERE ${avant('cree_le')}), 0)::int AS revenus_avant,
        count(DISTINCT compte_id) FILTER (WHERE ${dans('cree_le')})::int AS acheteurs
      FROM ${ventes}`, P);
    const parJour = await q(`SELECT d::date AS jour,
        (SELECT count(*) FROM presences p WHERE p.jour = d::date)::int AS actifs,
        (SELECT count(*) FROM comptes c WHERE c.cree_le::date = d::date)::int AS nouveaux,
        (SELECT count(*) FROM parties x WHERE x.debut::date = d::date)::int AS parties,
        (SELECT coalesce(sum(francs), 0) FROM ${ventes} WHERE v.cree_le::date = d::date AND v.source = 'bouquets')::int AS bouquets,
        (SELECT coalesce(sum(francs), 0) FROM ${ventes} WHERE v.cree_le::date = d::date AND v.source = 'kopoPlus')::int AS kopo_plus
      FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`);
    // Rétention à J1, J7, J30 (cohortes arrivées sur 7 jours), comme l'onglet Audience.
    const retention = {};
    for (const j of [1, 7, 30]) {
      const [x] = await q(`SELECT count(*)::int AS cohorte, count(p.compte_id)::int AS revenus
        FROM comptes c LEFT JOIN presences p ON p.compte_id = c.id AND p.jour = (c.cree_le::date + $1::int)
        WHERE c.cree_le::date BETWEEN current_date - ($1::int + 7) AND current_date - ($1::int + 1)`, [j]);
      retention['j' + j] = { cohorte: x.cohorte, taux: x.cohorte ? Math.round((100 * x.revenus) / x.cohorte) : null };
    }
    const [fidelite] = await q(`SELECT
        (SELECT count(DISTINCT compte_id) FROM presences WHERE jour = current_date)::int AS jour,
        (SELECT count(DISTINCT compte_id) FROM presences WHERE jour > current_date - 30)::int AS mois,
        (SELECT count(*) FROM participations pa JOIN parties x ON x.id = pa.partie_id WHERE ${dans('x.debut')})::int AS participations`, P);
    // Heures de jeu : parties lancées sur 28 jours, par jour de la semaine (1 = lundi) et heure de Kinshasa.
    const heures = await q(`SELECT extract(isodow FROM debut + interval '1 hour')::int AS jour, extract(hour FROM debut + interval '1 hour')::int AS heure, count(*)::int AS parties
      FROM parties WHERE debut > now() - interval '28 days' GROUP BY 1, 2`);
    const [parties] = await q(`SELECT count(*) FILTER (WHERE jeu = 'kopo')::int AS kopo, count(*) FILTER (WHERE jeu = 'inter8')::int AS inter8,
        coalesce(round(avg(extract(epoch FROM fin - debut) / 60) FILTER (WHERE fin IS NOT NULL)::numeric, 1), 0)::float AS duree_min,
        coalesce(round(avg(nb_joueurs)::numeric, 1), 0)::float AS joueurs_moyens,
        round(avg(attente_s) FILTER (WHERE publique AND attente_s IS NOT NULL))::int AS attente_s,
        (SELECT count(*) FROM participations pa JOIN parties x ON x.id = pa.partie_id WHERE ${dans('x.debut')} AND pa.abandon)::int AS abandons
      FROM parties WHERE ${dans('debut')}`, P);
    const [pieces] = await q(`SELECT
        coalesce(sum(montant) FILTER (WHERE montant > 0), 0)::bigint AS creees, coalesce(-sum(montant) FILTER (WHERE montant < 0), 0)::bigint AS detruites,
        coalesce(sum(montant) FILTER (WHERE motif = 'achat_pieces'), 0)::bigint AS vendues
      FROM registre_pieces WHERE ${dans('cree_le')}`, P);
    const [p7] = await q(`SELECT coalesce(sum(montant) FILTER (WHERE montant > 0), 0)::bigint AS creees, coalesce(-sum(montant) FILTER (WHERE montant < 0), 0)::bigint AS detruites
      FROM registre_pieces WHERE cree_le > now() - interval '7 days'`);
    const [soldes] = await q(`SELECT coalesce(sum(solde), 0)::bigint AS en_circulation,
        coalesce(round(100.0 * count(*) FILTER (WHERE solde < 20) / nullif(count(*), 0)), 0)::int AS part_a_court
      FROM comptes WHERE statut = 'actif' AND vu_le > now() - interval '7 days'`);
    const saison = (await q("SELECT numero, nom, fin FROM saisons WHERE statut = 'en_cours'"))[0] || null;
    const [competition] = await q(`SELECT
        (SELECT count(*) FROM ligue g WHERE g.saison = $2::int AND g.parties > 0)::int AS classes,
        (SELECT count(*) FROM parties WHERE ${dans('debut')} AND classee)::int AS parties_classees,
        (SELECT count(*) FROM match_jour WHERE jour = (now() + interval '1 hour')::date)::int AS match_jour,
        (SELECT count(*) FROM bande_semaines WHERE statut = 'ouverte')::int AS bandes,
        (SELECT coalesce(sum(i.mise), 0) FROM bande_inscriptions i JOIN bande_semaines w ON w.bande_id = i.bande_id AND w.semaine = i.semaine WHERE w.statut = 'ouverte')::bigint AS pot_bande`, [jours, saison ? saison.numero : -1]);
    // Appareils : dernière présence de chaque joueur actif de la période (web, android, ios ; vide = avant la mesure).
    const appareils = await q(`SELECT coalesce(plateforme, '?') AS plateforme, version, count(*)::int AS joueurs FROM (
        SELECT DISTINCT ON (compte_id) compte_id, plateforme, version FROM presences WHERE ${dans('jour')} ORDER BY compte_id, jour DESC) d GROUP BY 1, 2`, P);
    const [notifs] = await q(`SELECT count(DISTINCT p.compte_id)::int AS abonnes FROM presences p
      WHERE ${dans('p.jour')} AND (EXISTS (SELECT 1 FROM push_abonnements a WHERE a.compte_id = p.compte_id) OR EXISTS (SELECT 1 FROM push_natifs a WHERE a.compte_id = p.compte_id))`, P);
    // À traiter
    const sp = reglages.get('suspects') || {};
    const [signal] = await q("SELECT count(*)::int AS n FROM signalements WHERE statut = 'ouvert'");
    const suspects = (await chercherSuspects(sp.jours || 14, sp.parties || 5, sp.pourcent || 80)).length;
    const t = reglages.tout(), seuil = Number((t.alertes || {}).inflation);
    const ev = require('./reglages').evenementEnCours(t.evenement);
    const inflation = Number(p7.detruites) > 0 ? Math.round((100 * (Number(p7.creees) - Number(p7.detruites))) / Number(p7.detruites)) : null;
    res.json(n2({
      periode: jours, maintenant: { connectes, enCours, enAttente },
      cles: { ...cles, ...argent }, parJour, retention, fidelite, heures, parties, pieces: { ...pieces, ...soldes }, saison, competition,
      appareils, notifs: notifs.abonnes,
      alertes: {
        signalements: signal.n, suspects, inflation, seuilInflation: Number.isFinite(seuil) ? seuil : 25,
        maintenance: !!(t.maintenance && t.maintenance.active), jeuxFermes: Object.entries(t.jeux || {}).filter(([k, v]) => k !== 'testeurs' && v !== 'ouvert').map(([k, v]) => ({ jeu: k, etat: v })),
        evenement: ev ? { nom: ev.nom, fin: ev.fin } : null, invitesFermes: !((t.inscriptions || {}).invites ?? 1),
      },
    }));
  }));

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
        (SELECT count(*) FROM parties x WHERE x.debut::date = d::date AND x.avec_robots)::int AS parties_robots,
        (SELECT count(*) FROM parties x WHERE x.debut::date = d::date AND x.jeu = 'inter8')::int AS parties_inter8
      FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`);
    const [partiesInfo] = await q(`SELECT coalesce(round(avg(extract(epoch FROM fin - debut) / 60)::numeric, 1), 0)::float AS duree_min,
        coalesce(round(avg(nb_joueurs)::numeric, 1), 0)::float AS joueurs_moyens,
        (SELECT count(*) FROM participations WHERE abandon)::int AS abandons,
        count(*) FILTER (WHERE jeu = 'kopo')::int AS kopo,
        count(*) FILTER (WHERE jeu = 'inter8')::int AS inter8
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

  // --- Comptes suspects (sécurité, 17/11) : deux comptes qui jouent très souvent seuls ensemble (sans robot),
  // et où c'est presque toujours le même qui gagne. Signe qu'un joueur se fait donner des pièces (pots des tables à mise)
  // ou des points de ligue par un faux compte. Rien n'est sanctionné automatiquement : l'admin regarde et décide.
  // Seuils par défaut : Réglages > Sécurité (suspects : jours, parties, pourcent).
  async function chercherSuspects(jours, min, pourcent) {
    return n((await base.query(`WITH duos AS (
        SELECT p.id, p.classee, p.vainqueur, array_agg(pa.compte_id ORDER BY pa.compte_id) AS ids
        FROM parties p JOIN participations pa ON pa.partie_id = p.id
        WHERE p.fin > now() - make_interval(days => $1) AND NOT p.avec_robots
        GROUP BY p.id HAVING count(*) = 2),
      paires AS (
        SELECT ids[1] AS a, ids[2] AS b, count(*)::int AS ensemble, count(*) FILTER (WHERE classee)::int AS classees,
          count(*) FILTER (WHERE vainqueur = ids[1])::int AS victoires_a, count(*) FILTER (WHERE vainqueur = ids[2])::int AS victoires_b,
          array_agg(id) AS parties
        FROM duos GROUP BY 1, 2)
      SELECT x.a, ca.pseudo AS pseudo_a, ca.numero AS numero_a, ca.cree_le AS cree_a, ca.statut AS statut_a,
        x.b, cb.pseudo AS pseudo_b, cb.numero AS numero_b, cb.cree_le AS cree_b, cb.statut AS statut_b,
        x.ensemble, x.classees, x.victoires_a, x.victoires_b,
        coalesce((SELECT sum(r.montant) FROM registre_pieces r WHERE r.motif = 'pot' AND r.ref = ANY(x.parties) AND r.compte_id = x.a), 0)::int AS pots_a,
        coalesce((SELECT sum(r.montant) FROM registre_pieces r WHERE r.motif = 'pot' AND r.ref = ANY(x.parties) AND r.compte_id = x.b), 0)::int AS pots_b
      FROM paires x JOIN comptes ca ON ca.id = x.a JOIN comptes cb ON cb.id = x.b
      WHERE x.ensemble >= $2 AND greatest(x.victoires_a, x.victoires_b) >= $3::float * x.ensemble
      ORDER BY x.ensemble DESC LIMIT 50`, [jours, min, pourcent / 100])).rows);
  }
  r.get('/suspects', enveloppe(async (req, res) => {
    const d = reglages.get('suspects') || {};
    const jours = Math.min(90, Math.max(1, Math.trunc(Number(req.query.jours)) || d.jours || 14));
    const min = Math.min(100, Math.max(2, Math.trunc(Number(req.query.min)) || d.parties || 5));
    const pourcent = Math.min(100, Math.max(50, Math.trunc(Number(d.pourcent)) || 80));
    res.json({ jours, min, pourcent, paires: await chercherSuspects(jours, min, pourcent) });
  }));

  // --- Joueurs
  // Les listes de la fiche sont plafonnées ici ; le tableau de bord n'en montre que les premières (bouton « Voir plus »).
  const FICHE = { parties: 50, pieces: 50, signalements: 30, sanctions: 30, titres: 20, inventaire: 100, parrainages: 50 };
  // Recherche par pseudo, Pseudo#1234, identifiant ou adresse e-mail ; filtre google (compte lié) / invite.
  r.get('/joueurs', enveloppe(async (req, res) => {
    const t = String(req.query.q || '').trim();
    const filtre = ['google', 'invite'].includes(req.query.filtre) ? req.query.filtre : 'tous';
    const condFiltre = { tous: 'true', google: 'auth_id IS NOT NULL', invite: 'auth_id IS NULL' }[filtre];
    const m = /^(.*)#(\d{4})$/.exec(t);
    const rows = m
      ? (await base.query(`SELECT * FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2 AND ${condFiltre} LIMIT 100`, [m[1], m[2]])).rows
      : (await base.query(`SELECT * FROM comptes WHERE ($1 = '' OR lower(pseudo) LIKE lower($2) OR lower(email) LIKE lower($2) OR id = $1) AND ${condFiltre} ORDER BY vu_le DESC LIMIT 100`, [t, '%' + t.replace(/[%_]/g, '') + '%'])).rows;
    // Comptes liés avant que le serveur ne note l'adresse : on la demande une fois à Supabase.
    await Promise.all(rows.filter((c) => c.auth_id && c.email == null).map(async (c) => {
      const e = await emailSupabase(c.auth_id);
      if (e != null) { c.email = e; await comptes.noterEmail(c.id, e); }
    }));
    const comptage = (await base.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE auth_id IS NOT NULL)::int AS google, count(*) FILTER (WHERE auth_id IS NULL)::int AS invites FROM comptes WHERE statut <> 'supprime'")).rows[0];
    res.json({
      joueurs: n(rows).map((c) => ({ ...publicCompte(c), creeLe: c.cree_le, vuLe: c.vu_le, lie: !!c.auth_id, email: c.email || null, pays: c.pays })),
      comptage: { ...n([comptage])[0], resultats: rows.length, plafond: 100 },
    });
  }));

  r.get('/joueurs/:id', enveloppe(async (req, res) => {
    const c = await comptes.lire(req.params.id);
    if (!c) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    const q = async (sql) => n((await base.query(sql, [c.id])).rows);
    res.json({
      compte: { ...c, auth_id: c.auth_id ? 'lié' : null, email: ((await base.query('SELECT email FROM comptes WHERE id = $1', [c.id])).rows[0] || {}).email || null, parrain_createur: !!((await base.query('SELECT parrain_createur FROM comptes WHERE id = $1', [c.id])).rows[0] || {}).parrain_createur },
      stats: (await q(`SELECT count(*)::int AS parties, count(*) FILTER (WHERE place = 1)::int AS victoires, count(*) FILTER (WHERE abandon)::int AS abandons,
        (SELECT count(*) FROM signalements WHERE cible_id = $1)::int AS signalements, (SELECT count(*) FROM sanctions WHERE compte_id = $1)::int AS sanctions,
        (SELECT count(*) FROM registre_pieces WHERE compte_id = $1)::int AS operations, (SELECT count(*) FROM inventaire WHERE compte_id = $1)::int AS objets
        FROM participations WHERE compte_id = $1`))[0],
      parties: await q(`SELECT x.id, x.code, x.jeu, x.debut, x.nb_joueurs, x.avec_robots, p.place, p.abandon FROM participations p JOIN parties x ON x.id = p.partie_id WHERE p.compte_id = $1 ORDER BY x.debut DESC LIMIT ${FICHE.parties}`),
      pieces: await comptes.historique(c.id, FICHE.pieces),
      signalementsRecus: await q(`SELECT s.id, s.motif, s.details, s.statut, s.cree_le, a.pseudo AS auteur FROM signalements s JOIN comptes a ON a.id = s.auteur_id WHERE s.cible_id = $1 ORDER BY s.id DESC LIMIT ${FICHE.signalements}`),
      sanctions: await q(`SELECT type, motif, jusqu, cree_le FROM sanctions WHERE compte_id = $1 ORDER BY id DESC LIMIT ${FICHE.sanctions}`),
      // Joueurs souvent à la même table : aide à repérer la complicité (strategie-pieces §6.3).
      ligue: (await q(`SELECT l.saison, l.points, l.division, l.meilleure, l.parties, l.victoires FROM ligue l JOIN saisons s ON s.numero = l.saison WHERE l.compte_id = $1 AND s.statut = 'en_cours'`))[0] || null,
      titres: await q(`SELECT saison, titre, rang, pieces FROM recompenses_saison WHERE compte_id = $1 ORDER BY saison DESC LIMIT ${FICHE.titres}`),
      inventaire: await q(`SELECT objet, source, cree_le FROM inventaire WHERE compte_id = $1 ORDER BY cree_le DESC LIMIT ${FICHE.inventaire}`),
      parcours: (await q(`SELECT p.xp, cardinality(p.gratuits)::int AS gratuits, cardinality(p.plus)::int AS plus FROM parcours p JOIN saisons s ON s.numero = p.saison AND s.statut = 'en_cours' WHERE p.compte_id = $1`))[0] || null,
      parrainages: parrainage ? n(await parrainage.resumeAdmin(c.id, FICHE.parrainages)) : [],
      stickers: await q('SELECT sticker, restants, utilises, maj_le FROM stickers_soldes WHERE compte_id = $1 ORDER BY sticker'),
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
    for (const s of salles) if (s.majAbonne) s.majAbonne(req.params.id, jusqu);
    res.json({ ok: true, jusqu });
  }));
  // Parrainage : un créateur vérifié (influenceur) n'a pas de plafond de parrainages par mois.
  r.post('/joueurs/:id/createur', enveloppe(async (req, res) => {
    if (!parrainage || !(await parrainage.createur(req.params.id, !!req.body.actif))) return res.status(404).json({ erreur: 'Joueur introuvable.' });
    await journal('createur', req.params.id, { actif: !!req.body.actif });
    res.json({ ok: true });
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

  // --- Stickers : utilisations offertes à un joueur, à tous, ou à un groupe (ancienneté, Google…), toujours avec un message.
  r.get('/stickers', enveloppe(async (req, res) => res.json(n2(await stickers.resumeAdmin()))));
  r.post('/stickers/compter', enveloppe(async (req, res) => res.json(await stickers.compter(req.body.cible))));
  r.post('/stickers/offrir', enveloppe(async (req, res) => {
    const x = await stickers.offrir(req.body || {});
    await journal('stickers:cadeau', x.cible.type === 'joueur' ? x.cible.id : null, { cible: x.cible, stickers: x.stickers, utilisations: x.utilisations, message: req.body.message, joueurs: x.joueurs });
    res.json({ ok: true, ...x });
  }));

  // --- Bouquets de pièces : la liste, et un bouquet livré à un joueur (paiement mobile money reçu à la main).
  r.get('/bouquets', enveloppe(async (req, res) => res.json(n2(await bouquets.resumeAdmin()))));
  r.post('/bouquets/livrer', enveloppe(async (req, res) => {
    const x = await bouquets.livrer(req.body || {});
    await journal('bouquet:livre', x.joueur.id, { bouquet: x.bouquet.nom, francs: x.bouquet.francs, pieces: x.bouquet.pieces, message: req.body.message });
    res.json(x);
  }));

  // --- Abonnement Kopo+ (micro) : formules, abonnés, et un abonnement activé à la main (paiement mobile money reçu).
  r.get('/abonnements', enveloppe(async (req, res) => res.json(n2({ ...(await abonnement.resumeAdmin()),
    criteres: Object.entries(stickers.CRITERES).map(([id, d]) => ({ id, texte: d.texte, n: d.n || null, pays: !!d.pays })) }))));
  r.get('/abonnements/livekit', enveloppe(async (req, res) => res.json(await abonnement.verifierLiveKit())));
  r.post('/abonnements/:id/annuler', enveloppe(async (req, res) => {
    const x = await abonnement.annuler(req.params.id);
    await journal('abonnement:annule', x.compte, { activation: Number(req.params.id), formule: x.formule, francs: x.francs, jusqu: x.jusqu });
    for (const s of salles) if (s.majAbonne) s.majAbonne(x.compte, x.jusqu);
    res.json(x);
  }));
  // Kopo+ offert (à un joueur, à tous ou à un groupe) : jours ajoutés, message dans le jeu, push en option.
  r.post('/abonnements/compter', enveloppe(async (req, res) => res.json(await stickers.compter(req.body.cible))));
  r.post('/abonnements/offrir', enveloppe(async (req, res) => {
    const b = req.body || {};
    const x = await abonnement.offrir(b, conditionCible);
    let envoi = null;
    if (b.push) {
      envoi = await push.annonceA(x.ids, { titre: 'Kopo+ offert', texte: `${x.message} +${x.jours} jours de Kopo+ : micro et couronne dorée.` })
        .catch((e) => ({ erreur: e.message }));
    }
    await journal('abonnement:offert', x.cible.type === 'joueur' ? x.cible.id : null, { cible: x.cible, jours: x.jours, joueurs: x.joueurs, message: x.message, push: envoi });
    res.json({ ok: true, joueurs: x.joueurs, jours: x.jours, cible: x.cible, push: envoi });
  }));
  r.post('/abonnements/activer', enveloppe(async (req, res) => {
    const x = await abonnement.activer(req.body || {});
    await journal('abonnement:active', x.joueur.id, { formule: x.formule.id, francs: x.formule.francs, jusqu: x.jusqu, message: req.body.message });
    for (const s of salles) if (s.majAbonne) s.majAbonne(x.joueur.id, x.jusqu); // la couronne apparaît tout de suite à la table
    res.json(x);
  }));

  // --- Notifications push : abonnés, annonces envoyées, nouvelle annonce (essai à un joueur d'abord)
  r.get('/push', enveloppe(async (req, res) => res.json(n2(await push.resume()))));
  r.post('/push/compter', enveloppe(async (req, res) => res.json(await push.compter(req.body.public))));
  r.post('/push/annonce', enveloppe(async (req, res) => {
    const { titre, texte } = req.body;
    if (req.body.essai) {
      const m = /^(.*)#(\d{4})$/.exec(String(req.body.essai).trim());
      const c = m && (await base.query('SELECT id FROM comptes WHERE lower(pseudo) = lower($1) AND numero = $2', [m[1], m[2]])).rows[0];
      if (!c) return res.status(404).json({ erreur: 'Joueur introuvable. Écris Pseudo#1234.' });
      return res.json(await push.essai(c.id, { titre, texte }));
    }
    const x = await push.annonce({ titre, texte, public: req.body.public });
    await journal('annonce_push', null, { titre, texte, public: req.body.public || null, joueurs: x.joueurs, envoyees: x.envoyees });
    res.json(x);
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

  // --- Bandes : semaines, pots, et signal des Bandes suspectes (competition-amis.md §7)
  r.get('/bandes', enveloppe(async (req, res) => {
    const jour = (await base.query("SELECT count(*)::int AS joueurs, coalesce(round(avg(score)), 0)::int AS moyenne FROM match_jour WHERE jour = $1 AND statut = 'fini'", [bande ? require('./match-jour').jourDe() : null])).rows[0];
    res.json({ matchJour: jour, bandes: bande ? await bande.surveillance() : [] });
  }));

  // --- Le Fleuve (fleuve.md) : biefs, étapes et chiffres réels ; fabrication par les robots, puis publication.
  if (fleuve) {
    r.get('/fleuve', enveloppe(async (req, res) => res.json(await fleuve.resumeAdmin())));
    // Le lancement : Bande fermée (mises rendues), Match du jour arrêté, Fleuve ouvert à tous. Une seule fois.
    r.post('/fleuve/lancer', enveloppe(async (req, res) => {
      if (!req.body || req.body.confirmation !== 'LANCER') throw Object.assign(new Error('Écris LANCER pour confirmer.'), { statut: 400 });
      const x = await fleuve.lancer();
      await journal('fleuve:lancer', 'fleuve', { semaines: x.semaines, joueurs: x.joueurs, pieces: x.pieces });
      res.json(x);
    }));
    r.get('/fleuve/:fleuve/biefs/:bief', enveloppe(async (req, res) => res.json(await fleuve.etapesAdmin(req.params.fleuve, req.params.bief))));
    r.post('/fleuve/:fleuve/biefs/:bief/generer', enveloppe(async (req, res) => {
      const t = fleuve.generer(req.params.fleuve, req.params.bief);
      await journal('fleuve:generer', req.params.fleuve + ':' + req.params.bief, null);
      res.json(t);
    }));
    r.post('/fleuve/:fleuve/biefs/:bief/publier', enveloppe(async (req, res) => {
      const x = await fleuve.publier(req.params.fleuve, req.params.bief);
      await journal('fleuve:publier', req.params.fleuve + ':' + req.params.bief, null);
      res.json(x);
    }));
    r.post('/fleuve/:fleuve/etapes/:numero/refaire', enveloppe(async (req, res) => {
      const x = await fleuve.refaire(req.params.fleuve, Math.trunc(Number(req.params.numero)));
      await journal('fleuve:refaire', req.params.fleuve + ':' + req.params.numero, null);
      res.json(x);
    }));
    r.post('/fleuve/:fleuve/etapes/:numero/modifier', enveloppe(async (req, res) => {
      const x = await fleuve.modifier(req.params.fleuve, Math.trunc(Number(req.params.numero)), req.body || {});
      await journal('fleuve:modifier', req.params.fleuve + ':' + req.params.numero, { d: x && x.d });
      res.json(x);
    }));
  }

  // --- Pilotage : gains, bonus, tables, pot, annonce, maintenance
  r.get('/reglages', (req, res) => res.json({ ...reglages.tout(), versionAppli: require('./reglages').VERSION_APPLI }));
  r.put('/reglages/:cle', enveloppe(async (req, res) => {
    const avant = reglages.get(req.params.cle);
    const v = await reglages.ecrire(req.params.cle, req.body.valeur);
    if (req.params.cle === 'limites') require('./limites').appliquerLimites(v);
    await journal('reglage:' + req.params.cle, null, { avant, apres: v });
    res.json({ ok: true, valeur: v });
  }));

  r.get('/journal', enveloppe(async (req, res) => res.json(n((await base.query('SELECT * FROM journal_admin ORDER BY id DESC LIMIT 300')).rows))));
  // Valeurs de départ des réglages (bouton « rétablir » de l'onglet Réglages).
  r.get('/reglages/defauts', (req, res) => res.json(require('./reglages').DEFAUTS));

  return r;
}

module.exports = { routesAdmin };
