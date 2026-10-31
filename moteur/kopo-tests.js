// Kopo — parties d'exemple sous forme de tests.  Lancer : node kopo-tests.js
'use strict';
const assert = require('assert');
const K = require('./kopo-moteur.js');

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

const J = (m, joueur, carte) => K.jouer(m, { type: 'jouer', joueur, carte });
const R = (m, joueur) => K.jouer(m, { type: 'ramasser', joueur });
const T = (m, joueur) => K.jouer(m, { type: 'toutPoser', joueur });
const KA = (m, joueur) => K.jouer(m, { type: 'katapss', joueur });
const peut = (m, joueur, type, carte) =>
  K.actionsPossibles(m, joueur).some((a) => a.type === type && (carte === undefined || a.carte === carte));
const qualifies = (m) => m.qualifies.map((q) => q.joueur);

console.log('\nSéquences');

test("Exemple du règlement : 2♠ 3♠ 7♠ 10♠, le 5e n'a pas de pique et ramasse le 10♠", () => {
  const m = K.nouvelleManche(['A', 'B', 'C', 'D', 'E'], {
    A: ['2P', '4C', '5C', '6C'], B: ['3P', '4K', '5K', '6K'], C: ['7P', '4T', '5T', '6T'],
    D: ['10P', '7C', '7K', '7T'], E: ['8C', '8K', '8T', '9C'],
  }, 'A');
  J(m, 'A', '2P'); J(m, 'B', '3P'); J(m, 'C', '7P'); J(m, 'D', '10P');
  assert.ok(!peut(m, 'E', 'jouer'), "E n'a pas de pique, il ne peut pas jouer");
  R(m, 'E');
  assert.ok(m.mains.E.includes('10P'), 'E a le 10♠ en main');
  assert.strictEqual(m.mains.E.length, 5);
  assert.strictEqual(m.table.length, 0, 'les autres cartes sont retirées');
  assert.strictEqual(m.joueurCourant, 'D', 'D, qui avait posé le 10♠, relance');
  assert.strictEqual(m.couleurInterdite, 'P', 'D ne peut pas relancer à pique');
});

test('Le ramassage arrête la séquence tout de suite', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['9P', '2C', '3C', '4C'], B: ['2K', '3K', '4K', '5T'], C: ['10P', '6C', '7C', '8C'],
  }, 'A');
  J(m, 'A', '9P');
  R(m, 'B');
  assert.strictEqual(m.phase, 'ouverture', 'C ne joue pas : la séquence est finie');
  assert.strictEqual(m.joueurCourant, 'A');
  assert.ok(m.mains.B.includes('9P'));
});

test('Tout le monde suit : la plus forte carte relance, dans une autre couleur', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '2C', '3C', '4C'], B: ['9P', '2K', '3K', '4K'], C: ['5P', '6P', '2T', '3T'],
  }, 'A');
  J(m, 'A', '2P'); J(m, 'B', '9P'); J(m, 'C', '5P');
  assert.strictEqual(m.joueurCourant, 'B');
  assert.strictEqual(m.couleurInterdite, 'P');
  assert.throws(() => J(m, 'C', '6P'), "ce n'est pas le tour de C");
});

test('Relancer dans la couleur du tour précédent est refusé', () => {
  const m = K.nouvelleManche(['A', 'B'], {
    A: ['2P', '3P', '2C', '3C'], B: ['9P', '8P', '2K', '3K'],
  }, 'A');
  J(m, 'A', '3P'); J(m, 'B', '9P'); // B relance, pique interdit
  assert.throws(() => J(m, 'B', '8P'));
  assert.ok(peut(m, 'B', 'jouer', '2K'));
});

test("On joue toujours dans le sens des aiguilles d'une montre", () => {
  const m = K.nouvelleManche(['A', 'B', 'C', 'D'], {
    A: ['2C', '3C', '4C', '2P'], B: ['6C', '2K', '3K', '4K'],
    C: ['7C', '5K', '6K', '7K'], D: ['8C', '2T', '3T', '4T'],
  }, 'C');
  J(m, 'C', '7C');
  assert.deepStrictEqual(m.attente, ['D', 'A', 'B']);
});

test('Bluff : on peut ramasser même en ayant la couleur', () => {
  const m = K.nouvelleManche(['A', 'B'], {
    A: ['2P', '2C', '3C', '4C'], B: ['9P', '2K', '3K', '4K'],
  }, 'A');
  J(m, 'A', '2P');
  assert.ok(peut(m, 'B', 'ramasser') && peut(m, 'B', 'jouer', '9P'));
  R(m, 'B');
  assert.ok(m.mains.B.includes('2P'));
  assert.strictEqual(m.joueurCourant, 'A');
});

