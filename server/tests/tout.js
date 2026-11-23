// Tests du serveur : node tests/tout.js  (base Postgres en mémoire, aucun compte externe nécessaire)
'use strict';
process.env.KOPO_TESTS = '1';
const assert = require('assert');
const { Client } = require('colyseus.js');
const { demarrer } = require('../src/index');
const { codeTotp, nouveauSecretTotp, verifierTotp } = require('../src/auth');
const { verifierPseudo, migrerPseudos } = require('../src/comptes');
const { calculerPoints, finDeSaison } = require('../src/ligue');
const { DEFAUTS } = require('../src/reglages');
const jose = require('jose');

const TOTP = nouveauSecretTotp();
let srv, URL_;
let reussis = 0, echecs = 0;
async function test(nom, fn) {
  try { await fn(); reussis++; console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n    ' + (e.stack || e.message)); }
}
async function api(chemin, { methode = 'GET', corps, jeton } = {}) {
  const r = await fetch(URL_ + chemin, { method: methode, headers: { 'content-type': 'application/json', ...(jeton ? { authorization: 'Bearer ' + jeton } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, json: await r.json().catch(() => null) };
}
const invite = async (pseudo) => (await api('/api/invite', { methode: 'POST', corps: { pseudo } })).json;
// x demande, y accepte : amis des deux côtés.
async function devenirAmis(x, y) {
  await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.pseudo + '#' + y.compte.numero } });
  return api('/api/amis/demandes/' + encodeURIComponent(x.compte.id) + '/accepter', { methode: 'POST', jeton: y.jeton });
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Joue une partie jusqu'au bout : chaque client humain joue la première action permise.
async function jouerPartie(joueurs, { robots = 0, jeu = 'kopo', reglages = null, options = {} } = {}) {
  const client = new Client(URL_.replace('http', 'ws'));
  const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z]/g, 'Q').padEnd(3, 'Q');
  const salles = [];
  let fin = null;
  for (const j of joueurs) {
    const salle = salles.length ? await client.joinById(salles[0].roomId, { jeton: j.jeton }) : await client.create(jeu, Object.assign({ jeton: j.jeton, code, rapide: true }, options));
    salle.onMessage('erreur', () => {});
    salle.onMessage('solde', () => {});
    salle.onMessage('vue', (v) => {
      if (v.etat === 'finPartie') fin = fin || v;
      const a = v.manche && v.manche.actions[0];
      if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
    });
    salles.push(salle);
  }
  if (reglages) salles[0].send('reglages', reglages);
  for (let i = 0; i < robots; i++) salles[0].send('ajouterRobot');
  await attendre(100);
  salles[0].send('lancer');
  for (let t = 0; t < 2400 && !fin; t++) await attendre(50);
  assert.ok(fin, 'la partie doit se terminer');
  await attendre(400); // enregistrement en base
  for (const s of salles) await s.leave();
  return fin;
}


// Partie publique (inconnus) : tous entrent par le matchmaking, la salle démarre pleine.
async function jouerPublique(joueurs, { parCode = false } = {}) {
  const client = new Client(URL_.replace('http', 'ws'));
  const taille = joueurs.length;
  const salles = [], ligue = new Map(), classee = new Map();
  let fin = null, code = null;
  for (const j of joueurs) {
    const salle = parCode && salles.length
      ? await client.join('kopo', { jeton: j.jeton, code })
      : await client.joinOrCreate('kopo', { jeton: j.jeton, publique: true, taille, rapide: true });
    salle.onMessage('erreur', () => {}); salle.onMessage('solde', () => {});
    salle.onMessage('ligue', (m) => ligue.set(j.compte.id, m));
    salle.onMessage('classee', (m) => classee.set(j.compte.id, m.classee));
    salle.onMessage('vue', (v) => {
      code = v.code;
      if (v.etat === 'finPartie') fin = fin || v;
      const a = v.manche && v.manche.actions[0];
      if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
    });
    salles.push(salle);
    await attendre(80);
  }
  assert.ok(salles.every((x) => x.roomId === salles[0].roomId), 'même salle');
  for (let t = 0; t < 400 && !fin; t++) await attendre(50);
  assert.ok(fin, 'la partie doit se terminer');
  for (let t = 0; t < 40 && ligue.size < joueurs.length && classee.get(joueurs[0].compte.id); t++) await attendre(50);
  await attendre(200);
  for (const s of salles) await s.leave();
  return { fin, ligue, classee, ordre: [fin.vainqueur, ...fin.elimines.slice().reverse()] };
}

