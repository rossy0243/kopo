// Tests de la salle multijoueur. Lancer : node kopo-salle-tests.js
'use strict';
const assert = require('assert');
const K = require('../moteur/kopo-moteur.js');
const S = require('./kopo-salle.js');

let ok = 0, ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nom); }
  catch (e) { ko++; console.log('  ✗ ' + nom + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); }
}

function salleAvec(n, graine) {
  const s = S.creerSalle('ABCD', K.hasard(graine || 1));
  for (let i = 1; i <= n; i++) assert.ok(S.recevoir(s, 'p' + i, { type: 'rejoindre', nom: 'Ami' + i }).ok);
  return s;
}

// Fait jouer tous les téléphones au hasard, uniquement à partir de leur vue.
function jouerPartieParLesVues(s, rng) {
  let coups = 0;
  while (s.etat !== 'finPartie') {
    if (++coups > 50000) throw new Error('Partie bloquée');
    if (s.etat === 'finManche') { S.recevoir(s, s.hote, { type: 'mancheSuivante' }); continue; }
    const ids = s.manche.enJeu.slice().sort(() => rng() - 0.5);
    let fait = false;
    for (const id of ids) {
      const v = S.vue(s, id);
      if (!v.manche.actions.length) continue;
      const kat = v.manche.actions.find((a) => a.type === 'katapss');
      if (kat && rng() < 0.5) { assert.ok(S.recevoir(s, id, { type: 'action', action: kat }).ok); fait = true; break; }
      if (v.manche.joueurCourant === id) {
        const a = v.manche.actions[Math.floor(rng() * v.manche.actions.length)];
        assert.ok(S.recevoir(s, id, { type: 'action', action: a }).ok, JSON.stringify(a));
        fait = true; break;
      }
    }
    assert.ok(fait, 'personne ne pouvait agir');
  }
}

