// Inter (8) — tests des robots.  Lancer : node moteur/inter8-robots-tests.js
'use strict';
const assert = require('assert');
const I = require('./inter8-moteur.js');
const R = require('./inter8-robots.js');

let ok = 0;
const echecs = [];
function test(nom, fn) {
  try {
    fn();
    ok++;
    console.log('  ✓ ' + nom);
  } catch (e) {
    echecs.push(nom);
    console.log('  ✗ ' + nom + '\n      ' + e.message);
  }
}

const remplir = (depart) => Array.from({ length: 20 }, (_, i) => ['3', '4', '5', '6', '9'][i % 5] + 'PCKT'[i % 4] + '*').concat(depart);
const manche = (mains, depart, premier, mode, jRetour) => I.nouvelleManche(Object.keys(mains), mains, remplir(depart), premier, { mode: mode || 'simple', jRetour, graine: 3 });
const decide = (cerveau, m, j, rng) => cerveau(I.vuePublique(m, j), I.actionsPossibles(m, j), rng || (() => 0.5));

console.log('\nNiveaux');

test('Même progression que Kopo : la force monte avec le niveau du joueur, dans chaque plage', () => {
  assert.strictEqual(R.forceRobots('faciles', 1), 0);
  assert.strictEqual(R.forceRobots('normaux', 1), 1);
  assert.strictEqual(R.forceRobots('forts', 1), 1.6);
  assert.strictEqual(R.forceRobots('forts', 20), 2);
  assert.strictEqual(R.forceRobots('forts', 50), 2);
  assert.ok(R.forceRobots('normaux', 10) > 1 && R.forceRobots('normaux', 10) < 1.5);
  assert.strictEqual(R.forceRobots('gentils', 20), 0);
});

console.log('\nCe que voit un robot');