console.log('\nSortir de la manche');

test('Tout poser en suivant : les cartes posées ne comptent pas, la plus forte des autres relance', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['3P', '2C', '3C', '4C'], B: ['10P', '9P', '8P'], C: ['5P', '2K', '3K', '4K'],
  }, 'A');
  J(m, 'A', '3P');
  assert.ok(peut(m, 'B', 'toutPoser'));
  T(m, 'B');
  assert.deepStrictEqual(qualifies(m), ['B']);
  J(m, 'C', '5P');
  assert.strictEqual(m.joueurCourant, 'C', 'le 5♠ de C est la plus forte carte qui compte (pas le 10♠ de B)');
});

test("Garder ses cartes pour bluffer est permis (tout poser n'est pas obligatoire)", () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['3P', '2C', '3C', '4C'], B: ['10P', '9P'], C: ['5P', '6K', '7K', '8K'],
  }, 'A');
  J(m, 'A', '3P');
  assert.ok(peut(m, 'B', 'toutPoser') && peut(m, 'B', 'jouer', '9P'));
  J(m, 'B', '9P');
  assert.deepStrictEqual(m.mains.B, ['10P']);
  assert.deepStrictEqual(qualifies(m), []);
});

test('La carte avec laquelle on sort ne peut pas être ramassée', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['3P', '2C', '3C', '4C'], B: ['10P'], C: ['2K', '3K', '4K', '5K'],
  }, 'A');
  J(m, 'A', '3P');
  assert.ok(!peut(m, 'B', 'jouer'), 'sa dernière carte se pose avec « tout poser »');
  T(m, 'B'); // B sort avec le 10♠
  R(m, 'C');
  assert.ok(m.mains.C.includes('3P') && !m.mains.C.includes('10P'), 'C ramasse le 3♠, pas le 10♠');
  assert.strictEqual(m.joueurCourant, 'A');
});

test('Sortir en ouvrant : le joueur suivant relance librement, même dans la couleur de sortie', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['7C', '8C'], B: ['2C', '2P', '3K', '4K'], C: ['5P', '6P', '7P', '9T'],
  }, 'A');
  T(m, 'A'); // A pose ses 2 cœurs et sort
  assert.deepStrictEqual(qualifies(m), ['A']);
  assert.strictEqual(m.joueurCourant, 'B');
  assert.strictEqual(m.couleurInterdite, null);
  assert.ok(peut(m, 'B', 'jouer', '2C'));
  assert.ok(peut(m, 'B', 'jouer', '2P'));
});

test('Relance bloquée : seulement la couleur interdite en main, le joueur pose tout et sort', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '2C', '3C', '4C'], B: ['9P', '10P', '3P'], C: ['5P', '2K', '3K', '4K'],
  }, 'A');
  J(m, 'A', '2P'); J(m, 'B', '9P'); J(m, 'C', '5P'); // B relance, pique interdit, il n'a que du pique
  assert.deepStrictEqual(K.actionsPossibles(m, 'B').map((a) => a.type), ['toutPoser']);
  T(m, 'B');
  assert.strictEqual(m.joueurCourant, 'C', 'le joueur suivant relance');
  assert.strictEqual(m.couleurInterdite, null, 'librement, pique compris');
});

test("Ouvrir en posant tout d'un coup une couleur unique est permis (ou n'en poser qu'une)", () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2C', '3C', '4C'], B: ['9P', '2K', '3K', '4K'], C: ['5P', '6K', '7K', '8K'],
  }, 'A');
  assert.ok(peut(m, 'A', 'toutPoser') && peut(m, 'A', 'jouer', '2C'));
  T(m, 'A');
  assert.deepStrictEqual(qualifies(m), ['A']);
});

test('Le dernier joueur en jeu est éliminé, même en pleine séquence', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '3C'], B: ['4P'], C: ['5P'],
  }, 'A');
  J(m, 'A', '2P');
  T(m, 'B');
  T(m, 'C');
  assert.deepStrictEqual(qualifies(m), ['B', 'C']);
  assert.strictEqual(m.elimine, 'A');
  assert.strictEqual(m.phase, 'terminee');
});

console.log('\nKatapss');

