// La Bande (competition-amis.md v1.3, validé le 2/11) : un groupe de 2 à 20 amis qui mise chaque semaine
// sur ses Matchs du jour. Le meilleur de la semaine (le Chef) gagne le pot, moins la part de la maison.
// Seul le serveur tient les mises, les scores et le partage : le téléphone ne fait qu'afficher.
'use strict';
const crypto = require('crypto');
const { jourDe, debutDu, ajouterJours, lundiDe } = require('./match-jour');

const HEURE = 36e5;
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const erreur = (m, statut = 400) => Object.assign(new Error(m), { statut });
const nouveauCode = () => Array.from(crypto.randomBytes(6), (b) => LETTRES[b % LETTRES.length]).join('');
const nettoyerNom = (n) => String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const joursDe = (lundi) => [0, 1, 2, 3, 4, 5, 6].map((i) => ajouterJours(lundi, i));
// Dernier moment pour miser : mercredi 23 h (heure de Kinshasa). Fin de la semaine : lundi suivant à minuit.
const limiteInscription = (lundi) => new Date(debutDu(ajouterJours(lundi, 2)).getTime() + 23 * HEURE);
const finSemaine = (lundi) => debutDu(ajouterJours(lundi, 7));

// Classement d'une semaine et partage du pot (fonction pure, testée seule).
// inscrits : [{ id, pseudo, mise, inscritLe }] ; scores : [{ compte_id, jour, score, statut, debut }]
// r : réglages de la Bande ; maintenant : pour distinguer les jours à venir ; final : partage du pot.
//  - Un jour avant l'inscription (ou un Match commencé avant de miser) compte la pire note des inscrits
//    qui l'ont joué ce jour-là, moins r.penaliteRetard (jamais sous 0). Il compte comme joué.
//  - Il faut r.matchsMin jours joués sur 7 (et, avec des jours comptés en retard, tous les autres) :
//    sinon la mise est détruite, sans aller au Chef.
//  - Pot = mises des joueurs en règle. La maison en retire r.maison %. Le 2e récupère sa mise (à 3 joueurs
//    en règle ou plus, et un seul Chef ; plusieurs 2es se partagent une mise). Le Chef gagne le reste
//    (plusieurs Chefs à égalité : ils se partagent le pot, sans 2e remboursé).
//  - Le Loser est le dernier des inscrits (hors Chefs).
function classerSemaine({ lundi, inscrits, scores, r, maintenant = new Date(), final = false }) {
  const jours = joursDe(lundi), aujourdhui = jourDe(maintenant);
  const parCle = new Map(scores.map((s) => [s.compte_id + '|' + s.jour, s]));
  const avantInscription = (i, jour) => {
    if (jour < jourDe(i.inscritLe)) return true;
    const s = parCle.get(i.id + '|' + jour);
    return !!(s && s.debut && new Date(s.debut) < new Date(i.inscritLe));
  };
  const pire = new Map();
  for (const jour of jours) {
    const notes = inscrits.filter((i) => !avantInscription(i, jour)).map((i) => parCle.get(i.id + '|' + jour)).filter(Boolean).map((s) => s.score);
    pire.set(jour, notes.length ? Math.min(...notes) : 0);
  }
  const lignes = inscrits.map((i) => {
    let total = 0, joues = 0, rates = 0, retard = 0;
    const detail = jours.map((jour) => {
      if (avantInscription(i, jour)) {
        if (jour > aujourdhui && !final) return { jour, type: 'avenir', score: null };
        const v = Math.max(0, pire.get(jour) - r.penaliteRetard);
        total += v; joues++; retard++;
        return { jour, type: 'retard', score: v };
      }
      const s = parCle.get(i.id + '|' + jour);
      if (s) { total += s.score; joues++; return { jour, type: s.statut === 'fini' ? 'joue' : 'en_cours', score: s.score }; }
      if (!final && jour >= aujourdhui) return { jour, type: jour === aujourdhui ? 'attente' : 'avenir', score: null };
      rates++;
      return { jour, type: 'rate', score: 0 };
    });
    // En règle : assez de Matchs, et aucun raté pour qui a des jours comptés en retard.
    const possibles = 7 - rates;
    const enRegle = possibles >= r.matchsMin && !(retard > 0 && rates > 0);
    return { id: i.id, pseudo: i.pseudo, avatar: i.avatar || null, mise: i.mise, total, joues, rates, retard, jours: detail, enRegle: final ? enRegle && joues >= r.matchsMin : enRegle };
  });
  lignes.sort((a, b) => b.total - a.total || Number(b.enRegle) - Number(a.enRegle) || a.pseudo.localeCompare(b.pseudo));
  let rang = 0, avant = null;
  lignes.forEach((l, k) => { if (l.total !== avant) { rang = k + 1; avant = l.total; } l.rang = rang; });

  const regle = lignes.filter((l) => l.enRegle);
  const res = { lignes, chefs: [], deuxiemes: [], losers: [], pot: 0, maison: 0, detruit: 0, gains: {}, rendus: {} };
  res.pot = regle.reduce((t, l) => t + l.mise, 0);
  if (regle.length) {
    const haut = regle[0].total;
    res.chefs = regle.filter((l) => l.total === haut).map((l) => l.id);
    const suite = regle.filter((l) => l.total < haut);
    if (regle.length === 1) { res.rendus[regle[0].id] = regle[0].mise; } // seul en règle : il récupère sa mise
    else {
      res.maison = Math.floor((res.pot * r.maison) / 100);
      let reste = res.pot - res.maison;
      if (regle.length >= 3 && res.chefs.length === 1 && suite.length) { // plusieurs Chefs : pas de 2e remboursé
        const deux = suite.filter((l) => l.total === suite[0].total);
        res.deuxiemes = deux.map((l) => l.id);
        const rendu = Math.min(...deux.map((l) => l.mise)); // une mise, partagée entre les 2es à égalité
        for (const l of deux) res.rendus[l.id] = Math.floor(rendu / deux.length);
        reste -= deux.reduce((t, l) => t + res.rendus[l.id], 0);
      }
      for (const id of res.chefs) res.gains[id] = Math.floor(reste / res.chefs.length);
    }
  }
  // Loser : le dernier des inscrits, sauf si tout le monde est à égalité avec le Chef.
  const bas = lignes.length >= 2 ? lignes[lignes.length - 1].total : null;
  if (bas !== null) res.losers = lignes.filter((l) => l.total === bas && !res.chefs.includes(l.id)).map((l) => l.id);
  const verse = Object.values(res.gains).concat(Object.values(res.rendus)).reduce((t, n) => t + n, 0);
  res.detruit = inscrits.reduce((t, i) => t + i.mise, 0) - verse;
  for (const l of lignes) l.gain = (res.gains[l.id] || 0) + (res.rendus[l.id] || 0);
  return res;
}