test('Un robot ne voit jamais les mains des autres : même vue, même coup', () => {
  const m1 = manche({ A: ['8T', '4C', '4K', '9K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, 'DC', 'A');
  const m2 = manche({ A: ['8T', '4C', '4K', '9K'], B: ['7P', '7K', '2P', 'RP'], C: ['XR', 'AT', '10T', 'VT'] }, 'DC', 'A');
  for (const cerveau of [R.robotGentil, R.robotNormal, R.robotFort]) {
    assert.deepStrictEqual(decide(cerveau, m1, 'A'), decide(cerveau, m2, 'A'));
  }
});

console.log('\nComportements');

test('Normal et Fort annoncent toujours et contestent toujours', () => {
  const m = manche({ A: ['3C', '4C'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, '5C', 'A');
  I.jouer(m, { type: 'jouer', joueur: 'A', cartes: ['3C'] });
  for (const cerveau of [R.robotNormal, R.robotFort]) {
    assert.strictEqual(decide(cerveau, m, 'A').type, 'annoncer');
    assert.strictEqual(decide(cerveau, m, 'C').type, 'contester');
  }
});

test('Facile oublie parfois d\'annoncer', () => {
  const m = manche({ A: ['4C', '4K'], B: ['3P', '4P', '5P', '6P'] }, '5C', 'B');
  assert.strictEqual(decide(R.robotGentil, m, 'A', () => 0.9), null);
  assert.strictEqual(decide(R.robotGentil, m, 'A', () => 0.1).type, 'annoncer');
});

test('Tous sortent dès qu\'ils peuvent (Normal et Fort)', () => {
  const m = manche({ A: ['7C', '7P'], B: ['3P', '4P', '5P', '6P'] }, '5C', 'A');
  I.jouer(m, { type: 'annoncer', joueur: 'A' });
  for (const cerveau of [R.robotNormal, R.robotFort]) assert.strictEqual(decide(cerveau, m, 'A').cartes.length, 2);
});

test('Normal garde ses pénalités, et les pose sur le joueur qui va sortir', () => {
  const mains = (b) => ({ A: ['2C', '5C', '9K', 'DK'], B: b, C: ['3T', '4T', '5T', '6T'] });
  const calme = manche(mains(['3P', '4P', '5P', '6P']), '7C', 'A');
  assert.notStrictEqual(I.valeur(decide(R.robotNormal, calme, 'A').cartes[0]), '2');
  const danger = manche(mains(['3P']), '7C', 'A');
  assert.strictEqual(I.valeur(decide(R.robotNormal, danger, 'A').cartes[0]), '2');
});

test('Normal demande avec le 8 la valeur qu\'il a le plus', () => {
  const m = manche({ A: ['8T', '4P', '4K', '9K'], B: ['3P', '4P', '5P', '6P'] }, 'DC', 'A');
  const a = decide(R.robotNormal, m, 'A');
  assert.strictEqual(a.cartes[0], '8T');
  assert.strictEqual(a.demande, '4');
});

test('Fort garde son 8 pour ne jamais devoir piocher', () => {
  const m = manche({ A: ['8T', '5C', '4K', '9K'], B: ['3P', '4P', '5P', '6P'] }, 'DC', 'A');
  assert.strictEqual(decide(R.robotFort, m, 'A').cartes[0], '5C');
});

test('Fort, en mode délire avec J retour, pose un J retour pour éloigner le tour d\'un joueur qui va sortir', () => {
  const m = manche({ A: ['VC', '5C', '9K', 'DK'], B: ['3P'], C: ['3T', '4T', '5T', '6T'], D: ['3K', '4K', '5K', '6K'] }, '7C', 'A', 'delire', true);
  const a = decide(R.robotFort, m, 'A');
  assert.strictEqual(a.cartes[0], 'VC');
});

test('Coup automatique : il pioche, ou passe après avoir pioché', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, '9T', 'A');
  assert.strictEqual(R.coupAutomatique(m, 'A').type, 'piocher');
  assert.strictEqual(R.coupAutomatique(m, 'B'), null);
});

console.log('\nParties entre robots');

test('300 parties à tous les niveaux (2 à 8 joueurs, simple et délire) : jamais bloquées', () => {
  const rng = I.hasard(5);
  for (let n = 0; n < 300; n++) {
    const nb = 2 + (n % 7);
    const niveau = R.NIVEAUX_ROBOTS[n % 3];
    const joueurs = 'ABCDEFGH'.slice(0, nb).split('');
    const r = I.jouerPartie(joueurs, (m, j) => R.choixRobot(m, j, niveau, 1 + (n % 25), rng), rng, { mode: n % 2 ? 'delire' : 'simple', jRetour: n % 4 === 1 });
    assert.ok(joueurs.includes(r.vainqueur));
  }
});

function victoires(a, b, n, graine) {
  const rng = I.hasard(graine);
  let gagnees = 0;
  for (let k = 0; k < n; k++) {
    const joueurs = k % 2 ? ['a', 'b'] : ['b', 'a'];
    const r = I.jouerPartie(joueurs, (m, j, act) => (j === 'a' ? a : b)(I.vuePublique(m, j), act, rng), rng, { mode: k % 4 < 2 ? 'simple' : 'delire', jRetour: k % 8 >= 6 });
    if (r.vainqueur === 'a') gagnees++;
  }
  return gagnees / n;
}

test('Normal bat nettement Facile en duel', () => {
  const t = victoires(R.robotNormal, R.robotGentil, 400, 21);
  assert.ok(t > 0.7, `Normal gagne ${Math.round(t * 100)} %`);
});

test('Fort bat Normal en duel', () => {
  const t = victoires(R.robotFort, R.robotNormal, 600, 22);
  assert.ok(t > 0.52, `Fort gagne ${Math.round(t * 100)} %`);
});

console.log(`\n${ok} test(s) réussi(s), ${echecs.length} échec(s).`);
if (echecs.length) process.exit(1);