test("Katapss annoncé avant d'agir : qualifié tout de suite", () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '2C', '3C', '4C'], B: ['2K', '5K', '8K', '10K'], C: ['5P', '6T', '7T', '8T'],
  }, 'A');
  assert.deepStrictEqual(m.katapss, ['B']);
  J(m, 'A', '2P');
  KA(m, 'B');
  assert.deepStrictEqual(qualifies(m), ['B']);
  assert.strictEqual(m.joueurCourant, 'C', "c'était au tour de B : C enchaîne");
});

test('Katapss annoncé hors de son tour', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '2C', '3C', '4C'], B: ['3P', '6T', '7T', '9T'], C: ['2K', '5K', '8K', '10K'],
  }, 'A');
  J(m, 'A', '2P');
  KA(m, 'C'); // c'est au tour de B
  assert.deepStrictEqual(qualifies(m), ['C']);
  assert.strictEqual(m.joueurCourant, 'B');
});

test("Katapss impossible une fois qu'on a agi (joué ou ramassé)", () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2P', '2C', '3C', '4C'], B: ['2K', '5K', '8K', '10K'], C: ['5P', '6T', '7T', '8T'],
  }, 'A');
  J(m, 'A', '2P');
  R(m, 'B'); // B ramasse au lieu d'annoncer
  assert.ok(!peut(m, 'B', 'katapss'));
  assert.throws(() => KA(m, 'B'));
});

test('Plusieurs Katapss dans un cas normal : tous qualifiés', () => {
  const m = K.nouvelleManche(['A', 'B', 'C', 'D'], {
    A: ['2C', '3C', '4C', '5C'], B: ['2K', '5K', '8K', '10K'], C: ['5P', '6T', '7T', '8T'], D: ['9T', '10T', '6P', '7P'],
  }, 'C');
  KA(m, 'B');
  KA(m, 'A');
  assert.deepStrictEqual(qualifies(m), ['B', 'A']);
  assert.strictEqual(m.elimine, null);
  assert.strictEqual(m.joueurCourant, 'C');
});

test('Tous les joueurs ont un Katapss : le dernier à annoncer est éliminé (ordre des clics)', () => {
  const m = K.nouvelleManche(['A', 'B'], {
    A: ['2C', '3C', '4C', '5C'], B: ['2K', '5K', '8K', '10K'],
  }, 'A');
  KA(m, 'B');
  assert.deepStrictEqual(qualifies(m), ['B']);
  assert.strictEqual(m.elimine, 'A');
});

test('Celui qui devait ouvrir annonce Katapss : le joueur suivant ouvre', () => {
  const m = K.nouvelleManche(['A', 'B', 'C'], {
    A: ['2C', '3C', '4C', '5C'], B: ['2K', '3P', '8K', '10T'], C: ['5P', '6T', '7T', '8T'],
  }, 'A');
  KA(m, 'A');
  assert.strictEqual(m.joueurCourant, 'B');
  assert.strictEqual(m.phase, 'ouverture');
});

console.log('\nParties complètes (simulation)');

test('1 000 parties à 9 joueurs se terminent toutes avec 8 éliminés et 1 vainqueur', () => {
  const joueurs = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9'];
  let katapss = 0;
  for (let g = 0; g < 1000; g++) {
    const rng = K.hasard(g + 1);
    const strat = g % 2 ? K.strategieSimple : K.strategieHasard(K.hasard(g + 5000));
    const { vainqueur, manches } = K.jouerPartie(joueurs, strat, rng);
    assert.strictEqual(manches.length, 8);
    manches.forEach((m, i) => {
      assert.strictEqual(m.sieges.length, 9 - i, 'un joueur de moins à chaque manche');
      assert.strictEqual(m.qualifies.length, m.sieges.length - 1, 'un seul éliminé par manche');
      katapss += m.qualifies.filter((q) => q.raison === 'Katapss').length;
    });
    const elimines = manches.map((m) => m.elimine);
    assert.strictEqual(new Set(elimines).size, 8);
    assert.ok(!elimines.includes(vainqueur));
  }
  console.log(`      (${katapss} Katapss annoncés au total)`);
});

test('À 9 joueurs, jamais plus de 8 Katapss dans une distribution', () => {
  const rng = K.hasard(42);
  for (let g = 0; g < 20000; g++) {
    const paquet = K.melanger(K.nouveauPaquet(), rng);
    let n = 0;
    for (let i = 0; i < 9; i++) {
      const main = paquet.slice(i * 4, i * 4 + 4);
      if (main.every((c) => K.couleur(c) === K.couleur(main[0]))) n++;
    }
    assert.ok(n <= 8);
  }
});

console.log(`\n${ok} tests réussis, ${echecs.length} en échec.`);
if (echecs.length) process.exit(1);
