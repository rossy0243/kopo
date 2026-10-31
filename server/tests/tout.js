// Tests du serveur : node tests/tout.js  (base Postgres en mémoire, aucun compte externe nécessaire)
'use strict';
process.env.KOPO_TESTS = '1';
const assert = require('assert');
const { Client } = require('colyseus.js');
const { demarrer } = require('../src/index');
const { codeTotp, nouveauSecretTotp, verifierTotp } = require('../src/auth');
const { verifierPseudo } = require('../src/comptes');

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
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Joue une partie jusqu'au bout : chaque client humain joue la première action permise.
async function jouerPartie(joueurs, { robots = 0 } = {}) {
  const client = new Client(URL_.replace('http', 'ws'));
  const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z]/g, 'Q').padEnd(3, 'Q');
  const salles = [];
  let fin = null;
  for (const j of joueurs) {
    const salle = salles.length ? await client.joinById(salles[0].roomId, { jeton: j.jeton }) : await client.create('kopo', { jeton: j.jeton, code, rapide: true });
    salle.onMessage('erreur', () => {});
    salle.onMessage('solde', () => {});
    salle.onMessage('vue', (v) => {
      if (v.etat === 'finPartie') fin = fin || v;
      const a = v.manche && v.manche.actions[0];
      if (v.etat === 'manche' && a) setTimeout(() => salle.send('action', { action: a }), 5);
    });
    salles.push(salle);
  }
  for (let i = 0; i < robots; i++) salles[0].send('ajouterRobot');
  await attendre(100);
  salles[0].send('lancer');
  for (let t = 0; t < 400 && !fin; t++) await attendre(50);
  assert.ok(fin, 'la partie doit se terminer');
  await attendre(400); // enregistrement en base
  for (const s of salles) await s.leave();
  return fin;
}

(async () => {
  srv = await demarrer({ port: 0, env: { NODE_ENV: 'test', SECRET_SERVEUR: 'x'.repeat(40), ADMIN_MOT_DE_PASSE: 'motdepasse-admin', ADMIN_TOTP: TOTP } });
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
  await test('sans jeton, pas d\'accès', async () => assert.strictEqual((await api('/api/moi')).statut, 401));
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
  await test('ajouter un ami par pseudo#numéro', async () => {
    const r = await api('/api/amis', { methode: 'POST', jeton: a.jeton, corps: { cible: `Bruno#${b.compte.numero}` } });
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual((await api('/api/amis', { jeton: a.jeton })).json[0].pseudo, 'Bruno');
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
  await test('partie avec un robot : aucune pièce gagnée', async () => {
    const js = [await invite('Solo'), await invite('Duo')];
    await jouerPartie(js, { robots: 1 });
    for (const j of js) assert.strictEqual((await srv.comptes.lire(j.compte.id)).solde, 500);
    const r = (await srv.base.query('SELECT avec_robots FROM parties ORDER BY debut DESC LIMIT 1')).rows[0];
    assert.strictEqual(r.avec_robots, true);
  });
  await test('un joueur banni ne peut pas entrer dans une salle', async () => {
    const x = await invite('Tricheur');
    await srv.base.query("UPDATE comptes SET statut = 'banni' WHERE id = $1", [x.compte.id]);
    const c = new Client(URL_.replace('http', 'ws'));
    await assert.rejects(c.create('kopo', { jeton: x.jeton }));
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
    assert.strictEqual(l.json[0].id, a.compte.id);
    const f = await api('/admin/api/joueurs/' + a.compte.id, { jeton: adminJeton });
    assert.strictEqual(f.json.signalementsRecus.length, 1);
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
  await test('trop d\'essais de connexion admin : bloqué', async () => {
    for (let i = 0; i < 5; i++) await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'x', code: '1' } });
    const r = await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'motdepasse-admin', code: codeTotp(TOTP) } });
    assert.match(r.json.erreur, /Trop d'essais/);
  });

  await srv.arreter();
  console.log(`\n${reussis} tests réussis, ${echecs} en échec.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
