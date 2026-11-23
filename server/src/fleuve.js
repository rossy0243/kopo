// Le Fleuve (fleuve.md) : deux cartes à remonter étape par étape, le Congo (Kopo) et le Niger (Inter (8)).
// Chaque étape est une petite partie contre des robots avec un objectif ; 1 à 3 étoiles ; 5 pagaies par jour,
// communes aux deux fleuves, et une pagaie ne se perd qu'en cas d'échec. Le serveur garde tout.
'use strict';
const { jourDe, debutDu, ajouterJours, lundiDe } = require('./match-jour');
const { texteObjectif, etoilesDe } = require('./fleuve-suivi');
const G = require('./fleuve-generateur');

const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });
const EN_COURS_MAX = 45 * 60e3; // une étape restée « en cours » (serveur redémarré) est close au bout de 45 min

// Escales : une vraie ville toutes les 10 étapes, dans l'ordre où on la croise en remontant le fleuve depuis la mer
// (liste vérifiée, fleuve.md « Les villes, vérifiées »). Après la dernière ville : le retour, les mêmes villes
// dans l'autre sens (« Kinshasa · retour 2 »), pour ne jamais inventer de nom.
const VILLES = {
  congo: ['Banana', 'Boma', 'Matadi', 'Luozi', 'Kinshasa', 'Lukolela', 'Mbandaka', 'Lisala', 'Bumba', 'Kisangani'],
  niger: ['Onitsha', 'Lokoja', 'Jebba', 'Gaya', 'Niamey', 'Tillabéri', 'Ayorou', 'Gao', 'Tombouctou', 'Mopti', 'Ségou', 'Bamako'],
  // Le Kasaï : de Kwamouth (où il rejoint le Congo) aux chutes de Mai-Munene (Ilebo : le dernier grand port).
  kasai: ['Kwamouth', 'Mushie', 'Mangai', 'Dibaya-Lubwe', 'Mapangu', 'Ilebo', 'Djokupunda', 'Tshikapa', 'Mai-Munene'],
  // L'Oubangui : de Liranga (où il rejoint le Congo) à Yakoma (où il naît de l'Uele et du Mbomou).
  oubangui: ['Liranga', 'Impfondo', 'Dongou', 'Bétou', 'Libenge', 'Zongo', 'Bangui', 'Kouango', 'Mobaye', 'Yakoma'],
  // Le Nil : de la Méditerranée à sa source, le lac Victoria (Nil blanc après Khartoum).
  nil: ['Rosette', 'Le Caire', 'Minya', 'Assiout', 'Louxor', 'Assouan', 'Wadi Halfa', 'Dongola', 'Karima', 'Atbara', 'Khartoum', 'Kosti', 'Malakal', 'Juba', 'Jinja'],
};
// « le Congo », « l'Oubangui ».
const leF = (f) => (/^[AEIOUÉ]/.test(NOMS[f]) ? 'l\'' : 'le ') + NOMS[f];
const NOMS = { congo: 'Congo', niger: 'Niger', kasai: 'Kasaï', oubangui: 'Oubangui', nil: 'Nil' };
// Interrupteur de chaque fleuve (Réglages > Le Fleuve) : 'ouvert', 'testeurs' ou 'ferme'. Les nouveaux fleuves sont éteints au départ.
const ETATS_DEFAUT = { congo: 'ouvert', niger: 'ouvert', kasai: 'ferme', oubangui: 'ferme', nil: 'ferme' };
function villeDe(fleuve, k) { // k = numéro de l'escale (1 = la première)
  const l = VILLES[fleuve], n = l.length;
  const voyage = Math.floor((k - 1) / n), i = (k - 1) % n;
  if (voyage === 0) return l[i];
  const sens = voyage % 2 === 1 ? l.slice().reverse() : l; // aller, retour, aller…
  return `${sens[i]} · ${voyage % 2 === 1 ? 'retour' : 'voyage'} ${voyage + 1}`;
}
const villeDeLEtape = (fleuve, numero) => villeDe(fleuve, Math.ceil(numero / G.ETAPES_PAR_VILLE));
const estEscale = (numero) => numero % G.ETAPES_PAR_VILLE === 0;
const biefDe = (numero) => Math.ceil(numero / G.ETAPES_PAR_BIEF);

// Ce que le joueur voit d'une étape avant de jouer.
function publicEtape(fleuve, r, version) {
  return {
    fleuve, numero: r.numero, bief: biefDe(r.numero), jeu: r.jeu, escale: estEscale(r.numero), ville: villeDeLEtape(fleuve, r.numero),
    joueurs: r.joueurs, robots: r.robots, force: r.force, objectif: r.objectif, texte: texteObjectif(r.objectif),
    pieges: (r.pieges || []).map((p) => ({ id: p, texte: (G.PIEGES[p] || {}).texte || p })), seuils: r.seuils, version,
  };
}