(async () => {
  srv = await demarrer({ port: 0, env: { NODE_ENV: 'test', SECRET_SERVEUR: 'x'.repeat(40), ADMIN_MOT_DE_PASSE: 'motdepasse-admin', ADMIN_TOTP: TOTP, SUPABASE_JWT_SECRET: 's'.repeat(40), LIVEKIT_URL: 'wss://essai.livekit.cloud', LIVEKIT_API_KEY: 'APIessai', LIVEKIT_API_SECRET: 'l'.repeat(40) } });
  URL_ = 'http://localhost:' + srv.port;
  let adminJeton;

  console.log('Comptes et pièces');
  await test('un invité reçoit 500 pièces de bienvenue et un numéro à 4 chiffres', async () => {
    const r = await invite('Rossy');
    assert.strictEqual(r.compte.solde, 500);
    assert.match(r.compte.numero, /^\d{4}$/);
    const moi = await api('/api/moi', { jeton: r.jeton });
    assert.strictEqual(moi.json.compte.pseudo, 'Rossy');
  });
  await test('pseudos refusés : trop court, insultant', async () => {
    assert.strictEqual(verifierPseudo('ab').ok, false);
    assert.strictEqual(verifierPseudo('Connard du 93').ok, false);
    assert.strictEqual(verifierPseudo('Kévin').ok, true);
    assert.strictEqual((await api('/api/invite', { methode: 'POST', corps: { pseudo: 'x' } })).statut, 400);
  });
  await test('pseudo en un mot : espaces remplacés par _', async () => {
    assert.strictEqual(verifierPseudo('  Jean  Paul ').pseudo, 'Jean_Paul');
    assert.strictEqual(verifierPseudo('Ké<vin>').pseudo, 'Kévin');
    const r = await invite('Marie Claire');
    assert.strictEqual(r.compte.pseudo, 'Marie_Claire');
  });
  await test('pseudo unique : variante à la création, refus au changement', async () => {
    const a = await invite('Unique');
    const b = await invite('unique');
    assert.strictEqual(a.compte.pseudo, 'Unique');
    assert.match(b.compte.pseudo, /^unique_\d{4}$/);
    const ch = await api('/api/moi', { methode: 'PATCH', jeton: b.jeton, corps: { pseudo: 'UNIQUE' } });
    assert.strictEqual(ch.statut, 409);
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Unique' } })).statut, 200); // le sien
  });
  await test('pseudo : 2 changements au plus sur 12 mois', async () => {
    const a = await invite('Quota');
    let m = await api('/api/moi', { jeton: a.jeton });
    assert.deepStrictEqual([m.json.quotaPseudo.restants, m.json.quotaPseudo.max], [2, 2]);
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Quota' } })).json.quotaPseudo.restants, 2); // même pseudo : rien à compter
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Quota2' } })).json.quotaPseudo.restants, 1);
    const r2 = await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Quota3' } });
    assert.strictEqual(r2.json.quotaPseudo.restants, 0);
    assert.ok(r2.json.quotaPseudo.prochain);
    const r3 = await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Quota4' } });
    assert.strictEqual(r3.statut, 403);
    assert.match(r3.json.erreur, /2 fois cette année/);
    assert.strictEqual((await api('/api/moi', { jeton: a.jeton })).json.compte.pseudo, 'Quota3');
    // Un changement de plus d'un an ne compte plus.
    await srv.base.query("UPDATE changements_pseudo SET cree_le = now() - interval '13 months' WHERE nouveau = 'Quota2'");
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: a.jeton, corps: { pseudo: 'Quota4' } })).statut, 200);
  });
  await test('migration : anciens pseudos avec espaces et doublons corrigés', async () => {
    const b = srv.base;
    await b.query('DROP INDEX IF EXISTS comptes_pseudo_unique');
    await b.query("INSERT INTO comptes (id, pseudo, numero, cree_le) VALUES ('c_m1', 'Papa Wemba', '0001', now() - interval '2 days'), ('c_m2', 'papa_wemba', '0002', now() - interval '1 day')");
    await migrerPseudos(b);
    assert.strictEqual((await srv.comptes.lire('c_m1')).pseudo, 'Papa_Wemba');
    assert.match((await srv.comptes.lire('c_m2')).pseudo, /^papa_wemba_\d{4}$/);
    await assert.rejects(b.query("INSERT INTO comptes (id, pseudo, numero) VALUES ('c_m3', 'PAPA_WEMBA', '0003')"));
  });
  const jetonGoogle = (sub, nom) => new jose.SignJWT({ user_metadata: { name: nom } }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('s'.repeat(40)));
  await test('un compte Google = un seul compte Kopo, nom Google jamais repris', async () => {
    const g = await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonGoogle('google-1', 'Jean Dupont') } });
    assert.strictEqual(g.statut, 200);
    assert.match(g.json.compte.pseudo, /^Joueur\d{4}/);
    // Un autre téléphone (invité) se connecte avec le même Google : il reprend le même compte.
    const inv = await invite('Telephone2');
    const g2 = await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonGoogle('google-1'), jeton: inv.jeton } });
    assert.strictEqual(g2.json.compte.id, g.json.compte.id);
    assert.strictEqual((await srv.comptes.lire(inv.compte.id)).auth_id, null);
    // Un compte déjà lié ne passe pas à un autre Google.
    const g3 = await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonGoogle('google-2'), jeton: g.json.jeton } });
    assert.notStrictEqual(g3.json.compte.id, g.json.compte.id);
    assert.strictEqual((await srv.comptes.lire(g.json.compte.id)).auth_id, 'google-1');
  });
  await test('sans jeton, pas d\'accès', async () => assert.strictEqual((await api('/api/moi')).statut, 401));
  await test('connexion anonyme de Supabase refusée (ce n\'est pas un compte Google)', async () => {
    const anonyme = await new jose.SignJWT({ is_anonymous: true }).setProtectedHeader({ alg: 'HS256' }).setSubject('anonyme-1').setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('s'.repeat(40)));
    const r = await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: anonyme } });
    assert.strictEqual(r.statut, 401);
    assert.strictEqual(await srv.comptes.parAuth('anonyme-1'), null);
  });
  await test('bonus du jour : 50 la première fois, une seule fois par jour', async () => {
    const r = await invite('Bonus');
    const b1 = await api('/api/bonus-du-jour', { methode: 'POST', jeton: r.jeton });
    assert.deepStrictEqual([b1.json.montant, b1.json.solde], [50, 550]);
    const b2 = await api('/api/bonus-du-jour', { methode: 'POST', jeton: r.jeton });
    assert.strictEqual(b2.json.dejaPris, true);
  });
  await test('bonus du jour : la série monte de 10 et plafonne à 150', async () => {
    const r = await invite('Serie');
    await srv.base.query("UPDATE comptes SET serie_bonus = 10, dernier_bonus = current_date - 1 WHERE id = $1", [r.compte.id]);
    const b = await api('/api/bonus-du-jour', { methode: 'POST', jeton: r.jeton });
    assert.deepStrictEqual([b.json.serie, b.json.montant], [11, 150]);
    await srv.base.query("UPDATE comptes SET dernier_bonus = current_date - 3 WHERE id = $1", [r.compte.id]);
    await srv.base.query("UPDATE comptes SET dernier_bonus = current_date - 3 WHERE id = $1", [r.compte.id]);
  });
  await test('bonus du jour : le joker de série sauve un jour raté par semaine', async () => {
    const r = await invite('Joker' + Date.now() % 1000);
    await srv.base.query("UPDATE comptes SET serie_bonus = 4, dernier_bonus = current_date - 2, joker_semaine = NULL WHERE id = $1", [r.compte.id]);
    const b = (await api('/api/bonus-du-jour', { methode: 'POST', jeton: r.jeton })).json;
    assert.deepStrictEqual([b.serie, b.joker, b.montant, b.prochain], [5, true, 90, 100]);
    // Une deuxième fois la même semaine : la série repart.
    await srv.base.query("UPDATE comptes SET dernier_bonus = current_date - 2 WHERE id = $1", [r.compte.id]);
    const b2 = (await api('/api/bonus-du-jour', { methode: 'POST', jeton: r.jeton })).json;
    assert.deepStrictEqual([b2.serie, b2.joker], [1, false]);
  });
  await test('récompenses du téléphone (missions, défi, bienvenue) : plafonnées, sans doublon', async () => {
    const r = await invite('Mission' + Date.now() % 1000);
    const rec = (corps) => api('/api/recompense', { methode: 'POST', jeton: r.jeton, corps });
    const solde = (await srv.comptes.lire(r.compte.id)).solde;
    const jour = new Date().toISOString().slice(0, 10);
    assert.strictEqual((await rec({ motif: 'mission', montant: 60, ref: 'Fais un Katapss:' + jour })).json.solde, solde + 60);
    assert.strictEqual((await rec({ motif: 'mission', montant: 60, ref: 'Fais un Katapss:' + jour })).json.ok, false, 'doublon');
    assert.strictEqual((await rec({ motif: 'mission', montant: 100, ref: 'Fais un Katapss:' + jour })).statut, 400, 'montant différent de la mission');
    assert.strictEqual((await rec({ motif: 'mission', montant: 100, ref: 'Mission inventée:' + jour })).statut, 400, 'mission inconnue');
    assert.strictEqual((await rec({ motif: 'mission', montant: 60, ref: 'Fais un Katapss:2026-01-01' })).statut, 400, 'trop ancienne');
    assert.strictEqual((await rec({ motif: 'mission', montant: 5000, ref: 'x' })).statut, 400);
    for (const [texte, n] of [['Gagne une partie', 80], ['Atteins une finale', 40], ['Joue 2 parties', 20]]) assert.strictEqual((await rec({ motif: 'mission', montant: n, ref: texte + ':' + jour })).json.ok, true);
    assert.strictEqual((await rec({ motif: 'mission', montant: 30, ref: 'Joue 3 parties:' + jour })).json.ok, false, '4 missions par jour au plus');
    assert.strictEqual((await rec({ motif: 'jackpot', montant: 10 })).statut, 400);
    assert.strictEqual((await rec({ motif: 'defi', montant: 300, ref: 'Gagne 5 parties cette semaine:' + jour })).json.ok, true);
    assert.strictEqual((await rec({ motif: 'defi', montant: 300, ref: 'Joue 15 parties cette semaine:' + jour })).json.ok, false, 'un défi par semaine');
    assert.strictEqual((await rec({ motif: 'defi', montant: 300, ref: 'w45' })).statut, 400, 'défi inconnu');
    // Bienvenue : montant fixé par le serveur, jour N seulement après N jours de jeu.
    const b = (await rec({ motif: 'bienvenue', montant: 300, ref: 'j1' })).json;
    assert.deepStrictEqual([b.ok, b.montant], [true, 100], 'le montant vient du serveur');
    const r2 = await invite('Bienv' + Date.now() % 1000);
    assert.strictEqual((await api('/api/recompense', { methode: 'POST', jeton: r2.jeton, corps: { motif: 'bienvenue', montant: 300, ref: 'j6' } })).json.ok, false, 'pas avant 6 jours de jeu');
    assert.strictEqual((await api('/api/recompense', { methode: 'POST', jeton: r2.jeton, corps: { motif: 'bienvenue', montant: 100, ref: 'j3' } })).statut, 400, 'le jour 3 est un objet');
    assert.strictEqual((await rec({ motif: 'bienvenue', montant: 150, ref: 'j2' })).json.ok, false, 'un cadeau par jour');
    assert.strictEqual((await rec({ motif: 'installation', montant: 500, ref: 'pwa' })).statut, 400, 'cadeau d\'installation plafonné');
    assert.strictEqual((await rec({ motif: 'installation', montant: 200, ref: 'pwa' })).json.ok, true);
    assert.strictEqual((await rec({ motif: 'installation', montant: 200, ref: 'pwa2' })).json.ok, false, 'une seule installation récompensée');
  });
  await test('cadeau de fondateur : le dos « Les Fondateurs », une seule fois, coupé par l\'admin', async () => {
    const r = await invite('Fondateur' + Date.now() % 1000);
    const c1 = (await api('/api/cadeau-fondateur', { methode: 'POST', jeton: r.jeton })).json;
    assert.deepStrictEqual([c1.ok, c1.nouveau, c1.objet], [true, true, 'dos-fondateurs']);
    assert.strictEqual((await api('/api/cadeau-fondateur', { methode: 'POST', jeton: r.jeton })).json.nouveau, false);
    assert.ok((await api('/api/collection', { jeton: r.jeton })).json.possedes.includes('dos-fondateurs'));
    await srv.reglages.ecrire('cadeauFondateur', { actif: false });
    const autre = await invite('Tardif' + Date.now() % 1000);
    assert.strictEqual((await api('/api/cadeau-fondateur', { methode: 'POST', jeton: autre.jeton })).json.ok, false);
    await srv.reglages.ecrire('cadeauFondateur', { actif: true });
  });

  await test('le registre et le solde concordent, le solde ne passe jamais sous 0', async () => {
    const r = await invite('Registre');
    await assert.rejects(srv.comptes.crediter(r.compte.id, -501, 'mise'));
    await srv.comptes.crediter(r.compte.id, -490, 'mise');
    const p = await api('/api/pieces', { jeton: r.jeton });
    assert.strictEqual(p.json.solde, 10);
    assert.strictEqual(p.json.historique.reduce((s, l) => s + l.montant, 0), 10);
  });
  await test('remise à flot : remonte à 100 sous 20 pièces, une fois par jour', async () => {
    const r = await invite('Fauche');
    await srv.comptes.crediter(r.compte.id, -495, 'mise');
    const a = await api('/api/remise-a-flot', { methode: 'POST', jeton: r.jeton });
    assert.deepStrictEqual([a.json.ok, a.json.solde], [true, 100]);
    await srv.comptes.crediter(r.compte.id, -95, 'mise');
    assert.strictEqual((await api('/api/remise-a-flot', { methode: 'POST', jeton: r.jeton })).json.ok, false);
  });

  console.log('Amis, blocage, signalement, suppression');
  const a = await invite('Alice'), b = await invite('Bruno');
  await test('ajouter un ami envoie une demande ; il n\'est ami qu\'une fois acceptée', async () => {
    const r = await api('/api/amis', { methode: 'POST', jeton: a.jeton, corps: { cible: `Bruno#${b.compte.numero}` } });
    assert.deepStrictEqual([r.json.ok, r.json.etat], [true, 'envoyee']);
    assert.strictEqual((await api('/api/amis', { jeton: a.jeton })).json.length, 0, 'pas encore ami');
    assert.strictEqual((await api('/api/amis/demandes', { jeton: a.jeton })).json.envoyees[0].pseudo, 'Bruno');
    const d = (await api('/api/amis/demandes', { jeton: b.jeton })).json;
    assert.deepStrictEqual(d.recues.map((x) => x.pseudo), ['Alice']);
    const n = (await api('/api/notifications', { jeton: b.jeton })).json.liste[0];
    assert.deepStrictEqual([n.type, n.texte, n.donnees.demande, n.donnees.de], ['ami', 'Alice veut être ton ami', true, a.compte.id]);
    assert.strictEqual((await api('/api/notifications', { jeton: b.jeton })).json.demandesAmi, 1);
    // Redemander ne renvoie pas de notification.
    await api('/api/amis', { methode: 'POST', jeton: a.jeton, corps: { cible: `Bruno#${b.compte.numero}` } });
    assert.strictEqual((await api('/api/notifications', { jeton: b.jeton })).json.liste.length, 1);
    // Bruno accepte : amis des deux côtés, Alice est prévenue.
    assert.strictEqual((await api('/api/amis/demandes/' + a.compte.id + '/accepter', { methode: 'POST', jeton: b.jeton })).json.ok, true);
    assert.strictEqual((await api('/api/amis', { jeton: a.jeton })).json[0].pseudo, 'Bruno');
    assert.strictEqual((await api('/api/amis', { jeton: b.jeton })).json[0].pseudo, 'Alice');
    assert.deepStrictEqual((await api('/api/amis/demandes', { jeton: b.jeton })).json, { recues: [], envoyees: [] });
    // La fenêtre Amis montre l'XP (le téléphone en tire le niveau), l'apparence et la dernière visite.
    await api('/api/profil', { methode: 'PUT', jeton: b.jeton, corps: { profil: { xp: 420, bareme: 2 } } });
    const fb = (await api('/api/amis', { jeton: a.jeton })).json[0];
    assert.deepStrictEqual([fb.xp, fb.bareme, fb.apparence, fb.en_ligne, !!fb.vu_le], [420, 2, null, true, true]);
    const na = (await api('/api/notifications', { jeton: a.jeton })).json.liste[0];
    assert.deepStrictEqual([na.texte, na.donnees.accepte], ['Bruno a accepté ta demande d\'ami', true]);
    assert.strictEqual((await api('/api/amis/demandes/' + a.compte.id + '/accepter', { methode: 'POST', jeton: b.jeton })).statut, 404, 'plus de demande');
    // Un ajout d'avant les demandes (d'un seul côté) vaut une demande : l'autre peut l'accepter.
    const [x, y] = [await invite('Anc' + Date.now() % 1000), await invite('Anb' + Date.now() % 1000)];
    await srv.base.query('INSERT INTO amis (compte_id, ami_id) VALUES ($1,$2)', [x.compte.id, y.compte.id]);
    assert.strictEqual((await api('/api/amis', { methode: 'POST', jeton: y.jeton, corps: { cible: x.compte.id } })).json.etat, 'ami');
    assert.strictEqual((await api('/api/amis', { jeton: y.jeton })).json.length, 1);
  });
  await test('refuser une demande : l\'autre n\'est pas prévenu et ne peut pas insister', async () => {
    const [x, y] = [await invite('Dem' + Date.now() % 1000), await invite('Ref' + Date.now() % 1000)];
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.id } });
    assert.strictEqual((await api('/api/amis/demandes/' + x.compte.id + '/refuser', { methode: 'POST', jeton: y.jeton })).json.ok, true);
    assert.strictEqual((await api('/api/amis/demandes', { jeton: y.jeton })).json.recues.length, 0);
    assert.strictEqual((await api('/api/amis', { jeton: x.jeton })).json.length, 0);
    assert.strictEqual((await api('/api/notifications', { jeton: x.jeton })).json.liste.length, 0, 'pas de « refusé »');
    assert.strictEqual((await api('/api/amis/demandes', { jeton: x.jeton })).json.envoyees.length, 1, 'reste « envoyée » de son côté');
    const r = await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.id } });
    assert.strictEqual(r.json.etat, 'envoyee');
    assert.strictEqual((await api('/api/amis/demandes', { jeton: y.jeton })).json.recues.length, 0, 'pas de nouvelle demande pendant 7 jours');
    assert.strictEqual((await api('/api/notifications', { jeton: y.jeton })).json.liste.length, 1);
    // Il annule sa demande.
    await api('/api/amis/demandes/' + y.compte.id, { methode: 'DELETE', jeton: x.jeton });
    assert.strictEqual((await api('/api/amis/demandes', { jeton: x.jeton })).json.envoyees.length, 0);
  });
  await test('demandes croisées : si l\'autre m\'a déjà demandé, on devient amis tout de suite', async () => {
    const [x, y] = [await invite('Cro' + Date.now() % 1000), await invite('Cri' + Date.now() % 1000)];
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.id } });
    const r = await api('/api/amis', { methode: 'POST', jeton: y.jeton, corps: { cible: x.compte.id } });
    assert.strictEqual(r.json.etat, 'ami');
    assert.strictEqual((await api('/api/amis', { jeton: x.jeton })).json.length, 1);
    // Retirer un ami le retire des deux côtés.
    await api('/api/amis/' + x.compte.id, { methode: 'DELETE', jeton: y.jeton });
    assert.strictEqual((await api('/api/amis', { jeton: x.jeton })).json.length, 0);
  });
  await test('bloquer retire l\'ami, et le bloqué ne peut plus ajouter', async () => {
    await api('/api/bloques', { methode: 'POST', jeton: a.jeton, corps: { cible: b.compte.id } });
    assert.strictEqual((await api('/api/amis', { jeton: a.jeton })).json.length, 0);
    assert.strictEqual((await api('/api/amis', { methode: 'POST', jeton: b.jeton, corps: { cible: a.compte.id } })).statut, 404);
  });
  await test('signaler un joueur', async () => {
    assert.strictEqual((await api('/api/signaler', { methode: 'POST', jeton: b.jeton, corps: { cible: a.compte.id, motif: 'insultes', details: 'test' } })).json.ok, true);
    assert.strictEqual((await api('/api/signaler', { methode: 'POST', jeton: b.jeton, corps: { cible: a.compte.id, motif: 'nimporte' } })).statut, 400);
  });
  await test('supprimer son compte efface pseudo et connexion', async () => {
    const r = await invite('Partant');
    await api('/api/moi', { methode: 'DELETE', jeton: r.jeton });
    assert.strictEqual((await api('/api/moi', { jeton: r.jeton })).statut, 401);
    assert.strictEqual((await srv.comptes.lire(r.compte.id)).pseudo, 'Joueur supprimé');
  });

  console.log('Parties sur le serveur');
  await test('partie à 3 : places, gains de manche, victoire et 2e place', async () => {
    const js = [await invite('Premier'), await invite('Second'), await invite('Troisieme')];
    const fin = await jouerPartie(js);
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    const soldes = {};
    for (const j of js) soldes[j.compte.id] = (await srv.comptes.lire(j.compte.id)).solde;
    // 3 joueurs = 2 manches. Vainqueur : 2 manches × 5 + 40 ; 2e : 1 × 5 + 15 ; 3e : 0. (+ Katapss éventuels : 10)
    const sansK = (id) => { const k = soldes[id] - 500; return k % 10 === 0 || k % 5 === 0 ? k : NaN; };
    assert.ok(sansK(ordre[0]) >= 50, 'vainqueur ' + soldes[ordre[0]]);
    assert.ok(sansK(ordre[1]) >= 20, '2e ' + soldes[ordre[1]]);
    assert.ok(soldes[ordre[2]] >= 500, '3e');
    const p = (await srv.base.query('SELECT count(*)::int AS n FROM participations')).rows[0].n;
    assert.ok(p >= 3);
  });
  await test('événement : gains des tables gratuites et bonus du jour multipliés, annoncé dans /config, puis retour à la normale', async () => {
    const maintenant = Date.now();
    await assert.rejects(srv.reglages.ecrire('evenement', { actif: 1, nom: 'X', debut: '2026-11-28T18:00', fin: '2026-11-28T10:00', pieces: 2, bonus: 2 }), /après le début/);
    await assert.rejects(srv.reglages.ecrire('evenement', { actif: 1, nom: 'X', debut: '2026-11-28T10:00', fin: '2026-11-28T18:00', pieces: 9, bonus: 2 }), /entre 1 et 5/);
    await srv.reglages.ecrire('evenement', { actif: 1, nom: 'Week-end doré', debut: new Date(maintenant - 36e5).toISOString(), fin: new Date(maintenant + 36e5).toISOString(), pieces: 2, bonus: 3 });
    try {
      const cfg = (await api('/api/config')).json;
      assert.match(cfg.annonce, /Week-end doré : pièces x2 sur les tables gratuites et bonus du jour x3, jusqu'à/);
      assert.deepStrictEqual([cfg.evenement.pieces, cfg.evenement.bonus], [2, 3]);
      const x = await invite('Evenement');
      assert.strictEqual((await api('/api/bonus-du-jour', { methode: 'POST', jeton: x.jeton })).json.montant, 150, 'bonus 50 x 3');
      const js = [await invite('EvA'), await invite('EvB'), await invite('EvC')];
      const fin = await jouerPartie(js);
      const v = (await srv.base.query("SELECT montant FROM registre_pieces WHERE compte_id = $1 AND motif = 'victoire' ORDER BY id DESC LIMIT 1", [fin.vainqueur])).rows[0];
      assert.strictEqual(v.montant, 80, 'victoire 40 x 2');
    } finally {
      await srv.reglages.ecrire('evenement', DEFAUTS.evenement);
    }
    assert.strictEqual((await api('/api/config')).json.evenement, null);
  });
  await test('partie avec un robot : aucune pièce gagnée', async () => {
    const js = [await invite('Solo'), await invite('Duo')];
    await jouerPartie(js, { robots: 1 });
    for (const j of js) assert.strictEqual((await srv.comptes.lire(j.compte.id)).solde, 500);
    const r = (await srv.base.query('SELECT avec_robots FROM parties ORDER BY debut DESC LIMIT 1')).rows[0];
    assert.strictEqual(r.avec_robots, true);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.deepStrictEqual(await srv.social.duels(js[0].compte.id, [js[1].compte.id]), [], 'pas de face-à-face avec un robot à la table');
  });
  await test('5 dernières parties : adversaires humains seulement, ami ou demande en cours, sans les bloqués', async () => {
    const [a, b, c, d] = [await invite('Rena'), await invite('Rabi'), await invite('Rako'), await invite('Rado')];
    await jouerPartie([a, b, c], { jeu: 'inter8', reglages: { mode: 'delire' } });
    await jouerPartie([a, b], { robots: 1 });
    await api('/api/amis', { methode: 'POST', jeton: a.jeton, corps: { cible: c.compte.id } });
    await devenirAmis(a, b);
    let r = (await api('/api/recents', { jeton: a.jeton })).json;
    assert.strictEqual(r.length, 2, 'deux parties');
    assert.strictEqual(r[0].jeu, 'kopo'); assert.strictEqual(r[1].jeu, 'inter8');
    assert.deepStrictEqual(r[0].joueurs.map((j) => j.pseudo), ['Rabi'], 'les robots ne sont jamais montrés');
    assert.strictEqual(r[0].joueurs[0].ami, true);
    assert.deepStrictEqual(r[1].joueurs.map((j) => j.pseudo).sort(), ['Rabi', 'Rako']);
    const rako = r[1].joueurs.find((j) => j.pseudo === 'Rako');
    assert.strictEqual(rako.envoyee, true); assert.strictEqual(rako.ami, false);
    assert.ok(r[1].place >= 1 && r[1].nbJoueurs === 3);
    assert.strictEqual((await api('/api/recents', { jeton: c.jeton })).json[0].joueurs.find((j) => j.pseudo === 'Rena').recue, true, 'Rako voit que Rena lui a demandé');
    await api('/api/bloques', { methode: 'POST', jeton: c.jeton, corps: { cible: a.compte.id } });
    r = (await api('/api/recents', { jeton: a.jeton })).json;
    assert.deepStrictEqual(r[1].joueurs.map((j) => j.pseudo), ['Rabi'], 'un joueur qui m\'a bloqué disparaît');
    assert.deepStrictEqual((await api('/api/recents', { jeton: d.jeton })).json, [], 'aucune partie');
  });
  await test('un joueur banni ne peut pas entrer dans une salle', async () => {
    const x = await invite('Tricheur');
    await srv.base.query("UPDATE comptes SET statut = 'banni' WHERE id = $1", [x.compte.id]);
    const c = new Client(URL_.replace('http', 'ws'));
    await assert.rejects(c.create('kopo', { jeton: x.jeton }));
  });

  console.log('Inter (8) sur le serveur');
  await test('Inter (8) mode Cahier : la formule choisie à la création est gardée, gains comme une partie normale', async () => {
    const js = [await invite('Cah_A'), await invite('Cah_B'), await invite('Cah_C')];
    const fin = await jouerPartie(js, { jeu: 'inter8', options: { formule: 'cahier', total: 500 } });
    assert.strictEqual(fin.formule, 'cahier');
    assert.strictEqual(fin.cahier.total, 500);
    assert.ok(fin.cahier.donnes.length >= 2, 'plusieurs donnes');
    for (const e of fin.elimines) assert.ok(fin.cahier.scores[e] >= 500);
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    assert.strictEqual((await srv.comptes.lire(ordre[0])).solde, 500 + 2 * 5 + 40, 'vainqueur : comme 2 manches et la victoire');
  });
  await test('Inter (8) entre amis : simple + J retour choisi à la création, gardé jusqu\'au bout', async () => {
    const js = [await invite('SimJ_A'), await invite('SimJ_B'), await invite('SimJ_C')];
    const fin = await jouerPartie(js, { jeu: 'inter8', options: { mode: 'simple', jRetour: true } });
    assert.strictEqual(fin.mode, 'simple');
    assert.strictEqual(fin.jRetour, true);
  });
  await test('Inter (8) entre amis : partie complète en délire, gains, partie notée « inter8 », XP du parcours de saison', async () => {
    const js = [await invite('Inter_A'), await invite('Inter_B'), await invite('Inter_C')];
    const fin = await jouerPartie(js, { jeu: 'inter8', reglages: { mode: 'delire' } });
    assert.strictEqual(fin.jeu, 'inter8');
    assert.strictEqual(fin.mode, 'delire');
    assert.strictEqual(fin.jRetour, true, 'une appli qui envoie « délire » seul garde le J retour');
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    assert.strictEqual((await srv.comptes.lire(ordre[0])).solde, 500 + 2 * 5 + 40, 'vainqueur : 2 manches et la victoire');
    assert.strictEqual((await srv.comptes.lire(ordre[1])).solde, 500 + 5 + 15, '2e');
    const r = (await srv.base.query('SELECT jeu FROM parties ORDER BY debut DESC LIMIT 1')).rows[0];
    assert.strictEqual(r.jeu, 'inter8');
    const xp = (await srv.base.query('SELECT xp FROM parcours_parties WHERE compte_id = $1', [ordre[0]])).rows;
    assert.strictEqual(xp.length, 1, 'la partie compte pour le parcours');
    assert.strictEqual(xp[0].xp, srv.parcours.xpPartie({ place: 1, manchesSurvecues: 2 }));
  });
  await test('Inter (8) en ligne : salle publique listée avec son jeu, jamais mélangée avec Kopo', async () => {
    const [x, y] = [await invite('Inter_Pub'), await invite('Autre_Pub')];
    const client = new Client(URL_.replace('http', 'ws'));
    const a = await client.joinOrCreate('inter8', { jeton: x.jeton, publique: true, taille: 4 });
    const b = await client.joinOrCreate('kopo', { jeton: y.jeton, publique: true, taille: 4 });
    a.onMessage('*', () => {}); b.onMessage('*', () => {});
    assert.notStrictEqual(a.roomId, b.roomId);
    await attendre(100);
    const l = (await api('/api/en-ligne')).json.sallesOuvertes;
    assert.strictEqual(l.find((s) => s.id === a.roomId).jeu, 'inter8');
    assert.strictEqual(l.find((s) => s.id === b.roomId).jeu, 'kopo');
    await a.leave(); await b.leave();
  });

  console.log('Salles publiques (joueurs inconnus)');
  await test('salle publique de 3 : les inconnus s\'y retrouvent, elle démarre pleine, le 4e en ouvre une autre', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const js = [];
    for (const p of ['Pub1', 'Pub2', 'Pub3', 'Pub4']) js.push(await invite(p + Math.floor(Math.random() * 1000)));
    const vues = new Map();
    const entrer = async (j) => {
      const r = await client.joinOrCreate('kopo', { jeton: j.jeton, publique: true, taille: 3 });
      r.onMessage('vue', (v) => vues.set(j.compte.id, v)); r.onMessage('erreur', () => {}); r.onMessage('solde', () => {});
      return r;
    };
    const a = await entrer(js[0]);
    const b = await entrer(js[1]);
    assert.strictEqual(a.roomId, b.roomId);
    await attendre(100);
    let enLigne = (await api('/api/en-ligne')).json;
    const ouverte = enLigne.sallesOuvertes.find((x) => x.id === a.roomId);
    assert.ok(ouverte && ouverte.taille === 3 && ouverte.joueurs === 2 && /^[A-Z]{4}$/.test(ouverte.code), JSON.stringify(enLigne));
    const c = await entrer(js[2]);
    assert.strictEqual(c.roomId, a.roomId);
    await attendre(400);
    assert.strictEqual(vues.get(js[0].compte.id).etat, 'manche', 'la salle pleine démarre seule');
    enLigne = (await api('/api/en-ligne')).json;
    assert.ok(!enLigne.sallesOuvertes.some((x) => x.id === a.roomId), 'plus annoncée une fois commencée');
    const d = await entrer(js[3]);
    assert.notStrictEqual(d.roomId, a.roomId, 'le 4e ouvre une nouvelle salle');
    for (const r of [a, b, c, d]) await r.leave();
  });
  await test('salle publique gratuite : des robots complètent la table après l\'attente, partie non classée et sans pièces', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const j = await invite('Seul' + Math.floor(Math.random() * 1000));
    const solde = (await api('/api/moi', { jeton: j.jeton })).json.compte.solde;
    let vue = null, classee = null;
    const r = await client.joinOrCreate('kopo', { jeton: j.jeton, publique: true, taille: 4, rapide: true, attenteRobots: 200 });
    r.onMessage('erreur', () => {}); r.onMessage('solde', () => {}); r.onMessage('classee', (m) => (classee = m.classee));
    r.onMessage('vue', (v) => {
      vue = v;
      const a = v.manche && v.manche.actions[0];
      if (v.etat === 'manche' && a) setTimeout(() => r.send('action', { action: a }), 5);
    });
    for (let t = 0; t < 40 && !(vue && vue.etat !== 'salon'); t++) await attendre(50);
    assert.ok(vue && vue.etat !== 'salon', 'la salle démarre avec les robots');
    assert.strictEqual(vue.joueurs.length, 4);
    assert.strictEqual(vue.joueurs.filter((x) => x.robot).length, 3, 'robots affichés comme robots');
    assert.ok(vue.joueurs.filter((x) => x.robot).every((x) => /^Robot [A-ZÀ-Ü]/.test(x.nom)), 'noms « Robot <prénom> »');
    assert.strictEqual(new Set(vue.joueurs.map((x) => x.nom)).size, 4, 'noms différents');
    assert.strictEqual(classee, false, 'pas de Ligue avec des robots');
    const enLigne = (await api('/api/en-ligne')).json;
    assert.ok(!enLigne.sallesOuvertes.some((x) => x.id === r.roomId), 'plus proposée aux inconnus');
    for (let t = 0; t < 400 && vue.etat !== 'finPartie'; t++) await attendre(50);
    assert.strictEqual(vue.etat, 'finPartie');
    await attendre(300);
    assert.strictEqual((await api('/api/moi', { jeton: j.jeton })).json.compte.solde, solde, 'aucune pièce contre les robots');
    await r.leave();
  });
  await test('tables à mise : jamais de robots, même après l\'attente', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const j = await invite('Mise' + Math.floor(Math.random() * 1000));
    let vue = null;
    const r = await client.joinOrCreate('kopo-mise', { jeton: j.jeton, publique: true, taille: 3, mise: 'bronze', rapide: true, attenteRobots: 50 });
    r.onMessage('erreur', () => {}); r.onMessage('solde', () => {}); r.onMessage('vue', (v) => (vue = v));
    await attendre(600);
    assert.strictEqual(vue.etat, 'salon');
    assert.strictEqual(vue.joueurs.length, 1);
    await r.leave();
  });
  await test('réglage cahier : barème du mode Cahier, entiers de 0 à 500', async () => {
    await assert.rejects(srv.reglages.ecrire('cahier', { ...DEFAUTS.cahier, X: 501 }), /joker/);
    await assert.rejects(srv.reglages.ecrire('cahier', { ...DEFAUTS.cahier, 8: 'abc' }), /carte 8/);
    await srv.reglages.ecrire('cahier', { ...DEFAUTS.cahier, X: 80 });
    assert.strictEqual(srv.reglages.get('cahier').X, 80);
    await srv.reglages.ecrire('cahier', DEFAUTS.cahier);
  });
  await test('réglage cahierTotaux : montants d\'élimination, le petit sous le grand', async () => {
    await assert.rejects(srv.reglages.ecrire('cahierTotaux', { petit: 800, grand: 300 }), /petit montant/);
    await assert.rejects(srv.reglages.ecrire('cahierTotaux', { petit: 10, grand: 300 }), /50 à 10 000/);
    await srv.reglages.ecrire('cahierTotaux', { petit: 300, grand: 800 });
    assert.deepStrictEqual(srv.reglages.get('cahierTotaux'), { petit: 300, grand: 800 });
    await srv.reglages.ecrire('cahierTotaux', DEFAUTS.cahierTotaux);
  });
  await test('réglage robotsPublics : attente entre 10 et 600 secondes', async () => {
    await assert.rejects(srv.reglages.ecrire('robotsPublics', { actif: 1, attente: 3 }), /Attente/);
    await srv.reglages.ecrire('robotsPublics', { actif: 0, attente: 60 });
    assert.deepStrictEqual(srv.reglages.get('robotsPublics'), { actif: 0, attente: 60, robots: 'normaux', force: 10 }); // niveau et force : valeurs de départ
    await srv.reglages.ecrire('robotsPublics', DEFAUTS.robotsPublics);
  });
  await test('un ami rejoint une salle publique avec son code ; une salle privée n\'est jamais proposée aux inconnus', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const [x, y, z] = [await invite('Ami' + Date.now() % 1000), await invite('Ami' + (Date.now() + 1) % 1000), await invite('Inc' + Date.now() % 1000)];
    const pub = await client.joinOrCreate('kopo', { jeton: x.jeton, publique: true, taille: 5 });
    let code = null; pub.onMessage('vue', (v) => (code = v.code)); pub.onMessage('erreur', () => {});
    await attendre(150);
    const ami = await client.join('kopo', { jeton: y.jeton, code });
    assert.strictEqual(ami.roomId, pub.roomId);
    const prive = await client.create('kopo', { jeton: x.jeton, code: 'PRIV' });
    const inc = await client.joinOrCreate('kopo', { jeton: z.jeton, publique: true, taille: 4 });
    assert.notStrictEqual(inc.roomId, prive.roomId);
    for (const r of [pub, ami, prive, inc]) await r.leave();
  });
  await test('un code n\'est jamais partagé entre une salle Kopo et une salle Inter (8) ouvertes', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const [x, y] = [await invite('Duo' + Date.now() % 1000), await invite('Dua' + (Date.now() + 1) % 1000)];
    const a = await client.create('kopo', { jeton: x.jeton, code: 'DOUB' });
    const b = await client.create('inter8', { jeton: y.jeton, code: 'DOUB' });
    let codeA = null, codeB = null;
    a.onMessage('vue', (v) => (codeA = v.code)); b.onMessage('vue', (v) => (codeB = v.code));
    a.send('sync'); b.send('sync');
    [a, b].forEach((r) => r.onMessage('erreur', () => {}));
    await attendre(200);
    assert.strictEqual(codeA, 'DOUB');
    assert.ok(codeB && codeB !== 'DOUB', codeB);
    await a.leave(); await b.leave();
  });
  await test('émoji rapide relayé à toute la table', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const [x, y] = [await invite('Emo' + Date.now() % 1000), await invite('Emi' + Date.now() % 1000)];
    const a = await client.create('kopo', { jeton: x.jeton, code: 'EMOJ' });
    const b = await client.join('kopo', { jeton: y.jeton, code: 'EMOJ' });
    let recu = null;
    b.onMessage('reaction', (e) => (recu = e)); a.onMessage('reaction', () => {});
    [a, b].forEach((r) => { r.onMessage('vue', () => {}); r.onMessage('erreur', () => {}); });
    a.send('reaction', { emoji: '🔥' });
    await attendre(200);
    assert.deepStrictEqual(recu, { type: 'reaction', joueur: x.compte.id, emoji: '🔥' });
    await a.leave(); await b.leave();
  });

  console.log('Tables à mise et pot');
  await test('table Bronze : chacun paie 50, le pot (150) est partagé 50/25/10, la maison garde le reste', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const js = [await invite('MiseA'), await invite('MiseB'), await invite('MiseC')];
    const salles = [], pots = new Map(), mises = new Map();
    let fin = null;
    for (const j of js) {
      const salle = await client.joinOrCreate('kopo-mise', { jeton: j.jeton, publique: true, taille: 3, mise: 'bronze', rapide: true });
      salle.onMessage('erreur', () => {}); salle.onMessage('solde', () => {}); salle.onMessage('classee', () => {});
      salle.onMessage('mise', (m) => mises.set(j.compte.id, m));
      salle.onMessage('pot', (m) => pots.set(j.compte.id, m));
      salle.onMessage('vue', (v) => {
        if (v.etat === 'finPartie') fin = fin || v;
        const a = v.manche && v.manche.actions[0];
        if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
      });
      salles.push(salle);
      await attendre(80);
    }
    assert.ok(salles.every((x) => x.roomId === salles[0].roomId), 'même salle');
    for (let t = 0; t < 400 && !fin; t++) await attendre(50);
    assert.ok(fin, 'la partie doit se terminer');
    for (let t = 0; t < 40 && pots.size < 3; t++) await attendre(50);
    assert.deepStrictEqual(mises.get(js[0].compte.id), { niveau: 'bronze', mise: 50, pot: 150 });
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    const attendu = [75, 37, 15];
    for (let i = 0; i < 3; i++) {
      const moi = await api('/api/moi', { jeton: js.find((j) => j.compte.id === ordre[i]).jeton });
      assert.strictEqual(moi.json.compte.solde, 500 - 50 + attendu[i], 'solde de la place ' + (i + 1));
      assert.strictEqual(pots.get(ordre[i]).gain, attendu[i]);
    }
    for (const s of salles) await s.leave();
  });
  await test('Inter (8) à mise : salle « inter8-mise », chacun paie, le pot est partagé comme au Kopo', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const js = [await invite('MiseI1'), await invite('MiseI2'), await invite('MiseI3')];
    const salles = [], pots = new Map(), mises = new Map();
    let fin = null;
    for (const j of js) {
      const salle = await client.joinOrCreate('inter8-mise', { jeton: j.jeton, publique: true, taille: 3, mise: 'bronze', rapide: true });
      salle.onMessage('erreur', () => {}); salle.onMessage('solde', () => {}); salle.onMessage('classee', () => {});
      salle.onMessage('mise', (m) => mises.set(j.compte.id, m));
      salle.onMessage('pot', (m) => pots.set(j.compte.id, m));
      salle.onMessage('vue', (v) => {
        if (v.etat === 'finPartie') fin = fin || v;
        const a = v.manche && v.manche.actions[0];
        if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
      });
      salles.push(salle);
      await attendre(80);
    }
    assert.ok(salles.every((x) => x.roomId === salles[0].roomId), 'même salle');
    const enLigne = (await api('/api/en-ligne')).json.sallesOuvertes;
    const ouverte = enLigne.find((x) => x.id === salles[0].roomId);
    if (ouverte) assert.strictEqual(ouverte.mise, 'bronze');
    for (let t = 0; t < 2400 && !fin; t++) await attendre(50);
    assert.ok(fin, 'la partie doit se terminer');
    assert.strictEqual(fin.jeu, 'inter8');
    for (let t = 0; t < 40 && pots.size < 3; t++) await attendre(50);
    assert.deepStrictEqual(mises.get(js[0].compte.id), { niveau: 'bronze', mise: 50, pot: 150 });
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    const attendu = [75, 37, 15];
    for (let i = 0; i < 3; i++) {
      const moi = await api('/api/moi', { jeton: js.find((j) => j.compte.id === ordre[i]).jeton });
      assert.strictEqual(moi.json.compte.solde, 500 - 50 + attendu[i], 'solde de la place ' + (i + 1));
    }
    for (const s of salles) await s.leave();
  });
  await test('table à mise : refusée sans assez de pièces, ou avec un code ; jamais trouvée par une ancienne version', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const pauvre = await invite('MisePauvre');
    await assert.rejects(client.joinOrCreate('kopo-mise', { jeton: pauvre.jeton, publique: true, taille: 4, mise: 'argent' }), /au moins 2000 pièces/);
    const riche = await invite('MiseRiche');
    const a = await client.joinOrCreate('kopo-mise', { jeton: riche.jeton, publique: true, taille: 4, mise: 'bronze' });
    a.onMessage('vue', () => {}); a.onMessage('erreur', () => {});
    await attendre(100);
    const ancien = await client.joinOrCreate('kopo', { jeton: pauvre.jeton, publique: true, taille: 4 });
    ancien.onMessage('vue', () => {}); ancien.onMessage('erreur', () => {});
    assert.notStrictEqual(ancien.roomId, a.roomId);
    const enLigne = (await api('/api/en-ligne')).json.sallesOuvertes;
    assert.strictEqual(enLigne.find((x) => x.id === a.roomId).mise, 'bronze');
    assert.strictEqual(enLigne.find((x) => x.id === ancien.roomId).mise, null);
    await assert.rejects(client.joinById(a.roomId, { jeton: pauvre.jeton, code: 'ABCD' }), /sans code/);
    await assert.rejects(client.create('kopo-mise', { jeton: riche.jeton, publique: true, taille: 4, mise: 'platine' }));
    const cfg = (await api('/api/config')).json;
    assert.deepStrictEqual([cfg.tables.bronze, cfg.deblocage, cfg.pot.maison, cfg.remiseAFlot], [50, 10, 15, 20]);
    await a.leave(); await ancien.leave();
  });

  console.log('Ligue classée et saisons');
  const P = DEFAUTS.ligue.points;
  const ligneLigue = async (id) => (await srv.base.query("SELECT l.* FROM ligue l JOIN saisons s ON s.numero = l.saison AND s.statut = 'en_cours' WHERE l.compte_id = $1", [id])).rows[0];
  await test('points selon la place : 9 joueurs, 4 joueurs, 3 joueurs, abandon, coupure', () => {
    const t = (n) => Array.from({ length: n }, (_, i) => calculerPoints({ place: i + 1, n }, P));
    assert.deepStrictEqual(t(9), [20, 8, 2, 0, 0, 0, 0, -8, -12]);
    assert.deepStrictEqual(t(5), [20, 8, 2, 0, -12]);
    assert.deepStrictEqual(t(4), [16, 6, 0, -12]);
    assert.deepStrictEqual(t(3), [12, 5, 0]);
    assert.strictEqual(calculerPoints({ place: 1, n: 9, abandon: true }, P), -20);
    // Un joueur moyen avance peu : +3,6 en moyenne à 5 joueurs, +1,1 à 9 (avant : +8 et +3,9).
    assert.ok(t(5).reduce((a, b) => a + b) / 5 < 4 && t(9).reduce((a, b) => a + b) / 9 < 2);
    assert.strictEqual(calculerPoints({ place: 9, n: 9, coupure: true }, P), 0);
  });
  await test('fin de saison : un dimanche à 19 h UTC, 4 semaines pile ensuite', () => {
    for (const d of ['2026-11-01T10:00:00Z', '2026-11-04T23:00:00Z', '2026-11-06T08:00:00Z']) {
      const f = finDeSaison(new Date(d), 28);
      const jours = (f - new Date(d)) / 864e5;
      assert.ok(f.getUTCDay() === 0 && f.getUTCHours() === 19, f.toISOString());
      assert.ok(jours >= 24 && jours <= 32, d + ' → ' + jours);
    }
    const f1 = finDeSaison(new Date('2026-11-29T19:00:00Z'), 28);
    assert.strictEqual(f1.toISOString(), '2026-12-27T19:00:00.000Z');
  });
  await test('saison 1 « Les Fondateurs » ouverte au démarrage, écran Ligue d\'un nouveau joueur', async () => {
    const j = await invite('Ligueur');
    const l = await api('/api/ligue', { jeton: j.jeton });
    assert.strictEqual(l.statut, 200);
    assert.strictEqual(l.json.saison.numero, 1);
    assert.strictEqual(l.json.saison.titre, 'Saison 1 : Les Fondateurs');
    assert.ok(new Date(l.json.saison.fin) > new Date());
    assert.deepStrictEqual(l.json.divisions.map((d) => d.nom), ['Bois', 'Bronze', 'Argent', 'Or', 'Diamant', 'Légende']);
    assert.deepStrictEqual([l.json.moi.points, l.json.moi.division, l.json.moi.rangMondial, l.json.moi.prochaine.manque], [0, 'bois', null, 100]);
    assert.strictEqual(l.json.recompense, null);
    assert.strictEqual((await api('/api/ligue')).statut, 401);
    // Toute première saison : elle part directement avec les seuils et paliers durcis.
    assert.deepStrictEqual(srv.reglages.get('ligue').seuils, DEFAUTS.durcissement.seuils);
    assert.strictEqual(srv.reglages.get('parcours').xpPalier, DEFAUTS.durcissement.xpPalier);
    assert.deepStrictEqual(srv.reglages.get('durcissement'), { enAttente: false });
  });
  const classes = [];
  await test('partie publique à 4 : classée, points selon la place, message « ligue » à chacun', async () => {
    const js = [];
    for (let i = 0; i < 4; i++) js.push(await invite('Lg' + i + Date.now() % 1000));
    classes.push(...js);
    const r = await jouerPublique(js);
    assert.ok([...r.classee.values()].every(Boolean), 'annoncée classée au départ');
    assert.strictEqual(r.ligue.size, 4);
    const attendus = [16, 6, 0, 0]; // le dernier perd 12, mais pas sous 0
    r.ordre.forEach((id, i) => {
      const m = r.ligue.get(id);
      assert.strictEqual(m.points, attendus[i], 'place ' + (i + 1) + ' ' + JSON.stringify(m));
      assert.strictEqual(m.division, 'bois');
      assert.strictEqual(m.saison.numero, 1);
    });
    const l = await ligneLigue(r.ordre[0]);
    assert.deepStrictEqual([l.points, l.parties, l.victoires], [16, 1, 1]);
    const p = (await srv.base.query('SELECT classee FROM parties ORDER BY fin DESC LIMIT 1')).rows[0];
    assert.strictEqual(p.classee, true);
  });
  await test('partie entre amis (code) : pas classée', async () => {
    const js = [await invite('Pv1' + Date.now() % 1000), await invite('Pv2' + Date.now() % 1000), await invite('Pv3' + Date.now() % 1000)];
    await jouerPartie(js);
    for (const j of js) assert.strictEqual(await ligneLigue(j.compte.id), undefined);
  });
  await test('salle publique rejointe avec le code par un ami : plus classée', async () => {
    const js = [await invite('Cd1' + Date.now() % 1000), await invite('Cd2' + Date.now() % 1000), await invite('Cd3' + Date.now() % 1000)];
    const r = await jouerPublique(js, { parCode: true });
    assert.strictEqual(r.classee.get(js[0].compte.id), false);
    assert.strictEqual(r.ligue.size, 0);
    for (const j of js) assert.strictEqual(await ligneLigue(j.compte.id), undefined);
  });
  await test('montée de division, palier de protection, descente', async () => {
    const [a, b, c] = classes;
    const saison = 1;
    await srv.base.query('UPDATE ligue SET points = 95, division = $3, protection = 0 WHERE saison = $1 AND compte_id = $2', [saison, a.compte.id, 'bois']);
    let r = await srv.ligue.enregistrerPartie({ partieId: 'p_test1', n: 9, joueurs: [{ id: a.compte.id, place: 1 }] });
    let m = r.get(a.compte.id);
    assert.deepStrictEqual([m.points, m.division, m.divisionAvant, m.promu, m.protection], [115, 'bronze', 'bois', true, 3]);
    // Protégé : une défaite ne le fait pas redescendre sous 100.
    await srv.base.query('UPDATE ligue SET points = 104 WHERE saison = $1 AND compte_id = $2', [saison, a.compte.id]);
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test2', n: 9, joueurs: [{ id: a.compte.id, place: 9 }] });
    m = r.get(a.compte.id);
    assert.deepStrictEqual([m.points, m.division, m.relegue, m.protection], [100, 'bronze', false, 2]);
    // Sans protection : il redescend.
    await srv.base.query('UPDATE ligue SET protection = 0 WHERE saison = $1 AND compte_id = $2', [saison, a.compte.id]);
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test3', n: 9, joueurs: [{ id: a.compte.id, place: 9 }] });
    m = r.get(a.compte.id);
    assert.deepStrictEqual([m.points, m.division, m.relegue, m.delta], [88, 'bois', true, -12]);
    // Une même partie n'est jamais comptée deux fois.
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test3', n: 9, joueurs: [{ id: a.compte.id, place: 1 }] });
    assert.strictEqual(r.size, 0);
    assert.strictEqual((await ligneLigue(a.compte.id)).points, 88);
    // Coupure réseau : rien de perdu.
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test4', n: 9, joueurs: [{ id: b.compte.id, place: 9, coupure: true }, { id: c.compte.id, place: 1 }] });
    assert.strictEqual(r.get(b.compte.id).delta, 0);
    // Meilleure division atteinte gardée (Bronze), même après la descente.
    assert.strictEqual((await ligneLigue(a.compte.id)).meilleure, 'bronze');
  });
  await test('classements : mondial, pays, amis', async () => {
    const [a, b, c, d] = classes;
    await srv.base.query('UPDATE ligue SET points = 500, division = $2, meilleure = $2 WHERE compte_id = $1', [d.compte.id, 'or']);
    const m = await api('/api/classement?type=mondial', { jeton: b.jeton });
    assert.strictEqual(m.json.liste[0].id, d.compte.id);
    assert.strictEqual(m.json.liste[0].rang, 1);
    assert.ok(m.json.moi && m.json.moi.id === b.compte.id && m.json.moi.rang > 1);
    assert.ok(m.json.total >= 4);
    // Pays : choisi dans le profil.
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: b.jeton, corps: { pays: 'cd' } })).json.compte.pays, 'CD');
    assert.strictEqual((await api('/api/moi', { methode: 'PATCH', jeton: b.jeton, corps: { pays: 'Congo' } })).statut, 400);
    await api('/api/moi', { methode: 'PATCH', jeton: c.jeton, corps: { pays: 'CD' } });
    await api('/api/moi', { methode: 'PATCH', jeton: d.jeton, corps: { pays: 'CI' } });
    const p = await api('/api/classement?type=pays', { jeton: b.jeton });
    assert.strictEqual(p.json.pays, 'CD');
    assert.deepStrictEqual(p.json.liste.map((x) => x.id).sort(), [b.compte.id, c.compte.id].sort());
    assert.strictEqual((await api('/api/classement?type=pays&pays=CI', { jeton: b.jeton })).json.liste[0].id, d.compte.id);
    const l = await api('/api/ligue', { jeton: b.jeton });
    assert.ok(l.json.moi.rangPays >= 1 && l.json.moi.rangMondial >= 2, JSON.stringify(l.json.moi));
    // Amis : moi + mes amis, même un ami qui n'a pas encore joué.
    const nouveau = await invite('PasJoue' + Date.now() % 1000);
    await devenirAmis(b, d);
    await devenirAmis(b, nouveau);
    const am = await api('/api/classement?type=amis', { jeton: b.jeton });
    assert.deepStrictEqual(am.json.liste.map((x) => x.id), [d.compte.id, b.compte.id, nouveau.compte.id]);
    assert.strictEqual(am.json.liste[2].points, 0);
  });

  console.log('Rivalités, notifications, invitations');
  await test('face-à-face : une partie à 3 ne compte pas, seul un duel à deux compte', async () => {
    const js = [await invite('Fa1' + Date.now() % 1000), await invite('Fa2' + Date.now() % 1000), await invite('Fa3' + Date.now() % 1000)];
    const fin = await jouerPartie(js);
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    await new Promise((ok) => setTimeout(ok, 300));
    const r = await api('/api/rivaux', { jeton: js.find((j) => j.compte.id === ordre[0]).jeton });
    assert.deepStrictEqual(r.json, [], 'même salon à 3 : pas de face-à-face');
    assert.deepStrictEqual(await srv.social.apresPartie([{ id: js[0].compte.id, place: 1 }, { id: js[1].compte.id, place: 2 }, { id: js[2].compte.id, place: 3 }]), []);
    assert.deepStrictEqual(await srv.social.duels(js[0].compte.id, [js[1].compte.id, js[2].compte.id]), []);
  });
  for (const jeu of ['kopo', 'inter8']) await test(`face-à-face : un duel à deux compte (${jeu}), le même score des deux côtés`, async () => {
    const js = [await invite('Du1' + jeu.slice(0, 2) + Date.now() % 1000), await invite('Du2' + jeu.slice(0, 2) + Date.now() % 1000)];
    const fin = await jouerPartie(js, { jeu });
    await new Promise((ok) => setTimeout(ok, 300));
    const v = js.find((j) => j.compte.id === fin.vainqueur), autre = js.find((j) => j.compte.id !== fin.vainqueur);
    const [d1] = await srv.social.duels(v.compte.id, [autre.compte.id]);
    const [d2] = await srv.social.duels(autre.compte.id, [v.compte.id]);
    assert.deepStrictEqual([d1.moi, d1.lui], [1, 0]);
    assert.deepStrictEqual([d2.moi, d2.lui], [0, 1]);
    assert.strictEqual((await api('/api/rivaux', { jeton: v.jeton })).json.length, 1);
    assert.deepStrictEqual(await srv.social.duels(v.compte.id, []), []);
  });
  await test('statistiques du compte et copie du profil : gardées par le serveur', async () => {
    const js = [await invite('Sta' + Date.now() % 1000), await invite('Stb' + Date.now() % 1000), await invite('Stc' + Date.now() % 1000)];
    const fin = await jouerPartie(js);
    const v = js.find((j) => j.compte.id === fin.vainqueur);
    const st = await api('/api/statistiques', { jeton: v.jeton });
    assert.strictEqual(st.statut, 200);
    assert.deepStrictEqual(st.json.stats, { parties: 1, victoires: 1, finales: 1, eliminePremier: 0, battus: 2 });
    assert.deepStrictEqual(st.json.entrainement, { parties: 0, victoires: 0 });
    assert.strictEqual(st.json.rivaux.length, 0, 'partie à 3 : pas de face-à-face');
    const premier = js.find((j) => j.compte.id === fin.elimines[0]);
    assert.strictEqual((await api('/api/statistiques', { jeton: premier.jeton })).json.stats.eliminePremier, 1);
    assert.strictEqual((await api('/api/statistiques', { jeton: premier.jeton })).json.stats.battus, 0);
    // Copie du profil du téléphone.
    assert.strictEqual((await api('/api/profil', { jeton: v.jeton })).json.profil, null);
    assert.strictEqual((await api('/api/profil', { methode: 'PUT', jeton: v.jeton, corps: { profil: [] } })).statut, 400);
    const p = { version: 1, xp: 420, premierePartie: '2026-10-01', stats: { parties: 12 } };
    assert.strictEqual((await api('/api/profil', { methode: 'PUT', jeton: v.jeton, corps: { profil: p } })).statut, 200);
    assert.deepStrictEqual((await api('/api/profil', { jeton: v.jeton })).json.profil, p);
    assert.strictEqual((await api('/api/profil', { jeton: premier.jeton })).json.profil, null, 'chacun la sienne');
  });
  await test('rivalité entre amis : « t\'a rattrapé », une seule par jour, et 1 – 0 ne compte pas', async () => {
    const [x, y] = [await invite('Riv' + Date.now() % 1000), await invite('Ral' + Date.now() % 1000)];
    await devenirAmis(x, y);
    const S = srv.social;
    assert.deepStrictEqual(await S.apresPartie([{ id: x.compte.id, place: 1 }, { id: y.compte.id, place: 2 }]), []);
    const e = await S.apresPartie([{ id: y.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]);
    assert.deepStrictEqual(e, [{ a: x.compte.id, texte: `${y.compte.pseudo} t'a rattrapé : 1 – 1 !` }]);
    assert.deepStrictEqual(await S.apresPartie([{ id: y.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]), [], 'pas deux le même jour');
    const n = await api('/api/notifications', { jeton: x.jeton });
    assert.strictEqual(n.json.liste[0].type, 'rivalite');
    assert.deepStrictEqual([n.json.liste[0].donnees.toi, n.json.liste[0].donnees.lui], [1, 1]);
    // y a reçu la demande d'ami de x.
    const ny = await api('/api/notifications', { jeton: y.jeton });
    assert.strictEqual(ny.json.liste[0].type, 'ami');
    assert.strictEqual(ny.json.nonLues, 1);
    await api('/api/notifications/lues', { methode: 'POST', jeton: y.jeton, corps: {} });
    assert.strictEqual((await api('/api/notifications', { jeton: y.jeton })).json.nonLues, 0);
  });
  await test('rivalité entre inconnus : à partir de 3 – 3 ; coupée dans le profil, plus rien', async () => {
    const [x, y, z] = [await invite('Inc' + Date.now() % 1000), await invite('Inb' + Date.now() % 1000), await invite('Ind' + Date.now() % 1000)];
    const [a, b] = x.compte.id < y.compte.id ? [x, y] : [y, x];
    await srv.base.query('INSERT INTO face_a_face (a, b, victoires_a, victoires_b) VALUES ($1,$2,3,2)', [a.compte.id, b.compte.id]);
    const e = await srv.social.apresPartie([{ id: b.compte.id, place: 1 }, { id: a.compte.id, place: 3, abandon: false }]);
    assert.deepStrictEqual(e.map((v) => v.texte), [`${b.compte.pseudo} t'a rattrapé : 3 – 3 !`]);
    // z coupe les notifications de rivalité.
    const ch = await api('/api/moi', { methode: 'PATCH', jeton: z.jeton, corps: { notifs: { rivalite: false } } });
    assert.strictEqual(ch.json.compte.notifs.rivalite, false);
    await devenirAmis(x, z);
    await srv.social.apresPartie([{ id: z.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]);
    assert.deepStrictEqual(await srv.social.apresPartie([{ id: x.compte.id, place: 1 }, { id: z.compte.id, place: 2 }]), []);
  });
  await test('inviter un ami dans sa salle : ami seulement, code valide, pas de rafale', async () => {
    const [x, y, z] = [await invite('Hot' + Date.now() % 1000), await invite('Inv' + Date.now() % 1000), await invite('Aut' + Date.now() % 1000)];
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.pseudo + '#' + y.compte.numero } });
    assert.strictEqual((await api('/api/amis/' + y.compte.id + '/inviter', { methode: 'POST', jeton: x.jeton, corps: { code: 'ABCD' } })).statut, 404, 'demande pas encore acceptée');
    await api('/api/amis/demandes/' + x.compte.id + '/accepter', { methode: 'POST', jeton: y.jeton });
    assert.strictEqual((await api('/api/amis/' + z.compte.id + '/inviter', { methode: 'POST', jeton: x.jeton, corps: { code: 'ABCD' } })).statut, 404);
    assert.strictEqual((await api('/api/amis/' + y.compte.id + '/inviter', { methode: 'POST', jeton: x.jeton, corps: { code: 'ab' } })).statut, 400);
    assert.strictEqual((await api('/api/amis/' + y.compte.id + '/inviter', { methode: 'POST', jeton: x.jeton, corps: { code: 'ABCD' } })).json.envoyee, true);
    assert.strictEqual((await api('/api/amis/' + y.compte.id + '/inviter', { methode: 'POST', jeton: x.jeton, corps: { code: 'ABCD' } })).statut, 429);
    const n = (await api('/api/notifications', { jeton: y.jeton })).json.liste.find((v) => v.type === 'invitation');
    assert.deepStrictEqual([n.donnees.code, n.donnees.pseudo, n.texte], ['ABCD', x.compte.pseudo, `${x.compte.pseudo} t'invite à sa table`]);
  });

  console.log('Tableau de bord admin');
  await test('code à deux facteurs (TOTP) : bon code accepté, mauvais refusé', () => {
    assert.ok(verifierTotp(TOTP, codeTotp(TOTP)));
    assert.ok(!verifierTotp(TOTP, '000000') || codeTotp(TOTP) === '000000');
  });
  await test('connexion admin : mot de passe + code', async () => {
    assert.strictEqual((await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'faux', code: codeTotp(TOTP) } })).statut, 401);
    const r = await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'motdepasse-admin', code: codeTotp(TOTP) } });
    assert.ok(r.json.jeton);
    adminJeton = r.json.jeton;
    assert.strictEqual((await api('/admin/api/direct')).statut, 401);
    assert.strictEqual((await api('/admin/api/direct', { jeton: a.jeton })).statut, 401, 'un jeton joueur ne vaut pas un jeton admin');
  });
  await test('en direct, audience, économie', async () => {
    const d = await api('/admin/api/direct', { jeton: adminJeton });
    assert.strictEqual(typeof d.json.joueursConnectes, 'number');
    const au = await api('/admin/api/audience', { jeton: adminJeton });
    assert.ok(au.json.actifs.jour >= 10, JSON.stringify(au.json.actifs));
    assert.strictEqual(au.json.parJour.length, 30);
    const e = await api('/admin/api/economie', { jeton: adminJeton });
    assert.ok(e.json.parJour.at(-1).creees > 0);
  });
  await test('recherche et fiche joueur, sanction, journal', async () => {
    const l = await api('/admin/api/joueurs?q=Alice', { jeton: adminJeton });
    assert.strictEqual(l.json.joueurs[0].id, a.compte.id);
    assert.strictEqual(typeof l.json.comptage.total, 'number');
    const f = await api('/admin/api/joueurs/' + a.compte.id, { jeton: adminJeton });
    assert.strictEqual(f.json.signalementsRecus.length, 1);
    assert.strictEqual(f.json.stats.signalements, 1);
    assert.strictEqual(typeof f.json.stats.operations, 'number');
    assert.ok(f.json.parties.length <= 50 && f.json.pieces.length <= 50, 'listes de la fiche plafonnées');
    await api(`/admin/api/joueurs/${a.compte.id}/sanction`, { methode: 'POST', jeton: adminJeton, corps: { type: 'suspension', motif: 'insultes', jours: 1 } });
    assert.strictEqual((await srv.comptes.lire(a.compte.id)).statut, 'suspendu');
    await api(`/admin/api/joueurs/${a.compte.id}/sanction`, { methode: 'POST', jeton: adminJeton, corps: { type: 'levee', motif: 'erreur' } });
    assert.strictEqual((await srv.comptes.lire(a.compte.id)).statut, 'actif');
    const j = await api('/admin/api/journal', { jeton: adminJeton });
    assert.strictEqual(j.json[0].action, 'sanction:levee');
  });
  await test('corriger un solde, cadeau à tous', async () => {
    const r = await api(`/admin/api/joueurs/${b.compte.id}/pieces`, { methode: 'POST', jeton: adminJeton, corps: { montant: 100, motif: 'remboursement' } });
    assert.strictEqual(r.json.solde, 600);
    const c = await api('/admin/api/cadeau', { methode: 'POST', jeton: adminJeton, corps: { montant: 25, motif: 'panne' } });
    assert.ok(c.json.joueurs >= 10);
    assert.strictEqual((await srv.comptes.lire(b.compte.id)).solde, 625);
  });
  await test('signalements : liste et traitement', async () => {
    const l = await api('/admin/api/signalements', { jeton: adminJeton });
    assert.strictEqual(l.json.length, 1);
    await api('/admin/api/signalements/' + l.json[0].id, { methode: 'POST', jeton: adminJeton, corps: { statut: 'traite', decision: 'averti' } });
    assert.strictEqual((await api('/admin/api/signalements', { jeton: adminJeton })).json.length, 0);
  });
  await test('réglages : gains modifiés sans mise à jour, pot à 100 % obligatoire, annonce', async () => {
    await api('/admin/api/reglages/gains', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { bienvenue: 300, manche: 5, katapss: 10, victoire: 40, deuxieme: 15 } } });
    assert.strictEqual((await invite('Nouveau')).compte.solde, 300);
    assert.strictEqual((await api('/admin/api/reglages/pot', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { vainqueur: 60, deuxieme: 25, troisieme: 10, maison: 15 } } })).statut, 400);
    await api('/admin/api/reglages/annonce', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { texte: 'Tournoi samedi !', active: true } } });
    assert.strictEqual((await api('/api/config')).json.annonce, 'Tournoi samedi !');
  });
  await test('réglages : la version minimale ne dépasse jamais la version actuelle de l\'appli', async () => {
    const actuelle = (await api('/admin/api/reglages', { jeton: adminJeton })).json.versionAppli;
    assert.ok(/^[0-9.]+$/.test(actuelle));
    assert.strictEqual((await api('/admin/api/reglages/versionMin', { methode: 'PUT', jeton: adminJeton, corps: { valeur: '99.0' } })).statut, 400);
    assert.strictEqual((await api('/admin/api/reglages/versionMin', { methode: 'PUT', jeton: adminJeton, corps: { valeur: 'abc' } })).statut, 400);
    await api('/admin/api/reglages/versionMin', { methode: 'PUT', jeton: adminJeton, corps: { valeur: actuelle } });
    assert.strictEqual((await api('/api/config')).json.versionMin, actuelle);
    await api('/admin/api/reglages/versionMin', { methode: 'PUT', jeton: adminJeton, corps: { valeur: '1.0' } });
  });
  await test('réglages : Inter (8) réservé aux testeurs, Kopo en maintenance, Kopo continue pour les autres', async () => {
    const t = await invite('Testeuse'), autre = await invite('Passant');
    const ecrireJeux = (valeur) => api('/admin/api/reglages/jeux', { methode: 'PUT', jeton: adminJeton, corps: { valeur } });
    assert.deepStrictEqual((await api('/api/config')).json.jeux, { kopo: 'ouvert', inter8: 'ouvert' });
    assert.strictEqual((await ecrireJeux({ kopo: 'maintenance', inter8: 'testeurs', testeurs: '' })).statut, 400, 'au moins un jeu ouvert');
    assert.strictEqual((await ecrireJeux({ kopo: 'ouvert', inter8: 'ferme' })).statut, 400);
    await ecrireJeux({ kopo: 'ouvert', inter8: 'testeurs', testeurs: 'testeuse, Testeuse\n' });
    assert.deepStrictEqual((await api('/admin/api/reglages', { jeton: adminJeton })).json.jeux.testeurs, ['testeuse']);
    assert.deepStrictEqual((await api('/api/config', { jeton: t.jeton })).json.jeux, { kopo: 'ouvert', inter8: 'test' });
    assert.deepStrictEqual((await api('/api/config', { jeton: autre.jeton })).json.jeux, { kopo: 'ouvert', inter8: 'ferme' });
    assert.deepStrictEqual((await api('/api/config')).json.jeux, { kopo: 'ouvert', inter8: 'ferme' });
    const client = new Client(URL_.replace('http', 'ws'));
    const a = await client.create('inter8', { jeton: t.jeton, code: 'TEST' });
    a.onMessage('vue', () => {}); a.onMessage('erreur', () => {});
    await assert.rejects(client.join('inter8', { jeton: autre.jeton, code: 'TEST' }), /pas encore ouvert/);
    const k = await client.create('kopo', { jeton: autre.jeton, code: 'KOKO' });
    k.onMessage('vue', () => {}); k.onMessage('erreur', () => {});
    // Kopo en maintenance : on n'entre plus, mais Inter reste ouvert à tous.
    await ecrireJeux({ kopo: 'maintenance', inter8: 'ouvert', testeurs: [] });
    assert.deepStrictEqual((await api('/api/config')).json.jeux, { kopo: 'maintenance', inter8: 'ouvert' });
    await assert.rejects(client.join('kopo', { jeton: t.jeton, code: 'KOKO' }), /Kopo est en maintenance/);
    await ecrireJeux({ kopo: 'ouvert', inter8: 'ouvert', testeurs: [] });
    await a.leave(); await k.leave();
  });
  await test('réglages : fenêtre « Nouveau » de la compétition, éteinte par défaut', async () => {
    assert.strictEqual((await api('/api/config')).json.nouveaute, null);
    await api('/admin/api/reglages/nouveaute', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { bande: true, autre: '<b>' } } });
    assert.strictEqual((await api('/api/config')).json.nouveaute, 'bande');
    assert.deepStrictEqual((await api('/admin/api/reglages', { jeton: adminJeton })).json.nouveaute, { bande: true });
    await api('/admin/api/reglages/nouveaute', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { bande: false } } });
    assert.strictEqual((await api('/api/config')).json.nouveaute, null);
  });
  await test('groupes de la communauté : gérés dans l\'admin, seuls les visibles avec un lien vont aux joueurs, dans l\'ordre', async () => {
    assert.deepStrictEqual((await api('/api/config')).json.communautes, []);
    const mettre = (valeur) => api('/admin/api/reglages/communautes', { methode: 'PUT', jeton: adminJeton, corps: { valeur } });
    assert.strictEqual((await mettre([{ reseau: 'myspace', url: 'https://a.b' }])).statut, 400, 'réseau inconnu');
    assert.strictEqual((await mettre([{ reseau: 'whatsapp', url: 'javascript:alert(1)' }])).statut, 400, 'lien dangereux');
    assert.strictEqual((await mettre([{ reseau: 'whatsapp', url: 'http://chat.whatsapp.com/x' }])).statut, 400, 'http refusé');
    assert.strictEqual((await mettre([{ reseau: 'whatsapp', libelle: '<b>', url: 'https://a.b' }])).statut, 400);
    const ok = await mettre([
      { reseau: 'telegram', libelle: '  Kopo   Kinshasa ', url: 't.me/kopo', visible: true },
      { reseau: 'facebook', libelle: 'Page', url: 'https://facebook.com/kopo', visible: false },
      { reseau: 'whatsapp', libelle: '', url: '', visible: true },
      { reseau: 'whatsapp', libelle: '', url: 'https://chat.whatsapp.com/abc', visible: true },
    ]);
    assert.strictEqual(ok.statut, 200);
    assert.strictEqual(ok.json.valeur.length, 4, 'l\'admin garde aussi les groupes cachés ou sans lien');
    assert.deepStrictEqual((await api('/api/config')).json.communautes, [
      { reseau: 'telegram', libelle: 'Kopo Kinshasa', url: 'https://t.me/kopo' },
      { reseau: 'whatsapp', libelle: 'WhatsApp', url: 'https://chat.whatsapp.com/abc' },
    ]);
    await mettre([]);
  });
  await test('chat : messages gérés dans l\'admin, les autres sont refusés en partie', async () => {
    const mauvais = await api('/admin/api/reglages/messagesRapides', { methode: 'PUT', jeton: adminJeton, corps: { valeur: ['x'.repeat(41)] } });
    assert.strictEqual(mauvais.statut, 400);
    assert.strictEqual((await api('/admin/api/reglages/messagesRapides', { methode: 'PUT', jeton: adminJeton, corps: { valeur: [] } })).statut, 400);
    const ok = await api('/admin/api/reglages/messagesRapides', { methode: 'PUT', jeton: adminJeton, corps: { valeur: ['👍', '  On se calme  ', '👍', '', 'Belle main, bravo à toi !'] } });
    assert.strictEqual(ok.statut, 200);
    assert.deepStrictEqual((await api('/api/config')).json.messages, ['👍', 'On se calme', 'Belle main, bravo à toi !']);
    const client = new Client(URL_.replace('http', 'ws'));
    const [x, y] = [await invite('Cha' + Date.now() % 1000), await invite('Cho' + Date.now() % 1000)];
    const a = await client.create('kopo', { jeton: x.jeton, code: 'CHAT' });
    const b = await client.join('kopo', { jeton: y.jeton, code: 'CHAT' });
    const recus = [], erreurs = [];
    b.onMessage('reaction', (e) => recus.push(e.emoji)); a.onMessage('reaction', () => {});
    a.onMessage('erreur', (e) => erreurs.push(e)); b.onMessage('erreur', () => {});
    [a, b].forEach((r) => r.onMessage('vue', () => {}));
    a.send('reaction', { emoji: 'texte libre interdit' });
    await attendre(150);
    a.send('reaction', { emoji: 'Belle main, bravo à toi !' });
    await attendre(200);
    assert.deepStrictEqual(recus, ['Belle main, bravo à toi !']);
    assert.strictEqual(erreurs.length, 1);
    await a.leave(); await b.leave();
  });
  await test('ligue dans le tableau de bord : résumé, saison renommée, fin dans le passé refusée', async () => {
    const r = await api('/admin/api/ligue', { jeton: adminJeton });
    assert.strictEqual(r.json.saison.numero, 1);
    assert.ok(r.json.joueurs >= 4);
    assert.strictEqual(r.json.parDivision.length, 6);
    assert.ok(r.json.top.length >= 4);
    const m = await api('/admin/api/ligue/saison', { methode: 'PUT', jeton: adminJeton, corps: { nom: 'Les Pionniers' } });
    assert.strictEqual(m.json.saison.titre, 'Saison 1 : Les Pionniers');
    assert.strictEqual((await api('/admin/api/ligue/saison', { methode: 'PUT', jeton: adminJeton, corps: { fin: '2020-01-01' } })).statut, 400);
    const mauvais = { ...DEFAUTS.ligue, seuils: { ...DEFAUTS.ligue.seuils, argent: 50 } };
    assert.strictEqual((await api('/admin/api/reglages/ligue', { methode: 'PUT', jeton: adminJeton, corps: { valeur: mauvais } })).statut, 400);
    assert.strictEqual((await api('/admin/api/ligue/cloturer', { methode: 'POST', jeton: adminJeton, corps: {} })).statut, 400);
  });
  await test('fin de saison : récompense selon la division atteinte, titre, descente, saison suivante', async () => {
    const [a, b, , d] = classes;
    const soldeA = (await srv.comptes.lire(a.compte.id)).solde, soldeD = (await srv.comptes.lire(d.compte.id)).solde;
    await api('/admin/api/reglages/prochaineSaison', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { nom: 'Kinshasa la belle', theme: 'ville' } } });
    // Durcissement en attente : appliqué à l'ouverture de la saison 2 (rien ne change pour la saison 1 en cours).
    const durci = { enAttente: true, seuils: { bois: 0, bronze: 100, argent: 350, or: 600, diamant: 1000, legende: 1500 }, xpPalier: 120 };
    assert.strictEqual((await api('/admin/api/reglages/durcissement', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...durci, seuils: { ...durci.seuils, or: 200 } } } })).statut, 400);
    assert.strictEqual((await api('/admin/api/reglages/durcissement', { methode: 'PUT', jeton: adminJeton, corps: { valeur: durci } })).statut, 200);
    await api('/admin/api/reglages/parcours', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...DEFAUTS.parcours, xpPalier: 100 } } });
    const r = await api('/admin/api/ligue/cloturer', { methode: 'POST', jeton: adminJeton, corps: { confirmation: 'CLOTURER' } });
    assert.deepStrictEqual([r.json.cloturee, r.json.ouverte], [1, 2]);
    assert.deepStrictEqual(srv.reglages.get('ligue').seuils, durci.seuils);
    assert.strictEqual(srv.reglages.get('parcours').xpPalier, 120);
    assert.deepStrictEqual(srv.reglages.get('durcissement'), { enAttente: false });
    // a a atteint Bronze (redescendu en Bois) : récompense Bronze. d a fini en Or.
    assert.strictEqual((await srv.comptes.lire(a.compte.id)).solde, soldeA + DEFAUTS.ligue.recompenses.bronze);
    assert.strictEqual((await srv.comptes.lire(d.compte.id)).solde, soldeD + DEFAUTS.ligue.recompenses.or);
    const l = await api('/api/ligue', { jeton: d.jeton });
    assert.strictEqual(l.json.saison.titre, 'Saison 2 : Kinshasa la belle');
    assert.deepStrictEqual([l.json.recompense.titre, l.json.recompense.rang, l.json.recompense.pieces], ['Or S1', 1, DEFAUTS.ligue.recompenses.or]);
    assert.deepStrictEqual(l.json.titres.map((t) => t.titre), ['Or S1']);
    // Or → Argent (une division de moins), avec la protection de début de saison.
    assert.deepStrictEqual([l.json.moi.division, l.json.moi.points, l.json.moi.protection], ['argent', 350, DEFAUTS.ligue.protection]);
    // Bois et Bronze repartent de zéro.
    assert.strictEqual((await api('/api/ligue', { jeton: a.jeton })).json.moi.points, 0);
    await api('/api/ligue/vu', { methode: 'POST', jeton: d.jeton });
    assert.strictEqual((await api('/api/ligue', { jeton: d.jeton })).json.recompense, null);
    // Le registre garde la trace, et le nom prévu a servi une fois.
    const reg = (await srv.base.query("SELECT montant FROM registre_pieces WHERE compte_id = $1 AND motif = 'saison'", [d.compte.id])).rows;
    assert.deepStrictEqual(reg.map((x) => x.montant), [DEFAUTS.ligue.recompenses.or]);
    assert.deepStrictEqual(srv.reglages.get('prochaineSaison'), { nom: '', theme: '' });
    // Rien ne se passe tant que la nouvelle saison n'est pas finie ; pas de double récompense.
    assert.deepStrictEqual(await srv.ligue.assurerSaison(), {});
    const resume = await api('/admin/api/ligue', { jeton: adminJeton });
    assert.strictEqual(resume.json.passees[0].champion, d.compte.pseudo + '#' + d.compte.numero);
    // b n'a pas encore classé de partie en saison 2 : absent du mondial, présent chez ses amis.
    const am = await api('/api/classement?type=amis', { jeton: b.jeton });
    assert.strictEqual(am.json.liste[0].id, d.compte.id);
  });

  console.log('Parcours de saison, collection, boutique');
  await test('XP de saison : base, manches survécues, victoire ; une partie entre humains en donne', async () => {
    assert.strictEqual(srv.parcours.xpPartie({ place: 1, manchesSurvecues: 3 }), 10 + 9 + 10);
    assert.strictEqual(srv.parcours.xpPartie({ place: 4, manchesSurvecues: 1 }), 13);
    assert.strictEqual(srv.parcours.xpPartie({ place: 2, abandon: true }), 0);
    const js = [await invite('Xp1' + Date.now() % 1000), await invite('Xp2' + Date.now() % 1000)];
    await jouerPartie(js);
    const e = await api('/api/parcours', { jeton: js[0].jeton });
    assert.ok(e.json.xp >= 10, JSON.stringify({ xp: e.json.xp }));
    assert.strictEqual(e.json.xpPalier, 120, 'paliers durcis depuis la saison 2');
    assert.strictEqual(e.json.paliers.length, 30);
    const contenu = require('../src/catalogue').contenuParcours(30, (await srv.ligue.saisonCourante()).numero);
    assert.strictEqual(e.json.paliers[29].gratuit.objet, contenu[29].gratuit.objet);
    assert.strictEqual(e.json.kopoPlus, false);
  });
  await test('parcours dès la saison 2 : pays seulement (pas de ville), saison 1 inchangée', async () => {
    const { contenuParcours, OBJETS } = require('../src/catalogue');
    const objets = (l) => l.flatMap((x) => [x.gratuit.objet, x.plus && x.plus.objet]).filter(Boolean);
    assert.ok(objets(contenuParcours(30, 1)).includes('av-lubumbashi'));
    // Cadres retirés : plus aucun dans le parcours ; leurs paliers gratuits donnent 500 pièces.
    for (const saison of [1, 2]) assert.ok(objets(contenuParcours(30, saison)).every((id) => !OBJETS[id].retire && OBJETS[id].type !== 'cadre'));
    assert.strictEqual(contenuParcours(30, 2)[2].gratuit.pieces, 500);
    for (const saison of [2, 3, 7]) {
      const o = objets(contenuParcours(30, saison));
      assert.ok(o.length >= 10);
      assert.ok(o.every((id) => OBJETS[id] && !OBJETS[id].ville), o.join());
      assert.strictEqual(contenuParcours(30, saison)[29].gratuit.objet, 'dos-dakar');
    }
  });
  const pj = await invite('Passe' + Date.now() % 1000);
  let plusRecu;
  await test('récupérer les paliers : pièces, objet, pas deux fois, pas avant de l\'avoir atteint, Kopo+ réservé', async () => {
    const s = (await srv.ligue.saisonCourante()).numero;
    await srv.base.query('INSERT INTO parcours (saison, compte_id, xp) VALUES ($1,$2,1250)', [s, pj.compte.id]);
    const solde = (await srv.comptes.lire(pj.compte.id)).solde;
    const r1 = await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 1 } });
    assert.deepStrictEqual([r1.json.pieces, r1.json.solde], [60, solde + 60]);
    const contenu = require('../src/catalogue').contenuParcours(30, s);
    const r3 = await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 10 } });
    assert.strictEqual(r3.json.objet.id, contenu[9].gratuit.objet);
    assert.strictEqual((await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 10 } })).statut, 409);
    assert.strictEqual((await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 11 } })).statut, 400);
    assert.strictEqual((await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 4, voie: 'plus' } })).statut, 403);
    await api(`/admin/api/joueurs/${pj.compte.id}/kopo-plus`, { methode: 'POST', jeton: adminJeton, corps: { jours: 30 } });
    assert.strictEqual((await api('/api/moi', { jeton: pj.jeton })).json.compte.kopoPlus, true);
    const rp = await api('/api/parcours/recuperer', { methode: 'POST', jeton: pj.jeton, corps: { palier: 4, voie: 'plus' } });
    assert.strictEqual(rp.json.objet.id, contenu[3].plus.objet);
    plusRecu = rp.json.objet.id;
    const e = await api('/api/parcours', { jeton: pj.jeton });
    assert.deepStrictEqual([e.json.palier, e.json.paliers[0].gratuit.recupere, e.json.paliers[3].plus.recupere, e.json.paliers[1].gratuit.recupere], [10, true, true, false]);
  });
  await test('collection : équiper ce qu\'on possède (même un ancien objet « ville ») ; cadres retirés', async () => {
    await srv.parcours.donner(pj.compte.id, 'av-lubumbashi', 'admin');
    const e = await api('/api/collection/equiper', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'av-lubumbashi' } });
    assert.strictEqual(e.json.equipes.avatar, 'av-lubumbashi');
    assert.ok(e.json.possedes.includes(plusRecu) && e.json.possedes.includes('av-laiton'));
    assert.strictEqual((await api('/api/collection/equiper', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'av-goma' } })).statut, 403);
    // Un cadre déjà possédé reste en base, mais n'est plus montré ni équipable.
    await srv.parcours.donner(pj.compte.id, 'cadre-dakar', 'admin');
    assert.strictEqual((await api('/api/collection/equiper', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'cadre-dakar' } })).statut, 400);
    const c = (await api('/api/collection', { jeton: pj.jeton })).json;
    assert.strictEqual(c.equipes.avatar, 'av-lubumbashi');
    assert.ok(!c.possedes.includes('cadre-dakar') && !('cadre' in c.equipes));
    assert.strictEqual((await srv.base.query("SELECT 1 FROM inventaire WHERE compte_id = $1 AND objet = 'cadre-dakar'", [pj.compte.id])).rows.length, 1);
  });
  await test('boutique : prix affiché, pas deux fois, objets de saison pas en vente, solde insuffisant refusé', async () => {
    await srv.comptes.crediter(pj.compte.id, 1200, 'admin', 'test boutique', true);
    const b = await api('/api/boutique', { jeton: pj.jeton });
    assert.ok(b.json.objets.find((o) => o.id === 'av-nuit').prix === 1200);
    // Par catégorie : chaque dos coûte plus que chaque avatar. Plus de cadre dans la boutique (retirés).
    const enVente = (t) => b.json.objets.filter((o) => o.type === t && o.prix != null).map((o) => o.prix);
    assert.ok(Math.min(...enVente('dos')) > Math.max(...enVente('avatar')));
    assert.ok(!b.json.objets.some((o) => o.type === 'cadre'));
    assert.strictEqual((await api('/api/boutique/acheter', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'cadre-dakar' } })).statut, 400);
    // Thème des pays : plus de ville en vente, mais les objets « ville » restent connus (ceux qui les ont les gardent).
    assert.ok(b.json.objets.filter((o) => o.ville).every((o) => o.prix == null));
    assert.strictEqual(b.json.objets.find((o) => o.id === 'av-dakar').nom, 'Sénégal');
    assert.strictEqual((await api('/api/boutique/acheter', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'cadre-lubumbashi' } })).statut, 400);
    const avant = b.json.solde;
    const a = await api('/api/boutique/acheter', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'av-nuit' } });
    assert.strictEqual(a.json.solde, avant - 1200);
    assert.strictEqual((await api('/api/boutique/acheter', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'av-nuit' } })).statut, 409);
    assert.strictEqual((await api('/api/boutique/acheter', { methode: 'POST', jeton: pj.jeton, corps: { objet: 'dos-fondateurs' } })).statut, 400);
    const pauvre = await invite('Pauvre' + Date.now() % 1000);
    const r = await api('/api/boutique/acheter', { methode: 'POST', jeton: pauvre.jeton, corps: { objet: 'dos-kinshasa' } });
    assert.strictEqual(r.statut, 400);
    assert.match(r.json.erreur, /insuffisant/);
    const reg = (await srv.base.query("SELECT montant, ref FROM registre_pieces WHERE compte_id = $1 AND motif = 'boutique'", [pj.compte.id])).rows;
    assert.deepStrictEqual(reg, [{ montant: -1200, ref: 'av-nuit' }]);
  });
  await test('cadres retirés : un cadre acheté en boutique est remboursé une seule fois, du prix payé', async () => {
    const j = await invite('Cadre' + Date.now() % 1000);
    await srv.comptes.crediter(j.compte.id, 1000, 'admin', 'test cadre', true);
    await srv.comptes.crediter(j.compte.id, -1000, 'boutique', 'cadre-dakar');
    await srv.parcours.donner(j.compte.id, 'cadre-dakar', 'boutique');
    const avant = (await srv.comptes.lire(j.compte.id)).solde;
    await srv.parcours.rembourserCadres();
    await srv.parcours.rembourserCadres();
    assert.strictEqual((await srv.comptes.lire(j.compte.id)).solde, avant + 1000);
    const r = (await srv.base.query("SELECT montant, ref FROM registre_pieces WHERE compte_id = $1 AND motif = 'remboursement_cadre'", [j.compte.id])).rows;
    assert.deepStrictEqual(r, [{ montant: 1000, ref: 'cadre-dakar' }]);
  });

  // ----- Parrainage
  const jetonG = (sub, { providerId, email } = {}) => new jose.SignJWT({ email, app_metadata: { provider: 'google' }, user_metadata: { provider_id: providerId, email } })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('s'.repeat(40)));
  const connexionG = async (sub, opts = {}, corps = {}) => (await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonG(sub, opts), ...corps } })).json;
  // Partie terminée écrite directement en base (plus rapide qu'une vraie partie).
  const partieFictive = async (ids, { robots = false, abandon = null } = {}) => {
    const id = 'p_test' + Math.random().toString(36).slice(2);
    await srv.base.query("INSERT INTO parties (id, code, nb_joueurs, avec_robots, debut, fin) VALUES ($1, 'TEST', $2, $3, now(), now())", [id, ids.length, robots]);
    for (let i = 0; i < ids.length; i++) await srv.base.query('INSERT INTO participations (partie_id, compte_id, place, abandon) VALUES ($1,$2,$3,$4)', [id, ids[i], ids[i] === abandon ? null : i + 1, ids[i] === abandon]);
    return srv.parrainage.apresPartie(ids);
  };
  const solde = async (id) => (await srv.comptes.lire(id)).solde;
  let parrain, filleul, codeParrain;
  await test("admin Joueurs : e-mail Google affiché, filtre et comptage", async () => {
    const g = await connexionG('google-mail-1', { email: 'Mail.Test@Gmail.com' });
    const l = (await api('/admin/api/joueurs?q=mail.test@gmail', { jeton: adminJeton })).json;
    assert.strictEqual(l.joueurs.length, 1);
    assert.strictEqual(l.joueurs[0].id, g.compte.id);
    assert.strictEqual(l.joueurs[0].email, 'mail.test@gmail.com');
    const google = (await api('/admin/api/joueurs?filtre=google', { jeton: adminJeton })).json;
    assert.ok(google.joueurs.length && google.joueurs.every((c) => c.lie));
    const invites = (await api('/admin/api/joueurs?filtre=invite', { jeton: adminJeton })).json;
    assert.ok(invites.joueurs.length && invites.joueurs.every((c) => !c.lie && !c.email));
    const k = google.comptage;
    assert.ok(k.google >= 1 && k.total === k.google + k.invites);
    const f = (await api('/admin/api/joueurs/' + g.compte.id, { jeton: adminJeton })).json;
    assert.strictEqual(f.compte.email, 'mail.test@gmail.com');
    // L'adresse ne sort jamais vers les joueurs.
    assert.strictEqual((await api('/api/moi', { jeton: g.jeton })).json.compte.email, undefined);
  });
  await test('parrainage : lien réservé aux comptes Google, code stable', async () => {
    const inv = await invite('SansGoogle' + Date.now() % 1000);
    const e0 = (await api('/api/parrainage', { jeton: inv.jeton })).json;
    assert.deepStrictEqual([e0.lie, e0.code], [false, null]);
    parrain = await connexionG('sb-parrain', { providerId: 'g-parrain', email: 'parrain@gmail.com' });
    const e1 = (await api('/api/parrainage', { jeton: parrain.jeton })).json;
    assert.match(e1.code, /^[A-Z0-9]{6}$/);
    assert.strictEqual((await api('/api/parrainage', { jeton: parrain.jeton })).json.code, e1.code);
    assert.strictEqual(e1.regles.parties, 5);
    codeParrain = e1.code;
  });
  await test('parrainage : pas d\'auto-parrainage, pas pour un invité ni un ancien compte', async () => {
    const soi = await connexionG('sb-parrain', { providerId: 'g-parrain', email: 'parrain@gmail.com' }, { parrain: codeParrain });
    assert.match(soi.parrainage.erreur, /toi-même/);
    const inv = await invite('Invite' + Date.now() % 1000);
    const r = await api('/api/parrainage', { methode: 'POST', jeton: inv.jeton, corps: { code: codeParrain } });
    assert.strictEqual(r.statut, 400); assert.match(r.json.erreur, /Google/);
    // Un vieux compte invité qui se connecte à Google pour la première fois n'est pas un nouveau joueur.
    const vieux = await invite('Vieux' + Date.now() % 1000);
    await srv.base.query("UPDATE comptes SET cree_le = now() - interval '10 days' WHERE id = $1", [vieux.compte.id]);
    const v = await connexionG('sb-vieux', { providerId: 'g-vieux' }, { jeton: vieux.jeton, parrain: codeParrain });
    assert.strictEqual(v.parrainage.ok, false); assert.match(v.parrainage.erreur, /nouveaux joueurs/);
    assert.match((await connexionG('sb-x', { providerId: 'g-x' }, { parrain: 'ZZZZZZ' })).parrainage.erreur, /inconnu/);
  });
  await test('parrainage : 5 parties entre humains, les parties seul avec son parrain ou avec robots ne comptent pas', async () => {
    const inv = await invite('Filleul' + Date.now() % 1000);
    filleul = await connexionG('sb-filleul', { providerId: 'g-filleul', email: 'Jean.Dupont+kopo@gmail.com' }, { jeton: inv.jeton, parrain: codeParrain });
    assert.strictEqual(filleul.parrainage.ok, true);
    assert.strictEqual(filleul.compte.id, inv.compte.id);
    // Deuxième parrain refusé.
    assert.strictEqual((await api('/api/parrainage', { methode: 'POST', jeton: filleul.jeton, corps: { code: codeParrain } })).statut, 400);
    const autre = await invite('Tiers' + Date.now() % 1000);
    const P = parrain.compte.id, F = filleul.compte.id, X = autre.compte.id;
    const [sp, sf] = [await solde(P), await solde(F)];
    await partieFictive([F, P]);                     // à deux avec son parrain
    await partieFictive([F, X], { robots: true });   // avec robots
    await partieFictive([X, F], { abandon: F });     // abandon
    for (let i = 0; i < 4; i++) assert.deepStrictEqual(await partieFictive([F, P, X]), []);
    let e = (await api('/api/parrainage', { jeton: parrain.jeton })).json;
    assert.deepStrictEqual([e.filleuls.length, e.filleuls[0].parties, e.filleuls[0].statut], [1, 4, 'en_cours']);
    const v = await partieFictive([X, F]);
    assert.strictEqual(v.length, 1);
    assert.deepStrictEqual([await solde(P) - sp, await solde(F) - sf], [300, 200]);
    // Une seule fois.
    await partieFictive([X, F]);
    assert.deepStrictEqual([await solde(P) - sp, await solde(F) - sf], [300, 200]);
    e = (await api('/api/parrainage', { jeton: parrain.jeton })).json;
    assert.deepStrictEqual([e.filleuls[0].statut, e.recompenses.total], ['valide', 1]);
    assert.strictEqual((await api('/api/parrainage', { jeton: filleul.jeton })).json.parrain.statut, 'valide');
    const notifs = (await api('/api/notifications', { jeton: parrain.jeton })).json.liste;
    assert.ok(notifs.some((n) => n.type === 'parrainage' && /300 pièces/.test(n.texte)));
    const reg = (await srv.base.query("SELECT motif, montant FROM registre_pieces WHERE motif LIKE 'parrainage%' AND compte_id = ANY($1) ORDER BY motif", [[P, F]])).rows;
    assert.deepStrictEqual(reg, [{ motif: 'parrainage', montant: 300 }, { motif: 'parrainage_filleul', montant: 200 }]);
  });
  await test('parrainage : supprimer son compte et revenir avec le même Google ne redonne rien', async () => {
    assert.strictEqual((await api('/api/moi', { methode: 'DELETE', jeton: filleul.jeton })).statut, 200);
    // Supabase recrée l'utilisateur (nouvel identifiant), mais l'identifiant Google reste le même.
    const re = await connexionG('sb-filleul-bis', { providerId: 'g-filleul', email: 'jean.dupont@gmail.com' }, { parrain: codeParrain });
    assert.notStrictEqual(re.compte.id, filleul.compte.id);
    assert.strictEqual(re.parrainage.ok, false); assert.match(re.parrainage.erreur, /déjà été utilisé/);
    // Même adresse Gmail écrite autrement, autre identifiant : refusé aussi.
    const re2 = await connexionG('sb-filleul-ter', { providerId: 'g-autre', email: 'jeandupont+x@googlemail.com' }, { parrain: codeParrain });
    assert.strictEqual(re2.parrainage.ok, false);
    // Les empreintes ne contiennent ni l'identifiant ni l'adresse en clair.
    const emp = (await srv.base.query('SELECT empreinte FROM empreintes')).rows.map((r) => r.empreinte).join(' ');
    assert.ok(!/g-filleul|dupont/i.test(emp));
  });
  await test('parrainage : plafond du mois (levé pour un créateur), paliers pour les gros parrains', async () => {
    const reg = srv.reglages.get('parrainage');
    assert.strictEqual(reg.total, 0, 'pas de plafond à vie');
    const P = parrain.compte.id;
    const nouveauFilleul = async (n) => {
      const f = await connexionG('sb-f' + n, { providerId: 'g-f' + n }, { parrain: codeParrain });
      assert.strictEqual(f.parrainage.ok, true, f.parrainage.erreur);
      return f.compte.id;
    };
    const X = (await invite('Tiers2' + Date.now() % 1000)).compte.id;
    await srv.reglages.ecrire('parrainage', { ...reg, parties: 1, parMois: 2 });
    await partieFictive([X, await nouveauFilleul(2)]); // 2e récompensé : plafond du mois atteint
    let sp = await solde(P);
    const f3 = await nouveauFilleul(3), sf = await solde(f3);
    await partieFictive([X, f3]);                      // au-delà du plafond : le parrain n'a pas les 300…
    assert.deepStrictEqual([await solde(P) - sp, await solde(f3) - sf], [500, 200]); // … mais le palier 3 amis : 500 pièces
    assert.strictEqual((await srv.base.query('SELECT note FROM parrainages WHERE filleul_id = $1', [f3])).rows[0].note, 'plafond du mois');
    // … le 3e ami compte pour les paliers (500 pièces, plus de cadre Ambassadeur).
    assert.ok(!(await api('/api/collection', { jeton: parrain.jeton })).json.possedes.includes('cadre-ambassadeur'));
    // Créateur vérifié par l'admin : plus de plafond par mois.
    await srv.parrainage.createur(P, true);
    sp = await solde(P);
    await partieFictive([X, await nouveauFilleul(4)]);
    assert.strictEqual(await solde(P) - sp, 300);
    // Palier de 10 amis : 1 000 pièces, avatar et titre « Ambassadeur » (une seule fois).
    for (let i = 5; i <= 9; i++) await partieFictive([X, await nouveauFilleul(i)]);
    sp = await solde(P);
    await partieFictive([X, await nouveauFilleul(10)]);
    assert.strictEqual(await solde(P) - sp, 300 + 1000);
    const e = (await api('/api/parrainage', { jeton: parrain.jeton })).json;
    assert.deepStrictEqual([e.amis, e.titre, e.createur, e.regles.parMois], [10, 'Ambassadeur', true, null]);
    assert.ok(e.paliers.find((x) => x.n === 10).atteint && !e.paliers.find((x) => x.n === 25).atteint);
    assert.ok((await api('/api/collection', { jeton: parrain.jeton })).json.possedes.includes('av-ambassadeur'));
    const paliers = (await srv.base.query("SELECT ref FROM registre_pieces WHERE compte_id = $1 AND motif = 'parrainage_palier'", [P])).rows;
    assert.deepStrictEqual(paliers, [{ ref: 'palier:3' }, { ref: 'palier:10' }]);
    await srv.parrainage.createur(P, false);
    await srv.reglages.ecrire('parrainage', reg);
  });
  await test('parrainage : expiré après le délai, réglages vérifiés', async () => {
    const f = await connexionG('sb-lent', { providerId: 'g-lent' }, { parrain: codeParrain });
    await srv.base.query("UPDATE parrainages SET expire_le = now() - interval '1 minute' WHERE filleul_id = $1", [f.compte.id]);
    const X = (await invite('Tiers3' + Date.now() % 1000)).compte.id;
    for (let i = 0; i < 5; i++) await partieFictive([X, f.compte.id]);
    assert.strictEqual((await api('/api/parrainage', { jeton: f.jeton })).json.parrain.statut, 'expire');
    await assert.rejects(srv.reglages.ecrire('parrainage', { ...srv.reglages.get('parrainage'), parties: 0 }));
  });

  await test('trop d\'essais de connexion admin : bloqué', async () => {
    for (let i = 0; i < 5; i++) await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'x', code: '1' } });
    const r = await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'motdepasse-admin', code: codeTotp(TOTP) } });
    assert.match(r.json.erreur, /Trop d'essais/);
  });

  await test('page fermée en pleine partie : le joueur reprend sa place avec le code (mêmes cartes), salle pleine et verrouillée', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const js = [];
    for (const p of ['Ret1', 'Ret2', 'Ret3', 'Ret4']) js.push(await invite(p + Math.floor(Math.random() * 1000)));
    const vues = new Map();
    const ecouter = (r, j) => { r.onMessage('vue', (v) => vues.set(j.compte.id, v)); r.onMessage('erreur', () => {}); r.onMessage('solde', () => {}); r.onMessage('classee', () => {}); };
    const salles = [];
    for (const j of js.slice(0, 3)) {
      const r = await client.joinOrCreate('kopo', { jeton: j.jeton, publique: true, taille: 3, rapide: true });
      ecouter(r, j); salles.push(r);
    }
    const [a, b] = salles, idB = js[1].compte.id;
    for (let t = 0; t < 40 && !(vues.get(idB) && vues.get(idB).etat === 'manche'); t++) await attendre(50);
    const avant = vues.get(idB);
    assert.strictEqual(avant.etat, 'manche', 'la partie a commencé');
    const code = avant.code, main = avant.manche.main.slice();
    // B ferme la page : coupure sans « Quitter ».
    await b.leave(false);
    await attendre(150);
    assert.strictEqual(vues.get(js[0].compte.id).joueurs.find((x) => x.id === idB).connecte, false);
    // Le code seul ne suffit pas (partie commencée) : c'était le bug.
    await assert.rejects(client.join('kopo', { jeton: js[1].jeton, code }));
    // Un inconnu à cette table n'a rien à reprendre.
    assert.strictEqual((await api('/api/reprendre', { methode: 'POST', jeton: js[3].jeton, corps: { code } })).statut, 404);
    assert.strictEqual((await api('/api/reprendre', { methode: 'POST', corps: { code } })).statut, 401);
    // B revient (nouvelle page, sans jeton de reconnexion) : il reprend sa place, ses cartes.
    const rep = await api('/api/reprendre', { methode: 'POST', jeton: js[1].jeton, corps: { code } });
    assert.strictEqual(rep.statut, 200, JSON.stringify(rep.json));
    vues.delete(idB);
    const b2 = await new Client(URL_.replace('http', 'ws')).consumeSeatReservation(rep.json);
    ecouter(b2, js[1]);
    assert.strictEqual(b2.roomId, a.roomId);
    b2.send('sync');
    for (let t = 0; t < 40 && !vues.get(idB); t++) await attendre(50);
    const apres = vues.get(idB);
    assert.strictEqual(apres.etat, 'manche');
    assert.deepStrictEqual(apres.manche.main, main, 'mêmes cartes');
    await attendre(100);
    const vuA = vues.get(js[0].compte.id).joueurs.find((x) => x.id === idB);
    assert.ok(vuA.connecte && !vuA.robot, 'les autres le voient revenu');
    // Ancienne page encore ouverte (coupure pas encore vue par le serveur) : la nouvelle prend la place, l'ancienne est écartée.
    let ecarte = null; b2.onLeave((c) => (ecarte = c));
    const rep2 = await api('/api/reprendre', { methode: 'POST', jeton: js[1].jeton, corps: { code } });
    assert.strictEqual(rep2.statut, 200, JSON.stringify(rep2.json));
    const b3 = await new Client(URL_.replace('http', 'ws')).consumeSeatReservation(rep2.json);
    ecouter(b3, js[1]);
    for (let t = 0; t < 40 && ecarte === null; t++) await attendre(50);
    assert.strictEqual(ecarte, 4000, 'ancienne page écartée');
    await attendre(150);
    assert.ok(vues.get(js[0].compte.id).joueurs.find((x) => x.id === idB).connecte, 'le départ de l\'ancienne page ne le déconnecte pas');
    for (const r of [a, salles[2], b3]) await r.leave();
  });
  await test('coupure réseau : retour avec le jeton de reconnexion, puis nouvelle coupure bien vue', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const [x, y] = [await invite('Rec' + Date.now() % 1000), await invite('Rek' + (Date.now() + 1) % 1000)];
    const code = 'RECO';
    const a = await client.create('kopo', { jeton: x.jeton, code, rapide: true });
    const b = await client.join('kopo', { jeton: y.jeton, code });
    let vueA = null; a.onMessage('vue', (v) => (vueA = v)); a.onMessage('erreur', () => {});
    b.onMessage('vue', () => {}); b.onMessage('erreur', () => {});
    await attendre(100);
    a.send('lancer');
    for (let t = 0; t < 40 && !(vueA && vueA.etat === 'manche'); t++) await attendre(50);
    const connecte = () => vueA.joueurs.find((j) => j.id === y.compte.id).connecte;
    const jetonReco = b.reconnectionToken;
    await b.leave(false);
    await attendre(150);
    assert.strictEqual(connecte(), false);
    const b2 = await client.reconnect(jetonReco);
    b2.onMessage('vue', () => {}); b2.onMessage('erreur', () => {});
    await attendre(150);
    assert.strictEqual(connecte(), true, 'revenu avec le jeton');
    await b2.leave(false);
    await attendre(150);
    assert.strictEqual(connecte(), false, 'la coupure suivante est vue');
    await a.leave();
  });

  // ===== Match du jour et Bande (competition-amis.md v1.3) =====
  console.log('Match du jour et Bande');
  const { classerSemaine, aGagner } = require('../src/bande');
  const MJ = require('../src/match-jour');
  // Joue le Match du jour jusqu'au bout (rapide) : renvoie le message de fin et la première main reçue.
  async function jouerMatchJour(jeton) {
    const client = new Client(URL_.replace('http', 'ws'));
    const salle = await client.create('kopo-jour', { jeton, rapide: true });
    let fin = null, debut = null, premiereMain = null;
    salle.onMessage('erreur', () => {});
    salle.onMessage('matchJour', (m) => { if (m.fin) fin = m; else debut = m; });
    salle.onMessage('vue', (v) => {
      if (v.manche && v.numeroManche === 1 && !premiereMain && v.manche.main.length === 4) premiereMain = v.manche.main.slice().sort();
      const a = v.manche && v.manche.actions.find((x) => x.type !== 'katapss') || (v.manche && v.manche.actions[0]);
      if (v.etat === 'manche' && a) setTimeout(() => { try { salle.send('action', { action: a }); } catch (e) {} }, 1);
      if (v.etat === 'finManche' && v.hote === v.moi) setTimeout(() => { try { salle.send('mancheSuivante'); } catch (e) {} }, 1);
    });
    for (let t = 0; t < 600 && !fin; t++) await attendre(50);
    await salle.leave().catch(() => {});
    return { fin, debut, premiereMain };
  }
  await test('Match du jour : score sur 100, jours et semaines à l\'heure de Kinshasa', () => {
    assert.deepStrictEqual([MJ.scoreDe(0, false), MJ.scoreDe(3, false), MJ.scoreDe(7, false), MJ.scoreDe(7, true), MJ.scoreDe(12, false)], [0, 30, 70, 100, 70]);
    assert.strictEqual(MJ.jourDe(new Date('2026-11-02T22:59:00Z')), '2026-11-02');
    assert.strictEqual(MJ.jourDe(new Date('2026-11-02T23:00:00Z')), '2026-11-03'); // minuit à Kinshasa
    assert.strictEqual(MJ.lundiDe('2026-11-08'), '2026-11-02');
    assert.strictEqual(MJ.lundiDe('2026-11-09'), '2026-11-09');
    assert.strictEqual(MJ.numeroDu('2026-11-02'), 1);
    assert.notStrictEqual(MJ.graineDu('2026-11-02', 'a'), MJ.graineDu('2026-11-03', 'a'));
  });
  let gA, gB;
  await test('Match du jour : réservé aux comptes Google', async () => {
    const inv = await invite('SansG' + Date.now() % 1000);
    const e = (await api('/api/match-jour', { jeton: inv.jeton })).json;
    assert.strictEqual(e.google, false);
    const client = new Client(URL_.replace('http', 'ws'));
    await assert.rejects(client.create('kopo-jour', { jeton: inv.jeton, rapide: true }), /Google/);
  });
  await test('Match du jour : un essai officiel, la même main pour deux joueurs, le score noté', async () => {
    gA = await connexionG('sb-mj-a', { providerId: 'g-mj-a' });
    gB = await connexionG('sb-mj-b', { providerId: 'g-mj-b' });
    const a = await jouerMatchJour(gA.jeton), b = await jouerMatchJour(gB.jeton);
    assert.ok(a.fin && b.fin, 'les deux Matchs se terminent');
    assert.strictEqual(a.debut.officiel, true);
    assert.deepStrictEqual(a.premiereMain, b.premiereMain, 'même donne pour tous');
    assert.strictEqual(a.fin.score, MJ.scoreDe(a.fin.manches, a.fin.victoire));
    await attendre(200);
    const e = (await api('/api/match-jour', { jeton: gA.jeton })).json;
    assert.deepStrictEqual([e.moi.score, e.moi.fini], [a.fin.score, true]);
    assert.ok(e.rang >= 1 && e.joueurs >= 2);
    // Deuxième entrée : entraînement, rien n'est noté.
    const c = await jouerMatchJour(gA.jeton);
    assert.strictEqual(c.debut.officiel, false);
    assert.strictEqual((await api('/api/match-jour', { jeton: gA.jeton })).json.moi.score, a.fin.score);
    const cl = (await api('/api/match-jour/classement?type=mondial', { jeton: gA.jeton })).json;
    assert.ok(cl.liste.some((x) => x.id === gA.compte.id) && cl.moi.id === gA.compte.id);
    // Le lendemain : rappel de mon score et de ma place mondiale d'hier.
    assert.strictEqual(e.hier, null);
    srv.matchJour.regler(() => new Date(Date.now() + 864e5));
    const demain = (await api('/api/match-jour', { jeton: gA.jeton })).json;
    srv.matchJour.regler(() => new Date());
    assert.deepStrictEqual([demain.hier.score, demain.hier.rang, demain.hier.numero, demain.moi], [a.fin.score, e.rang, e.numero, null]);
    assert.ok(demain.hier.joueurs >= 2);
  });
  await test('Match du jour : quitter en cours arrête le score là ; un essai en cours bloque l\'entraînement', async () => {
    const g = await connexionG('sb-mj-c', { providerId: 'g-mj-c' });
    const client = new Client(URL_.replace('http', 'ws'));
    const salle = await client.create('kopo-jour', { jeton: g.jeton });
    salle.onMessage('vue', () => {}); salle.onMessage('matchJour', () => {}); salle.onMessage('erreur', () => {});
    await attendre(150);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('kopo-jour', { jeton: g.jeton }), /en cours/);
    await salle.leave(true);
    await attendre(200);
    const e = (await api('/api/match-jour', { jeton: g.jeton })).json;
    assert.deepStrictEqual([e.moi.fini, e.moi.score], [true, 0]);
  });

  await test('Bande : classement de la semaine, pot, 2e remboursé, Loser, mise détruite sous 5 Matchs', () => {
    const r = { ...DEFAUTS.bande };
    const lundi = '2026-11-09', jours = [0, 1, 2, 3, 4, 5, 6].map((i) => MJ.ajouterJours(lundi, i));
    const ins = ['k', 'g', 'p', 't'].map((id) => ({ id, pseudo: id.toUpperCase(), mise: 1000, inscritLe: new Date('2026-11-08T23:30:00Z') }));
    const notes = { k: [90, 100, 80, 70, 100, 90, 80], g: [80, 80, 80, 80, 80, 80, 80], p: [10, 0, 20, 30, null, null, 40], t: [100, 100, 100, 100, null, null, null] };
    const scores = [];
    for (const [id, l] of Object.entries(notes)) l.forEach((n, i) => { if (n !== null) scores.push({ compte_id: id, jour: jours[i], score: n, statut: 'fini', debut: new Date(Date.parse(jours[i] + 'T10:00:00Z')) }); });
    const res = classerSemaine({ lundi, inscrits: ins, scores, r, maintenant: new Date('2026-11-16T10:00:00Z'), final: true });
    const l = Object.fromEntries(res.lignes.map((x) => [x.id, x]));
    assert.deepStrictEqual([l.k.total, l.g.total, l.p.total, l.t.total], [610, 560, 100, 400]);
    assert.strictEqual(l.t.enRegle, false, '4 Matchs sur 7 : hors course');
    assert.strictEqual(l.p.enRegle, true, '5 Matchs : en règle');
    assert.deepStrictEqual(res.chefs, ['k']); assert.deepStrictEqual(res.deuxiemes, ['g']); assert.deepStrictEqual(res.losers, ['p']);
    // Pot = 3 mises en règle (3 000) ; maison 15 % = 450 ; le 2e récupère 1 000 ; le Chef gagne 1 550. La mise de T est détruite.
    assert.deepStrictEqual([res.pot, res.maison, l.k.gain, l.g.gain, l.p.gain, l.t.gain], [3000, 450, 1550, 1000, 0, 0]);
    assert.strictEqual(res.detruit, 4000 - 2550);
    assert.strictEqual(aGagner(6, 1000, r), 4100); assert.strictEqual(aGagner(2, 1000, r), 1700); assert.strictEqual(aGagner(1, 1000, r), 0);
  });
  await test('Bande : à 2, le Chef gagne plus que sa mise ; égalité de Chefs ; retardataire = pire note - 10', () => {
    const r = { ...DEFAUTS.bande };
    const lundi = '2026-11-09', jours = [0, 1, 2, 3, 4, 5, 6].map((i) => MJ.ajouterJours(lundi, i));
    const d = (i) => new Date(Date.parse(jours[i] + 'T10:00:00Z'));
    const s = (id, l) => l.map((n, i) => ({ compte_id: id, jour: jours[i], score: n, statut: 'fini', debut: d(i) }));
    const deux = classerSemaine({ lundi, r, final: true, inscrits: [{ id: 'a', pseudo: 'A', mise: 1000, inscritLe: d(0) }, { id: 'b', pseudo: 'B', mise: 1000, inscritLe: d(0) }].map((x) => ({ ...x, inscritLe: new Date(Date.parse(lundi) - 36e5) })),
      scores: s('a', [70, 70, 70, 70, 70, 70, 70]).concat(s('b', [60, 60, 60, 60, 60, 60, 60])) });
    assert.deepStrictEqual([deux.gains.a, deux.rendus.b || 0, deux.losers[0]], [1700, 0, 'b']);
    const egal = classerSemaine({ lundi, r, final: true, inscrits: ['a', 'b', 'c'].map((id) => ({ id, pseudo: id, mise: 1000, inscritLe: new Date(Date.parse(lundi) - 36e5) })),
      scores: s('a', [50, 50, 50, 50, 50, 0, 0]).concat(s('b', [50, 50, 50, 50, 50, 0, 0]), s('c', [10, 10, 10, 10, 10, 0, 0])) });
    assert.deepStrictEqual(egal.chefs.sort(), ['a', 'b']);
    assert.deepStrictEqual([egal.gains.a, egal.gains.b, egal.deuxiemes.length], [1275, 1275, 0], 'deux Chefs : pas de 2e remboursé');
    // Inscrit mercredi : lundi et mardi valent la pire note des inscrits ce jour-là, moins 10 ; il doit jouer tous les jours restants.
    const mercredi = new Date(Date.parse(jours[2] + 'T08:00:00Z'));
    const ret = classerSemaine({ lundi, r, final: true, inscrits: [{ id: 'a', pseudo: 'A', mise: 1000, inscritLe: new Date(Date.parse(lundi) - 36e5) }, { id: 'b', pseudo: 'B', mise: 1000, inscritLe: new Date(Date.parse(lundi) - 36e5) }, { id: 'z', pseudo: 'Z', mise: 1000, inscritLe: mercredi }],
      scores: s('a', [40, 90, 50, 50, 50, 50, 50]).concat(s('b', [80, 30, 50, 50, 50, 50, 50]), s('z', [100, 100, 60, 60, 60, 60, 60])) });
    const z = ret.lignes.find((x) => x.id === 'z');
    assert.deepStrictEqual(z.jours.slice(0, 2).map((j) => [j.type, j.score]), [['retard', 30], ['retard', 20]], 'ses vrais scores d\'avant ne comptent pas');
    assert.strictEqual(z.total, 30 + 20 + 5 * 60);
    assert.strictEqual(z.enRegle, true);
    const ret2 = classerSemaine({ lundi, r, final: true, inscrits: [{ id: 'a', pseudo: 'A', mise: 1000, inscritLe: new Date(Date.parse(lundi) - 36e5) }, { id: 'z', pseudo: 'Z', mise: 1000, inscritLe: mercredi }],
      scores: s('a', [40, 90, 50, 50, 50, 50, 50]).concat(s('z', [0, 0, 60, 60, 60, 60]).slice(2)) });
    assert.strictEqual(ret2.lignes.find((x) => x.id === 'z').enRegle, false, 'un retardataire qui rate un jour est hors course');
    // Jour du lancement (2/11) : un Match joué avant de miser compte avec son vrai score ; le lendemain, plus.
    const l0 = MJ.PREMIER_JOUR, j0 = [0, 1].map((i) => MJ.ajouterJours(l0, i));
    const lancement = classerSemaine({ lundi: l0, r, maintenant: new Date(Date.parse(j0[1] + 'T20:00:00Z')), inscrits: [{ id: 'm', pseudo: 'M', mise: 500, inscritLe: new Date(Date.parse(j0[1] + 'T12:00:00Z')) }, { id: 'n', pseudo: 'N', mise: 500, inscritLe: new Date(Date.parse(j0[0] + 'T12:00:00Z')) }],
      scores: [{ compte_id: 'n', jour: j0[0], score: 30, statut: 'fini', debut: new Date(Date.parse(j0[0] + 'T10:00:00Z')) }, { compte_id: 'm', jour: j0[1], score: 40, statut: 'fini', debut: new Date(Date.parse(j0[1] + 'T10:00:00Z')) }] });
    assert.deepStrictEqual(lancement.lignes.find((x) => x.id === 'n').jours[0], { jour: j0[0], type: 'joue', score: 30 }, 'joué avant de miser le jour du lancement : compté');
    assert.strictEqual(lancement.lignes.find((x) => x.id === 'm').jours[1].type, 'retard', 'le lendemain, la règle anti-triche revient');
  });

  let bandeId, codeBande, membres;
  await test('Bande : créer (Google), rejoindre par le lien, 3 Bandes au plus, conditions pour miser', async () => {
    // Lundi 10 h : sinon, de jeudi à dimanche, « inscriptions fermées » répond avant les conditions pour miser.
    srv.matchJour.regler(() => new Date(MJ.debutDu(MJ.lundiDe(MJ.jourDe())).getTime() + 10 * 36e5));
    const inv = await invite('SansG2' + Date.now() % 1000);
    assert.strictEqual((await api('/api/bandes', { methode: 'POST', jeton: inv.jeton, corps: { nom: 'Les Lions', mise: 1000 } })).statut, 403);
    membres = [];
    for (const n of ['b1', 'b2', 'b3']) membres.push(await connexionG('sb-' + n, { providerId: 'g-' + n }));
    const c = await api('/api/bandes', { methode: 'POST', jeton: membres[0].jeton, corps: { nom: '  Les <Lions> de Matonge ', mise: 1000 } });
    assert.strictEqual(c.statut, 200, JSON.stringify(c.json));
    assert.strictEqual(c.json.nom, 'Les Lions de Matonge');
    bandeId = c.json.id; codeBande = c.json.code;
    assert.strictEqual((await api('/api/bandes', { methode: 'POST', jeton: membres[0].jeton, corps: { nom: 'Trop cher', mise: 20000 } })).statut, 400);
    for (const m of membres.slice(1)) assert.strictEqual((await api('/api/bandes/rejoindre', { methode: 'POST', jeton: m.jeton, corps: { code: codeBande } })).statut, 200);
    assert.strictEqual((await api('/api/bandes/' + bandeId, { jeton: inv.jeton })).statut, 403);
    const e = (await api('/api/bandes/' + bandeId, { jeton: membres[1].jeton })).json;
    assert.strictEqual(e.membres.length, 3);
    assert.strictEqual(e.moi.peutMiser, false, 'compte trop récent, pas assez de parties');
    assert.strictEqual((await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: membres[1].jeton })).statut, 403);
    // Un 4e Bande refusée.
    for (let i = 0; i < 2; i++) assert.strictEqual((await api('/api/bandes', { methode: 'POST', jeton: membres[2].jeton, corps: { nom: 'Bande ' + i } })).statut, 200);
    const trop = await api('/api/bandes', { methode: 'POST', jeton: membres[2].jeton, corps: { nom: 'Bande 3' } });
    assert.strictEqual(trop.statut, 400); assert.match(trop.json.erreur, /3 Bandes/);
  });
  await test('Bande : miser, semaine lancée à 2, fin de semaine avec partage du pot et notifications', async () => {
    await srv.reglages.ecrire('bande', { ...DEFAUTS.bande, joursCompte: 0, partiesMin: 0 });
    const lundi = MJ.lundiDe(MJ.jourDe());
    srv.matchJour.regler(() => new Date(MJ.debutDu(lundi).getTime() + 10 * 36e5)); // lundi 10 h à Kinshasa
    for (const m of membres) await srv.comptes.crediter(m.compte.id, 5000, 'admin', 'test');
    const avant = await solde(membres[0].compte.id);
    const r1 = await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: membres[0].jeton });
    assert.strictEqual(r1.statut, 200, JSON.stringify(r1.json));
    assert.strictEqual(await solde(membres[0].compte.id), avant - 1000);
    assert.strictEqual((await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: membres[0].jeton })).statut, 400, 'pas deux fois');
    assert.strictEqual(r1.json.semaine.lancee, false);
    for (const m of membres.slice(1)) assert.strictEqual((await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: m.jeton })).statut, 200);
    const e = (await api('/api/bandes/' + bandeId, { jeton: membres[0].jeton })).json;
    assert.deepStrictEqual([e.semaine.inscrits, e.semaine.lancee, e.semaine.aGagner], [3, true, 1550]);
    // Notes de la semaine : b1 joue tout (80), b2 tout (60), b3 seulement 3 jours (hors course).
    for (let i = 0; i < 7; i++) {
      const jour = MJ.ajouterJours(lundi, i);
      for (const [k, n] of [[0, 80], [1, 60], [2, i < 3 ? 100 : null]]) if (n !== null) await srv.base.query("INSERT INTO match_jour (compte_id, jour, score, manches, statut, debut, fin) VALUES ($1, $2, $3, 0, 'fini', $4, $4) ON CONFLICT (compte_id, jour) DO UPDATE SET score = $3, statut = 'fini', debut = $4", [membres[k].compte.id, jour, n, new Date(MJ.debutDu(jour).getTime() + 12 * 36e5)]);
    }
    const soldes = await Promise.all(membres.map((m) => solde(m.compte.id)));
    srv.matchJour.regler(() => new Date(MJ.debutDu(MJ.ajouterJours(lundi, 7)).getTime() + 60e3)); // lundi suivant, 0 h 01
    await srv.bande.tic();
    const apres = await Promise.all(membres.map((m) => solde(m.compte.id)));
    // 2 joueurs en règle : pot 2 000, maison 300, le Chef gagne 1 700 ; la mise de b3 est détruite.
    assert.deepStrictEqual(apres.map((x, i) => x - soldes[i]), [1700, 0, 0]);
    const f = (await api('/api/bandes/' + bandeId, { jeton: membres[1].jeton })).json;
    assert.deepStrictEqual([f.titres.chefs[0].id, f.titres.losers[0].id], [membres[0].compte.id, membres[2].compte.id]);
    const n = (await api('/api/notifications', { jeton: membres[0].jeton })).json;
    assert.ok(n.liste.some((x) => x.type === 'bande' && /Chef/.test(x.texte)));
    await srv.bande.tic(); // pas deux fois
    assert.strictEqual(await solde(membres[0].compte.id), apres[0]);
    const mes = (await api('/api/bandes', { jeton: membres[0].jeton })).json;
    assert.ok(mes.bandes.find((b) => b.id === bandeId).jeSuisChef);
  });
  await test('Bande : inscriptions fermées après mercredi 23 h ; seul inscrit, mise rendue', async () => {
    const lundi = MJ.lundiDe(MJ.jourDe(srv.matchJour.maintenant()));
    srv.matchJour.regler(() => new Date(MJ.debutDu(lundi).getTime() + 2 * 864e5 + 22 * 36e5)); // mercredi 22 h
    const avant = await solde(membres[1].compte.id);
    assert.strictEqual((await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: membres[1].jeton })).statut, 200);
    srv.matchJour.regler(() => new Date(MJ.debutDu(lundi).getTime() + 2 * 864e5 + 23 * 36e5 + 60e3)); // mercredi 23 h 01
    const ferme = await api(`/api/bandes/${bandeId}/miser`, { methode: 'POST', jeton: membres[0].jeton });
    assert.strictEqual(ferme.statut, 400); assert.match(ferme.json.erreur, /mercredi/);
    await srv.bande.tic();
    assert.strictEqual(await solde(membres[1].compte.id), avant, 'mise rendue');
    srv.matchJour.regler(() => new Date());
    await srv.reglages.ecrire('bande', { ...DEFAUTS.bande });
  });
  await test('Bande ouverte : un inconnu la voit, demande, le créateur accepte ; le créateur qui part passe la main', async () => {
    const [chef, , autre] = membres;
    assert.strictEqual((await api('/api/bandes/' + bandeId, { methode: 'PATCH', jeton: membres[1].jeton, corps: { ouverte: true } })).statut, 403);
    await api('/api/bandes/' + bandeId, { methode: 'PATCH', jeton: chef.jeton, corps: { ouverte: true, pays: '' } });
    const x = await connexionG('sb-b4', { providerId: 'g-b4' });
    assert.ok((await api('/api/bandes/ouvertes?pays=CD', { jeton: x.jeton })).json.liste.some((b) => b.id === bandeId), 'Bande sans pays : visible de tous');
    await api('/api/bandes/' + bandeId, { methode: 'PATCH', jeton: chef.jeton, corps: { ouverte: true, pays: 'CD' } });
    assert.ok(!(await api('/api/bandes/ouvertes?pays=SN', { jeton: x.jeton })).json.liste.some((b) => b.id === bandeId), 'Bande du Congo : pas dans la liste du Sénégal');
    const l = (await api('/api/bandes/ouvertes?pays=CD', { jeton: x.jeton })).json;
    assert.ok(l.liste.some((b) => b.id === bandeId));
    assert.strictEqual((await api(`/api/bandes/${bandeId}/demander`, { methode: 'POST', jeton: x.jeton })).statut, 200);
    const e = (await api('/api/bandes/' + bandeId, { jeton: chef.jeton })).json;
    assert.deepStrictEqual(e.demandes.map((d) => d.id), [x.compte.id]);
    await api(`/api/bandes/${bandeId}/demandes/${x.compte.id}`, { methode: 'POST', jeton: chef.jeton, corps: { accepter: true } });
    assert.strictEqual((await api('/api/bandes/' + bandeId, { jeton: x.jeton })).statut, 200);
    await api(`/api/bandes/${bandeId}/quitter`, { methode: 'POST', jeton: chef.jeton });
    const apres = (await api('/api/bandes/' + bandeId, { jeton: membres[1].jeton })).json;
    assert.strictEqual(apres.createur, true, 'le plus ancien devient créateur');
    assert.strictEqual(apres.membres.length, 3);
    assert.ok(autre);
  });
  await test('tableau de bord : Bandes et réglages vérifiés', async () => {
    const t = (await api('/admin/api/bandes', { jeton: adminJeton })).json;
    assert.ok(t.bandes.some((b) => b.id === bandeId));
    const mauvais = await api('/admin/api/reglages/bande', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...DEFAUTS.bande, miseMin: 20000 } } });
    assert.strictEqual(mauvais.statut, 400);
    const ok = await api('/admin/api/reglages/bande', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...DEFAUTS.bande, maison: 10 } } });
    assert.strictEqual(ok.json.valeur.maison, 10);
    await api('/admin/api/reglages/bande', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...DEFAUTS.bande } } });
  });
  await test('Google obligatoire en ligne et entre amis (salles kopo, kopo-mise, inter8), reprise permise', async () => {
    const { SalleKopo } = require('../src/salle-kopo');
    const client = new Client(URL_.replace('http', 'ws'));
    const inv = await invite('SansGoogle');
    const g = (await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonGoogle('google-obligatoire') } })).json;
    // Un invité déjà assis quand la règle s'allume peut reprendre sa place.
    const assise = await client.create('kopo', { jeton: inv.jeton, code: 'GOOA' });
    SalleKopo.services.googleObligatoire = true;
    try {
      await assert.rejects(client.create('kopo', { jeton: inv.jeton, code: 'GOOB' }), /Connecte-toi avec Google/);
      await assert.rejects(client.create('inter8', { jeton: inv.jeton, code: 'GOOC' }), /Connecte-toi avec Google/);
      await assert.rejects(client.joinOrCreate('kopo', { jeton: inv.jeton, publique: true, taille: 3 }), /Connecte-toi avec Google/);
      await assert.rejects(client.joinOrCreate('inter8', { jeton: inv.jeton, publique: true, taille: 3 }), /Connecte-toi avec Google/);
      await assert.rejects(client.joinOrCreate('kopo-mise', { jeton: inv.jeton, publique: true, taille: 3, mise: 'bronze' }), /Connecte-toi avec Google/);
      const retour = await client.join('kopo', { jeton: inv.jeton, code: 'GOOA' }); // déjà assis : il revient
      await retour.leave();
      const s = await client.create('inter8', { jeton: g.jeton, code: 'GOOD' });
      await s.leave();
    } finally { SalleKopo.services.googleObligatoire = false; }
    assert.ok(assise); // l'ancienne connexion a été écartée par le retour (même compte)
  });

  // --- Notifications push (envoi remplacé par une liste : aucun service de push contacté)
  const envois = [];
  const midi = () => new Date('2026-11-20T11:00:00Z'); // 12 h à Kinshasa
  srv.push.regler({ envoi: async (abo, charge, options) => {
    if (abo.endpoint.includes('perime')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    envois.push({ endpoint: abo.endpoint, ...JSON.parse(charge), options });
  }, maintenant: midi });
  const abo = (nom) => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/' + nom, keys: { p256dh: 'p' + nom, auth: 'a' + nom } });
  const pour = (nom) => envois.filter((e) => e.endpoint.endsWith('/' + nom));
  await test('push : abonnement, invitation et demande d\'ami envoyées au téléphone', async () => {
    const a = await invite('PushA'), b = await invite('PushB');
    assert.strictEqual((await api('/api/push/abonnement', { methode: 'POST', jeton: b.jeton, corps: { abonnement: { endpoint: 'http://pas-https', keys: {} } } })).statut, 400);
    assert.strictEqual((await api('/api/push/abonnement', { methode: 'POST', jeton: b.jeton, corps: { abonnement: { endpoint: 'https://pirate.exemple.com/x', keys: { p256dh: 'p', auth: 'a' } } } })).statut, 400, 'service de notification inconnu');
    assert.strictEqual((await api('/api/push/abonnement', { methode: 'POST', jeton: b.jeton, corps: { abonnement: abo('b1'), appareil: 'Android' } })).statut, 200);
    const e = (await api('/api/push', { jeton: b.jeton })).json;
    assert.strictEqual(e.appareils, 1); assert.deepStrictEqual(e.prefs, { invitation: true, ami: true, match: true, annonce: true, fleuve: true });
    await api('/api/amis', { methode: 'POST', jeton: a.jeton, corps: { cible: b.compte.pseudo + '#' + b.compte.numero } });
    await attendre(100);
    const d = pour('b1').find((x) => x.type === 'ami');
    assert.ok(d, 'demande d\'ami envoyée'); assert.match(d.texte, /PushA veut être ton ami/); assert.strictEqual(d.url, './?ouvrir=amis');
    await api('/api/push/abonnement', { methode: 'POST', jeton: a.jeton, corps: { abonnement: abo('a1') } });
    await api('/api/amis/demandes/' + encodeURIComponent(a.compte.id) + '/accepter', { methode: 'POST', jeton: b.jeton });
    await attendre(100);
    assert.ok(pour('a1').find((x) => x.type === 'ami' && /accepté/.test(x.texte)), 'acceptation envoyée');
    await api('/api/amis/' + encodeURIComponent(b.compte.id) + '/inviter', { methode: 'POST', jeton: a.jeton, corps: { code: 'PUSH' } });
    await attendre(100);
    const inv = pour('b1').find((x) => x.type === 'invitation');
    assert.ok(inv); assert.strictEqual(inv.url, './#PUSH'); assert.strictEqual(inv.options.TTL, 600); assert.strictEqual(inv.options.urgency, 'high');
  });
  await test('push : types coupés, nuit (sauf invitations), téléphone périmé oublié', async () => {
    const a = await invite('PushC'), b = await invite('PushD');
    await devenirAmis(a, b);
    await api('/api/push/abonnement', { methode: 'POST', jeton: b.jeton, corps: { abonnement: abo('d1') } });
    const p = await api('/api/push/prefs', { methode: 'PATCH', jeton: b.jeton, corps: { invitation: false, inconnu: true } });
    assert.strictEqual(p.json.prefs.invitation, false);
    await api('/api/amis/' + encodeURIComponent(b.compte.id) + '/inviter', { methode: 'POST', jeton: a.jeton, corps: { code: 'COUP' } });
    await attendre(100);
    assert.strictEqual(pour('d1').length, 0, 'invitation coupée : rien');
    // La notification reste dans le jeu.
    assert.ok((await api('/api/notifications', { jeton: b.jeton })).json.liste.some((n) => n.type === 'invitation'));
    await api('/api/push/prefs', { methode: 'PATCH', jeton: b.jeton, corps: { invitation: true } });
    srv.push.regler({ maintenant: () => new Date('2026-11-20T22:30:00Z') }); // 23 h 30 à Kinshasa
    try {
      assert.strictEqual(await srv.push.envoyer(b.compte.id, 'ami', { titre: 'x', texte: 'nuit' }), 0);
      assert.strictEqual(await srv.push.envoyer(b.compte.id, 'invitation', { titre: 'x', texte: 'nuit' }), 1);
    } finally { srv.push.regler({ maintenant: midi }); }
    await api('/api/push/abonnement', { methode: 'POST', jeton: b.jeton, corps: { abonnement: abo('perime') } });
    assert.strictEqual((await api('/api/push', { jeton: b.jeton })).json.appareils, 2);
    await srv.push.envoyer(b.compte.id, 'ami', { titre: 'x', texte: 'y' });
    assert.strictEqual((await api('/api/push', { jeton: b.jeton })).json.appareils, 1);
    await api('/api/push/abonnement', { methode: 'DELETE', jeton: b.jeton, corps: { endpoint: abo('d1').endpoint } });
    assert.strictEqual((await api('/api/push', { jeton: b.jeton })).json.appareils, 0);
  });
  await test('push : rappel du Match du jour à 19 h, une fois, pour les habitués pas encore venus', async () => {
    const h = await invite('PushHabitue'), n = await invite('PushNouveau'), j = await invite('PushDejaJoue');
    for (const [x, nom] of [[h, 'h1'], [n, 'n1'], [j, 'j1']]) await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo(nom) } });
    await srv.base.query("INSERT INTO match_jour (compte_id, jour, statut) VALUES ($1, '2026-11-18', 'fini'), ($2, '2026-11-18', 'fini'), ($2, '2026-11-20', 'fini')", [h.compte.id, j.compte.id]);
    srv.push.regler({ maintenant: () => new Date('2026-11-20T17:00:00Z') }); // 18 h : trop tôt
    try {
      assert.strictEqual(await srv.push.tic(), 0);
      srv.push.regler({ maintenant: () => new Date('2026-11-20T18:05:00Z') }); // 19 h 05
      await srv.push.tic();
      assert.strictEqual(pour('h1').filter((x) => x.type === 'match').length, 1);
      assert.match(pour('h1')[0].texte, /Match du jour n°19/);
      assert.strictEqual(pour('n1').length, 0, 'jamais joué : pas de rappel');
      assert.strictEqual(pour('j1').length, 0, 'déjà joué aujourd\'hui');
      await srv.push.rappelMatchJour(); // même après un redémarrage : un seul par jour
      assert.strictEqual(pour('h1').filter((x) => x.type === 'match').length, 1);
    } finally { srv.push.regler({ maintenant: midi }); }
  });
  await test('push : rappel de la série du bonus du jour à 17 h, une fois, si le bonus n\'est pas encore pris', async () => {
    const a = await invite('PushSerie'), b = await invite('PushSeriePris'), c = await invite('PushSerieCourte');
    for (const [x, nom] of [[a, 's1'], [b, 's2'], [c, 's3']]) await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo(nom) } });
    await srv.base.query("UPDATE comptes SET serie_bonus = 5, dernier_bonus = '2026-11-19' WHERE id = $1", [a.compte.id]);
    await srv.base.query("UPDATE comptes SET serie_bonus = 5, dernier_bonus = '2026-11-20' WHERE id = $1", [b.compte.id]);
    await srv.base.query("UPDATE comptes SET serie_bonus = 2, dernier_bonus = '2026-11-19' WHERE id = $1", [c.compte.id]);
    srv.push.regler({ maintenant: () => new Date('2026-11-20T16:05:00Z') }); // 17 h 05 à Kinshasa
    try {
      await srv.push.tic();
      const r = pour('s1').filter((x) => x.tag === 'serie-2026-11-20');
      assert.strictEqual(r.length, 1); assert.match(r[0].texte, /série de 5 jours/); assert.strictEqual(r[0].type, 'match');
      assert.strictEqual(pour('s2').length, 0, 'bonus déjà pris aujourd\'hui');
      assert.strictEqual(pour('s3').length, 0, 'série trop courte');
      await srv.push.rappelSerie(); // après un redémarrage : toujours un seul
      assert.strictEqual(pour('s1').length, 1);
      await api('/api/push/prefs', { methode: 'PATCH', jeton: b.jeton, corps: { match: false } });
      await srv.base.query("UPDATE comptes SET dernier_bonus = '2026-11-19' WHERE id = $1", [b.compte.id]);
      await srv.push.rappelSerie();
      assert.strictEqual(pour('s2').length, 0, 'rappels coupés avec le Match du jour');
    } finally { srv.push.regler({ maintenant: midi }); }
  });
  await test('push : rappel de mise de la Bande le mercredi à 18 h, pour les membres pas encore inscrits', async () => {
    const a = await invite('PushBandeA'), b = await invite('PushBandeB');
    for (const [x, nom] of [[a, 'ba1'], [b, 'bb1']]) await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo(nom) } });
    await srv.base.query("INSERT INTO bandes (id, nom, code, createur, mise) VALUES ('b_push', 'Les Lions', 'PUSHB1', $1, 500)", [a.compte.id]);
    await srv.base.query("INSERT INTO bande_membres (bande_id, compte_id) VALUES ('b_push', $1), ('b_push', $2)", [a.compte.id, b.compte.id]);
    await srv.base.query("INSERT INTO bande_semaines (bande_id, semaine, mise) VALUES ('b_push', '2026-11-16', 500)");
    await srv.base.query("INSERT INTO bande_inscriptions (bande_id, semaine, compte_id, mise) VALUES ('b_push', '2026-11-16', $1, 500)", [a.compte.id]);
    srv.push.regler({ maintenant: () => new Date('2026-11-17T17:05:00Z') }); // mardi 18 h 05 : rien
    try {
      await srv.push.tic();
      assert.strictEqual(pour('bb1').length, 0);
      srv.push.regler({ maintenant: () => new Date('2026-11-18T17:05:00Z') }); // mercredi 18 h 05
      await srv.push.tic();
      const r = pour('bb1');
      assert.strictEqual(r.length, 1); assert.match(r[0].texte, /Les Lions/); assert.match(r[0].texte, /23 h/);
      assert.strictEqual(pour('ba1').length, 0, 'déjà inscrit');
      await srv.push.rappelBande();
      assert.strictEqual(pour('bb1').length, 1, 'un seul par semaine');
    } finally { srv.push.regler({ maintenant: midi }); }
  });
  await test('push : fin de saison de la Ligue, 24 h avant, une fois, pour les joueurs classés', async () => {
    const a = await invite('PushLigue'), b = await invite('PushPasLigue');
    for (const [x, nom] of [[a, 'l1'], [b, 'l2']]) await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo(nom) } });
    const s = (await srv.base.query("SELECT numero, fin FROM saisons WHERE statut = 'en_cours'")).rows[0];
    await srv.base.query('INSERT INTO ligue (saison, compte_id, points, parties) VALUES ($1, $2, 40, 3)', [s.numero, a.compte.id]);
    await srv.base.query("UPDATE saisons SET fin = '2026-11-22T19:00:00Z' WHERE numero = $1", [s.numero]);
    try {
      srv.push.regler({ maintenant: () => new Date('2026-11-21T11:00:00Z') }); // 32 h avant : trop tôt
      assert.strictEqual(await srv.push.rappelSaison(), 0);
      srv.push.regler({ maintenant: () => new Date('2026-11-21T19:30:00Z') }); // samedi 20 h 30, 23 h 30 avant la fin
      await srv.push.tic();
      const r = pour('l1');
      assert.strictEqual(r.length, 1); assert.match(r[0].texte, /Plus que 24 h|Plus que 23 h/);
      assert.strictEqual(pour('l2').length, 0, 'pas classé cette saison');
      await srv.push.tic();
      assert.strictEqual(pour('l1').length, 1, 'une seule fois');
    } finally {
      await srv.base.query('UPDATE saisons SET fin = $2 WHERE numero = $1', [s.numero, s.fin]);
      srv.push.regler({ maintenant: midi });
    }
  });
  await test('push : relance des absents à 18 h, avec des pièces offertes, une fois par mois', async () => {
    const a = await invite('PushAbsent'), b = await invite('PushPresent'), c = await invite('PushParti');
    for (const [x, nom] of [[a, 'ab1'], [b, 'ab2'], [c, 'ab3']]) await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo(nom) } });
    await srv.base.query("UPDATE comptes SET vu_le = '2026-11-18T10:00:00Z' WHERE id = $1", [a.compte.id]);
    await srv.base.query("UPDATE comptes SET vu_le = '2026-11-22T10:00:00Z' WHERE id = $1", [b.compte.id]);
    await srv.base.query("UPDATE comptes SET vu_le = '2026-09-01T10:00:00Z' WHERE id = $1", [c.compte.id]);
    const avant = (await srv.comptes.lire(a.compte.id)).solde;
    srv.push.regler({ maintenant: () => new Date('2026-11-23T17:05:00Z') }); // lundi 18 h 05 à Kinshasa
    try {
      await srv.push.tic();
      const r = pour('ab1').filter((x) => /Tu nous manques/.test(x.texte));
      assert.strictEqual(r.length, 1); assert.match(r[0].texte, /100 pièces/);
      assert.strictEqual((await srv.comptes.lire(a.compte.id)).solde, avant + 100);
      assert.ok((await api('/api/notifications', { jeton: a.jeton })).json.liste.some((n) => n.type === 'cadeau' && n.donnees.relance));
      assert.strictEqual(pour('ab2').length, 0, 'venu il y a 1 jour');
      assert.strictEqual(pour('ab3').length, 0, 'parti depuis plus de 30 jours');
      srv.push.regler({ maintenant: () => new Date('2026-11-28T17:05:00Z') }); // 5 jours plus tard : pas de deuxième relance
      await srv.base.query("UPDATE comptes SET vu_le = '2026-11-23T10:00:00Z' WHERE id = $1", [a.compte.id]);
      await srv.push.rappelAbsents();
      assert.strictEqual(pour('ab1').filter((x) => /Tu nous manques/.test(x.texte)).length, 1);
    } finally { srv.push.regler({ maintenant: midi }); }
  });
  await test('réglage rappels : chaque rappel se coupe depuis le tableau de bord', async () => {
    await srv.reglages.ecrire('rappels', { serie: 0, bande: '1', saison: true });
    assert.deepStrictEqual(srv.reglages.get('rappels'), { serie: 0, bande: 1, saison: 1 });
    assert.strictEqual(await srv.push.rappelSerie(), 0);
    await srv.reglages.ecrire('rappels', DEFAUTS.rappels);
  });
  await test('push : annonce de l\'admin (compter, essai, envoi, limite de 10 min)', async () => {
    const x = await invite('PushAnnonce');
    await api('/api/push/abonnement', { methode: 'POST', jeton: x.jeton, corps: { abonnement: abo('x1') } });
    const avant = (await api('/admin/api/push/compter', { methode: 'POST', jeton: adminJeton, corps: {} })).json.joueurs;
    assert.ok(avant >= 1);
    assert.strictEqual((await api('/admin/api/push/compter', { methode: 'POST', jeton: adminJeton, corps: { public: { pays: 'XYZ' } } })).statut, 400);
    const essai = await api('/admin/api/push/annonce', { methode: 'POST', jeton: adminJeton, corps: { titre: 'Essai', texte: 'Bonjour', essai: x.compte.pseudo + '#' + x.compte.numero } });
    assert.strictEqual(essai.json.envoyees, 1);
    await api('/api/push/prefs', { methode: 'PATCH', jeton: x.jeton, corps: { annonce: false } });
    assert.strictEqual((await api('/admin/api/push/compter', { methode: 'POST', jeton: adminJeton, corps: {} })).json.joueurs, avant - 1);
    assert.strictEqual((await api('/admin/api/push/annonce', { methode: 'POST', jeton: adminJeton, corps: { titre: 'T', texte: '' } })).statut, 400);
    const r = await api('/admin/api/push/annonce', { methode: 'POST', jeton: adminJeton, corps: { titre: 'Tournoi', texte: 'Ce soir à 20 h !' } });
    assert.strictEqual(r.statut, 200); assert.strictEqual(r.json.joueurs, avant - 1);
    assert.strictEqual(pour('x1').filter((e) => e.titre === 'Tournoi').length, 0, 'annonces coupées : rien');
    assert.ok(envois.some((e) => e.titre === 'Tournoi'));
    assert.strictEqual((await api('/admin/api/push/annonce', { methode: 'POST', jeton: adminJeton, corps: { titre: 'Encore', texte: 'x' } })).statut, 429);
    const resume = (await api('/admin/api/push', { jeton: adminJeton })).json;
    assert.strictEqual(resume.annonces[0].titre, 'Tournoi');
  });
  // --- Applis mobiles (Flutter) : config, versions, jeton, /api/v1, entraînement contre les robots, push FCM
  await test('mobile : config (Supabase, liens légaux, versions), 426 pour une appli trop ancienne, /api/v1', async () => {
    const c = (await api('/api/config')).json;
    assert.ok(c.liens && /legal\/conditions\.html$/.test(c.liens.conditions) && /legal\/confidentialite\.html$/.test(c.liens.confidentialite));
    assert.deepStrictEqual(c.mobile, { android: { versionMin: null, store: null }, ios: { versionMin: null, store: null } });
    assert.strictEqual(c.miseAJour, false);
    assert.ok('push' in c && 'supabase' in c && 'googleObligatoire' in c);
    const x = await invite('MobileVers');
    const ecrire = (valeur) => api('/admin/api/reglages/mobile', { methode: 'PUT', jeton: adminJeton, corps: { valeur } });
    assert.strictEqual((await ecrire({ android: { versionMin: 'abc' } })).statut, 400);
    assert.strictEqual((await ecrire({ android: { versionMin: '1.2.0', store: 'https://play.google.com/store/apps/details?id=app.masano' }, ios: { versionMin: '' } })).statut, 200);
    try {
      const appel = async (chemin, client) => { const r = await fetch(URL_ + chemin, { headers: { authorization: 'Bearer ' + x.jeton, 'x-masano-client': client } }); return { statut: r.status, json: await r.json() }; };
      const vieux = await appel('/api/v1/moi', 'android/1.1.9');
      assert.strictEqual(vieux.statut, 426);
      assert.strictEqual(vieux.json.miseAJour.versionMin, '1.2.0'); assert.match(vieux.json.miseAJour.store, /play\.google/);
      assert.strictEqual((await appel('/api/v1/moi', 'android/1.2.0')).statut, 200);
      assert.strictEqual((await appel('/api/v1/moi', 'ios/0.1')).statut, 200, 'pas de minimum pour iOS');
      assert.strictEqual((await appel('/api/moi', 'Mozilla/5.0')).statut, 200, 'le site n\'est pas concerné');
      const conf = await appel('/api/v1/config', 'android/1.0.0');
      assert.strictEqual(conf.statut, 200); assert.strictEqual(conf.json.miseAJour, true);
    } finally { await ecrire({}); }
  });
  await test('mobile : renouveler le jeton', async () => {
    const x = await invite('MobileJeton');
    const r = await api('/api/v1/jeton', { methode: 'POST', jeton: x.jeton });
    assert.strictEqual(r.statut, 200); assert.ok(r.json.jeton && r.json.expireDans > 0);
    assert.strictEqual((await api('/api/v1/moi', { jeton: r.json.jeton })).json.compte.id, x.compte.id);
    assert.strictEqual((await api('/api/v1/jeton', { methode: 'POST', jeton: 'faux' })).statut, 401);
  });
  await test('mobile : salle par code (Kopo ou Inter (8)), invitation avec le jeu et l\'action « table »', async () => {
    const a = await invite('MobileHote'), b = await invite('MobileAmi');
    await devenirAmis(a, b);
    const client = new Client(URL_.replace('http', 'ws'));
    const s = await client.create('inter8', { jeton: a.jeton, code: 'MOBI', mode: 'delire' });
    s.onMessage('vue', () => {});
    await attendre(50);
    try {
      const r = await api('/api/v1/salles/mobi');
      assert.strictEqual(r.statut, 200);
      assert.strictEqual(r.json.jeu, 'inter8'); assert.strictEqual(r.json.salle, 'inter8'); assert.strictEqual(r.json.mode, 'delire'); assert.strictEqual(r.json.etat, 'salon');
      assert.strictEqual((await api('/api/v1/salles/ZZZZ')).statut, 404);
      assert.strictEqual((await api('/api/v1/salles/12')).statut, 400);
      await api('/api/v1/amis/' + encodeURIComponent(b.compte.id) + '/inviter', { methode: 'POST', jeton: a.jeton, corps: { code: 'MOBI' } });
      const n = (await api('/api/v1/notifications', { jeton: b.jeton })).json.liste.find((x) => x.type === 'invitation');
      assert.strictEqual(n.action, 'table'); assert.strictEqual(n.donnees.code, 'MOBI'); assert.strictEqual(n.donnees.jeu, 'inter8');
      assert.ok((await api('/api/v1/notifications', { jeton: b.jeton })).json.liste.some((x) => x.type === 'ami' && x.action === 'amis'));
    } finally { await s.leave(); }
  });
  await test('mobile : entraînement contre les robots sur le serveur, sans Google, une seule personne', async () => {
    const { SalleKopo } = require('../src/salle-kopo');
    const x = await invite('MobileSolo'), y = await invite('MobileIntrus');
    const client = new Client(URL_.replace('http', 'ws'));
    SalleKopo.services.googleObligatoire = true;
    let salle, fin = null, premiere = null;
    try {
      // Inter (8) : 3 robots Forts, mode Délire, réglages appliqués dès l'ouverture.
      const i8 = await client.create('entrainement', { jeton: x.jeton, jeu: 'inter8', robots: 3, niveau: 'forts', mode: 'delire', jRetour: false, delai: 10 });
      let vi = null; i8.onMessage('vue', (v) => { vi = v; });
      for (let t = 0; t < 40 && !vi; t++) await attendre(25);
      assert.strictEqual(vi.jeu, 'inter8'); assert.strictEqual(vi.mode, 'delire'); assert.strictEqual(vi.jRetour, false); assert.strictEqual(vi.delai, 10);
      assert.strictEqual(vi.joueurs.filter((j) => j.robot).length, 3); assert.strictEqual(vi.robots, 'forts'); assert.strictEqual(vi.etat, 'salon');
      await assert.rejects(client.joinById(i8.roomId, { jeton: y.jeton }), 'personne d\'autre n\'entre');
      await i8.leave();
      // Kopo : 1 robot, partie jouée jusqu'au bout ; ni pièces ni ligue, mais comptée en entraînement.
      const solde = (await api('/api/moi', { jeton: x.jeton })).json.compte.solde;
      salle = await client.create('entrainement', { jeton: x.jeton, robots: 1, rapide: true });
      salle.onMessage('erreur', () => {}); salle.onMessage('solde', () => {});
      salle.onMessage('vue', (v) => {
        premiere = premiere || v;
        if (v.etat === 'finPartie') fin = fin || v;
        const a = v.manche && v.manche.actions[0];
        if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
      });
      for (let t = 0; t < 40 && !premiere; t++) await attendre(25);
      assert.strictEqual(premiere.joueurs.length, 2); assert.strictEqual(premiere.hote, x.compte.id);
      salle.send('lancer');
      for (let t = 0; t < 400 && !fin; t++) await attendre(50);
      assert.ok(fin, 'la partie se termine');
      await attendre(400);
      assert.strictEqual((await api('/api/moi', { jeton: x.jeton })).json.compte.solde, solde, 'pas de pièces contre les robots');
      assert.strictEqual((await api('/api/statistiques', { jeton: x.jeton })).json.entrainement.parties, 1);
      assert.strictEqual((await api('/api/v1/salles/' + fin.code)).statut, 404, 'une salle d\'entraînement ne se rejoint pas par son code');
    } finally { SalleKopo.services.googleObligatoire = false; if (salle) await salle.leave().catch(() => {}); }
  });
  await test('entraînement : pause et reprise (robots et chrono arrêtés)', async () => {
    const x = await invite('PauseSolo');
    const client = new Client(URL_.replace('http', 'ws'));
    const salle = await client.create('entrainement', { jeton: x.jeton, robots: 2, lancer: true });
    let v = null, err = null; salle.onMessage('vue', (w) => { v = w; }); salle.onMessage('erreur', (e) => { err = e; });
    try {
      for (let t = 0; t < 80 && !(v && v.etat === 'manche'); t++) await attendre(25);
      assert.strictEqual(v.pausePossible, true);
      salle.send('enPause', { pause: true });
      for (let t = 0; t < 40 && !v.enPause; t++) await attendre(25);
      assert.strictEqual(v.enPause, true);
      const fige = JSON.stringify(v.manche);
      await attendre(1500);
      salle.send('sync'); await attendre(150);
      assert.strictEqual(JSON.stringify(v.manche), fige, 'rien ne bouge pendant la pause');
      salle.send('enPause', { pause: false });
      for (let t = 0; t < 40 && v.enPause; t++) await attendre(25);
      assert.strictEqual(v.enPause, false);
      assert.strictEqual(err, null);
    } finally { await salle.leave().catch(() => {}); }
  });
  await test('mobile : push FCM (Android et iOS) avec action, jeton périmé oublié', async () => {
    const fcm = [];
    const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    srv.push.regler({ compte: { client_email: 'masano@essai.iam.gserviceaccount.com', private_key: await jose.exportPKCS8(privateKey), project_id: 'masano-essai' }, fcm: async (url, init) => {
      if (/oauth2/.test(url)) return { ok: true, status: 200, json: async () => ({ access_token: 'acces-essai', expires_in: 3600 }) };
      const corps = JSON.parse(init.body);
      fcm.push({ url, auth: init.headers.authorization, ...corps.message });
      if (corps.message.token.includes('perime')) return { ok: false, status: 404, json: async () => ({ error: { message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } }) };
      return { ok: true, status: 200, json: async () => ({ name: 'projects/masano-essai/messages/1' }) };
    } });
    const a = await invite('FcmA'), b = await invite('FcmB');
    await devenirAmis(a, b);
    const jetonFcm = 'fcm-android-' + 'x'.repeat(40);
    assert.strictEqual((await api('/api/v1/push/natif', { methode: 'POST', jeton: b.jeton, corps: { jeton: 'court', plateforme: 'android' } })).statut, 400);
    assert.strictEqual((await api('/api/v1/push/natif', { methode: 'POST', jeton: b.jeton, corps: { jeton: jetonFcm, plateforme: 'windows' } })).statut, 400);
    assert.strictEqual((await api('/api/v1/push/natif', { methode: 'POST', jeton: b.jeton, corps: { jeton: jetonFcm, plateforme: 'android', appareil: 'Pixel 7' } })).statut, 200);
    const e = (await api('/api/v1/push', { jeton: b.jeton })).json;
    assert.strictEqual(e.natif, true); assert.strictEqual(e.natifs.length, 1); assert.strictEqual(e.natifs[0].plateforme, 'android');
    await api('/api/v1/amis/' + encodeURIComponent(b.compte.id) + '/inviter', { methode: 'POST', jeton: a.jeton, corps: { code: 'FCMA' } });
    await attendre(100);
    const m = fcm.find((x) => x.token === jetonFcm && x.data.type === 'invitation');
    assert.ok(m, 'invitation envoyée par FCM');
    assert.strictEqual(m.url, 'https://fcm.googleapis.com/v1/projects/masano-essai/messages:send'); assert.strictEqual(m.auth, 'Bearer acces-essai');
    assert.strictEqual(m.data.action, 'table'); assert.strictEqual(m.data.code, 'FCMA'); assert.strictEqual(m.android.priority, 'high'); assert.strictEqual(m.android.ttl, '600s');
    assert.strictEqual(m.apns.headers['apns-priority'], '10'); assert.match(m.notification.body, /FcmA t'invite/);
    assert.ok(Object.values(m.data).every((v) => typeof v === 'string'), 'données FCM en texte');
    // Jeton périmé (appli désinstallée) : oublié au premier envoi.
    await api('/api/v1/push/natif', { methode: 'POST', jeton: b.jeton, corps: { jeton: 'fcm-perime-' + 'y'.repeat(40), plateforme: 'ios' } });
    assert.strictEqual((await api('/api/v1/push', { jeton: b.jeton })).json.natifs.length, 2);
    await srv.push.envoyer(b.compte.id, 'ami', { titre: 'x', texte: 'y', action: 'amis' });
    assert.strictEqual((await api('/api/v1/push', { jeton: b.jeton })).json.natifs.length, 1);
    await api('/api/v1/push/natif', { methode: 'DELETE', jeton: b.jeton, corps: { jeton: jetonFcm } });
    assert.strictEqual((await api('/api/v1/push', { jeton: b.jeton })).json.natifs.length, 0);
  });
  // --- Stickers animés : utilisations vendues (plus tard) ou offertes par l'admin, envoi vérifié et décompté
  await test('page Recharger : pièces et Kopo+ ensemble, numéro WhatsApp des commandes réglé dans le tableau de bord', async () => {
    const a = await invite('Rechargeur' + Date.now() % 1000);
    let R = (await api('/api/v1/recharger', { jeton: a.jeton })).json;
    assert.strictEqual(R.whatsapp, null); assert.strictEqual(R.compte, a.compte.pseudo + '#' + a.compte.numero);
    assert.ok(R.pieces.bouquets.length >= 3 && R.kopoPlus.formules.length === 2 && R.kopoPlus.actif === false);
    assert.strictEqual((await api('/api/v1/recharger')).statut, 401);
    const mettre = (whatsapp) => api('/admin/api/reglages/achat', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { whatsapp } } });
    for (const faux of ['abc', '12', '0812345678', '+243 81 234 567 890 123']) assert.strictEqual((await mettre(faux)).statut, 400, faux);
    assert.strictEqual((await mettre('+243 81-234-5678')).statut, 200);
    R = (await api('/api/v1/recharger', { jeton: a.jeton })).json;
    assert.strictEqual(R.whatsapp, '243812345678');
    assert.strictEqual((await api('/api/v1/bouquets', { jeton: a.jeton })).json.whatsapp, '243812345678');
    assert.strictEqual((await api('/api/v1/abonnement', { jeton: a.jeton })).json.whatsapp, '243812345678');
    assert.ok(!('whatsapp' in (await api('/api/config')).json), 'jamais dans la config publique (lue par les applis des stores)');
    assert.strictEqual((await mettre('')).statut, 200);
    assert.strictEqual((await api('/api/v1/recharger', { jeton: a.jeton })).json.whatsapp, null);
  });
  await test('bouquets de pièces : du moins cher au plus cher, 40 000 FC au plus, taux des stickers, livrés par l\'admin', async () => {
    const a = await invite('Acheteur' + Date.now() % 1000);
    const B = (await api('/api/v1/bouquets', { jeton: a.jeton })).json;
    assert.strictEqual(B.paiement, false);
    assert.deepStrictEqual(B.bouquets.map((b) => [b.francs, b.pieces]), [[500, 200], [2000, 850], [5000, 2250], [10000, 4800], [20000, 10000], [40000, 21000]]);
    assert.strictEqual(B.bouquets.at(-1).francs, 40000); assert.ok(!('dollars' in B.bouquets[0]));
    for (let i = 1; i < B.bouquets.length; i++) {
      assert.ok(B.bouquets[i].francs > B.bouquets[i - 1].francs && B.bouquets[i].bonusPct > B.bouquets[i - 1].bonusPct, 'bonus croissant');
    }
    for (const b of B.bouquets) assert.ok(b.pieces >= b.francs / 2.5, 'jamais moins que le taux des stickers');
    assert.strictEqual((await api('/api/v1/bouquets')).statut, 401);
    // Réglage : refusé au-dessus de 40 000 FC, sous le taux, ou dans le désordre.
    for (const bouquets of [[{ francs: 50000, pieces: 30000 }], [{ francs: 2000, pieces: 500 }], [{ francs: 2000, pieces: 850 }, { francs: 500, pieces: 200 }], [{ francs: 2000, pieces: 1000 }, { francs: 5000, pieces: 2100 }]]) {
      assert.strictEqual((await api('/admin/api/reglages/bouquets', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { bouquets } } })).statut, 400, JSON.stringify(bouquets));
    }
    // Livraison à la main : pièces au registre, notification, journal.
    const avant = (await api('/api/pieces', { jeton: a.jeton })).json.solde;
    assert.strictEqual((await api('/admin/api/bouquets/livrer', { methode: 'POST', jeton: a.jeton, corps: {} })).statut, 401);
    const nom = a.compte.pseudo + '#' + a.compte.numero;
    assert.strictEqual((await api('/admin/api/bouquets/livrer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, bouquet: 1, message: '' } })).statut, 400);
    assert.strictEqual((await api('/admin/api/bouquets/livrer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, bouquet: 9, message: 'MP-123' } })).statut, 400);
    const r = await api('/admin/api/bouquets/livrer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, bouquet: 1, message: 'MP-123456' } });
    assert.strictEqual(r.statut, 200); assert.strictEqual(r.json.solde, avant + 850);
    assert.ok((await api('/api/notifications', { jeton: a.jeton })).json.liste.some((n) => /Petit sac.*\+850/.test(n.texte)));
    const adm = (await api('/admin/api/bouquets', { jeton: adminJeton })).json;
    assert.strictEqual(adm.livraisons[0].pieces, 850); assert.match(adm.livraisons[0].ref, /MP-123456/);
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((l) => l.action === 'bouquet:livre'));
  });
  await test('abonnement Kopo+ : une activation de test s\'annule (jours retirés, micro coupé, francs hors du total)', async () => {
    const a = await invite('AboAnnul'), b = await invite('AboAnnulB');
    const nom = a.compte.pseudo + '#' + a.compte.numero;
    const avant = (await api('/admin/api/abonnements', { jeton: adminJeton })).json;
    await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'mois', message: 'ESSAI-1' } });
    const r2 = await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'an', message: 'ESSAI-2' } });
    const fin2 = new Date(r2.json.jusqu).getTime();
    const liste = (await api('/admin/api/abonnements', { jeton: adminJeton })).json;
    assert.strictEqual(liste.francs30j, avant.francs30j + 27500);
    const [an, mois] = liste.activations.filter((l) => l.compte === a.compte.id);

    const client = new Client(URL_.replace('http', 'ws'));
    const sa = await client.create('kopo', { jeton: a.jeton, code: 'ABOZ', rapide: true });
    const sb = await client.joinById(sa.roomId, { jeton: b.jeton });
    const recu = [], vues = { b: null };
    sa.onMessage('vocal', (m) => recu.push(m)); sa.onMessage('*', () => {});
    sb.onMessage('vue', (v) => { vues.b = v; }); sb.onMessage('*', () => {});

    // L'année annulée : il garde le mois.
    assert.strictEqual((await api(`/admin/api/abonnements/${an.id}/annuler`, { methode: 'POST', jeton: a.jeton })).statut, 401);
    const x = await api(`/admin/api/abonnements/${an.id}/annuler`, { methode: 'POST', jeton: adminJeton });
    assert.strictEqual(x.statut, 200);
    assert.ok(Math.abs(new Date(x.json.jusqu).getTime() - (fin2 - 365 * 864e5)) < 60e3);
    assert.strictEqual((await api(`/admin/api/abonnements/${an.id}/annuler`, { methode: 'POST', jeton: adminJeton })).statut, 404, 'une seule fois');
    // Le mois annulé : plus de Kopo+, couronne et micro retirés tout de suite.
    const y = await api(`/admin/api/abonnements/${mois.id}/annuler`, { methode: 'POST', jeton: adminJeton });
    assert.strictEqual(y.json.jusqu, null);
    await attendre(300);
    assert.deepStrictEqual(recu.at(-1), { fin: 'abonnement' });
    assert.ok(!vues.b.joueurs.find((j) => j.id === a.compte.id).plus);
    sa.send('vocal'); await attendre(300);
    assert.strictEqual(recu.at(-1).refuse, 'abonnement');
    await sa.leave(); await sb.leave();

    const apres = (await api('/admin/api/abonnements', { jeton: adminJeton })).json;
    assert.strictEqual(apres.francs30j, avant.francs30j);
    assert.ok(apres.activations.find((l) => l.id === mois.id).annule_le);
    assert.strictEqual((await api('/api/moi', { jeton: a.jeton })).json.compte.kopoPlus, false);
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((l) => l.action === 'abonnement:annule'));
  });
  await test('bienvenue : essai Kopo+ de 7 jours (une fois, compte Google) et rappel la veille de la fin', async () => {
    const inv = await invite('EssaiInvite');
    const o = (await api('/api/v1/abonnement', { jeton: inv.jeton })).json;
    assert.deepStrictEqual([o.essai.jours, o.essai.possible, o.essai.raison], [7, false, 'google']);
    assert.strictEqual((await api('/api/v1/abonnement/essai', { methode: 'POST', jeton: inv.jeton })).statut, 403);
    // Un joueur déjà inscrit avec Google y a droit aussi.
    const g = (await api('/api/connexion', { methode: 'POST', corps: { jetonSupabase: await jetonGoogle('google-essai', 'Essai Kopo') } })).json;
    assert.strictEqual((await api('/api/v1/abonnement', { jeton: g.jeton })).json.essai.possible, true);
    const r = await api('/api/v1/abonnement/essai', { methode: 'POST', jeton: g.jeton });
    assert.strictEqual(r.statut, 200);
    assert.ok(Math.abs(new Date(r.json.jusqu).getTime() - (Date.now() + 7 * 864e5)) < 60e3);
    const apres = (await api('/api/v1/abonnement', { jeton: g.jeton })).json;
    assert.strictEqual(apres.actif, true); assert.strictEqual(apres.essai.raison, 'deja'); assert.strictEqual(apres.essai.enCours, true);
    assert.strictEqual((await api('/api/v1/abonnement/essai', { methode: 'POST', jeton: g.jeton })).statut, 409, 'une seule fois');
    const adm = (await api('/admin/api/abonnements', { jeton: adminJeton })).json;
    const ligne = adm.activations.find((l) => l.compte === g.compte.id);
    assert.strictEqual(ligne.formule, 'essai'); assert.strictEqual(ligne.francs, 0); assert.ok(adm.essais30j >= 1);
    // La veille de la fin : une notification avec les prix, une seule fois.
    await srv.base.query("UPDATE comptes SET kopo_plus_jusqu = now() + interval '20 hours' WHERE id = $1", [g.compte.id]);
    const notes = [];
    const notifier = async (id, type, texte) => { notes.push({ id, texte }); };
    await srv.abonnement.rappels(notifier);
    await srv.abonnement.rappels(notifier);
    const mien = notes.filter((n) => n.id === g.compte.id);
    assert.strictEqual(mien.length, 1); assert.match(mien[0].texte, /essai Kopo\+ se termine demain.*2 500 FC/);
    // Après l'essai : plus abonné, et pas de deuxième essai.
    await srv.base.query("UPDATE comptes SET kopo_plus_jusqu = now() - interval '1 hour' WHERE id = $1", [g.compte.id]);
    assert.strictEqual((await api('/api/v1/abonnement/essai', { methode: 'POST', jeton: g.jeton })).statut, 409);
  });
  await test('bienvenue : stickers offerts une fois à chaque joueur, nouveaux comme anciens, quand les stickers sont allumés', async () => {
    const resume = (await api('/admin/api/stickers', { jeton: adminJeton })).json;
    assert.deepStrictEqual(resume.reglage.bienvenue, { stickers: ['katapss', 'rire', 'bravo'], utilisations: 10 });
    const a = await invite('BvStick');
    await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage, actif: false } } });
    assert.deepStrictEqual((await api('/api/v1/stickers', { jeton: a.jeton })).json.soldes, {}, 'éteints : rien encore');
    assert.strictEqual((await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage, bienvenue: { stickers: ['inconnu'], utilisations: 5 } } } })).statut, 400);
    await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage, actif: true, bienvenue: { stickers: ['katapss', 'bravo'], utilisations: 10 } } } });
    const s1 = (await api('/api/v1/stickers', { jeton: a.jeton })).json.soldes;
    assert.strictEqual(s1.katapss, 10); assert.strictEqual(s1.bravo, 10); assert.ok(!s1.rire);
    const s2 = (await api('/api/v1/stickers', { jeton: a.jeton })).json.soldes;
    assert.strictEqual(s2.katapss, 10, 'une seule fois');
    const n = (await api('/api/notifications', { jeton: a.jeton })).json;
    assert.ok(n.liste.some((x) => /Cadeau de bienvenue : 10 envois/.test(x.texte)));
    assert.ok((await api('/admin/api/stickers', { jeton: adminJeton })).json.bienvenueJoueurs >= 1);
    await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage } } });
  });
  await test('LiveKit : adresse corrigée, valeurs nettoyées, vérification depuis le tableau de bord', async () => {
    const { creerAbonnement, adresseLiveKit } = require('../src/abonnement');
    assert.strictEqual(adresseLiveKit('https://kopo-x.livekit.cloud/'), 'wss://kopo-x.livekit.cloud');
    assert.strictEqual(adresseLiveKit('kopo-x.livekit.cloud'), 'wss://kopo-x.livekit.cloud');
    assert.strictEqual(adresseLiveKit('wss://kopo-x.livekit.cloud'), 'wss://kopo-x.livekit.cloud');
    const ab = creerAbonnement(null, { LIVEKIT_URL: ' "https://kopo-x.livekit.cloud" ', LIVEKIT_API_KEY: ' APIabc\n', LIVEKIT_API_SECRET: 's'.repeat(40) + ' ' });
    const v = ab.jetonVocal({ compte: { id: 'c1', pseudo: 'A' }, salon: 'table-1', parler: true });
    assert.strictEqual(v.url, 'wss://kopo-x.livekit.cloud');
    const corps = JSON.parse(Buffer.from(v.jeton.split('.')[1], 'base64url').toString());
    assert.strictEqual(corps.iss, 'APIabc');
    let vu = null;
    const ok = await ab.verifierLiveKit(async (u) => { vu = u; return { ok: true, status: 200, text: async () => 'success' }; });
    assert.ok(ok.ok); assert.match(vu, /^https:\/\/kopo-x\.livekit\.cloud\/rtc\/validate\?access_token=/);
    const refus = await ab.verifierLiveKit(async () => ({ ok: false, status: 401, text: async () => 'invalid API key' }));
    assert.ok(!refus.ok); assert.match(refus.raison, /LIVEKIT_API_SECRET/);
    const loin = await ab.verifierLiveKit(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    assert.match(loin.raison, /injoignable/);
    assert.ok(!(await creerAbonnement(null, {}).verifierLiveKit()).ok);
    // Micro coupé par l'hôte (joueur éliminé) : le droit de parler est retiré dans LiveKit, sans sortir du salon vocal.
    let appel = null;
    assert.ok(await ab.permissionVocal({ salon: 'table-1', identite: 'c2', parler: false }, async (u, o) => { appel = { u, o }; return { ok: true }; }));
    assert.strictEqual(appel.u, 'https://kopo-x.livekit.cloud/twirp/livekit.RoomService/UpdateParticipant');
    const pc = JSON.parse(appel.o.body);
    assert.deepStrictEqual([pc.room, pc.identity, pc.permission.canSubscribe, pc.permission.canPublish], ['table-1', 'c2', true, false]);
    const adm = JSON.parse(Buffer.from(appel.o.headers.Authorization.split('.')[1], 'base64url').toString());
    assert.strictEqual(adm.video.roomAdmin, true); assert.strictEqual(adm.video.room, 'table-1');
    await ab.permissionVocal({ salon: 'table-1', identite: 'c2', parler: true }, async (u, o) => { appel = { u, o }; return { ok: true }; });
    assert.deepStrictEqual(JSON.parse(appel.o.body).permission.canPublishSources, ['MICROPHONE']);
    assert.strictEqual(await creerAbonnement(null, {}).permissionVocal({ salon: 's', identite: 'x', parler: false }), false);
  });
  await test('abonnement Kopo+ : 2 500 FC le mois, 25 000 FC l\'an, activé par l\'admin, prolongé, couronne à la table', async () => {
    const a = await invite('AboA'), b = await invite('AboB');
    const o = (await api('/api/v1/abonnement', { jeton: a.jeton })).json;
    assert.deepStrictEqual(o.formules.map((f) => [f.id, f.francs, f.jours]), [['mois', 2500, 30], ['an', 25000, 365]]);
    assert.strictEqual(o.actif, false); assert.strictEqual(o.paiement, false); assert.strictEqual(o.micro, true);
    assert.ok(!JSON.stringify(o).includes('$'), 'francs congolais seulement');
    assert.strictEqual((await api('/api/v1/abonnement')).statut, 401);
    const nom = a.compte.pseudo + '#' + a.compte.numero;
    assert.strictEqual((await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: a.jeton, corps: { joueur: nom, formule: 'mois', message: 'MP-1' } })).statut, 401);
    assert.strictEqual((await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'mois', message: '' } })).statut, 400);
    assert.strictEqual((await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'semaine', message: 'MP-1' } })).statut, 400);
    assert.strictEqual((await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: 'Personne#0000', formule: 'mois', message: 'MP-1' } })).statut, 404);

    // b n'est pas abonné : à la table, le micro lui renvoie les prix ; a est abonné : jeton LiveKit, couronne visible de tous.
    const client = new Client(URL_.replace('http', 'ws'));
    const sa = await client.create('kopo', { jeton: a.jeton, code: 'ABOX', rapide: true });
    const sb = await client.joinById(sa.roomId, { jeton: b.jeton });
    const recu = { a: [], b: [] }, vues = { a: null, b: null };
    for (const [k, s] of [['a', sa], ['b', sb]]) { s.onMessage('vocal', (m) => recu[k].push(m)); s.onMessage('vue', (v) => { vues[k] = v; }); s.onMessage('*', () => {}); }
    sb.send('vocal'); sa.send('vocal');
    await attendre(300);
    assert.strictEqual(recu.b[0].refuse, 'abonnement'); assert.strictEqual(recu.b[0].formules[0].francs, 2500);
    assert.strictEqual(recu.a[0].refuse, 'abonnement');
    sb.send('micro', { voix: true, muet: false });
    await attendre(200);
    const jb = vues.a.joueurs.find((j) => j.id === b.compte.id);
    assert.strictEqual(jb.voix, false, 'un non-abonné n\'entre pas en vocal'); assert.ok(!jb.plus);

    const r = await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'mois', message: 'MP-777' } });
    assert.strictEqual(r.statut, 200);
    const fin1 = new Date(r.json.jusqu).getTime();
    assert.ok(Math.abs(fin1 - (Date.now() + 30 * 864e5)) < 60e3);
    await attendre(200);
    assert.strictEqual(vues.b.joueurs.find((j) => j.id === a.compte.id).plus, true, 'couronne de a vue par b');
    assert.ok(vues.b.joueurs.every((j) => j.peerId === null));
    sa.send('vocal');
    await attendre(300);
    const v = recu.a.at(-1);
    assert.strictEqual(v.url, 'wss://essai.livekit.cloud'); assert.strictEqual(v.parler, true); assert.strictEqual(v.salon, 'table-' + sa.roomId);
    const [t, c, sig] = v.jeton.split('.');
    assert.strictEqual(require('crypto').createHmac('sha256', 'l'.repeat(40)).update(t + '.' + c).digest('base64url'), sig);
    const corps = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.strictEqual(corps.iss, 'APIessai'); assert.strictEqual(corps.sub, a.compte.id); assert.strictEqual(corps.video.room, 'table-' + sa.roomId); assert.strictEqual(corps.video.canPublish, true);
    sa.send('micro', { voix: true, muet: false });
    await attendre(200);
    assert.strictEqual(vues.b.joueurs.find((j) => j.id === a.compte.id).voix, true);

    // Sanction « micro » : toujours abonné, il écoute mais ne parle plus.
    await api(`/admin/api/joueurs/${encodeURIComponent(a.compte.id)}/sanction`, { methode: 'POST', jeton: adminJeton, corps: { type: 'micro', motif: 'Insultes' } });
    sa.send('vocal');
    await attendre(300);
    assert.strictEqual(recu.a.at(-1).parler, false);
    await api(`/admin/api/joueurs/${encodeURIComponent(a.compte.id)}/sanction`, { methode: 'POST', jeton: adminJeton, corps: { type: 'levee', motif: 'Fin' } });
    await sa.leave(); await sb.leave();

    // Un an de plus, ajouté à la fin du mois en cours.
    const r2 = await api('/admin/api/abonnements/activer', { methode: 'POST', jeton: adminJeton, corps: { joueur: nom, formule: 'an', message: 'MP-778' } });
    assert.ok(Math.abs(new Date(r2.json.jusqu).getTime() - (fin1 + 365 * 864e5)) < 60e3);
    const moi = (await api('/api/moi', { jeton: a.jeton })).json.compte;
    assert.strictEqual(moi.kopoPlus, true); assert.ok(moi.kopoPlusJusqu);
    assert.ok((await api('/api/notifications', { jeton: a.jeton })).json.liste.some((n) => /Kopo\+ \(1 mois\).*micro/.test(n.texte)));
    const adm = (await api('/admin/api/abonnements', { jeton: adminJeton })).json;
    assert.ok(adm.actifs >= 1); assert.ok(adm.francs30j >= 27500);
    assert.strictEqual(adm.activations[0].formule, 'an'); assert.match(adm.activations[0].ref, /MP-778/);
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((l) => l.action === 'abonnement:active'));
  });
  await test('stickers : éteints au départ, cadeaux de l\'admin (joueur, tous, groupe) avec message, envoi décompté', async () => {
    assert.deepStrictEqual((await api('/api/config')).json.stickers, { actif: false, vente: false });
    const a = await invite('StickA'), b = await invite('StickB'), c = await invite('StickC');
    const vide = (await api('/api/v1/stickers', { jeton: a.jeton })).json;
    assert.strictEqual(vide.actif, false); assert.strictEqual(vide.vente, false);
    assert.strictEqual(vide.stickers.length, 21); assert.deepStrictEqual(vide.soldes, {});
    // Le serveur et les dessins du jeu (src/kopo-stickers.js) connaissent les mêmes stickers.
    assert.deepStrictEqual(vide.stickers.map((x) => x.id), require('../../src/kopo-stickers.js').IDS);
    assert.deepStrictEqual(vide.packs.map((p) => p.id), ['emotions', 'coupsDurs', 'table', 'ambiance', 'supporters']);
    assert.deepStrictEqual(vide.packs.find((p) => p.id === 'coupsDurs').stickers, ['quoi', 'aie', 'pitie', 'snif', 'serieux', 'pfff']);
    assert.deepStrictEqual(vide.packs.find((p) => p.id === 'emotions').stickers, ['ouf', 'rire', 'louche', 'encore', 'katapss', 'grrr']);
    assert.ok(vide.offres.sticker.every((o) => o.utilisations && o.pieces && o.francs) && vide.offres.packs.emotions.length);
    const adm = (chemin, corps) => api('/admin/api/stickers' + chemin, { methode: corps ? 'POST' : 'GET', jeton: adminJeton, corps });
    assert.strictEqual((await api('/admin/api/stickers/compter', { methode: 'POST', jeton: a.jeton, corps: { cible: { type: 'tous' } } })).statut, 401);
    // Cibles : tous, un groupe (critères cumulés), un joueur.
    const tous = (await adm('/compter', { cible: { type: 'tous' } })).json.joueurs;
    assert.ok(tous >= 3);
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: {} } })).statut, 400);
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { google: true, invites: true } } })).statut, 400);
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { anciennete: 0 } } })).statut, 400);
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { inconnu: 1 } } })).statut, 400);
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { anciennete: 30 } } })).json.joueurs, 0, 'personne n\'a 30 jours ici');
    const sql = async (w) => (await srv.base.query(`SELECT count(*)::int AS n FROM comptes WHERE statut = 'actif' AND ${w}`)).rows[0].n;
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { invites: true, nouveaux: 1, actifs: 1 } } })).json.joueurs, await sql("auth_id IS NULL AND cree_le > now() - interval '1 day' AND vu_le > now() - interval '1 day'"));
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { google: true } } })).json.joueurs, await sql('auth_id IS NOT NULL'));
    assert.strictEqual((await adm('/compter', { cible: { type: 'groupe', criteres: { pays: 'cd', parties: 1, kopoPlus: false } } })).statut, 200);
    assert.strictEqual((await adm('/compter', { cible: { type: 'joueur', joueur: 'Personne#0000' } })).statut, 404);
    assert.strictEqual((await adm('/compter', { cible: { type: 'joueur', joueur: `${a.compte.pseudo}#${a.compte.numero}` } })).json.joueurs, 1);
    // Le message qui explique le cadeau est obligatoire.
    const cibleA = { type: 'joueur', joueur: `${a.compte.pseudo}#${a.compte.numero}` };
    assert.strictEqual((await adm('/offrir', { cible: cibleA, pack: 'emotions', utilisations: 20, message: '' })).statut, 400);
    assert.strictEqual((await adm('/offrir', { cible: cibleA, pack: 'emotions', utilisations: 0, message: 'Merci pour tes retours !' })).statut, 400);
    assert.strictEqual((await adm('/offrir', { cible: cibleA, sticker: 'inconnu', utilisations: 5, message: 'Merci pour tes retours !' })).statut, 400);
    const r = await adm('/offrir', { cible: cibleA, pack: 'emotions', utilisations: 20, message: 'Merci pour tes retours !' });
    assert.strictEqual(r.statut, 200); assert.strictEqual(r.json.joueurs, 1); assert.strictEqual(r.json.stickers.length, 6);
    await adm('/offrir', { cible: { type: 'groupe', criteres: { invites: true, actifs: 1 } }, sticker: 'ouf', utilisations: 2, message: 'Bienvenue aux nouveaux joueurs.' });
    const sa = (await api('/api/v1/stickers', { jeton: a.jeton })).json.soldes;
    assert.strictEqual(sa.ouf, 22); assert.strictEqual(sa.grrr, 20); assert.strictEqual(sa.danse, undefined, 'le pack Ambiance reste verrouillé');
    assert.deepStrictEqual((await api('/api/v1/stickers', { jeton: c.jeton })).json.soldes, { ouf: 2 }); assert.deepStrictEqual((await api('/api/v1/stickers', { jeton: b.jeton })).json.soldes, { ouf: 2 });
    const notes = (await api('/api/v1/notifications', { jeton: a.jeton })).json.liste.filter((x) => x.type === 'cadeau');
    assert.strictEqual(notes.length, 2);
    assert.ok(notes.some((x) => /Merci pour tes retours !/.test(x.texte) && /20 utilisations du pack « Émotions »/.test(x.texte) && x.donnees.message === 'Merci pour tes retours !'));
    const resume = (await adm('')).json;
    assert.strictEqual(resume.reglage.actif, false); assert.ok(resume.criteres.some((x) => x.id === 'anciennete' && x.n));
    assert.strictEqual(resume.cadeaux[0].message, 'Bienvenue aux nouveaux joueurs.');
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((l) => l.action === 'stickers:cadeau'));
    assert.strictEqual((await api('/admin/api/joueurs/' + a.compte.id, { jeton: adminJeton })).json.stickers.length, 6);
    // En partie : refusé tant que l'interrupteur est éteint, puis une utilisation de moins par envoi.
    const client = new Client(URL_.replace('http', 'ws'));
    const sA = await client.create('kopo', { jeton: a.jeton, code: 'STIK' });
    const sB = await client.joinById(sA.roomId, { jeton: b.jeton });
    const recu = { a: [], b: [], erreursA: [], erreursB: [], restants: [] };
    for (const [s, k] of [[sA, 'a'], [sB, 'b']]) { s.onMessage('vue', () => {}); s.onMessage('sticker', (m) => recu[k].push(m)); s.onMessage('erreur', (t) => recu[k === 'a' ? 'erreursA' : 'erreursB'].push(t)); s.onMessage('stickers', (m) => k === 'a' && recu.restants.push(m)); }
    try {
      await attendre(100);
      sA.send('sticker', { sticker: 'ouf' }); await attendre(150);
      assert.deepStrictEqual(recu.erreursA, ['Les stickers arrivent bientôt.']); assert.strictEqual(recu.b.length, 0);
      assert.strictEqual((await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { actif: true, offres: { sticker: [{ utilisations: 0, pieces: 1, francs: 1 }] } } } })).statut, 400);
      assert.strictEqual((await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage, actif: true } } })).statut, 200);
      assert.deepStrictEqual((await api('/api/config')).json.stickers, { actif: true, vente: false });
      sA.send('sticker', { sticker: 'ouf' }); await attendre(150);
      assert.deepStrictEqual(recu.b, [{ type: 'sticker', joueur: a.compte.id, sticker: 'ouf' }]);
      assert.strictEqual(recu.a.length, 1); assert.deepStrictEqual(recu.restants, [{ sticker: 'ouf', restants: 21 }]);
      sA.send('sticker', { sticker: 'grrr' }); await attendre(150);
      assert.strictEqual(recu.b.length, 1, 'un sticker toutes les 5 secondes'); assert.match(recu.erreursA.at(-1), /5 secondes/);
      sB.send('sticker', { sticker: 'danse' }); await attendre(150);
      assert.match(recu.erreursB.at(-1), /Plus d'utilisations/); assert.strictEqual(recu.a.length, 1);
      assert.strictEqual((await api('/api/v1/stickers', { jeton: a.jeton })).json.soldes.ouf, 21);
    } finally {
      await api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...resume.reglage, actif: false } } });
      await sA.leave(); await sB.leave();
    }
  });
  await test('stickers : achat en pièces (prix du serveur, pack selon sa taille), fermé tant que la vente est éteinte', async () => {
    const j = await invite('StickAch');
    const acheter = (corps) => api('/api/v1/stickers/acheter', { methode: 'POST', jeton: j.jeton, corps });
    const E = (await api('/api/v1/stickers', { jeton: j.jeton })).json;
    assert.strictEqual(E.vente, false);
    // Prix des packs : 6 stickers = 33 % de moins que 6 × 200 ; 2 stickers = 250 au lieu de 400 ; un pack d'un seul sticker ne se vend pas.
    assert.deepStrictEqual(E.offres.sticker.map((o) => [o.pieces, o.francs]), [[200, 500], [400, 1000]], 'pièces et francs au même taux');
    assert.deepStrictEqual(E.offres.packs.emotions.map((o) => [o.pieces, o.francs]), [[800, 2000], [1600, 4000]]);
    assert.deepStrictEqual(E.offres.packs.ambiance.map((o) => [o.pieces, o.francs]), [[250, 600], [550, 1400]]);
    assert.deepStrictEqual(E.offres.packs.supporters, []);
    assert.strictEqual((await acheter({ sticker: 'ouf', offre: 0 })).statut, 403, 'vente éteinte');
    const r0 = (await api('/admin/api/reglages', { jeton: adminJeton })).json.stickers;
    const reg = (v) => api('/admin/api/reglages/stickers', { methode: 'PUT', jeton: adminJeton, corps: { valeur: v } });
    assert.strictEqual((await reg({ actif: true, vente: true })).statut, 200);
    try {
      assert.deepStrictEqual((await api('/api/config')).json.stickers, { actif: true, vente: true });
      await srv.comptes.crediter(j.compte.id, 5000 - await solde(j.compte.id), 'admin', 'test');
      assert.strictEqual((await acheter({ sticker: 'ouf', offre: 9 })).statut, 400);
      assert.strictEqual((await acheter({ sticker: 'inconnu', offre: 0 })).statut, 400);
      assert.strictEqual((await acheter({ pack: 'supporters', offre: 0 })).statut, 400, 'pas de pack d\'un seul sticker');
      const a = await acheter({ sticker: 'ouf', offre: 0, pieces: 1 }); // le prix envoyé par le téléphone est ignoré
      assert.strictEqual(a.statut, 200, JSON.stringify(a.json));
      assert.deepStrictEqual([a.json.solde, a.json.pieces, a.json.soldes], [4800, 200, { ouf: 20 }]);
      const p = await acheter({ pack: 'emotions', offre: 1 });
      assert.strictEqual(p.statut, 200); assert.strictEqual(p.json.solde, 3200);
      assert.deepStrictEqual(p.json.soldes, { ouf: 70, rire: 50, louche: 50, encore: 50, katapss: 50, grrr: 50 });
      await acheter({ pack: 'table', offre: 1 }); await acheter({ pack: 'coupsDurs', offre: 0 }); // 3200 - 1600 - 800 = 800
      const trop = await acheter({ pack: 'coupsDurs', offre: 1 });
      assert.strictEqual(trop.statut, 402); assert.match(trop.json.erreur, /1600 pièces/);
      assert.strictEqual(await solde(j.compte.id), 800, 'rien débité');
      assert.strictEqual((await api('/api/v1/stickers', { jeton: j.jeton })).json.soldes.quoi, 20);
      const reg2 = await srv.base.query("SELECT montant, motif FROM registre_pieces WHERE compte_id = $1 AND motif = 'stickers' ORDER BY id", [j.compte.id]);
      assert.deepStrictEqual(reg2.rows.map((l) => Number(l.montant)), [-200, -1600, -1600, -800]);
      assert.strictEqual((await reg({ actif: true, vente: true, remisePack: 80 })).statut, 400);
    } finally { await reg(r0); }
  });
  await test('documentation : chaque route des joueurs est décrite dans docs/api/openapi.yaml', async () => {
    const yaml = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'docs', 'api', 'openapi.yaml'), 'utf8');
    const decrites = new Set();
    let chemin = null;
    for (const l of yaml.split('\n')) {
      const c = /^  (\/[^:]+):\s*$/.exec(l); if (c) { chemin = c[1]; continue; }
      const m = /^    (get|post|put|patch|delete):/.exec(l); if (m && chemin) decrites.add(m[1].toUpperCase() + ' ' + chemin);
      if (/^\S/.test(l)) chemin = null;
    }
    const { routesJoueurs } = require('../src/api');
    const r = routesJoueurs({ reglages: { get: () => ({}) } });
    const manquantes = [];
    const routes = r.stack.filter((x) => x.route).flatMap((x) => Object.keys(x.route.methods).map((m) => m.toUpperCase() + ' /' + x.route.path.replace(/^\//, '').replace(/:(\w+)/g, '{$1}')))
      .concat(['GET /en-ligne', 'GET /salles/{code}', 'POST /reprendre']);
    for (const x of routes) if (!decrites.has(x)) manquantes.push(x);
    assert.deepStrictEqual(manquantes, [], 'routes sans documentation');
    const res = await fetch(URL_ + '/api/openapi.yaml');
    assert.strictEqual(res.status, 200); assert.match(await res.text(), /^openapi: 3\.1/);
  });
  await test('sécurité : limiteur (fenêtre fixe, par clé)', async () => {
    const { creerLimiteur } = require('../src/limites');
    const l = creerLimiteur(3, 1000);
    assert.deepStrictEqual([1, 2, 3, 4].map(() => l.passer('a', 0)), [true, true, true, false]);
    assert.strictEqual(l.passer('b', 0), true, 'une autre clé a son propre compteur');
    assert.strictEqual(l.passer('a', 1000), true, 'nouvelle fenêtre');
  });
  await test('sécurité : trop de demandes = 429 (API, codes de table)', async () => {
    process.env.KOPO_LIMITES = '1';
    const { limiteurs, LIMITES } = require('../src/limites');
    try {
      const j = await invite('Presse' + Date.now() % 1000);
      limiteurs.apiCompte.vider();
      let dernier;
      for (let i = 0; i <= LIMITES.apiCompte.max; i++) dernier = await api('/api/pieces', { jeton: j.jeton });
      assert.strictEqual(dernier.statut, 429);
      limiteurs.codesIp.vider();
      for (let i = 0; i <= LIMITES.codesIp.max; i++) dernier = await api('/api/salles/ABCD');
      assert.strictEqual(dernier.statut, 429);
    } finally { delete process.env.KOPO_LIMITES; for (const l of Object.values(limiteurs)) l.vider(); }
  });
  await test('sécurité : niveau affiché aux amis plafonné selon les jours de jeu', async () => {
    const a = await invite('Frimeur' + Date.now() % 1000), b = await invite('Copain' + Date.now() % 1000);
    await api('/api/profil', { methode: 'PUT', jeton: a.jeton, corps: { profil: { xp: 999999, bareme: 2 } } });
    await srv.base.query('INSERT INTO amis (compte_id, ami_id) VALUES ($1,$2), ($2,$1)', [a.compte.id, b.compte.id]);
    const moi = (await api('/api/amis', { jeton: b.jeton })).json.find((x) => x.id === a.compte.id);
    assert.ok(moi.xp <= 1600, 'XP plafonnée : ' + moi.xp);
    await api('/api/profil', { methode: 'PUT', jeton: a.jeton, corps: { profil: { xp: 120, bareme: 2 } } });
    assert.strictEqual((await api('/api/amis', { jeton: b.jeton })).json.find((x) => x.id === a.compte.id).xp, 120, 'un vrai niveau passe tel quel');
  });
  await test('sécurité : admin, comptes qui jouent trop souvent ensemble', async () => {
    const a = await invite('Gros' + Date.now() % 1000), b = await invite('Faux' + Date.now() % 1000);
    for (let i = 0; i < 6; i++) {
      const id = 'p_suspect_' + i + '_' + Date.now();
      await srv.base.query("INSERT INTO parties (id, code, publique, nb_joueurs, avec_robots, vainqueur, debut, fin, classee, jeu) VALUES ($1, 'ZZZZ', true, 2, false, $2, now(), now(), true, 'kopo')", [id, a.compte.id]);
      await srv.base.query('INSERT INTO participations (partie_id, compte_id, place, abandon) VALUES ($1,$2,1,false), ($1,$3,2,false)', [id, a.compte.id, b.compte.id]);
      await srv.comptes.crediter(a.compte.id, 90, 'pot', id);
    }
    const s = (await api('/admin/api/suspects', { jeton: adminJeton })).json;
    const p = s.paires.find((x) => [x.a, x.b].includes(a.compte.id) && [x.a, x.b].includes(b.compte.id));
    assert.ok(p, 'la paire est signalée');
    assert.strictEqual(p.ensemble, 6);
    assert.strictEqual(p.a === a.compte.id ? p.pots_a : p.pots_b, 540);
    assert.strictEqual((await api('/admin/api/suspects')).statut, 401, 'réservé à l\'admin');
  });
  console.log('\nTableau de bord admin et nouveaux réglages');
  const reg = (cle, valeur) => api('/admin/api/reglages/' + cle, { methode: 'PUT', jeton: adminJeton, corps: { valeur } });
  await test('tableau de bord : chiffres clés, courbes sur 30 jours, heures, appareils, alertes', async () => {
    for (const periode of ['jour', '7', '30']) {
      const t = (await api('/admin/api/tableau?periode=' + periode, { jeton: adminJeton })).json;
      assert.strictEqual(t.periode, { jour: 1, 7: 7, 30: 30 }[periode]);
      assert.ok(t.cles.actifs >= 1 && t.cles.parties >= 1, JSON.stringify(t.cles));
      assert.strictEqual(t.parJour.length, 30);
      assert.ok('bouquets' in t.parJour[0] && 'kopo_plus' in t.parJour[0]);
      assert.ok(Array.isArray(t.heures) && Array.isArray(t.appareils));
      assert.strictEqual(typeof t.alertes.signalements, 'number');
      assert.strictEqual(typeof t.alertes.suspects, 'number');
      assert.strictEqual(typeof t.maintenant.connectes, 'number');
    }
    assert.strictEqual((await api('/admin/api/tableau')).statut, 401, 'réservé à l\'admin');
  });
  await test('tableau de bord : revenus des bouquets livrés et de Kopo+, appareil du joueur', async () => {
    const x = await invite('Payeur' + Date.now() % 1000);
    const avant = (await api('/admin/api/tableau?periode=jour', { jeton: adminJeton })).json.cles.revenus;
    const b = await api('/admin/api/bouquets/livrer', { methode: 'POST', jeton: adminJeton, corps: { joueur: x.compte.id, bouquet: 1, message: 'MP-123' } });
    assert.strictEqual(b.statut, 200, JSON.stringify(b.json));
    const t = (await api('/admin/api/tableau?periode=jour', { jeton: adminJeton })).json;
    assert.strictEqual(t.cles.revenus - avant, b.json.bouquet.francs);
    assert.ok(t.parJour.at(-1).bouquets >= b.json.bouquet.francs);
    await fetch(URL_ + '/api/moi', { headers: { authorization: 'Bearer ' + x.jeton, 'x-masano-client': 'android/1.4.0' } });
    const p = (await srv.base.query('SELECT plateforme, version FROM presences WHERE compte_id = $1', [x.compte.id])).rows[0];
    assert.deepStrictEqual([p.plateforme, p.version], ['android', '1.4.0']);
  });
  await test('rythme des parties : réglé dans Pilotage, envoyé au site, appliqué aux nouvelles salles', async () => {
    assert.strictEqual((await reg('rythme', { kopo: { ...DEFAUTS.rythme.kopo, depart: 30 }, inter8: DEFAUTS.rythme.inter8 })).statut, 400, 'hors bornes');
    const r = await reg('rythme', { kopo: { ...DEFAUTS.rythme.kopo, finTour: 3, depart: 3, mancheAuto: 6, pauseRobot: 0.8 }, inter8: { ...DEFAUTS.rythme.inter8, annonce: 2, rapide: 0 } });
    assert.strictEqual(r.statut, 200, JSON.stringify(r.json));
    const cfg = (await api('/api/config')).json;
    assert.strictEqual(cfg.rythme.kopo.finTour, 3);
    const { salles } = require('../src/salle-kopo');
    const a = await invite('Rythme' + Date.now() % 1000);
    const client = new Client(URL_.replace('http', 'ws'));
    const k = await client.create('kopo', { jeton: a.jeton }), i = await client.create('inter8', { jeton: a.jeton });
    await attendre(100);
    const sk = [...salles].find((s) => s.roomId === k.roomId), si = [...salles].find((s) => s.roomId === i.roomId);
    assert.strictEqual(sk.salle.durees.finTour, 3000);
    assert.strictEqual(sk.salle.durees.mancheAuto, 6000);
    assert.strictEqual(sk.salle.rythme.pauseRobot, 800);
    assert.strictEqual(si.salle.rythme.annonce, 2000);
    assert.strictEqual(si.salle.rythme.rapide, false);
    await k.leave(); await i.leave();
    await reg('rythme', DEFAUTS.rythme);
  });
  await test('robots des salles publiques : niveau et force réglables', async () => {
    assert.strictEqual((await reg('robotsPublics', { actif: 1, attente: 45, robots: 'geants', force: 10 })).statut, 400);
    assert.strictEqual((await reg('robotsPublics', { actif: 1, attente: 45, robots: 'forts', force: 25 })).statut, 400);
    const r = await reg('robotsPublics', { actif: 1, attente: 45, robots: 'forts', force: 18 });
    assert.deepStrictEqual(r.json.valeur, { actif: 1, attente: 45, robots: 'forts', force: 18 });
    await reg('robotsPublics', DEFAUTS.robotsPublics);
  });
  await test('plafond de pièces par jour aux tables gratuites', async () => {
    const x = await invite('Farm' + Date.now() % 1000), y = await invite('Mule' + Date.now() % 1000);
    assert.strictEqual((await reg('gains', { ...DEFAUTS.gains, plafondJour: 12 })).statut, 200);
    try {
      await jouerPartie([x, y]);
      await jouerPartie([x, y]);
      const g = async (c) => Number((await srv.base.query("SELECT coalesce(sum(montant), 0) AS n FROM registre_pieces WHERE compte_id = $1 AND motif IN ('manche', 'katapss', 'victoire', 'deuxieme')", [c.compte.id])).rows[0].n);
      const gx = await g(x), gy = await g(y);
      assert.ok(gx <= 12 && gy <= 12, `gains plafonnés : ${gx}, ${gy}`);
      assert.ok(gx + gy > 0, 'le vainqueur gagne quand même jusqu\'au plafond');
    } finally { await reg('gains', DEFAUTS.gains); }
  });
  await test('Kopo+ : prix réglables, note « mois offerts » recalculée', async () => {
    assert.strictEqual((await reg('kopoPlus', { mois: 3000, an: 2000 })).statut, 400, 'un an moins cher qu\'un mois');
    assert.strictEqual((await reg('kopoPlus', { mois: 3000, an: 30000 })).statut, 200);
    const x = await invite('Prix' + Date.now() % 1000);
    const o = (await api('/api/abonnement', { jeton: x.jeton })).json;
    assert.deepStrictEqual(o.formules.map((f) => f.francs), [3000, 30000]);
    assert.strictEqual(o.formules[1].note, '2 mois offerts');
    await reg('kopoPlus', DEFAUTS.kopoPlus);
  });
  await test('création de comptes invités : fermée puis rouverte', async () => {
    assert.strictEqual((await reg('inscriptions', { invites: 0 })).statut, 200);
    try { assert.strictEqual((await api('/api/invite', { methode: 'POST', corps: { pseudo: 'Ferme' } })).statut, 403); }
    finally { await reg('inscriptions', { invites: 1 }); }
    assert.ok((await invite('Rouvert' + Date.now() % 1000)).jeton);
  });
  await test('annonce programmée : visible seulement entre ses dates', async () => {
    const demain = new Date(Date.now() + 864e5).toISOString();
    assert.strictEqual((await reg('annonce', { texte: 'Tournoi demain', active: true, debut: demain, fin: '' })).statut, 200);
    assert.strictEqual((await api('/api/config')).json.annonce, null, 'pas encore');
    await reg('annonce', { texte: 'Tournoi ce soir', active: true, debut: new Date(Date.now() - 6e4).toISOString(), fin: demain });
    assert.strictEqual((await api('/api/config')).json.annonce, 'Tournoi ce soir');
    await reg('annonce', { texte: '', active: false });
  });
  await test('notifications programmées, heures des rappels, seuils de sécurité, limites', async () => {
    assert.strictEqual((await reg('pushProgrammes', [{ texte: '', quand: '2026-12-01T18:00' }])).statut, 400);
    const p = await reg('pushProgrammes', [{ titre: 'Ce soir', texte: 'Tournoi à 20 h', quand: '2026-12-01T18:00', pays: 'cd' }]);
    assert.strictEqual(p.json.valeur[0].quand, '2026-12-01T17:00:00.000Z', 'heure de Kinshasa');
    assert.strictEqual(p.json.valeur[0].pays, 'CD');
    await reg('pushProgrammes', []);
    assert.strictEqual((await reg('heuresPush', { ...DEFAUTS.heuresPush, serie: 24 })).statut, 400);
    assert.strictEqual((await reg('heuresPush', { ...DEFAUTS.heuresPush, matchJour: 20 })).statut, 200);
    await reg('heuresPush', DEFAUTS.heuresPush);
    assert.strictEqual((await reg('suspects', { jours: 14, parties: 1, pourcent: 80 })).statut, 400);
    assert.strictEqual((await reg('suspects', { jours: 30, parties: 5, pourcent: 90 })).statut, 200);
    assert.strictEqual((await api('/admin/api/suspects', { jeton: adminJeton })).json.jours, 30, 'seuils par défaut du réglage');
    await reg('suspects', DEFAUTS.suspects);
    const { limiteurs } = require('../src/limites');
    assert.strictEqual((await reg('limites', { ...DEFAUTS.limites, apiCompte: 300 })).statut, 200);
    assert.strictEqual(limiteurs.apiCompte.max, 300, 'appliquée tout de suite');
    await reg('limites', DEFAUTS.limites);
    assert.strictEqual(limiteurs.apiCompte.max, 120);
    const j = (await api('/admin/api/journal', { jeton: adminJeton })).json.find((x) => x.action === 'reglage:limites');
    assert.ok(j.details.avant && j.details.apres, 'le journal garde l\'ancienne et la nouvelle valeur');
    assert.strictEqual((await api('/admin/api/reglages/defauts', { jeton: adminJeton })).json.rythme.kopo.depart, 5);
  });
  await test('rappels push : heures de silence réglables', () => {
    const { heureDeSilence } = require('../src/reglages');
    assert.ok(heureDeSilence(23) && heureDeSilence(3) && !heureDeSilence(8) && !heureDeSilence(21));
    assert.ok(heureDeSilence(13, { silenceDebut: 12, silenceFin: 14 }) && !heureDeSilence(14, { silenceDebut: 12, silenceFin: 14 }));
    assert.ok(!heureDeSilence(3, { silenceDebut: 0, silenceFin: 0 }), 'même heure : pas de silence');
  });
  // ===== Le Fleuve (fleuve.md) =====
  console.log('Le Fleuve');
  const FS = require('../src/fleuve-suivi');
  const FG = require('../src/fleuve-generateur');
  const regF = (cle, valeur) => api('/admin/api/reglages/' + cle, { methode: 'PUT', jeton: adminJeton, corps: { valeur } });
  const recetteRapide = { ...FG.RECETTE_DEFAUT, simulations: 20, calibrage: 10, essais: 1 };
  await test('Fleuve : villes vraies puis retour, étoiles, seuils toujours atteignables', () => {
    const { villeDe, VILLES } = require('../src/fleuve');
    assert.strictEqual(villeDe('congo', 1), 'Banana');
    assert.strictEqual(villeDe('congo', 5), 'Kinshasa');
    assert.strictEqual(villeDe('congo', VILLES.congo.length + 1), 'Kisangani · retour 2');
    assert.strictEqual(villeDe('niger', VILLES.niger.length * 2 + 1), 'Onitsha · voyage 3');
    assert.strictEqual(FS.etoilesDe({ reussi: false, score: 99 }, { deux: 1, trois: 2 }), 0);
    assert.strictEqual(FS.etoilesDe({ reussi: true, score: 5 }, { deux: 6, trois: 9 }), 1);
    assert.strictEqual(FS.etoilesDe({ reussi: true, score: 9 }, { deux: 6, trois: 9 }), 3);
    const s = FG.seuilsDe([3, 3, 3, 3].map((score) => ({ score })));
    assert.ok(s.deux <= 3 && s.trois <= 3, 'jamais au-dessus du meilleur essai');
    assert.strictEqual(FS.texteObjectif({ type: 'manches', n: 3 }), 'Qualifie-toi pour 3 manches');
  });
  await test('Fleuve : réglages vérifiés, fermé par défaut', async () => {
    assert.strictEqual(srv.reglages.get('fleuve').etat, 'ferme');
    assert.strictEqual((await regF('fleuve', { ...DEFAUTS.fleuve, etat: 'grand' })).statut, 400);
    assert.strictEqual((await regF('fleuve', { ...DEFAUTS.fleuve, pagaies: 0 })).statut, 400);
    assert.strictEqual((await regF('fleuveRecette', { ...FG.RECETTE_DEFAUT, etoiles: { deux: 10, trois: 40 } })).statut, 400);
    assert.strictEqual((await regF('fleuveRecette', recetteRapide)).statut, 200);
    assert.strictEqual((await api('/api/config')).json.fleuve, 'ferme');
  });
  let gF;
  await test('Fleuve : l\'admin fabrique un bief, puis le publie dans l\'ordre', async () => {
    assert.strictEqual((await api('/admin/api/fleuve/congo/biefs/2/publier', { methode: 'POST', jeton: adminJeton })).statut, 400);
    const g = await api('/admin/api/fleuve/congo/biefs/1/generer', { methode: 'POST', jeton: adminJeton });
    assert.strictEqual(g.statut, 200);
    assert.strictEqual((await api('/admin/api/fleuve/congo/biefs/1/generer', { methode: 'POST', jeton: adminJeton })).statut, 409, 'pas deux fois en même temps');
    let r;
    for (let t = 0; t < 1200; t++) { r = (await api('/admin/api/fleuve', { jeton: adminJeton })).json; if (r.travaux['congo:1'].fini) break; await attendre(100); }
    assert.strictEqual(r.travaux['congo:1'].erreur, null);
    assert.strictEqual(r.fleuves.congo.biefs[0].etapes, 50);
    const etapes = (await api('/admin/api/fleuve/congo/biefs/1', { jeton: adminJeton })).json;
    assert.strictEqual(etapes.length, 50);
    for (const e of etapes) {
      assert.ok(e.d >= 1 && e.d <= 60 && e.joueurs >= 2 && e.texte, 'étape ' + e.numero);
      assert.ok(e.seuils.deux >= 1 && e.seuils.trois >= e.seuils.deux, 'seuils ' + e.numero);
    }
    assert.ok(etapes[9].escale && etapes[9].ville === 'Banana');
    assert.strictEqual((await api('/admin/api/fleuve/congo/biefs/2/publier', { methode: 'POST', jeton: adminJeton })).statut, 400, 'bief 2 pas fabriqué');
    assert.strictEqual((await api('/admin/api/fleuve/congo/biefs/1/publier', { methode: 'POST', jeton: adminJeton })).statut, 200);
    const m = await api('/admin/api/fleuve/congo/etapes/3/modifier', { methode: 'POST', jeton: adminJeton, corps: { d: 2 } });
    assert.deepStrictEqual([m.statut, m.json.d, m.json.publie], [200, 2, true]);
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((x) => x.action === 'fleuve:publier'));
  });
  await test('Fleuve : fermé aux joueurs, puis aux testeurs, puis ouvert', async () => {
    gF = await connexionG('sb-fleuve-a', { providerId: 'g-fleuve-a' });
    assert.strictEqual((await api('/api/fleuve', { jeton: gF.jeton })).json.ouvert, false);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: 1 }), /bientôt/);
    const jeux = srv.reglages.get('jeux');
    await regF('jeux', { ...jeux, testeurs: [gF.compte.pseudo] });
    await regF('fleuve', { ...DEFAUTS.fleuve, etat: 'testeurs' });
    assert.strictEqual((await api('/api/fleuve', { jeton: gF.jeton })).json.ouvert, true, 'testeur');
    await regF('jeux', jeux);
    await regF('fleuve', { ...DEFAUTS.fleuve, etat: 'ouvert' });
    const e = (await api('/api/fleuve', { jeton: gF.jeton })).json;
    assert.deepStrictEqual([e.ouvert, e.pagaies.restantes, e.fleuves.congo.courante, e.fleuves.congo.etapes.length, e.fleuves.niger.courante], [true, 5, 1, 50, null]);
    const d2 = (await api('/api/fleuve/congo/2', { jeton: gF.jeton })).json;
    assert.match(d2.refus, /d'abord/);
    const inv = await invite('SansGF' + Date.now() % 1000);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: inv.jeton, fleuve: 'congo', numero: 1 }), /Google/);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: 2 }), /d'abord/);
  });
  await test('Fleuve : une étape jouée dans la salle, jusqu\'au résultat', async () => {
    const client = new Client(URL_.replace('http', 'ws'));
    const salle = await client.create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: 1, rapide: true });
    let debut = null, fin = null, robots = 0;
    salle.onMessage('erreur', () => {});
    salle.onMessage('fleuve', (m) => { if (m.fin) fin = m; else debut = m; });
    salle.onMessage('vue', (v) => {
      robots = v.joueurs.filter((j) => j.robot).length;
      const a = v.manche && (v.manche.actions.find((x) => x.type === 'jouer') || v.manche.actions.find((x) => x.type !== 'katapss'));
      if (v.etat === 'manche' && a) setTimeout(() => { try { salle.send('action', { action: a }); } catch (e) {} }, 1);
    });
    for (let t = 0; t < 1200 && !fin; t++) await attendre(50);
    await salle.leave().catch(() => {});
    assert.ok(debut && debut.etape.numero === 1 && debut.etape.texte, 'fenêtre de départ');
    assert.ok(fin, 'résultat reçu');
    assert.strictEqual(robots, debut.etape.joueurs - 1);
    const e = (await api('/api/fleuve', { jeton: gF.jeton })).json;
    if (fin.reussi) assert.deepStrictEqual([fin.etoiles >= 1, fin.pagaies.restantes, e.fleuves.congo.courante, fin.double, fin.pieces], [true, 5, 2, true, fin.etoiles * 10]);
    else assert.deepStrictEqual([fin.etoiles, fin.pagaies.restantes, e.fleuves.congo.courante], [0, 4, 1]);
  });
  await test('Fleuve : une étape du Niger (Inter (8)) jouée dans la salle', async () => {
    const e = await FG.fabriquerEtape('niger', 1, { recette: recetteRapide, graine: 12345 });
    await srv.base.query('INSERT INTO fleuve_etapes (fleuve, numero, bief, recette, publie) VALUES ($1, 1, 1, $2, true)', ['niger', JSON.stringify(e)]);
    const client = new Client(URL_.replace('http', 'ws'));
    const salle = await client.create('fleuve', { jeton: gF.jeton, fleuve: 'niger', numero: 1, rapide: true });
    let debut = null, fin = null, jeu = null;
    salle.onMessage('erreur', () => {});
    salle.onMessage('fleuve', (m) => { if (m.fin) fin = m; else debut = m; });
    salle.onMessage('vue', (v) => {
      jeu = v.jeu || jeu;
      const a = v.manche && v.manche.actions && (v.manche.actions.find((x) => x.type === 'jouer') || v.manche.actions[0]);
      if (v.etat === 'manche' && a) setTimeout(() => { try { salle.send('action', { action: a }); } catch (er) {} }, 1);
    });
    for (let t = 0; t < 1200 && !fin; t++) await attendre(50);
    await salle.leave().catch(() => {});
    assert.ok(debut && fin, 'départ et résultat');
    assert.deepStrictEqual([jeu, debut.etape.jeu, fin.fleuve], ['inter8', 'inter8', 'niger']);
    await srv.base.query("DELETE FROM fleuve_pagaies WHERE compte_id = $1", [gF.compte.id]);
  });
  await test('Fleuve : quitter = une pagaie perdue ; pas de pagaie, pas d\'étape', async () => {
    const avant = (await api('/api/fleuve', { jeton: gF.jeton })).json;
    const n = avant.fleuves.congo.courante;
    const salle = await new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: n });
    salle.onMessage('vue', () => {}); salle.onMessage('fleuve', () => {}); salle.onMessage('erreur', () => {});
    await attendre(150);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: n }), /en cours/);
    await salle.leave(true);
    await attendre(300);
    const apres = (await api('/api/fleuve', { jeton: gF.jeton })).json;
    assert.strictEqual(apres.pagaies.restantes, avant.pagaies.restantes - 1);
    await srv.base.query('UPDATE fleuve_pagaies SET perdues = 5 WHERE compte_id = $1', [gF.compte.id]);
    await assert.rejects(new Client(URL_.replace('http', 'ws')).create('fleuve', { jeton: gF.jeton, fleuve: 'congo', numero: n }), /repose/);
    await srv.base.query('DELETE FROM fleuve_pagaies WHERE compte_id = $1', [gF.compte.id]);
  });
  await test('Fleuve : acheter une pagaie quand on n\'en a plus (100, 200, 400 pièces, pièces détruites)', async () => {
    const g = await connexionG('sb-fleuve-p', { providerId: 'g-fleuve-p' });
    const achat = () => api('/api/fleuve/pagaie', { methode: 'POST', jeton: g.jeton });
    const e0 = (await api('/api/fleuve', { jeton: g.jeton })).json;
    assert.deepStrictEqual([e0.pagaies.restantes, e0.pagaies.max, e0.pagaies.prix], [5, 5, 100]);
    assert.strictEqual((await achat()).statut, 409, 'il reste des pagaies');
    await srv.base.query('INSERT INTO fleuve_pagaies (compte_id, jour, perdues) VALUES ($1, $2, 5)', [g.compte.id, require('../src/match-jour').jourDe(new Date())]);
    await srv.base.query('UPDATE comptes SET solde = 650 WHERE id = $1', [g.compte.id]);
    const a1 = await achat();
    assert.strictEqual(a1.statut, 200);
    assert.deepStrictEqual([a1.json.paye, Number(a1.json.solde), a1.json.pagaies.restantes, a1.json.pagaies.max, a1.json.pagaies.prix], [100, 550, 1, 6, 200]);
    assert.strictEqual((await achat()).statut, 409, 'une à la fois');
    await srv.base.query('UPDATE fleuve_pagaies SET perdues = 6 WHERE compte_id = $1', [g.compte.id]);
    assert.strictEqual((await achat()).json.paye, 200);
    await srv.base.query('UPDATE fleuve_pagaies SET perdues = 7 WHERE compte_id = $1', [g.compte.id]);
    const pauvre = await achat();
    assert.deepStrictEqual([pauvre.statut, /400 pièces/.test(pauvre.json.erreur)], [400, true], 'solde 350 < 400');
    await srv.base.query('UPDATE comptes SET solde = 1000 WHERE id = $1', [g.compte.id]);
    const a3 = await achat();
    assert.deepStrictEqual([a3.json.paye, Number(a3.json.solde), a3.json.pagaies.prix], [400, 600, null]);
    await srv.base.query('UPDATE fleuve_pagaies SET perdues = 8 WHERE compte_id = $1', [g.compte.id]);
    assert.strictEqual((await achat()).statut, 403, '3 par jour au plus');
    const reg = (await srv.base.query("SELECT sum(montant)::int AS n FROM registre_pieces WHERE compte_id = $1 AND motif = 'pagaie'", [g.compte.id])).rows[0].n;
    assert.strictEqual(reg, -700);
    // Pas en vente (prix à 0) ; compte invité refusé.
    await srv.reglages.ecrire('fleuve', { ...srv.reglages.get('fleuve'), prixPagaie1: 0 });
    assert.strictEqual((await api('/api/fleuve', { jeton: g.jeton })).json.pagaies.prix, null);
    const inv = await invite('SansGP' + Date.now() % 1000);
    assert.strictEqual((await api('/api/fleuve/pagaie', { methode: 'POST', jeton: inv.jeton })).statut, 403);
    await srv.reglages.ecrire('fleuve', { ...srv.reglages.get('fleuve'), prixPagaie1: 100 });
  });
  await test('Fleuve : étoiles et pièces (doublées au premier succès du jour), escale fermée sans assez d\'étoiles', async () => {
    const F = srv.fleuve;
    const g = await connexionG('sb-fleuve-b', { providerId: 'g-fleuve-b' });
    const c = await srv.comptes.statut(g.compte.id);
    const solde0 = Number(c.solde);
    const seuils = (await api('/admin/api/fleuve/congo/biefs/1', { jeton: adminJeton })).json.map((x) => x.seuils);
    const jouer = async (n, score) => { const d = await F.commencer(c, 'congo', n); return F.terminer(c.id, d.essai, { reussi: true, score }); };
    const r1 = await jouer(1, seuils[0].trois);
    assert.deepStrictEqual([r1.etoiles, r1.double, r1.pieces, r1.nouvelles], [3, true, 30, 3]);
    const r2 = await jouer(2, 0);
    assert.deepStrictEqual([r2.etoiles, r2.double, r2.pieces], [1, false, 5]);
    const r2b = await jouer(2, seuils[1].trois); // rejouer pour la 3e étoile : seulement les étoiles nouvelles
    assert.deepStrictEqual([r2b.etoiles, r2b.pieces, r2b.premiereFois], [3, 10, false]);
    const rate = await F.terminer(c.id, (await F.commencer(c, 'congo', 3)).essai, { reussi: false, score: 50 });
    assert.deepStrictEqual([rate.etoiles, rate.pieces, rate.pagaies.restantes], [0, 0, 4]);
    for (let n = 3; n <= 9; n++) await jouer(n, 0);
    assert.strictEqual(Number((await srv.comptes.statut(c.id)).solde), solde0 + 30 + 5 + 10 + 7 * 5);
    await assert.rejects(F.commencer(c, 'congo', 10), /20 étoiles/);
    const d = (await api('/api/fleuve/congo/10', { jeton: g.jeton })).json;
    assert.deepStrictEqual([d.escale, d.villeEtoiles, d.ville], [true, 13, 'Banana']);
    await srv.reglages.ecrire('fleuve', { ...srv.reglages.get('fleuve'), etoilesVille: 13 });
    const boss = await jouer(10, 0);
    assert.deepStrictEqual([boss.escale, boss.piecesEscale, boss.pieces], [true, 200, 205]);
    await srv.reglages.ecrire('fleuve', { ...DEFAUTS.fleuve, etat: 'ouvert' });
    const reg = (await srv.base.query("SELECT count(*)::int AS n FROM registre_pieces WHERE compte_id = $1 AND motif = 'fleuve'", [c.id])).rows[0].n;
    assert.strictEqual(reg, 11);
  });
  await test('Fleuve : bloqué 5 jours sur une étape, les robots baissent d\'un cran', async () => {
    const F = srv.fleuve;
    const g = await connexionG('sb-fleuve-c', { providerId: 'g-fleuve-c' });
    const c = await srv.comptes.statut(g.compte.id);
    const maintenant = Date.now();
    for (let j = 5; j >= 1; j--) {
      F.regler(() => new Date(maintenant - j * 864e5));
      const d = await F.commencer(c, 'congo', 1);
      assert.strictEqual(d.adoucir, 0);
      await F.terminer(c.id, d.essai, { reussi: false, score: 0 });
    }
    F.regler(() => new Date(maintenant));
    const d = await F.commencer(c, 'congo', 1);
    assert.strictEqual(d.adoucir, 10);
    await F.annuler(c.id, d.essai);
    await srv.reglages.ecrire('fleuve', { ...DEFAUTS.fleuve });
  });
  await test('Fleuve : amis sur la carte, dépassement (une alerte par jour), 1er à l\'escale, course de la semaine', async () => {
    const F = srv.fleuve;
    await srv.reglages.ecrire('fleuve', { ...DEFAUTS.fleuve, etat: 'ouvert', etoilesVille: 0 });
    const maintenant = Date.now();
    F.regler(() => new Date(maintenant));
    const ga = await connexionG('sb-fleuve-d', { providerId: 'g-fleuve-d' }), gb = await connexionG('sb-fleuve-e', { providerId: 'g-fleuve-e' }), gc = await connexionG('sb-fleuve-f', { providerId: 'g-fleuve-f' });
    await devenirAmis(ga, gb); await devenirAmis(ga, gc);
    const A = await srv.comptes.statut(ga.compte.id), B = await srv.comptes.statut(gb.compte.id);
    const jouer = async (c, n, score = 0) => { const d = await F.commencer(c, 'congo', n); return F.terminer(c.id, d.essai, { reussi: true, score }); };
    for (let n = 1; n <= 3; n++) await jouer(B, n);
    for (let n = 1; n <= 3; n++) assert.deepStrictEqual((await jouer(A, n)).depasses, [], 'B est devant');
    const r4 = await jouer(A, 4);
    assert.deepStrictEqual(r4.depasses, [B.pseudo]);
    await attendre(300);
    const notifsB = async () => (await srv.base.query("SELECT texte, donnees FROM notifications WHERE compte_id = $1 AND type = 'fleuve' ORDER BY id", [B.id])).rows;
    let nb = await notifsB();
    assert.strictEqual(nb.length, 1);
    assert.match(nb[0].texte, new RegExp(A.pseudo + ' t\'a dépassé sur le Congo \\(étape 4\\)'));
    await jouer(B, 4);
    assert.deepStrictEqual((await jouer(A, 5)).depasses, [B.pseudo], 'dépassé encore');
    await attendre(300);
    assert.strictEqual((await notifsB()).length, 1, 'une seule alerte par jour');
    // Ce que voit A : B sur la carte, la course de la semaine.
    const e = (await api('/api/fleuve', { jeton: ga.jeton })).json.fleuves.congo;
    const b = e.amis.find((x) => x.id === B.id);
    assert.deepStrictEqual([e.amis.length, b.n, b.etoiles], [1, 5, 4], 'C n\'a pas commencé : absent');
    assert.deepStrictEqual(e.course.lignes.map((l) => [l.pseudo, l.etoiles]), [[A.pseudo, 5], [B.pseudo, 4]]);
    assert.strictEqual(e.course.pieces, 300);
    // 1er à l'escale : A passe Banana avant ses amis ; B ensuite ne l'a pas.
    for (let n = 6; n <= 9; n++) await jouer(A, n);
    const boss = await jouer(A, 10);
    assert.strictEqual(boss.premierA, 'Banana');
    for (let n = 5; n <= 10; n++) await jouer(B, n);
    assert.strictEqual((await srv.base.query("SELECT count(*)::int AS n FROM fleuve_marques WHERE compte_id = $1 AND type = 'premier'", [B.id])).rows[0].n, 0);
    assert.deepStrictEqual((await api('/api/fleuve', { jeton: ga.jeton })).json.fleuves.congo.marques.premiers, ['1er à Banana']);
    // Alertes coupées dans les paramètres : plus rien.
    await api('/api/push/prefs', { methode: 'PATCH', jeton: gb.jeton, corps: { fleuve: false } });
    // Fin de la semaine : A (10 étoiles) bat B (10 aussi : ex æquo, les deux gagnent) ; C n'a pas couru.
    await jouer(A, 1, 999); // 3 étoiles sur l'étape 1 : 2 étoiles nouvelles de plus pour A
    const soldeA = Number((await srv.comptes.statut(A.id)).solde), soldeB = Number((await srv.comptes.statut(B.id)).solde);
    F.regler(() => new Date(maintenant + 7 * 864e5));
    const faits = await F.reglerCourses();
    const congo = faits.find((x) => x.fleuve === 'congo');
    assert.deepStrictEqual(congo.gagnants.map((g) => g.id), [A.id]);
    assert.strictEqual(Number((await srv.comptes.statut(A.id)).solde), soldeA + 300);
    assert.strictEqual(Number((await srv.comptes.statut(B.id)).solde), soldeB);
    assert.deepStrictEqual(await F.reglerCourses(), [], 'une seule fois');
    const ea = (await api('/api/fleuve', { jeton: ga.jeton })).json.fleuves.congo;
    assert.deepStrictEqual([ea.marques.pagayeur, ea.course.lignes.map((l) => l.etoiles)], [true, [0]], 'nouvelle semaine');
    assert.ok((await srv.base.query("SELECT 1 FROM notifications WHERE compte_id = $1 AND type = 'fleuve' AND donnees->>'course' = 'true'", [A.id])).rows.length);
    F.regler(() => new Date());
    await srv.reglages.ecrire('fleuve', { ...DEFAUTS.fleuve });
  });

  await test('Fleuve : le lancement ferme la Bande (mises rendues), arrête le Match du jour, ouvre le Fleuve, une seule fois', async () => {
    const F = srv.fleuve;
    const ga = await connexionG('sb-fleuve-g', { providerId: 'g-fleuve-g' }), gb = await connexionG('sb-fleuve-h', { providerId: 'g-fleuve-h' });
    const lundi = require('../src/match-jour').lundiDe(require('../src/match-jour').jourDe(new Date()));
    await srv.base.query("INSERT INTO bandes (id, nom, code, createur, mise) VALUES ('b-lance', 'Les Pagayeurs', 'LANCE1', $1, 700)", [ga.compte.id]);
    await srv.base.query("INSERT INTO bande_semaines (bande_id, semaine, mise) VALUES ('b-lance', $1, 700)", [lundi]);
    for (const g of [ga, gb]) {
      await srv.base.query("INSERT INTO bande_inscriptions (bande_id, semaine, compte_id, mise) VALUES ('b-lance', $1, $2, 700)", [lundi, g.compte.id]);
    }
    const solde = async (g) => Number((await srv.comptes.statut(g.compte.id)).solde);
    const avantA = await solde(ga);
    assert.strictEqual((await api('/admin/api/fleuve/lancer', { methode: 'POST', jeton: adminJeton, corps: {} })).statut, 400, 'confirmation obligatoire');
    const r = await api('/admin/api/fleuve/lancer', { methode: 'POST', jeton: adminJeton, corps: { confirmation: 'LANCER' } });
    assert.strictEqual(r.statut, 200);
    assert.ok(r.json.joueurs >= 2 && r.json.pieces >= 1400);
    assert.strictEqual(await solde(ga), avantA + 700);
    assert.strictEqual((await srv.base.query("SELECT statut FROM bande_semaines WHERE bande_id = 'b-lance'")).rows[0].statut, 'annulee');
    assert.deepStrictEqual([srv.reglages.get('bande').actif, srv.reglages.get('matchJour').actif, srv.reglages.get('fleuve').etat], [false, false, 'ouvert']);
    const cfg = (await api('/api/config')).json;
    assert.deepStrictEqual([cfg.fleuve, cfg.nouveaute, !!cfg.fleuveLance], ['ouvert', 'fleuve', true]);
    assert.strictEqual((await api('/api/fleuve', { jeton: gb.jeton })).json.rembourse, 700);
    await attendre(200);
    assert.ok((await srv.base.query("SELECT 1 FROM notifications WHERE compte_id = $1 AND type = 'bande' AND donnees->>'fermeture' = 'true'", [gb.compte.id])).rows.length);
    assert.strictEqual((await api('/admin/api/fleuve/lancer', { methode: 'POST', jeton: adminJeton, corps: { confirmation: 'LANCER' } })).statut, 409, 'une seule fois');
    // Les réglages gardent la date du lancement quand l'admin change autre chose.
    await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...DEFAUTS.fleuve, etat: 'ouvert', pagaies: 6 } } });
    assert.ok(srv.reglages.get('fleuve').lance);
    assert.ok((await api('/admin/api/journal', { jeton: adminJeton })).json.some((x) => x.action === 'fleuve:lancer'));
  });
  await test('Fleuve : chaque fleuve a son interrupteur (Kasaï, Oubangui, Nil éteints au départ)', async () => {
    const g = await connexionG('sb-fleuve-i', { providerId: 'g-fleuve-i' });
    const { VILLES, NOMS } = require('../src/fleuve');
    assert.deepStrictEqual(Object.keys(require('../src/fleuve-generateur').FLEUVES), ['congo', 'niger', 'kasai', 'oubangui', 'nil']);
    assert.deepStrictEqual(Object.keys(NOMS), Object.keys(VILLES));
    assert.deepStrictEqual([VILLES.kasai[0], VILLES.oubangui[6], VILLES.nil[VILLES.nil.length - 1]], ['Kwamouth', 'Bangui', 'Jinja']);
    let e = (await api('/api/fleuve', { jeton: g.jeton })).json;
    assert.deepStrictEqual(Object.keys(e.fleuves), ['congo', 'niger'], 'les nouveaux fleuves sont éteints');
    let r = await api('/api/fleuve/kasai/1', { jeton: g.jeton });
    assert.strictEqual(r.statut, 403); assert.match(r.json.erreur, /Kasaï ouvre bientôt/);
    const reg = srv.reglages.get('fleuve');
    assert.strictEqual((await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...reg, fleuves: { kasai: 'allume' } } } })).statut, 400);
    assert.strictEqual((await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...reg, fleuves: { amazone: 'ouvert' } } } })).statut, 400);
    assert.strictEqual((await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...reg, fleuves: { kasai: 'ouvert' } } } })).statut, 200);
    assert.deepStrictEqual(srv.reglages.get('fleuve').fleuves, { congo: 'ouvert', niger: 'ouvert', kasai: 'ouvert', oubangui: 'ferme', nil: 'ferme' }, 'les autres gardent leur état');
    e = (await api('/api/fleuve', { jeton: g.jeton })).json;
    assert.deepStrictEqual(Object.keys(e.fleuves), ['congo', 'niger', 'kasai']);
    assert.deepStrictEqual([e.fleuves.kasai.nom, e.fleuves.kasai.jeu, e.fleuves.kasai.ville], ['Kasaï', 'kopo', 'Kwamouth']);
    // Testeurs : seulement les pseudos de la liste.
    await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...srv.reglages.get('fleuve'), fleuves: { kasai: 'ferme', nil: 'testeurs' } } } });
    assert.deepStrictEqual(Object.keys((await api('/api/fleuve', { jeton: g.jeton })).json.fleuves), ['congo', 'niger']);
    const adm = (await api('/admin/api/fleuve', { jeton: adminJeton })).json;
    assert.deepStrictEqual([adm.fleuves.nil.etat, adm.fleuves.nil.villes, adm.fleuves.kasai.etat], ['testeurs', 15, 'ferme']);
    await api('/admin/api/reglages/fleuve', { methode: 'PUT', jeton: adminJeton, corps: { valeur: { ...srv.reglages.get('fleuve'), fleuves: { nil: 'ferme' } } } });
  });
  await srv.arreter();
  console.log(`\n${reussis} tests réussis, ${echecs} en échec.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