// Ce que le Chef gagnerait si tous les inscrits restaient en règle (affiché « À gagner »).
function aGagner(n, mise, r) {
  if (n < 2) return 0;
  const pot = n * mise, maison = Math.floor((pot * r.maison) / 100);
  return pot - maison - (n >= 3 ? mise : 0);
}

function creerBande(base, reglages, comptes, matchJour, social) {
  const cfg = () => reglages.get('bande');
  const maintenant = () => matchJour.maintenant();
  const rappels = new Set(); // jours où le rappel du soir est déjà parti (en plus de la vérification en base)
  const autos = new Set(); // lundis où les mises automatiques sont faites

  async function bandeDe(id, q = base) {
    const b = (await q.query('SELECT * FROM bandes WHERE id = $1', [id])).rows[0];
    if (!b) throw erreur('Bande introuvable.', 404);
    return b;
  }
  const estMembre = async (bandeId, compteId, q = base) => (await q.query('SELECT 1 FROM bande_membres WHERE bande_id = $1 AND compte_id = $2', [bandeId, compteId])).rows.length > 0;
  const nbBandes = async (compteId, q = base) => (await q.query('SELECT count(*)::int AS n FROM bande_membres WHERE compte_id = $1', [compteId])).rows[0].n;
  const nbMembres = async (bandeId, q = base) => (await q.query('SELECT count(*)::int AS n FROM bande_membres WHERE bande_id = $1', [bandeId])).rows[0].n;

  function verifierGoogle(compte) { if (!compte.auth_id) throw erreur('Connecte-toi avec Google pour entrer dans une Bande.', 403); }
  function verifierActif() { if (!cfg().actif) throw erreur('Les Bandes sont en pause. Reviens bientôt !'); }
  function verifierMise(m) {
    const n = Math.trunc(Number(m)), r = cfg();
    if (!(n >= r.miseMin && n <= r.miseMax)) throw erreur(`La mise va de ${r.miseMin} à ${r.miseMax} pièces.`);
    return n;
  }
  async function placeLibre(compte, bandeId, q = base) {
    const r = cfg();
    if ((await nbBandes(compte.id, q)) >= r.bandesMax) throw erreur(`Tu es déjà dans ${r.bandesMax} Bandes : c'est le maximum.`);
    if (bandeId && (await nbMembres(bandeId, q)) >= r.membresMax) throw erreur(`Cette Bande est complète (${r.membresMax} membres).`);
  }

  // Peut-il miser ? (compte Google assez ancien, assez de parties contre des humains)
  async function conditions(compte) {
    const r = cfg(), manque = [];
    if (!compte.auth_id) manque.push('se connecter avec Google');
    const age = (maintenant() - new Date(compte.cree_le)) / 864e5;
    if (r.joursCompte > 0 && age < r.joursCompte) manque.push(`un compte de ${r.joursCompte} jours au moins (encore ${Math.ceil(r.joursCompte - age)} j)`);
    const parties = (await base.query('SELECT count(*)::int AS n FROM participations pa JOIN parties p ON p.id = pa.partie_id WHERE pa.compte_id = $1 AND NOT p.avec_robots AND NOT pa.abandon', [compte.id])).rows[0].n;
    if (parties < r.partiesMin) manque.push(`${r.partiesMin} parties jouées contre des joueurs (tu en as ${parties})`);
    return { ok: !manque.length, manque, parties };
  }

  async function inscrits(bandeId, lundi, q = base) {
    return (await q.query(`SELECT i.compte_id AS id, c.pseudo, c.avatar, i.mise, i.inscrit_le AS "inscritLe"
      FROM bande_inscriptions i JOIN comptes c ON c.id = i.compte_id WHERE i.bande_id = $1 AND i.semaine = $2 ORDER BY i.inscrit_le`, [bandeId, lundi])).rows;
  }
  async function calculer(bandeId, lundi, { final = false, q = base } = {}) {
    const ins = await inscrits(bandeId, lundi, q);
    const scores = await matchJour.scores(ins.map((i) => i.id), joursDe(lundi), q);
    return { inscrits: ins, ...classerSemaine({ lundi, inscrits: ins, scores, r: cfg(), maintenant: maintenant(), final }) };
  }

  // Chef(s) et Loser(s) de la dernière semaine finie : couronne et cadre pendant toute la semaine suivante.
  async function titres(bandeId) {
    const s = (await base.query("SELECT to_char(semaine, 'YYYY-MM-DD') AS semaine, resultat FROM bande_semaines WHERE bande_id = $1 AND statut = 'cloturee' ORDER BY semaine DESC LIMIT 1", [bandeId])).rows[0];
    if (!s || !s.resultat) return { chefs: [], losers: [], semaine: null };
    const res = typeof s.resultat === 'string' ? JSON.parse(s.resultat) : s.resultat;
    const nom = (id) => (res.lignes.find((l) => l.id === id) || {}).pseudo || '?';
    return { semaine: s.semaine,
      chefs: res.chefs.map((id) => ({ id, pseudo: nom(id) })), losers: res.losers.map((id) => ({ id, pseudo: nom(id) })), serie: await serieChef(bandeId, res.chefs),
      pot: res.pot, maison: res.maison, deuxiemes: res.deuxiemes,
      classement: res.lignes.map((l) => ({ id: l.id, pseudo: l.pseudo, rang: l.rang, total: l.total, enRegle: l.enRegle, gain: l.gain })) };
  }
  // « Chef : Kevin (2e semaine d'affilée) »
  async function serieChef(bandeId, chefs) {
    if (chefs.length !== 1) return 1;
    const l = (await base.query("SELECT resultat FROM bande_semaines WHERE bande_id = $1 AND statut = 'cloturee' ORDER BY semaine DESC LIMIT 12", [bandeId])).rows;
    let n = 0;
    for (const x of l) { const res = typeof x.resultat === 'string' ? JSON.parse(x.resultat) : x.resultat; if (res && res.chefs.includes(chefs[0])) n++; else break; }
    return n;
  }

  // Clôture d'une semaine : partage du pot (ou mises rendues si moins de 2 inscrits). Une seule fois.
  async function cloturer(bandeId, lundi) {
    const r = cfg();
    const fait = await base.transaction(async (q) => {
      const s = (await q.query("SELECT * FROM bande_semaines WHERE bande_id = $1 AND semaine = $2 AND statut = 'ouverte' FOR UPDATE", [bandeId, lundi])).rows[0];
      if (!s) return null;
      const ref = `bande:${bandeId}:${lundi}`;
      const ins = await inscrits(bandeId, lundi, q);
      if (ins.length < r.inscritsMin) {
        for (const i of ins) await comptes.mouvement(q, i.id, i.mise, 'remboursement_bande', ref);
        await q.query("UPDATE bande_semaines SET statut = 'annulee', cloturee_le = now(), resultat = $3 WHERE bande_id = $1 AND semaine = $2", [bandeId, lundi, JSON.stringify({ annulee: true, inscrits: ins.map((i) => i.id) })]);
        return { annulee: true, inscrits: ins };
      }
      const scores = await matchJour.scores(ins.map((i) => i.id), joursDe(lundi), q);
      const res = classerSemaine({ lundi, inscrits: ins, scores, r, maintenant: maintenant(), final: true });
      for (const [id, n] of Object.entries(res.gains)) if (n > 0) await comptes.mouvement(q, id, n, 'pot_bande', ref);
      for (const [id, n] of Object.entries(res.rendus)) if (n > 0) await comptes.mouvement(q, id, n, 'mise_rendue_bande', ref);
      await q.query("UPDATE bande_semaines SET statut = 'cloturee', cloturee_le = now(), resultat = $3 WHERE bande_id = $1 AND semaine = $2", [bandeId, lundi, JSON.stringify(res)]);
      return { res, inscrits: ins };
    });
    if (!fait || !social) return fait;
    const b = await bandeDe(bandeId).catch(() => null);
    const nom = b ? b.nom : 'ta Bande';
    if (fait.annulee) {
      for (const i of fait.inscrits) await social.notifier(i.id, 'bande', `Pas assez d'inscrits dans « ${nom} » cette semaine : ta mise est rendue.`, { bande: bandeId }).catch(() => {});
      return fait;
    }
    const { res } = fait;
    const chefs = res.chefs.map((id) => res.lignes.find((l) => l.id === id).pseudo).join(' et ');
    for (const l of res.lignes) {
      let t = res.chefs.includes(l.id) ? `👑 Tu es le Chef de « ${nom} » et tu gagnes ${l.gain} pièces !`
        : `Semaine terminée dans « ${nom} » : ${chefs || 'personne'} ${res.chefs.length > 1 ? 'sont les Chefs' : 'est le Chef'}.`;
      if (res.deuxiemes.includes(l.id)) t += ` Tu es 2e : tu récupères ${l.gain} pièces.`;
      else if (!l.enRegle) t += ` Moins de ${r.matchsMin} Matchs joués : ta mise est perdue.`;
      if (res.losers.includes(l.id)) t += ' Tu es le Loser de la semaine 🤡';
      await social.notifier(l.id, 'bande', t, { bande: bandeId, semaine: lundi }).catch(() => {});
    }
    return fait;
  }

  async function inscrire(compte, bandeId, { auto = false } = {}) {
    verifierActif();
    const r = cfg(), now = maintenant(), lundi = lundiDe(jourDe(now));
    if (!(await estMembre(bandeId, compte.id))) throw erreur('Tu ne fais pas partie de cette Bande.', 403);
    if (now >= limiteInscription(lundi)) throw erreur('Les inscriptions sont fermées depuis mercredi 23 h. Rendez-vous lundi !');
    const c = await conditions(compte);
    if (!c.ok) throw erreur('Pour miser, il te faut : ' + c.manque.join(', ') + '.', 403);
    return base.transaction(async (q) => {
      const b = await bandeDe(bandeId, q);
      await q.query('INSERT INTO bande_semaines (bande_id, semaine, mise) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [bandeId, lundi, b.mise]);
      const s = (await q.query('SELECT * FROM bande_semaines WHERE bande_id = $1 AND semaine = $2 FOR UPDATE', [bandeId, lundi])).rows[0];
      if (s.statut !== 'ouverte') throw erreur('Cette semaine est déjà terminée.');
      const n = (await q.query('SELECT count(*)::int AS n FROM bande_inscriptions WHERE bande_id = $1 AND semaine = $2', [bandeId, lundi])).rows[0].n;
      if (n >= r.membresMax) throw erreur(`Déjà ${r.membresMax} inscrits cette semaine.`);
      const deja = await q.query('INSERT INTO bande_inscriptions (bande_id, semaine, compte_id, mise) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING 1', [bandeId, lundi, compte.id, s.mise]);
      if (!deja.rows.length) throw erreur('Tu as déjà misé cette semaine.');
      const solde = await comptes.mouvement(q, compte.id, -s.mise, 'mise_bande', `bande:${bandeId}:${lundi}`)
        .catch(() => { throw erreur(`Il te faut ${s.mise} pièces pour miser.`); });
      return { ok: true, mise: s.mise, solde, auto };
    });
  }

  const api = {
    classerSemaine, aGagner, limiteInscription, finSemaine, conditions, cloturer,

    async creer(compte, { nom, mise, ouverte = false, pays = null } = {}) {
      verifierActif(); verifierGoogle(compte);
      const n = nettoyerNom(nom);
      if (n.length < 3) throw erreur('Le nom de la Bande fait au moins 3 caractères.');
      const m = verifierMise(mise === undefined ? cfg().miseMin : mise);
      const p = pays && /^[A-Z]{2}$/.test(String(pays).toUpperCase()) ? String(pays).toUpperCase() : compte.pays || null;
      const id = 'b_' + crypto.randomBytes(9).toString('base64url');
      await base.transaction(async (q) => {
        await placeLibre(compte, null, q);
        for (let k = 0; ; k++) {
          const ok = await q.query('INSERT INTO bandes (id, nom, code, createur, mise, ouverte, pays) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING RETURNING id', [id, n, nouveauCode(), compte.id, m, !!ouverte, p]);
          if (ok.rows.length) break;
          if (k > 5) throw erreur('Réessaie dans un instant.', 500);
        }
        await q.query('INSERT INTO bande_membres (bande_id, compte_id) VALUES ($1, $2)', [id, compte.id]);
      });
      return api.etat(compte, id);
    },

    async modifier(compte, bandeId, { nom, mise, ouverte, pays } = {}) {
      const b = await bandeDe(bandeId);
      if (b.createur !== compte.id) throw erreur('Seul le créateur de la Bande peut la modifier.', 403);
      if (nom !== undefined) { const n = nettoyerNom(nom); if (n.length < 3) throw erreur('Le nom de la Bande fait au moins 3 caractères.'); await base.query('UPDATE bandes SET nom = $2 WHERE id = $1', [bandeId, n]); }
      if (mise !== undefined) await base.query('UPDATE bandes SET mise = $2 WHERE id = $1', [bandeId, verifierMise(mise)]); // vaut dès la prochaine semaine sans mise
      if (ouverte !== undefined) await base.query('UPDATE bandes SET ouverte = $2 WHERE id = $1', [bandeId, !!ouverte]);
      if (pays !== undefined) await base.query('UPDATE bandes SET pays = $2 WHERE id = $1', [bandeId, pays && /^[A-Z]{2}$/.test(String(pays).toUpperCase()) ? String(pays).toUpperCase() : null]);
      return api.etat(compte, bandeId);
    },

    // Entrer avec le lien d'invitation (?bande=CODE).
    async rejoindre(compte, code) {
      verifierActif(); verifierGoogle(compte);
      const b = (await base.query('SELECT * FROM bandes WHERE code = $1', [String(code || '').toUpperCase().trim()])).rows[0];
      if (!b) throw erreur('Lien de Bande inconnu.', 404);
      if (await estMembre(b.id, compte.id)) return api.etat(compte, b.id);
      await base.transaction(async (q) => {
        await placeLibre(compte, b.id, q);
        await q.query('INSERT INTO bande_membres (bande_id, compte_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [b.id, compte.id]);
        await q.query('DELETE FROM bande_demandes WHERE bande_id = $1 AND compte_id = $2', [b.id, compte.id]);
      });
      return api.etat(compte, b.id);
    },

    // Bandes ouvertes : visibles des inconnus, qui demandent à entrer.
    async ouvertes(compte, pays) {
      const p = pays && /^[A-Z]{2}$/.test(String(pays).toUpperCase()) ? String(pays).toUpperCase() : compte.pays;
      const r = await base.query(`SELECT b.id, b.nom, b.mise, b.pays, count(m.compte_id)::int AS membres,
          EXISTS (SELECT 1 FROM bande_demandes d WHERE d.bande_id = b.id AND d.compte_id = $2) AS demandee
        FROM bandes b JOIN bande_membres m ON m.bande_id = b.id
        WHERE b.ouverte AND ($1::text IS NULL OR b.pays IS NULL OR b.pays = $1) AND NOT EXISTS (SELECT 1 FROM bande_membres x WHERE x.bande_id = b.id AND x.compte_id = $2)
        GROUP BY b.id HAVING count(m.compte_id) < $3 ORDER BY count(m.compte_id) DESC, b.cree_le LIMIT 30`, [p || null, compte.id, cfg().membresMax]);
      return { pays: p || null, liste: r.rows };
    },
    async demander(compte, bandeId) {
      verifierActif(); verifierGoogle(compte);
      const b = await bandeDe(bandeId);
      if (!b.ouverte) throw erreur('Cette Bande n\'accepte que les invitations.', 403);
      if (await estMembre(bandeId, compte.id)) return { ok: true, membre: true };
      await placeLibre(compte, bandeId);
      const n = (await base.query("SELECT count(*)::int AS n FROM bande_demandes WHERE compte_id = $1 AND cree_le > now() - interval '1 day'", [compte.id])).rows[0].n;
      if (n >= 10) throw erreur('Trop de demandes aujourd\'hui. Réessaie demain.', 429);
      const neuve = await base.query('INSERT INTO bande_demandes (bande_id, compte_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [bandeId, compte.id]);
      if (neuve.rows.length && social) await social.notifier(b.createur, 'bande', `${compte.pseudo} demande à entrer dans « ${b.nom} »`, { bande: bandeId, demande: compte.id }).catch(() => {});
      return { ok: true, demandee: true };
    },
    async repondre(compte, bandeId, compteId, accepter) {
      const b = await bandeDe(bandeId);
      if (b.createur !== compte.id) throw erreur('Seul le créateur de la Bande peut répondre.', 403);
      const d = await base.query('DELETE FROM bande_demandes WHERE bande_id = $1 AND compte_id = $2 RETURNING 1', [bandeId, compteId]);
      if (!d.rows.length) throw erreur('Demande introuvable.', 404);
      if (accepter) {
        const c = await comptes.lire(compteId);
        if (!c || c.statut === 'supprime' || c.statut === 'banni') throw erreur('Joueur introuvable.', 404);
        await base.transaction(async (q) => { await placeLibre(c, bandeId, q); await q.query('INSERT INTO bande_membres (bande_id, compte_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [bandeId, compteId]); });
        if (social) await social.notifier(compteId, 'bande', `Bienvenue dans « ${b.nom} » !`, { bande: bandeId }).catch(() => {});
      }
      return api.etat(compte, bandeId);
    },

    // Quitter (ou être retiré) : la mise de la semaine reste dans le pot. Le créateur passe la main au plus ancien.
    async quitter(compte, bandeId, cible = compte.id) {
      const b = await bandeDe(bandeId);
      if (cible !== compte.id && b.createur !== compte.id) throw erreur('Seul le créateur peut retirer un membre.', 403);
      await base.transaction(async (q) => {
        await q.query('DELETE FROM bande_membres WHERE bande_id = $1 AND compte_id = $2', [bandeId, cible]);
        if (b.createur === cible) {
          const suivant = (await q.query('SELECT compte_id FROM bande_membres WHERE bande_id = $1 ORDER BY rejoint_le LIMIT 1', [bandeId])).rows[0];
          if (suivant) await q.query('UPDATE bandes SET createur = $2 WHERE id = $1', [bandeId, suivant.compte_id]);
        }
      });
      return { ok: true };
    },

    async auto(compte, bandeId, oui) {
      const r = await base.query('UPDATE bande_membres SET auto = $3 WHERE bande_id = $1 AND compte_id = $2 RETURNING auto', [bandeId, compte.id, !!oui]);
      if (!r.rows.length) throw erreur('Tu ne fais pas partie de cette Bande.', 403);
      return { ok: true, auto: !!oui };
    },

    inscrire,

    // Mes Bandes, avec un résumé de la semaine (pour l'accueil).
    async mesBandes(compte) {
      const now = maintenant(), lundi = lundiDe(jourDe(now));
      const l = (await base.query('SELECT b.id, b.nom, b.mise, b.createur, b.ouverte FROM bande_membres m JOIN bandes b ON b.id = m.bande_id WHERE m.compte_id = $1 ORDER BY m.rejoint_le', [compte.id])).rows;
      const out = [];
      for (const b of l) {
        const sem = await calculer(b.id, lundi);
        const moi = sem.lignes.find((x) => x.id === compte.id);
        const t = await titres(b.id);
        out.push({ id: b.id, nom: b.nom, membres: await nbMembres(b.id), inscrits: sem.lignes.length, inscrit: !!moi, rang: moi ? moi.rang : null, total: moi ? moi.total : null,
          chef: t.chefs.map((c) => c.pseudo).join(' et ') || null, jeSuisChef: t.chefs.some((c) => c.id === compte.id), jeSuisLoser: t.losers.some((c) => c.id === compte.id) });
      }
      const r = cfg();
      return { bandes: out, max: r.bandesMax, regles: { miseMin: r.miseMin, miseMax: r.miseMax, maison: r.maison, membresMax: r.membresMax }, google: !!compte.auth_id, actif: !!r.actif };
    },

    // L'écran d'une Bande : membres, semaine en cours (classement, pot), dernière semaine, ce que je peux faire.
    async etat(compte, bandeId) {
      const b = await bandeDe(bandeId);
      if (!(await estMembre(bandeId, compte.id))) throw erreur('Tu ne fais pas partie de cette Bande.', 403);
      const r = cfg(), now = maintenant(), aujourdhui = jourDe(now), lundi = lundiDe(aujourdhui);
      const membres = (await base.query(`SELECT c.id, c.pseudo, c.numero, c.avatar, m.auto, m.compte_id = $2 AS createur,
          EXISTS (SELECT 1 FROM match_jour j WHERE j.compte_id = c.id AND j.jour = $3 AND j.statut = 'fini') AS joue
        FROM bande_membres m JOIN comptes c ON c.id = m.compte_id WHERE m.bande_id = $1 ORDER BY m.rejoint_le`, [bandeId, b.createur, aujourdhui])).rows;
      const s = (await base.query('SELECT mise, statut FROM bande_semaines WHERE bande_id = $1 AND semaine = $2', [bandeId, lundi])).rows[0];
      const sem = await calculer(bandeId, lundi);
      const mise = s ? s.mise : b.mise;
      const moi = sem.lignes.find((x) => x.id === compte.id) || null;
      const demandes = b.createur === compte.id ? (await base.query('SELECT c.id, c.pseudo, c.numero FROM bande_demandes d JOIN comptes c ON c.id = d.compte_id WHERE d.bande_id = $1 ORDER BY d.cree_le', [bandeId])).rows : [];
      const cond = moi ? null : await conditions(compte);
      return {
        id: b.id, nom: b.nom, code: b.code, ouverte: b.ouverte, pays: b.pays, miseBande: b.mise, createur: b.createur === compte.id,
        membres: membres.map((m) => ({ id: m.id, pseudo: m.pseudo, numero: m.numero, avatar: m.avatar, createur: m.createur, joueAujourdhui: m.joue, inscrit: sem.lignes.some((l) => l.id === m.id) })),
        demandes,
        semaine: {
          lundi, mise, finA: finSemaine(lundi).toISOString(), limite: limiteInscription(lundi).toISOString(),
          inscriptionOuverte: now < limiteInscription(lundi) && (!s || s.statut === 'ouverte'),
          inscrits: sem.lignes.length, lancee: sem.lignes.length >= r.inscritsMin,
          aGagner: aGagner(sem.lignes.length, mise, r),
          classement: sem.lignes.map((l) => ({ id: l.id, pseudo: l.pseudo, avatar: l.avatar, rang: l.rang, total: l.total, joues: l.joues, enRegle: l.enRegle, jours: l.jours })),
        },
        moi: { inscrit: !!moi, auto: !!(membres.find((m) => m.id === compte.id) || {}).auto, peutMiser: cond ? cond.ok : true, manque: cond ? cond.manque : [] },
        titres: await titres(bandeId),
        regles: { maison: r.maison, matchsMin: r.matchsMin, penaliteRetard: r.penaliteRetard, inscritsMin: r.inscritsMin, membresMax: r.membresMax, miseMin: r.miseMin, miseMax: r.miseMax },
      };
    },

    // Chaque minute : semaines finies, semaines annulées faute d'inscrits, mises automatiques, rappel du soir.
    async tic() {
      const r = cfg(), now = maintenant(), aujourdhui = jourDe(now), lundi = lundiDe(aujourdhui);
      // Semaines passées : partage du pot.
      for (const s of (await base.query("SELECT bande_id, to_char(semaine, 'YYYY-MM-DD') AS semaine FROM bande_semaines WHERE statut = 'ouverte' AND semaine < $1", [lundi])).rows) {
        await cloturer(s.bande_id, s.semaine).catch((e) => console.error('Bande (clôture) :', e.message));
      }
      // Mercredi 23 h passé avec moins de 2 inscrits : pas de semaine, mises rendues tout de suite.
      if (now >= limiteInscription(lundi)) {
        const seules = await base.query(`SELECT s.bande_id FROM bande_semaines s WHERE s.statut = 'ouverte' AND s.semaine = $1
          AND (SELECT count(*) FROM bande_inscriptions i WHERE i.bande_id = s.bande_id AND i.semaine = s.semaine) < $2`, [lundi, r.inscritsMin]);
        for (const s of seules.rows) await cloturer(s.bande_id, lundi).catch((e) => console.error('Bande (annulation) :', e.message));
      }
      // Lundi : mises automatiques (une fois par semaine ; un échec, faute de pièces par exemple, n'est pas retenté).
      if (r.actif && !autos.has(lundi) && now < limiteInscription(lundi)) {
        autos.add(lundi);
        const l = await base.query(`SELECT m.bande_id, m.compte_id FROM bande_membres m WHERE m.auto
          AND NOT EXISTS (SELECT 1 FROM bande_inscriptions i WHERE i.bande_id = m.bande_id AND i.compte_id = m.compte_id AND i.semaine = $1)`, [lundi]);
        for (const x of l.rows) {
          const c = await comptes.statut(x.compte_id);
          if (!c || c.statut !== 'actif') continue;
          await inscrire(c, x.bande_id, { auto: true }).catch(async (e) => {
            if (social) await social.notifier(c.id, 'bande', `Mise automatique impossible cette semaine : ${e.message}`, { bande: x.bande_id }).catch(() => {});
          });
        }
      }
      // Rappel du soir (19 h à Kinshasa), une fois par jour : inscrits qui n'ont pas encore joué.
      const heure = new Date(now.getTime() + HEURE).getUTCHours();
      if (social && heure >= 19 && heure < 22 && !rappels.has(aujourdhui)) {
        rappels.add(aujourdhui);
        const l = await base.query(`SELECT DISTINCT i.compte_id FROM bande_inscriptions i JOIN bande_semaines s ON s.bande_id = i.bande_id AND s.semaine = i.semaine
          WHERE s.semaine = $1 AND s.statut = 'ouverte'
          AND NOT EXISTS (SELECT 1 FROM match_jour j WHERE j.compte_id = i.compte_id AND j.jour = $2)
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.compte_id = i.compte_id AND n.type = 'bande' AND n.donnees->>'rappel' = $2)`, [lundi, aujourdhui]);
        for (const x of l.rows) await social.notifier(x.compte_id, 'bande', 'Tu n\'as pas encore joué ton Match du jour. Chaque Match compte pour ta Bande !', { rappel: aujourdhui }).catch(() => {});
      }
    },

    // Tableau de bord : Bandes et semaines, avec un signal quand des mises partent sans que le joueur joue.
    async surveillance() {
      const r = await base.query(`SELECT b.id, b.nom, b.code, b.ouverte, b.cree_le, c.pseudo AS createur,
          (SELECT count(*)::int FROM bande_membres m WHERE m.bande_id = b.id) AS membres
        FROM bandes b JOIN comptes c ON c.id = b.createur ORDER BY b.cree_le DESC LIMIT 200`);
      const sem = (await base.query("SELECT bande_id, to_char(semaine, 'YYYY-MM-DD') AS semaine, mise, statut, resultat FROM bande_semaines ORDER BY semaine DESC LIMIT 1000")).rows;
      return r.rows.map((b) => {
        const s = sem.filter((x) => x.bande_id === b.id).slice(0, 8).map((x) => {
          const res = x.resultat && (typeof x.resultat === 'string' ? JSON.parse(x.resultat) : x.resultat);
          const lignes = (res && res.lignes) || [];
          return { semaine: x.semaine, mise: x.mise, statut: x.statut, inscrits: lignes.length || (res && res.inscrits ? res.inscrits.length : 0),
            chefs: res && res.chefs ? res.chefs.map((id) => (lignes.find((l) => l.id === id) || {}).pseudo) : [],
            pot: res ? res.pot || 0 : 0, detruit: res ? res.detruit || 0 : 0, horsRegle: lignes.filter((l) => !l.enRegle).length };
        });
        // Suspect : le même Chef 3 semaines de suite pendant que d'autres misent sans jouer.
        const fin = s.filter((x) => x.statut === 'cloturee');
        const suspecte = fin.length >= 3 && fin.slice(0, 3).every((x) => x.chefs.length === 1 && x.chefs[0] === fin[0].chefs[0] && x.horsRegle > 0);
        return { ...b, semaines: s, suspecte };
      });
    },
  };
  return api;
}

module.exports = { creerBande, classerSemaine, aGagner, limiteInscription, finSemaine };