console.log('\nSalon');
test("Le premier arrivé est l'hôte, 9 joueurs maximum", () => {
  const s = salleAvec(9);
  assert.strictEqual(s.hote, 'p1');
  assert.ok(!S.recevoir(s, 'p10', { type: 'rejoindre', nom: 'X' }).ok);
});
test("Seul l'hôte lance, et il faut 2 joueurs", () => {
  const s = salleAvec(1);
  assert.ok(!S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  S.recevoir(s, 'p2', { type: 'rejoindre', nom: 'B' });
  assert.ok(!S.recevoir(s, 'p2', { type: 'lancer' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  assert.strictEqual(s.etat, 'manche');
});
test('Personne ne rejoint une partie commencée, mais un joueur déconnecté retrouve sa place', () => {
  const s = salleAvec(3);
  S.recevoir(s, 'p1', { type: 'lancer' });
  assert.ok(!S.recevoir(s, 'intrus', { type: 'rejoindre', nom: 'I' }).ok);
  S.deconnecter(s, 'p2');
  assert.strictEqual(S.vue(s, 'p1').joueurs[1].connecte, false);
  assert.ok(S.recevoir(s, 'p2', { type: 'rejoindre' }).ok);
  assert.strictEqual(S.vue(s, 'p2').manche.main.length, 4);
});
test('Les pseudos sont nettoyés', () => {
  const s = S.creerSalle('X');
  S.recevoir(s, 'a', { type: 'rejoindre', nom: '<b>Un pseudo beaucoup trop long</b>' });
  assert.ok(!/[<>]/.test(s.joueurs[0].nom) && s.joueurs[0].nom.length <= 16);
});

console.log('\nConfidentialité');
test('Chaque téléphone ne reçoit que sa propre main', () => {
  const s = salleAvec(5);
  S.recevoir(s, 'p1', { type: 'lancer' });
  for (const j of s.joueurs) {
    const v = S.vue(s, j.id);
    assert.deepStrictEqual(v.manche.main, s.manche.mains[j.id]);
    const texte = JSON.stringify(v);
    for (const autre of s.joueurs) if (autre.id !== j.id)
      for (const c of s.manche.mains[autre.id]) assert.ok(!texte.includes('"' + c + '"'), j.id + ' voit ' + c);
    assert.strictEqual(v.manche.nbCartes.p1, 4);
  }
});
test("On ne peut pas jouer à la place d'un autre", () => {
  const s = salleAvec(3);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const courant = s.manche.joueurCourant;
  const autre = s.manche.sieges.find((j) => j !== courant);
  const carte = s.manche.mains[courant][0];
  const r = S.recevoir(s, autre, { type: 'action', action: { type: 'jouer', joueur: courant, carte } });
  assert.ok(!r.ok);
  assert.strictEqual(s.manche.mains[courant].length, 4);
});

console.log('\nKatapss');
function salleKatapss() {
  const s = salleAvec(3);
  S.recevoir(s, 'p1', { type: 'lancer' });
  s.manche = K.nouvelleManche(['p1', 'p2', 'p3'], {
    p1: ['2P', '3P', '4P', '5P'], p2: ['2C', '3C', '4C', '5C'], p3: ['6P', '6C', '6K', '6T'],
  }, 'p3');
  return s;
}
test("Seul le joueur concerné voit le bouton Katapss", () => {
  const s = salleKatapss();
  assert.ok(S.vue(s, 'p1').manche.actions.some((a) => a.type === 'katapss'));
  assert.ok(!S.vue(s, 'p3').manche.actions.some((a) => a.type === 'katapss'));
});
test("Katapss simultanés : l'ordre des clics décide, et un clic périmé est ignoré", () => {
  const s = salleKatapss();
  assert.ok(S.recevoir(s, 'p2', { type: 'action', action: { type: 'katapss' } }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'action', action: { type: 'katapss' } }).ok);
  assert.deepStrictEqual(s.manche.qualifies.map((q) => q.joueur), ['p2', 'p1']);
  assert.strictEqual(s.manche.elimine, 'p3');
  assert.strictEqual(s.etat, 'finManche');
  assert.deepStrictEqual(s.restants.sort(), ['p1', 'p2']);
  assert.ok(!S.recevoir(s, 'p1', { type: 'action', action: { type: 'katapss' } }).ok);
});

console.log('\nParties complètes');
test('Le journal affiche les pseudos, pas les identifiants', () => {
  const s = salleKatapss();
  S.recevoir(s, 'p2', { type: 'action', action: { type: 'katapss' } });
  const j = S.vue(s, 'p1').manche.journal.join(' ');
  assert.ok(j.includes('Ami2') && !/\bp2\b/.test(j), j);
});
test('200 parties de 2 à 9 joueurs jouées uniquement depuis les vues des téléphones', () => {
  const rng = K.hasard(42);
  for (let k = 0; k < 200; k++) {
    const n = 2 + (k % 8);
    const s = salleAvec(n, k + 1);
    S.recevoir(s, 'p1', { type: 'lancer' });
    jouerPartieParLesVues(s, rng);
    assert.ok(s.vainqueur);
    assert.strictEqual(s.elimines.length, n - 1);
    assert.strictEqual(s.numeroManche, n - 1);
  }
});
test("L'hôte rejoue une partie avec les mêmes joueurs", () => {
  const s = salleAvec(3, 7);
  S.recevoir(s, 'p1', { type: 'lancer' });
  jouerPartieParLesVues(s, K.hasard(3));
  assert.ok(S.recevoir(s, 'p1', { type: 'rejouer' }).ok);
  assert.strictEqual(s.etat, 'salon');
  assert.strictEqual(s.joueurs.length, 3);
});
test("Sauvegarde et reprise si l'hôte recharge sa page", () => {
  const s = salleAvec(4, 9);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const r = S.importer(S.exporter(s));
  assert.deepStrictEqual(r.manche.mains, s.manche.mains);
  assert.ok(r.joueurs.every((j) => !j.connecte));
});

console.log('\nChrono (5 secondes par joueur)');
function salleChrono() {
  const s = salleAvec(3);
  let t = 1000; s.horloge = () => t;
  S.recevoir(s, 'p1', { type: 'lancer' });
  s.manche = K.nouvelleManche(['p1', 'p2', 'p3'], {
    p1: ['9P', '2C', '3C', '4C'], p2: ['2K', '3K', '4K', '5T'], p3: ['10P', '6C', '7C', '8C'],
  }, 'p1');
  s.echeance = t + 5000;
  return { s, avancer: (ms) => (t += ms) };
}
test('Le chrono est de 5 secondes par défaut et visible par tous', () => {
  const { s } = salleChrono();
  assert.strictEqual(s.delai, 5);
  assert.deepStrictEqual(S.vue(s, 'p2').chrono, { resteMs: 5000, totalMs: 5000 });
});
test("Rien ne se passe avant la fin des 5 secondes", () => {
  const { s, avancer } = salleChrono();
  avancer(4999);
  assert.ok(!S.tic(s));
  assert.strictEqual(s.manche.joueurCourant, 'p1');
});
test("Ouvreur trop lent : sa plus petite carte autorisée est posée", () => {
  const { s, avancer } = salleChrono();
  avancer(5000);
  assert.ok(S.tic(s));
  assert.deepStrictEqual(s.manche.table[0].cartes, ['2C']);
  assert.strictEqual(s.manche.joueurCourant, 'p2');
});
test("Joueur trop lent (ou hors ligne) en suite : il pioche, et le chrono repart pour le suivant", () => {
  const { s, avancer } = salleChrono();
  S.recevoir(s, 'p1', { type: 'action', action: { type: 'jouer', carte: '9P' } });
  S.deconnecter(s, 'p2');
  avancer(5000);
  assert.ok(S.tic(s));
  assert.ok(s.manche.mains.p2.includes('9P'), 'p2 a ramassé le 9♠');
  assert.strictEqual(s.manche.joueurCourant, 'p1');
  assert.strictEqual(S.vue(s, 'p1').chrono.resteMs, 5000);
  assert.ok(S.vue(s, 'p1').manche.journal.some((t) => t.includes('Temps écoulé pour Ami2')));
});
test("Jouer à temps relance le chrono pour le joueur suivant", () => {
  const { s, avancer } = salleChrono();
  avancer(3000);
  S.recevoir(s, 'p1', { type: 'action', action: { type: 'jouer', carte: '2C' } });
  assert.strictEqual(S.vue(s, 'p2').chrono.resteMs, 5000);
});
test("L'hôte peut régler le chrono dans le salon, ou le couper", () => {
  const s = salleAvec(2);
  assert.ok(!S.recevoir(s, 'p2', { type: 'reglages', delai: 10 }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'reglages', delai: 7 }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', delai: 0 }).ok);
  S.recevoir(s, 'p1', { type: 'lancer' });
  assert.strictEqual(S.vue(s, 'p1').chrono, null);
});
test('Parties complètes jouées uniquement au chrono (tout le monde hors ligne)', () => {
  for (let n = 2; n <= 9; n++) {
    const s = salleAvec(n, n);
    let t = 0; s.horloge = () => t;
    S.recevoir(s, 'p1', { type: 'lancer' });
    let tours = 0;
    while (s.etat !== 'finPartie') {
      if (++tours > 20000) throw new Error('bloqué');
      if (s.etat === 'finManche') { S.recevoir(s, 'p1', { type: 'mancheSuivante' }); continue; }
      t += 5000; assert.ok(S.tic(s));
    }
  }
});

console.log('\nMicro');
test("Chacun indique s'il a activé ou coupé son micro", () => {
  const s = salleAvec(2);
  S.recevoir(s, 'p2', { type: 'rejoindre', peerId: 'abc' });
  S.recevoir(s, 'p2', { type: 'micro', voix: true, muet: false });
  const j = S.vue(s, 'p1').joueurs[1];
  assert.deepStrictEqual([j.peerId, j.voix, j.muet], ['abc', true, false]);
});

console.log(`\n${ok} tests réussis, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
