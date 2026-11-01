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
  srv = await demarrer({ port: 0, env: { NODE_ENV: 'test', SECRET_SERVEUR: 'x'.repeat(40), ADMIN_MOT_DE_PASSE: 'motdepasse-admin', ADMIN_TOTP: TOTP, SUPABASE_JWT_SECRET: 's'.repeat(40) } });
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

  console.log('Ligue classée et saisons');
  const P = DEFAUTS.ligue.points;
  const ligneLigue = async (id) => (await srv.base.query("SELECT l.* FROM ligue l JOIN saisons s ON s.numero = l.saison AND s.statut = 'en_cours' WHERE l.compte_id = $1", [id])).rows[0];
  await test('points selon la place : 9 joueurs, 4 joueurs, 3 joueurs, abandon, coupure', () => {
    const t = (n) => Array.from({ length: n }, (_, i) => calculerPoints({ place: i + 1, n }, P));
    assert.deepStrictEqual(t(9), [30, 15, 5, 0, 0, 0, 0, -5, -10]);
    assert.deepStrictEqual(t(5), [30, 15, 5, 0, -10]);
    assert.deepStrictEqual(t(4), [24, 12, 0, -10]);
    assert.deepStrictEqual(t(3), [18, 9, 0]);
    assert.strictEqual(calculerPoints({ place: 1, n: 9, abandon: true }, P), -15);
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
  });
  const classes = [];
  await test('partie publique à 4 : classée, points selon la place, message « ligue » à chacun', async () => {
    const js = [];
    for (let i = 0; i < 4; i++) js.push(await invite('Lg' + i + Date.now() % 1000));
    classes.push(...js);
    const r = await jouerPublique(js);
    assert.ok([...r.classee.values()].every(Boolean), 'annoncée classée au départ');
    assert.strictEqual(r.ligue.size, 4);
    const attendus = [24, 12, 0, 0]; // le dernier perd 10, mais pas sous 0
    r.ordre.forEach((id, i) => {
      const m = r.ligue.get(id);
      assert.strictEqual(m.points, attendus[i], 'place ' + (i + 1) + ' ' + JSON.stringify(m));
      assert.strictEqual(m.division, 'bois');
      assert.strictEqual(m.saison.numero, 1);
    });
    const l = await ligneLigue(r.ordre[0]);
    assert.deepStrictEqual([l.points, l.parties, l.victoires], [24, 1, 1]);
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
    assert.deepStrictEqual([m.points, m.division, m.divisionAvant, m.promu, m.protection], [125, 'bronze', 'bois', true, 3]);
    // Protégé : une défaite ne le fait pas redescendre sous 100.
    await srv.base.query('UPDATE ligue SET points = 104 WHERE saison = $1 AND compte_id = $2', [saison, a.compte.id]);
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test2', n: 9, joueurs: [{ id: a.compte.id, place: 9 }] });
    m = r.get(a.compte.id);
    assert.deepStrictEqual([m.points, m.division, m.relegue, m.protection], [100, 'bronze', false, 2]);
    // Sans protection : il redescend.
    await srv.base.query('UPDATE ligue SET protection = 0 WHERE saison = $1 AND compte_id = $2', [saison, a.compte.id]);
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test3', n: 9, joueurs: [{ id: a.compte.id, place: 9 }] });
    m = r.get(a.compte.id);
    assert.deepStrictEqual([m.points, m.division, m.relegue, m.delta], [90, 'bois', true, -10]);
    // Une même partie n'est jamais comptée deux fois.
    r = await srv.ligue.enregistrerPartie({ partieId: 'p_test3', n: 9, joueurs: [{ id: a.compte.id, place: 1 }] });
    assert.strictEqual(r.size, 0);
    assert.strictEqual((await ligneLigue(a.compte.id)).points, 90);
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
    await api('/api/amis', { methode: 'POST', jeton: b.jeton, corps: { cible: d.compte.pseudo + '#' + d.compte.numero } });
    await api('/api/amis', { methode: 'POST', jeton: b.jeton, corps: { cible: nouveau.compte.pseudo + '#' + nouveau.compte.numero } });
    const am = await api('/api/classement?type=amis', { jeton: b.jeton });
    assert.deepStrictEqual(am.json.liste.map((x) => x.id), [d.compte.id, b.compte.id, nouveau.compte.id]);
    assert.strictEqual(am.json.liste[2].points, 0);
  });

  console.log('Rivalités, notifications, invitations');
  await test('face-à-face : une partie à 3 crée les 3 duels', async () => {
    const js = [await invite('Fa1' + Date.now() % 1000), await invite('Fa2' + Date.now() % 1000), await invite('Fa3' + Date.now() % 1000)];
    const fin = await jouerPartie(js);
    const ordre = [fin.vainqueur, ...fin.elimines.slice().reverse()];
    const r = await api('/api/rivaux', { jeton: js.find((j) => j.compte.id === ordre[0]).jeton });
    assert.strictEqual(r.json.length, 2);
    assert.ok(r.json.every((x) => x.moi === 1 && x.lui === 0), JSON.stringify(r.json));
  });
  await test('rivalité entre amis : « t\'a rattrapé », une seule par jour, et 1 – 0 ne compte pas', async () => {
    const [x, y] = [await invite('Riv' + Date.now() % 1000), await invite('Ral' + Date.now() % 1000)];
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.pseudo + '#' + y.compte.numero } });
    const S = srv.social;
    assert.deepStrictEqual(await S.apresPartie([{ id: x.compte.id, place: 1 }, { id: y.compte.id, place: 2 }]), []);
    const e = await S.apresPartie([{ id: y.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]);
    assert.deepStrictEqual(e, [{ a: x.compte.id, texte: `${y.compte.pseudo} t'a rattrapé : 1 – 1 !` }]);
    assert.deepStrictEqual(await S.apresPartie([{ id: y.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]), [], 'pas deux le même jour');
    const n = await api('/api/notifications', { jeton: x.jeton });
    assert.strictEqual(n.json.liste[0].type, 'rivalite');
    assert.deepStrictEqual([n.json.liste[0].donnees.toi, n.json.liste[0].donnees.lui], [1, 1]);
    // y a reçu « x t'a ajouté en ami ».
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
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: z.compte.pseudo + '#' + z.compte.numero } });
    await srv.social.apresPartie([{ id: z.compte.id, place: 1 }, { id: x.compte.id, place: 2 }]);
    assert.deepStrictEqual(await srv.social.apresPartie([{ id: x.compte.id, place: 1 }, { id: z.compte.id, place: 2 }]), []);
  });
  await test('inviter un ami dans sa salle : ami seulement, code valide, pas de rafale', async () => {
    const [x, y, z] = [await invite('Hot' + Date.now() % 1000), await invite('Inv' + Date.now() % 1000), await invite('Aut' + Date.now() % 1000)];
    await api('/api/amis', { methode: 'POST', jeton: x.jeton, corps: { cible: y.compte.pseudo + '#' + y.compte.numero } });
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
    const r = await api('/admin/api/ligue/cloturer', { methode: 'POST', jeton: adminJeton, corps: { confirmation: 'CLOTURER' } });
    assert.deepStrictEqual([r.json.cloturee, r.json.ouverte], [1, 2]);
    // a a atteint Bronze (redescendu en Bois) : récompense Bronze. d a fini en Or.
    assert.strictEqual((await srv.comptes.lire(a.compte.id)).solde, soldeA + DEFAUTS.ligue.recompenses.bronze);
    assert.strictEqual((await srv.comptes.lire(d.compte.id)).solde, soldeD + DEFAUTS.ligue.recompenses.or);
    const l = await api('/api/ligue', { jeton: d.jeton });
    assert.strictEqual(l.json.saison.titre, 'Saison 2 : Kinshasa la belle');
    assert.deepStrictEqual([l.json.recompense.titre, l.json.recompense.rang, l.json.recompense.pieces], ['Or S1', 1, DEFAUTS.ligue.recompenses.or]);
    assert.deepStrictEqual(l.json.titres.map((t) => t.titre), ['Or S1']);
    // Or → Argent (une division de moins), avec la protection de début de saison.
    assert.deepStrictEqual([l.json.moi.division, l.json.moi.points, l.json.moi.protection], ['argent', 250, DEFAUTS.ligue.protection]);
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

  await test('trop d\'essais de connexion admin : bloqué', async () => {
    for (let i = 0; i < 5; i++) await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'x', code: '1' } });
    const r = await api('/admin/api/connexion', { methode: 'POST', corps: { motDePasse: 'motdepasse-admin', code: codeTotp(TOTP) } });
    assert.match(r.json.erreur, /Trop d'essais/);
  });

  await srv.arreter();
  console.log(`\n${reussis} tests réussis, ${echecs} en échec.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