function creerFleuve(base, reglages, comptes, social = null) {
  const cfg = () => reglages.get('fleuve') || {};
  const recette = () => G.completerRecette(reglages.get('fleuveRecette'));
  let horloge = () => new Date(); // remplacée dans les tests
  let coursesReglees = null; // dernière semaine réglée (évite de revérifier chaque minute)
  const travaux = new Map(); // fabrication en cours : 'congo:3' -> { fait, total, erreur, fini }

  // Ouvert à ce joueur ? 'ferme' : personne ; 'testeurs' : les pseudos de la liste des testeurs (Réglages > Jeux) ; 'ouvert' : tous.
  const estTesteur = (compte) => !!compte && ((reglages.get('jeux') || {}).testeurs || []).map((x) => String(x).toLowerCase()).includes(String(compte.pseudo || '').toLowerCase());
  function ouvertPour(compte) {
    const e = cfg().etat;
    if (e === 'ouvert') return true;
    return e === 'testeurs' && estTesteur(compte);
  }
  // Ce fleuve-là, pour ce joueur : le Fleuve ouvert, et l'interrupteur du fleuve allumé (ou testeur).
  const etatDuFleuve = (fleuve) => ({ ...ETATS_DEFAUT, ...(cfg().fleuves || {}) })[fleuve] || 'ferme';
  function fleuveOuvertPour(compte, fleuve) {
    if (!G.FLEUVES[fleuve] || !ouvertPour(compte)) return false;
    const e = etatDuFleuve(fleuve);
    return e === 'ouvert' || (e === 'testeurs' && estTesteur(compte));
  }

  async function pagaiesDe(compteId, q = base) {
    const max = Math.max(1, Number(cfg().pagaies) || 5);
    const r = (await q.query('SELECT perdues FROM fleuve_pagaies WHERE compte_id = $1 AND jour = $2', [compteId, jourDe(horloge())])).rows[0];
    return { restantes: Math.max(0, max - (r ? r.perdues : 0)), max };
  }
  async function etoilesDuJoueur(compteId, fleuve, q = base) {
    const r = await q.query('SELECT numero, etoiles FROM fleuve_etoiles WHERE compte_id = $1 AND fleuve = $2', [compteId, fleuve]);
    return new Map(r.rows.map((x) => [x.numero, x.etoiles]));
  }
  async function dernierePubliee(fleuve, q = base) {
    return (await q.query('SELECT coalesce(max(numero), 0)::int AS n FROM fleuve_etapes WHERE fleuve = $1 AND publie', [fleuve])).rows[0].n;
  }
  // Étape courante : la première étape publiée pas encore réussie (null : tout est fini, la suite arrive).
  function courante(etoiles, publiees) {
    for (let n = 1; n <= publiees; n++) if (!(etoiles.get(n) > 0)) return n;
    return null;
  }
  // Étoiles gagnées dans la ville de l'étape (ses 9 premières étapes), pour ouvrir l'escale.
  function etoilesVille(etoiles, numero) {
    const debut = (Math.ceil(numero / G.ETAPES_PAR_VILLE) - 1) * G.ETAPES_PAR_VILLE + 1;
    let t = 0;
    for (let n = debut; n < debut + G.ETAPES_PAR_VILLE - 1; n++) t += etoiles.get(n) || 0;
    return t;
  }
  const seuilVille = () => { const v = Number(cfg().etoilesVille ?? 20); return Number.isFinite(v) ? Math.max(0, v) : 20; }; // 0 permis (admin)
  const piecesCourse = () => Math.max(0, Number(cfg().piecesCourse ?? 300) || 0);

  // --- Les amis (fleuve.md « La rivalité entre amis »). Les étapes se réussissent dans l'ordre : le nombre d'étapes
  // réussies d'un joueur dit où il est (étape courante = réussies + 1).
  // Amis d'un joueur (ceux qu'il a ajoutés, sans les comptes bloqués, supprimés ou bannis).
  const AMIS = `SELECT c.id, c.pseudo, c.equipes->>'avatar' AS apparence FROM amis a JOIN comptes c ON c.id = a.ami_id
    WHERE a.compte_id = $1 AND c.statut NOT IN ('supprime', 'banni')
      AND NOT EXISTS (SELECT 1 FROM blocages b WHERE (b.compte_id = $1 AND b.bloque_id = c.id) OR (b.compte_id = c.id AND b.bloque_id = $1))`;
  const debutSemaine = () => debutDu(lundiDe(jourDe(horloge())));
  async function veutAlertes(q, compteId) {
    const r = (await q.query('SELECT push_prefs FROM comptes WHERE id = $1', [compteId])).rows[0];
    return !!r && !(r.push_prefs && r.push_prefs.fleuve === false);
  }
  // Où en sont mes amis sur un fleuve, et leurs étoiles de la semaine. Seuls ceux qui ont commencé ce fleuve.
  async function amisSurLeFleuve(compteId, fleuve, q = base) {
    const l = (await q.query(`SELECT x.*, 
        (SELECT count(*) FROM fleuve_etoiles e WHERE e.compte_id = x.id AND e.fleuve = $2)::int AS faites,
        (SELECT coalesce(sum(e.etoiles), 0) FROM fleuve_etoiles e WHERE e.compte_id = x.id AND e.fleuve = $2)::int AS etoiles,
        (SELECT coalesce(sum(s.nouvelles), 0) FROM fleuve_essais s WHERE s.compte_id = x.id AND s.fleuve = $2 AND s.statut = 'reussi' AND s.debut >= $3)::int AS semaine
      FROM (${AMIS}) x`, [compteId, fleuve, debutSemaine()])).rows;
    const actifs = l.filter((a) => a.faites > 0 || a.semaine > 0);
    const marques = await marquesDe(actifs.map((a) => a.id), fleuve, q);
    return actifs.map((a) => ({ ...a, ...(marques.get(a.id) || { premiers: [], pagayeur: false }) }));
  }
  // Marques en cours : « 1er à … » (pour toujours) et « Pagayeur de la semaine » (7 jours).
  async function marquesDe(ids, fleuve, q = base) {
    const m = new Map();
    if (!ids.length) return m;
    const r = await q.query('SELECT compte_id, type, cle, texte FROM fleuve_marques WHERE compte_id = ANY($1) AND fleuve = $2 AND (jusqu IS NULL OR jusqu > $3) ORDER BY cree_le', [ids, fleuve, horloge()]);
    for (const x of r.rows) {
      if (!m.has(x.compte_id)) m.set(x.compte_id, { premiers: [], pagayeur: false });
      const v = m.get(x.compte_id);
      if (x.type === 'premier') v.premiers.push(x.texte); else if (x.type === 'pagayeur') v.pagayeur = true;
    }
    return m;
  }
  // Après une première réussite : les amis restés sur cette étape sont dépassés (prévenus une fois par jour au plus),
  // et le premier de ses amis à passer une escale garde la marque « 1er à … ».
  async function apresReussite(q, compteId, fleuve, numero) {
    const out = { depasses: [], premierA: null };
    const amis = (await q.query(`SELECT x.id, x.pseudo FROM (${AMIS}) x
      WHERE $3 > 1 AND (SELECT count(*) FROM fleuve_etoiles e WHERE e.compte_id = x.id AND e.fleuve = $2) = $3 - 1`, [compteId, fleuve, numero])).rows; // un ami qui n'a pas commencé n'est pas dépassé
    out.depasses = amis.map((a) => ({ id: a.id, pseudo: a.pseudo }));
    if (estEscale(numero)) {
      const avant = (await q.query(`SELECT 1 FROM (${AMIS}) x JOIN fleuve_etoiles e ON e.compte_id = x.id AND e.fleuve = $2 AND e.numero = $3 LIMIT 1`, [compteId, fleuve, numero])).rows.length;
      if (!avant) {
        const ville = villeDeLEtape(fleuve, numero);
        await q.query(`INSERT INTO fleuve_marques (compte_id, fleuve, type, cle, texte, cree_le) VALUES ($1, $2, 'premier', $3, $4, $5) ON CONFLICT DO NOTHING`, [compteId, fleuve, String(numero), '1er à ' + ville, horloge()]);
        out.premierA = ville;
      }
    }
    return out;
  }
  // Prévient les amis dépassés : une seule alerte « t'a dépassé » par jour et par joueur, coupable dans les paramètres.
  async function prevenirDepasses(compteId, fleuve, numero, depasses) {
    if (!social || !depasses.length) return;
    const moi = (await base.query('SELECT pseudo FROM comptes WHERE id = $1', [compteId])).rows[0];
    if (!moi) return;
    for (const a of depasses) {
      try {
        if (!(await veutAlertes(base, a.id))) continue;
        const deja = (await base.query("SELECT 1 FROM notifications WHERE compte_id = $1 AND type = 'fleuve' AND donnees->>'depasse' = 'true' AND cree_le >= $2 LIMIT 1", [a.id, debutDu(jourDe(horloge()))])).rows.length;
        if (deja) continue;
        const p = await pagaiesDe(a.id);
        const texte = `${moi.pseudo} t'a dépassé sur ${leF(fleuve)} (étape ${numero}).`;
        const push = texte + (p.restantes > 0 ? ` Tu as ${p.restantes} pagaie${p.restantes > 1 ? 's' : ''} pour repasser devant.` : ' Tes pagaies reviennent à minuit.');
        await social.notifier(a.id, 'fleuve', texte, { depasse: true, de: compteId, pseudo: moi.pseudo, fleuve, numero, push });
      } catch (e) { console.error('Fleuve, alerte :', e.message); }
    }
  }

  // Peut-on jouer cette étape ? Renvoie null, ou la raison (texte affiché).
  function refus(etoiles, publiees, numero) {
    if (!(numero >= 1 && numero <= publiees)) return 'Cette étape n\'est pas encore ouverte.';
    const c = courante(etoiles, publiees);
    if (etoiles.get(numero) > 0) return null; // rejouer une étape réussie : toujours permis (3e étoile)
    if (numero !== c) return 'Réussis d\'abord les étapes d\'avant.';
    if (estEscale(numero) && etoilesVille(etoiles, numero) < seuilVille()) return `Il te faut ${seuilVille()} étoiles dans cette ville pour affronter le boss.`;
    return null;
  }

  const api = {
    VILLES, villeDe, villeDeLEtape, estEscale, biefDe, ouvertPour, fleuveOuvertPour,
    regler(h) { horloge = h; },

    // État des deux fleuves pour un joueur : pagaies, étoiles, étapes visibles (jusqu'à la fin du bief en cours).
    async etat(compte) {
      const ouvert = ouvertPour(compte);
      const p = await pagaiesDe(compte.id);
      const demain = debutDu(ajouterJours(jourDe(horloge()), 1));
      const res = { ouvert, google: !!compte.auth_id, pagaies: { ...p, retourMs: demain - horloge() }, etoilesVille: seuilVille(), fleuves: {}, lance: cfg().lance || null };
      // Mise de la Bande rendue au lancement (3e écran de la fenêtre « Nouveau »).
      if (cfg().lance) res.rembourse = (await base.query("SELECT coalesce(sum(montant), 0)::int AS n FROM registre_pieces WHERE compte_id = $1 AND motif = 'fermeture_bande'", [compte.id])).rows[0].n;
      if (!ouvert) return res;
      for (const fleuve of Object.keys(G.FLEUVES)) {
        if (!fleuveOuvertPour(compte, fleuve)) continue; // interrupteur éteint : le fleuve n'apparaît pas
        const etoiles = await etoilesDuJoueur(compte.id, fleuve);
        const publiees = await dernierePubliee(fleuve);
        const c = courante(etoiles, publiees);
        const reference = c || publiees || 1;
        const finBief = Math.min(publiees, biefDe(reference) * G.ETAPES_PAR_BIEF);
        const etapes = [];
        for (let n = 1; n <= finBief; n++) {
          const e = { n, etoiles: etoiles.get(n) || 0 };
          if (estEscale(n)) { e.escale = true; e.ville = villeDeLEtape(fleuve, n); if (n === c) e.villeEtoiles = etoilesVille(etoiles, n); }
          etapes.push(e);
        }
        let total = 0; for (const v of etoiles.values()) total += v;
        const amis = await amisSurLeFleuve(compte.id, fleuve);
        const mesMarques = (await marquesDe([compte.id], fleuve)).get(compte.id) || { premiers: [], pagayeur: false };
        const maSemaine = (await base.query("SELECT coalesce(sum(nouvelles), 0)::int AS n FROM fleuve_essais WHERE compte_id = $1 AND fleuve = $2 AND statut = 'reussi' AND debut >= $3", [compte.id, fleuve, debutSemaine()])).rows[0].n;
        // Course de la semaine : moi et mes amis, au nombre d'étoiles nouvelles gagnées depuis lundi.
        const course = [{ id: compte.id, pseudo: compte.pseudo, apparence: (compte.equipes && compte.equipes.avatar) || null, etoiles: maSemaine, moi: true, pagayeur: mesMarques.pagayeur },
          ...amis.filter((a) => a.semaine > 0).map((a) => ({ id: a.id, pseudo: a.pseudo, apparence: a.apparence, etoiles: a.semaine, pagayeur: a.pagayeur }))]
          .sort((x, y) => y.etoiles - x.etoiles || (x.moi ? -1 : y.moi ? 1 : 0));
        res.fleuves[fleuve] = {
          nom: NOMS[fleuve], jeu: G.FLEUVES[fleuve], courante: c, publiees, bief: biefDe(reference), etoiles: total,
          suiteBientot: c === null || finBief === publiees && biefDe(reference) * G.ETAPES_PAR_BIEF > publiees,
          ville: villeDeLEtape(fleuve, c || reference), etapes,
          // Mes amis sur la carte : leur étape (null : ils ont fini tout ce qui est publié).
          amis: amis.map((a) => ({ id: a.id, pseudo: a.pseudo, apparence: a.apparence, n: a.faites >= publiees ? null : a.faites + 1, faites: a.faites, etoiles: a.etoiles, premiers: a.premiers, pagayeur: a.pagayeur })),
          marques: mesMarques,
          course: { lignes: course, finMs: debutDu(ajouterJours(lundiDe(jourDe(horloge())), 7)) - horloge(), pieces: piecesCourse(), amis: amis.length },
        };
      }
      return res;
    },

    // Détail d'une étape (fenêtre avant de jouer).
    async etape(compte, fleuve, numero) {
      if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
      if (!fleuveOuvertPour(compte, fleuve)) throw erreur(ouvertPour(compte) ? `${leF(fleuve)[0].toUpperCase()}${leF(fleuve).slice(1)} ouvre bientôt.` : 'Le Fleuve arrive bientôt.', 403);
      numero = Math.trunc(Number(numero));
      const r = (await base.query('SELECT recette, version FROM fleuve_etapes WHERE fleuve = $1 AND numero = $2 AND publie', [fleuve, numero])).rows[0];
      if (!r) throw erreur('Cette étape n\'est pas encore ouverte.', 404);
      const etoiles = await etoilesDuJoueur(compte.id, fleuve);
      const raison = refus(etoiles, await dernierePubliee(fleuve), numero);
      const p = await pagaiesDe(compte.id);
      return { ...publicEtape(fleuve, recetteDe(r), r.version), etoiles: etoiles.get(numero) || 0, refus: raison, pagaies: p, villeEtoiles: estEscale(numero) ? etoilesVille(etoiles, numero) : null, etoilesVille: seuilVille() };
    },

    // Entrée dans la salle d'une étape : tout est vérifié ici (Google, ouverture, pagaies, ordre des étapes).
    async commencer(compte, fleuve, numero) {
      if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
      if (!compte.auth_id) throw erreur('Connecte-toi avec Google pour jouer au Fleuve.', 403);
      if (!fleuveOuvertPour(compte, fleuve)) throw erreur(ouvertPour(compte) ? `${leF(fleuve)[0].toUpperCase()}${leF(fleuve).slice(1)} ouvre bientôt.` : 'Le Fleuve arrive bientôt.', 403);
      numero = Math.trunc(Number(numero));
      return base.transaction(async (q) => {
        await q.query('SELECT id FROM comptes WHERE id = $1 FOR UPDATE', [compte.id]); // une seule entrée à la fois par compte
        const enCours = (await q.query("SELECT id, debut FROM fleuve_essais WHERE compte_id = $1 AND statut = 'en_cours'", [compte.id])).rows;
        for (const e of enCours) {
          if (horloge() - new Date(e.debut) < EN_COURS_MAX) throw erreur('Une étape est déjà en cours sur un autre appareil.', 409);
          await q.query("UPDATE fleuve_essais SET statut = 'coupe', fin = $2 WHERE id = $1", [e.id, horloge()]); // serveur redémarré : rien n'est perdu
        }
        const r = (await q.query('SELECT recette, version FROM fleuve_etapes WHERE fleuve = $1 AND numero = $2 AND publie', [fleuve, numero])).rows[0];
        if (!r) throw erreur('Cette étape n\'est pas encore ouverte.', 404);
        const etoiles = await etoilesDuJoueur(compte.id, fleuve, q);
        const raison = refus(etoiles, await dernierePubliee(fleuve, q), numero);
        if (raison) throw erreur(raison, 403);
        const p = await pagaiesDe(compte.id, q);
        if (p.restantes <= 0) throw erreur(`Ta pirogue se repose : ${p.max} nouvelles pagaies à minuit.`, 403);
        // Bloqué depuis N jours sur la même étape (jamais réussie) : les robots baissent d'un cran.
        const jours = Math.max(1, Number(cfg().adoucirJours) || 5);
        const bloque = etoiles.get(numero) > 0 ? 0 : (await q.query("SELECT count(DISTINCT ((debut AT TIME ZONE 'UTC') + interval '1 hour')::date)::int AS n FROM fleuve_essais WHERE compte_id = $1 AND fleuve = $2 AND numero = $3 AND statut IN ('rate', 'parti')", [compte.id, fleuve, numero])).rows[0].n;
        const adoucir = bloque >= jours ? 10 : 0;
        const e = (await q.query('INSERT INTO fleuve_essais (compte_id, fleuve, numero, version, adouci, debut) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [compte.id, fleuve, numero, r.version, adoucir > 0, horloge()])).rows[0];
        return { essai: Number(e.id), etape: { ...recetteDe(r), fleuve, numero }, adoucir, public: publicEtape(fleuve, recetteDe(r), r.version) };
      });
    },

    // Essai jamais commencé (salle prise par un autre, entrée ratée) : effacé, sans pagaie perdue.
    async annuler(compteId, essaiId) {
      await base.query("DELETE FROM fleuve_essais WHERE id = $1 AND compte_id = $2 AND statut = 'en_cours'", [essaiId, compteId]);
    },
    // Au démarrage du serveur : aucune salle n'a survécu, les essais « en cours » sont clos sans pagaie perdue.
    async nettoyer() {
      await base.query("UPDATE fleuve_essais SET statut = 'coupe', fin = now() WHERE statut = 'en_cours'");
    },

    // Fin d'une étape. resultat : celui du suivi ({ reussi, score, ... }). parti : le joueur a quitté (= échec).
    async terminer(compteId, essaiId, resultat, { parti = false } = {}) {
      const c = cfg();
      return base.transaction(async (q) => {
        const e = (await q.query("SELECT * FROM fleuve_essais WHERE id = $1 AND compte_id = $2 FOR UPDATE", [essaiId, compteId])).rows[0];
        if (!e) throw erreur('Étape inconnue.', 404);
        if (e.statut !== 'en_cours') return { deja: true, statut: e.statut };
        const r = (await q.query('SELECT recette FROM fleuve_etapes WHERE fleuve = $1 AND numero = $2', [e.fleuve, e.numero])).rows[0];
        const rec = r ? recetteDe(r) : {};
        const reussi = !parti && !!(resultat && resultat.reussi);
        const etoiles = reussi ? etoilesDe(resultat, rec.seuils) : 0;
        const score = resultat ? resultat.score | 0 : 0;
        await q.query('UPDATE fleuve_essais SET statut = $2, fin = $6, etoiles = $3, score = $4, pagaie = $5 WHERE id = $1', [e.id, reussi ? 'reussi' : parti ? 'parti' : 'rate', etoiles, score, !reussi, horloge()]);
        const jour = jourDe(horloge());
        const out = { fleuve: e.fleuve, numero: e.numero, reussi, parti, etoiles, score, seuils: rec.seuils || null, objectif: rec.objectif, texte: texteObjectif(rec.objectif), pieces: 0, double: false, escale: estEscale(e.numero), ville: villeDeLEtape(e.fleuve, e.numero), resultat: resultat || null };
        if (!reussi) {
          await q.query('INSERT INTO fleuve_pagaies (compte_id, jour, perdues) VALUES ($1, $2, 1) ON CONFLICT (compte_id, jour) DO UPDATE SET perdues = fleuve_pagaies.perdues + 1', [compteId, jour]);
        } else {
          const avant = (await q.query('SELECT etoiles FROM fleuve_etoiles WHERE compte_id = $1 AND fleuve = $2 AND numero = $3', [compteId, e.fleuve, e.numero])).rows[0];
          const etoilesAvant = avant ? avant.etoiles : 0;
          out.etoilesAvant = etoilesAvant;
          out.premiereFois = !avant;
          if (etoiles > etoilesAvant) {
            await q.query(`INSERT INTO fleuve_etoiles (compte_id, fleuve, numero, etoiles, score, reussie_le) VALUES ($1, $2, $3, $4, $5, now())
              ON CONFLICT (compte_id, fleuve, numero) DO UPDATE SET etoiles = EXCLUDED.etoiles, score = greatest(fleuve_etoiles.score, EXCLUDED.score), maj_le = now()`, [compteId, e.fleuve, e.numero, etoiles, score]);
          }
          // Pièces : 5 par étoile gagnée pour la première fois, doublées pour la première étape réussie du jour ;
          // 200 à la première victoire sur le boss d'une ville (escale).
          const nouvelles = Math.max(0, etoiles - etoilesAvant);
          const deja = (await q.query("SELECT count(*)::int AS n FROM fleuve_essais WHERE compte_id = $1 AND statut = 'reussi' AND id <> $2 AND debut >= $3", [compteId, e.id, debutDu(jour)])).rows[0].n;
          out.double = deja === 0;
          let pieces = nouvelles * Math.max(0, Number(c.piecesEtoile) || 0) * (out.double ? 2 : 1);
          if (out.escale && !avant) { out.piecesEscale = Math.max(0, Number(c.piecesEscale) || 0); pieces += out.piecesEscale; }
          out.pieces = pieces;
          if (pieces > 0) out.solde = await comptes.mouvement(q, compteId, pieces, 'fleuve', `${e.fleuve}:${e.numero}`);
          out.nouvelles = nouvelles;
          if (nouvelles > 0) await q.query('UPDATE fleuve_essais SET nouvelles = $2 WHERE id = $1', [e.id, nouvelles]);
          out.biefTermine = !avant && e.numero % G.ETAPES_PAR_BIEF === 0;
          if (!avant) Object.assign(out, await apresReussite(q, compteId, e.fleuve, e.numero));
        }
        out.pagaies = await pagaiesDe(compteId, q);
        return out;
      }).then((out) => {
        // Alertes envoyées après l'enregistrement, sans faire attendre le joueur.
        if (out.depasses && out.depasses.length) prevenirDepasses(compteId, out.fleuve, out.numero, out.depasses).catch((e) => console.error('Fleuve :', e.message));
        if (out.depasses) out.depasses = out.depasses.map((a) => a.pseudo);
        return out;
      });
    },

    // --- Le lancement (fleuve.md « La fermeture de la Bande ») : un seul bouton de l'admin, une seule fois.
    // La semaine de Bande en cours est annulée et chaque mise rendue (« Bande fermée : mise rendue »), plus personne
    // ne peut miser ; le Match du jour s'arrête ; le Fleuve s'ouvre à tous et la fenêtre « Nouveau » s'allume.
    async lancer() {
      if (cfg().lance) throw erreur('Le Fleuve est déjà lancé.', 409);
      const quand = horloge();
      const semaines = (await base.query("SELECT bande_id, to_char(semaine, 'YYYY-MM-DD') AS semaine FROM bande_semaines WHERE statut = 'ouverte'")).rows;
      const rendus = new Map();
      for (const s of semaines) {
        const l = await base.transaction(async (q) => {
          const x = (await q.query("SELECT 1 FROM bande_semaines WHERE bande_id = $1 AND semaine = $2 AND statut = 'ouverte' FOR UPDATE", [s.bande_id, s.semaine])).rows[0];
          if (!x) return [];
          const ins = (await q.query('SELECT compte_id, mise FROM bande_inscriptions WHERE bande_id = $1 AND semaine = $2', [s.bande_id, s.semaine])).rows;
          for (const i of ins) await comptes.mouvement(q, i.compte_id, i.mise, 'fermeture_bande', `bande:${s.bande_id}:${s.semaine}`);
          await q.query("UPDATE bande_semaines SET statut = 'annulee', cloturee_le = now(), resultat = $3 WHERE bande_id = $1 AND semaine = $2", [s.bande_id, s.semaine, JSON.stringify({ annulee: true, fermeture: true, inscrits: ins.map((i) => i.compte_id) })]);
          return ins;
        });
        for (const i of l) rendus.set(i.compte_id, (rendus.get(i.compte_id) || 0) + i.mise);
      }
      await reglages.ecrire('bande', { ...(reglages.get('bande') || {}), actif: false });
      await reglages.ecrire('matchJour', { ...(reglages.get('matchJour') || {}), actif: false });
      await reglages.ecrire('fleuve', { ...cfg(), etat: 'ouvert', lance: quand.toISOString() });
      if (social) for (const [id, n] of rendus) {
        await social.notifier(id, 'bande', `La Bande laisse la place au Fleuve. Ta mise de la semaine t'a été rendue : +${n} pièces.`, { fermeture: true, pieces: n }).catch(() => {});
      }
      return { ok: true, lance: quand.toISOString(), semaines: semaines.length, joueurs: rendus.size, pieces: [...rendus.values()].reduce((a, b) => a + b, 0) };
    },

    // --- Course de la semaine (du lundi au dimanche minuit, heure de Kinshasa), sur chaque fleuve.
    // Chaque joueur court contre ses amis : il gagne s'il a le plus d'étoiles nouvelles de la semaine parmi eux
    // (ex æquo : tous gagnent), avec au moins 1 étoile et au moins un ami qui a aussi gagné des étoiles cette semaine.
    // Prix offert par le jeu (piecesCourse, 300 au départ) et marque « Pagayeur de la semaine » pendant 7 jours.
    async reglerCourses() {
      if ((cfg().etat || 'ferme') === 'ferme') return [];
      const lundi = lundiDe(jourDe(horloge())), semaine = ajouterJours(lundi, -7);
      if (coursesReglees === semaine) return [];
      const debut = debutDu(semaine), fin = debutDu(lundi), jusqu = debutDu(ajouterJours(lundi, 7));
      const faits = [];
      for (const fleuve of Object.keys(G.FLEUVES)) {
        const r = await base.transaction(async (q) => {
          const neuf = (await q.query('INSERT INTO fleuve_courses (fleuve, semaine) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING fleuve', [fleuve, semaine])).rows.length;
          if (!neuf) return null; // déjà réglée
          const scores = new Map((await q.query(`SELECT compte_id, sum(nouvelles)::int AS n FROM fleuve_essais
            WHERE fleuve = $1 AND statut = 'reussi' AND debut >= $2 AND debut < $3 GROUP BY compte_id HAVING sum(nouvelles) > 0`, [fleuve, debut, fin])).rows.map((x) => [x.compte_id, x.n]));
          if (!scores.size) return { fleuve, gagnants: [] };
          const liens = (await q.query(`SELECT a.compte_id, a.ami_id FROM amis a JOIN comptes c ON c.id = a.compte_id
            WHERE a.compte_id = ANY($1) AND a.ami_id = ANY($1) AND c.statut NOT IN ('supprime', 'banni')
              AND NOT EXISTS (SELECT 1 FROM blocages b WHERE (b.compte_id = a.compte_id AND b.bloque_id = a.ami_id) OR (b.compte_id = a.ami_id AND b.bloque_id = a.compte_id))`, [[...scores.keys()]])).rows;
          const rivaux = new Map();
          for (const l of liens) { if (!rivaux.has(l.compte_id)) rivaux.set(l.compte_id, []); rivaux.get(l.compte_id).push(l.ami_id); }
          const prix = piecesCourse(), gagnants = [];
          for (const [id, n] of scores) {
            const autres = rivaux.get(id) || [];
            if (!autres.length || autres.some((a) => scores.get(a) > n)) continue;
            gagnants.push({ id, etoiles: n });
            await q.query(`INSERT INTO fleuve_marques (compte_id, fleuve, type, cle, texte, jusqu, cree_le) VALUES ($1, $2, 'pagayeur', $3, 'Pagayeur de la semaine', $4, $5) ON CONFLICT DO NOTHING`, [id, fleuve, semaine, jusqu, horloge()]);
            if (prix > 0) await comptes.mouvement(q, id, prix, 'fleuve', `course:${fleuve}:${semaine}`);
          }
          await q.query('UPDATE fleuve_courses SET gagnants = $3, pieces = $4 WHERE fleuve = $1 AND semaine = $2', [fleuve, semaine, gagnants.length, prix * gagnants.length]);
          return { fleuve, gagnants, prix };
        });
        if (!r) continue;
        faits.push(r);
        if (social) for (const g of r.gagnants) {
          await social.notifier(g.id, 'fleuve', `Tu es le Pagayeur de la semaine sur ${leF(fleuve)} : ${g.etoiles} étoile${g.etoiles > 1 ? 's' : ''} gagnée${g.etoiles > 1 ? 's' : ''}${r.prix ? `, +${r.prix} pièces` : ''} !`, { course: true, fleuve, semaine, pieces: r.prix }).catch(() => {});
        }
      }
      coursesReglees = semaine;
      return faits;
    },
    // Chaque minute (index.js) : la course de la semaine passée est réglée dès lundi minuit.
    async tic() { return api.reglerCourses(); },

    // --- Admin : biefs, étapes, fabrication, publication, chiffres réels.
    async resumeAdmin() {
      const out = { reglages: cfg(), recette: recette(), fleuves: {}, travaux: Object.fromEntries(travaux),
        courses: (await base.query('SELECT fleuve, semaine, gagnants, pieces FROM fleuve_courses ORDER BY semaine DESC, fleuve LIMIT 8')).rows };
      for (const fleuve of Object.keys(G.FLEUVES)) {
        const biefs = (await base.query(`SELECT bief, count(*)::int AS etapes, bool_and(publie) AS publie, count(*) FILTER (WHERE publie)::int AS publiees
          FROM fleuve_etapes WHERE fleuve = $1 GROUP BY bief ORDER BY bief`, [fleuve])).rows;
        const meilleur = (await base.query("SELECT coalesce(max(numero), 0)::int AS n FROM fleuve_etoiles WHERE fleuve = $1", [fleuve])).rows[0].n;
        const joueurs = (await base.query("SELECT count(DISTINCT compte_id)::int AS n FROM fleuve_essais WHERE fleuve = $1 AND debut > now() - interval '7 days'", [fleuve])).rows[0].n;
        const publie = biefs.filter((b) => b.publie).length;
        out.fleuves[fleuve] = { nom: NOMS[fleuve], jeu: G.FLEUVES[fleuve], etat: etatDuFleuve(fleuve), villes: VILLES[fleuve].length, biefs, meilleur, biefMeilleur: meilleur ? biefDe(meilleur) : 0, joueurs7j: joueurs, avance: publie - (meilleur ? biefDe(meilleur) : 0), alerte: publie - (meilleur ? biefDe(meilleur) : 0) < 2 };
      }
      return out;
    },

    // Étapes d'un bief, avec les chiffres réels de chaque étape.
    async etapesAdmin(fleuve, bief) {
      if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
      bief = Math.trunc(Number(bief));
      const r = await base.query(`SELECT e.numero, e.recette, e.publie, e.version,
          (SELECT count(*)::int FROM fleuve_essais x WHERE x.fleuve = e.fleuve AND x.numero = e.numero AND x.statut <> 'en_cours') AS essais,
          (SELECT count(*)::int FROM fleuve_essais x WHERE x.fleuve = e.fleuve AND x.numero = e.numero AND x.pagaie) AS pagaies,
          (SELECT count(DISTINCT compte_id)::int FROM fleuve_essais x WHERE x.fleuve = e.fleuve AND x.numero = e.numero) AS joueurs,
          (SELECT count(*)::int FROM fleuve_etoiles x WHERE x.fleuve = e.fleuve AND x.numero = e.numero) AS reussis
        FROM fleuve_etapes e WHERE e.fleuve = $1 AND e.bief = $2 ORDER BY e.numero`, [fleuve, bief]);
      // Réussite au premier essai : parmi les joueurs qui ont tenté l'étape, part de ceux dont le premier essai a réussi.
      const premiers = (await base.query(`SELECT numero, count(*)::int AS n, count(*) FILTER (WHERE statut = 'reussi')::int AS ok FROM (
          SELECT DISTINCT ON (compte_id, numero) compte_id, numero, statut FROM fleuve_essais WHERE fleuve = $1 AND numero BETWEEN $2 AND $3 AND statut <> 'en_cours' ORDER BY compte_id, numero, id) t GROUP BY numero`,
        [fleuve, (bief - 1) * G.ETAPES_PAR_BIEF + 1, bief * G.ETAPES_PAR_BIEF])).rows;
      const p1 = new Map(premiers.map((x) => [x.numero, x]));
      return r.rows.map((x) => {
        const rec = recetteDe(x), p = p1.get(x.numero);
        const premier = p && p.n ? Math.round((100 * p.ok) / p.n) : null;
        return { ...publicEtape(fleuve, rec, x.version), d: rec.d, note: rec.note, vise: rec.vise, taux: rec.taux, horsCible: rec.horsCible, publie: x.publie,
          chiffres: { essais: x.essais, pagaies: x.pagaies, joueurs: x.joueurs, reussis: x.reussis, premier, bloque: premier !== null && p.n >= 5 && premier < Math.max(5, (rec.vise || 50) - 30) } };
      });
    },

    // Fabrique (ou refait) toutes les étapes pas encore publiées d'un bief, en tâche de fond.
    generer(fleuve, bief) {
      if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
      bief = Math.trunc(Number(bief));
      if (!(bief >= 1 && bief <= 200)) throw erreur('Bief invalide.');
      const cle = fleuve + ':' + bief;
      if (travaux.has(cle) && !travaux.get(cle).fini) throw erreur('Ce bief est déjà en fabrication.', 409);
      const t = { fait: 0, total: G.ETAPES_PAR_BIEF, fini: false, erreur: null, debut: new Date().toISOString() };
      travaux.set(cle, t);
      (async () => {
        const prec = (await base.query('SELECT bief, publie FROM fleuve_etapes WHERE fleuve = $1 AND bief = $2 - 1 LIMIT 1', [fleuve, bief])).rows[0];
        if (bief > 1 && !prec) throw erreur(`Fabrique d'abord le bief ${bief - 1}.`);
        const deja = new Map((await base.query('SELECT numero, publie FROM fleuve_etapes WHERE fleuve = $1 AND bief = $2', [fleuve, bief])).rows.map((x) => [x.numero, x.publie]));
        const familles = (await base.query('SELECT recette FROM fleuve_etapes WHERE fleuve = $1 AND numero BETWEEN $2 AND $3 ORDER BY numero', [fleuve, (bief - 1) * G.ETAPES_PAR_BIEF - 9, (bief - 1) * G.ETAPES_PAR_BIEF])).rows.map((x) => recetteDe(x).famille);
        const rec = recette();
        for (let n = (bief - 1) * G.ETAPES_PAR_BIEF + 1; n <= bief * G.ETAPES_PAR_BIEF; n++) {
          if (deja.get(n) === true) { const x = (await base.query('SELECT recette FROM fleuve_etapes WHERE fleuve = $1 AND numero = $2', [fleuve, n])).rows[0]; familles.push(recetteDe(x).famille); t.fait++; continue; }
          const e = await G.fabriquerEtape(fleuve, n, { recette: rec, familles });
          familles.push(e.famille);
          await ecrireEtape(fleuve, e);
          t.fait++;
        }
      })().catch((e) => { t.erreur = e.message; console.error('Fleuve, fabrication :', e.message); }).finally(() => { t.fini = true; t.finLe = new Date().toISOString(); });
      return t;
    },

    // Refait une seule étape (pas encore publiée, ou publiée : la nouvelle version ne touche que ceux qui ne l'ont pas réussie).
    async refaire(fleuve, numero) {
      const x = await lireEtape(fleuve, numero);
      const familles = (await base.query('SELECT recette FROM fleuve_etapes WHERE fleuve = $1 AND numero BETWEEN $2 AND $3 ORDER BY numero', [fleuve, numero - 9, numero - 1])).rows.map((r) => recetteDe(r).famille);
      const e = await G.fabriquerEtape(fleuve, numero, { recette: recette(), familles });
      await ecrireEtape(fleuve, e, x.publie);
      return (await api.etapesAdmin(fleuve, biefDe(numero))).find((y) => y.numero === numero);
    },

    // Change la force des robots d'une étape (d : 1 à 60) ; les seuils d'étoiles sont recalculés par les essais.
    async modifier(fleuve, numero, { d }) {
      const x = await lireEtape(fleuve, numero);
      d = Math.trunc(Number(d));
      if (!(d >= 1 && d <= 60)) throw erreur('Force des robots entre 1 et 60.');
      const rec = recette();
      const e = { ...recetteDe(x), d, testeur: rec.testeur };
      const l = await G.essais(e, rec.simulations, (e.graine ^ 0x27d4eb2d) >>> 0);
      const taux = Math.round((100 * l.filter((r) => r.reussi).length) / Math.max(1, l.length));
      await ecrireEtape(fleuve, { ...e, ...G.niveauDe(d), taux, seuils: G.seuilsDe(l, rec), horsCible: Math.abs(taux - (e.vise || taux)) > rec.tolerance, modifie: true }, x.publie);
      return (await api.etapesAdmin(fleuve, biefDe(numero))).find((y) => y.numero === numero);
    },

    // Publie un bief complet (50 étapes), après le bief d'avant.
    async publier(fleuve, bief) {
      if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
      bief = Math.trunc(Number(bief));
      const n = (await base.query('SELECT count(*)::int AS n FROM fleuve_etapes WHERE fleuve = $1 AND bief = $2', [fleuve, bief])).rows[0].n;
      if (n < G.ETAPES_PAR_BIEF) throw erreur(`Le bief ${bief} n'a que ${n} étapes sur ${G.ETAPES_PAR_BIEF} : fabrique-le d'abord.`);
      if (bief > 1) {
        const p = (await base.query('SELECT bool_and(publie) AS p FROM fleuve_etapes WHERE fleuve = $1 AND bief = $2', [fleuve, bief - 1])).rows[0].p;
        if (!p) throw erreur(`Publie d'abord le bief ${bief - 1}.`);
      }
      const t = travaux.get(fleuve + ':' + bief);
      if (t && !t.fini) throw erreur('Ce bief est encore en fabrication.', 409);
      await base.query('UPDATE fleuve_etapes SET publie = true, maj_le = now() WHERE fleuve = $1 AND bief = $2', [fleuve, bief]);
      return { ok: true };
    },
  };

  function recetteDe(row) { const r = row.recette; return typeof r === 'string' ? JSON.parse(r) : r; }
  async function lireEtape(fleuve, numero) {
    if (!G.FLEUVES[fleuve]) throw erreur('Fleuve inconnu.');
    const x = (await base.query('SELECT recette, publie, version FROM fleuve_etapes WHERE fleuve = $1 AND numero = $2', [fleuve, Math.trunc(Number(numero))])).rows[0];
    if (!x) throw erreur('Étape inconnue.', 404);
    return x;
  }
  // Une étape réécrite garde sa publication ; sa version monte (les essais gardent la version jouée).
  async function ecrireEtape(fleuve, e, publie = false) {
    const { testeur, ...rec } = e;
    await base.query(`INSERT INTO fleuve_etapes (fleuve, numero, bief, recette, publie) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (fleuve, numero) DO UPDATE SET recette = EXCLUDED.recette, version = fleuve_etapes.version + 1, maj_le = now()`,
    [fleuve, e.numero, biefDe(e.numero), JSON.stringify(rec), !!publie]);
  }
  return api;
}

module.exports = { creerFleuve, VILLES, villeDe, NOMS, ETATS_DEFAUT };
