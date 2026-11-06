// Inter (8) — exemples du règlement sous forme de tests.  Lancer : node moteur/inter8-tests.js
'use strict';
const assert = require('assert');
const I = require('./inter8-moteur.js');

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

// Manche sur mesure : la pioche se tire par la fin, la carte de départ est la dernière de la pioche.
function manche(mains, pioche, premier, mode) {
  const sieges = Object.keys(mains);
  return I.nouvelleManche(sieges, mains, pioche, premier || sieges[0], { mode: mode || 'simple', graine: 7 });
}
const J = (m, joueur, cartes, demande) => I.jouer(m, demande ? { type: 'jouer', joueur, cartes, demande } : { type: 'jouer', joueur, cartes });
const P = (m, joueur) => I.jouer(m, { type: 'piocher', joueur });
const PA = (m, joueur) => I.jouer(m, { type: 'passer', joueur });
const AN = (m, joueur) => I.jouer(m, { type: 'annoncer', joueur });
const CO = (m, joueur) => I.jouer(m, { type: 'contester', joueur });
const peut = (m, joueur, type) => I.actionsPossibles(m, joueur).some((a) => a.type === type);
const interdit = (fn, morceau) => assert.throws(fn, morceau ? new RegExp(morceau) : undefined);
// Pioche de remplissage (aucune carte spéciale), puis la carte de départ en dernier.
const remplir = (depart, n) => Array.from({ length: n || 20 }, (_, i) => ['3', '4', '5', '6', '9'][i % 5] + 'PCKT'[i % 4] + '*').concat(depart);

console.log('\nMatériel');

test('1 paquet de 54 cartes de 2 à 4 joueurs, 2 paquets (108) de 5 à 8', () => {
  assert.strictEqual(I.nouveauPaquet(1).length, 54);
  assert.strictEqual(I.nouveauPaquet(2).length, 108);
  assert.strictEqual(new Set(I.nouveauPaquet(2)).size, 108, 'chaque carte est unique');
  assert.strictEqual(I.nombrePaquets(4), 1);
  assert.strictEqual(I.nombrePaquets(5), 2);
  assert.strictEqual(I.nombrePaquets(8), 2);
});

test('Lecture des cartes', () => {
  assert.strictEqual(I.valeur('10C'), '10');
  assert.strictEqual(I.valeur('AP*'), 'A');
  assert.strictEqual(I.couleur('VK*'), 'K');
  assert.strictEqual(I.valeur('XR'), 'X');
  assert.strictEqual(I.couleur('XN*'), null);
  assert.strictEqual(I.afficher('7C'), '7♥');
});

test('Chacun reçoit 4 cartes', () => {
  const d = I.distribuer(['A', 'B', 'C'], 1, I.hasard(1));
  for (const j of ['A', 'B', 'C']) assert.strictEqual(d.mains[j].length, 4);
  assert.strictEqual(d.pioche.length, 54 - 12);
});

console.log('\nCarte de départ');

test("La carte de départ n'est jamais un 8 : on prend la suivante", () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, ['9T', '7K', '8C'], 'A');
  assert.strictEqual(m.defausse[m.defausse.length - 1], '7K');
  assert.ok(m.pioche.includes('8C'), 'le 8 retourne dans la pioche');
});

test('Un 2 au départ : le premier joueur pioche 2 cartes et passe son tour', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('2K'), 'A');
  assert.strictEqual(m.mains.A.length, 6);
  assert.strictEqual(m.joueurCourant, 'B');
});

test('Un joker au départ : le premier pioche 5 cartes, le suivant pose la carte de son choix', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'], C: ['9C', '9P', '9K', '9T'] }, remplir('XR'), 'A');
  assert.strictEqual(m.mains.A.length, 9);
  assert.strictEqual(m.joueurCourant, 'B');
  J(m, 'B', ['3P']); // n'importe quelle carte
});

test('Un As au départ : le premier joueur passe son tour', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'], C: ['9C', '9P', '9K', '9T'] }, remplir('AK'), 'A');
  assert.strictEqual(m.joueurCourant, 'B');
  assert.strictEqual(m.mains.A.length, 4);
});

console.log('\nTour ordinaire');

test('On pose une carte de même couleur ou de même valeur', () => {
  const m = manche({ A: ['3C', '7P', 'DK', '9T'], B: ['3P', '4P', '5P', '6P'] }, remplir('7C'), 'A');
  interdit(() => J(m, 'A', ['DK']), 'même couleur ou de même valeur');
  J(m, 'A', ['7P']); // même valeur
  assert.strictEqual(m.joueurCourant, 'B');
  J(m, 'B', ['3P']); // même couleur
});

test("Sans carte jouable, on pioche une carte ; si elle se joue, on peut la poser", () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('9T').slice(0, -1).concat('9P', '9T'), 'A');
  assert.ok(!peut(m, 'A', 'jouer'));
  P(m, 'A');
  assert.strictEqual(m.aPioche, '9P');
  interdit(() => J(m, 'A', ['3C']), 'carte piochée');
  J(m, 'A', ['9P']);
  assert.strictEqual(m.joueurCourant, 'B');
});

test('On ne peut pas piocher quand on peut jouer', () => {
  const m = manche({ A: ['3C', '9P', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('9T'), 'A');
  assert.ok(!peut(m, 'A', 'piocher'));
  interdit(() => P(m, 'A'));
});

test("Après avoir pioché, on peut garder la carte et passer ; si elle ne se joue pas, le tour passe seul", () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('9T').slice(0, -1).concat('9P', '9T'), 'A');
  P(m, 'A');
  PA(m, 'A');
  assert.strictEqual(m.joueurCourant, 'B');
  const m2 = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('9T').slice(0, -1).concat('DC', '9T'), 'A');
  P(m2, 'A');
  assert.strictEqual(m2.joueurCourant, 'B', 'la DC ne se joue pas sur 9♣ : le tour passe');
});

console.log('\nPlusieurs cartes de même valeur');

test('Exemple du règlement : sur 4♥, 7♥ puis 7♠ ensemble, on suit pique', () => {
  const m = manche({ A: ['7C', '7P', '3K', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('4C'), 'A');
  J(m, 'A', ['7C', '7P']);
  assert.strictEqual(m.defausse[m.defausse.length - 1], '7P');
  interdit(() => J(m, 'B', ['4P*'])); // B n'a pas cette carte
  J(m, 'B', ['3P']); // pique
});

test('La première carte doit être jouable', () => {
  const m = manche({ A: ['7C', '7P', '3K', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('4C'), 'A');
  interdit(() => J(m, 'A', ['7P', '7C']), 'même couleur ou de même valeur');
});

test('Pas plusieurs cartes juste parce qu\'elles ont la même couleur', () => {
  const m = manche({ A: ['7C', '9C', '3K', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('4C'), 'A');
  interdit(() => J(m, 'A', ['7C', '9C']), 'même valeur');
});

test('Plusieurs cartes : la dernière doit changer la couleur du centre', () => {
  // Centre 4♥ : 7♥ puis 7♠ change la couleur ; 7♠ puis 7♥ la garde, c'est refusé.
  const m = manche({ A: ['7C', '7P', '7T', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('4C'), 'A');
  interdit(() => J(m, 'A', ['7T', '7P', '7C']), 'même couleur ou de même valeur');
  const m2 = manche({ A: ['7C', '7P', '7T', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('7C*'), 'A');
  interdit(() => J(m2, 'A', ['7P', '7C']), 'Avec plusieurs cartes, la dernière doit changer la couleur \\(pas de cœur');
  interdit(() => J(m2, 'A', ['7T', '7P', '7C']), 'Avec plusieurs cartes');
  J(m2, 'A', ['7C', '7P']);
  assert.strictEqual(I.couleur(m2.defausse[m2.defausse.length - 1]), 'P');
});

test('Plusieurs cartes : on peut en garder une partie en main', () => {
  const m = manche({ A: ['7C', '7P', '7T', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('4C'), 'A');
  const coups = I.actionsPossibles(m, 'A').filter((a) => a.type === 'jouer').map((a) => a.cartes.join(' '));
  assert.ok(coups.includes('7C 7P'), coups.join(' | '));
  assert.ok(coups.includes('7C 7T 7P'), coups.join(' | '));
  assert.ok(!coups.some((c) => c.endsWith('C') && c.includes(' ')), 'jamais un cœur en dernier sur du cœur');
});

test('Deux paquets : les doublons de la couleur du centre passent ensemble (deux 5♦ sur du carreau)', () => {
  const m = manche({ A: ['5K', '5K*', '5P', '9C'], B: ['3P', '4P', '5P*', '6P'] }, remplir('9K'), 'A');
  interdit(() => J(m, 'A', ['5K', '5P', '5K*']), 'Avec plusieurs cartes');
  J(m, 'A', ['5K', '5K*']);
  assert.strictEqual(m.mains.A.length, 2);
});

test('Plusieurs jokers ou plusieurs 8 pour sortir : pas de couleur à changer', () => {
  const m = manche({ A: ['8C', '8C*'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  AN(m, 'A');
  J(m, 'A', ['8C*', '8C']);
  assert.ok(m.qualifies.includes('A'));
});

console.log('\nPénalités');

test('2 : le suivant pioche 2 cartes et passe son tour', () => {
  const m = manche({ A: ['2C', '3K', '4K', '5K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('9C'), 'A');
  J(m, 'A', ['2C']);
  assert.strictEqual(m.mains.B.length, 6);
  assert.strictEqual(m.joueurCourant, 'C');
});

test('Deux 2 : 4 cartes ; deux 10 : 8 cartes ; deux jokers : 10 cartes, toujours au suivant', () => {
  const m = manche({ A: ['2C', '2P', '4K', '5K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('9C', 40), 'A');
  J(m, 'A', ['2C', '2P']);
  assert.strictEqual(m.mains.B.length, 8);
  assert.strictEqual(m.mains.C.length, 4);
  const m2 = manche({ A: ['10C', '10P', '4K', '5K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('9C', 40), 'A');
  J(m2, 'A', ['10C', '10P']);
  assert.strictEqual(m2.mains.B.length, 12);
  const m3 = manche({ A: ['XR', 'XN', '4K', '5K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('9C', 40), 'A');
  J(m3, 'A', ['XR', 'XN']);
  assert.strictEqual(m3.mains.B.length, 14);
});

test('Pas de contre : celui qui reçoit la pénalité ne joue pas', () => {
  const m = manche({ A: ['2C', '3K', '4K', '5K'], B: ['2P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('9C'), 'A');
  J(m, 'A', ['2C']);
  assert.strictEqual(m.joueurCourant, 'C');
  interdit(() => J(m, 'B', ['2P']));
});

test('Le joker se pose sur tout ; après le pénalisé, on pose la carte de son choix', () => {
  const m = manche({ A: ['XR', '3K', '4K', '5K'], B: ['3P', '4P', '5P', '6P'], C: ['DT', '4T', '5T', '6T'] }, remplir('9C'), 'A');
  J(m, 'A', ['XR']);
  assert.strictEqual(m.mains.B.length, 9);
  assert.strictEqual(m.joueurCourant, 'C');
  J(m, 'C', ['DT']);
});

test('À 2 joueurs, après une pénalité, le poseur rejoue', () => {
  const m = manche({ A: ['2C', '3C', '4K', '5K'], B: ['3P', '4P', '5P', '6P'] }, remplir('9C'), 'A');
  J(m, 'A', ['2C']);
  assert.strictEqual(m.joueurCourant, 'A');
});

console.log('\nLe 8 : « Inter demande »');

test('Le 8 se pose sur tout et demande une valeur qu\'on a en main', () => {
  const m = manche({ A: ['8T', '4C', '5K', '6K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  interdit(() => J(m, 'A', ['8T'], '9'), 'Demande une valeur');
  interdit(() => J(m, 'A', ['8T'], '8'), 'Demande une valeur');
  J(m, 'A', ['8T'], '4');
  assert.deepStrictEqual(m.demande, { valeur: '4', par: 'A' });
});

test("Pendant une demande : la valeur demandée, un 8 ou un joker, sinon on pioche ; la valeur posée arrête la demande", () => {
  const m = manche({ A: ['8T', '4C', '5K', '6K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  J(m, 'A', ['8T'], '4');
  interdit(() => J(m, 'B', ['3P']), 'Inter demande 4');
  J(m, 'B', ['4P']);
  assert.strictEqual(m.demande, null, 'la demande est finie');
  assert.strictEqual(m.joueurCourant, 'C');
  // Jeu normal sur le 4♠ : C n'a ni pique ni 4, il doit piocher.
  assert.ok(!peut(m, 'C', 'jouer'));
  assert.ok(peut(m, 'C', 'piocher'));
});

test('Si personne ne pose la valeur, le tour revient au demandeur qui la pose', () => {
  const pioche = remplir('DC').slice(0, -1).concat('9C', 'DP', 'DC');
  const m = manche({ A: ['8T', '4C', '5K', '6K'], B: ['3P', '7P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, pioche, 'A');
  J(m, 'A', ['8T'], '4');
  P(m, 'B'); // DP : pas un 4, le tour passe
  assert.strictEqual(m.joueurCourant, 'C');
  P(m, 'C'); // 9C : pas un 4
  assert.strictEqual(m.joueurCourant, 'A');
  interdit(() => J(m, 'A', ['5K']), 'que tu as demandée');
  J(m, 'A', ['4C']);
  assert.strictEqual(m.demande, null);
  assert.deepStrictEqual(m.vu.piochesDemande.map((p) => p.joueur), ['B', 'C']);
});

test('Un autre 8 lance une nouvelle demande', () => {
  const m = manche({ A: ['8T', '4C', '5K', '6K'], B: ['8P', '9P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  J(m, 'A', ['8T'], '4');
  J(m, 'B', ['8P'], '9');
  assert.deepStrictEqual(m.demande, { valeur: '9', par: 'B' });
  J(m, 'C', ['9T']);
  assert.strictEqual(m.demande, null);
});

test('Un joker coupe la demande : le suivant pioche 5, puis jeu libre', () => {
  const m = manche({ A: ['8T', '4C', '5K', '6K'], B: ['XN', '9P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  J(m, 'A', ['8T'], '4');
  J(m, 'B', ['XN']);
  assert.strictEqual(m.demande, null);
  assert.strictEqual(m.mains.C.length, 9);
  assert.strictEqual(m.joueurCourant, 'A');
  J(m, 'A', ['6K']); // carte de son choix
});

test('Pendant une demande, pas de 2, de 10 ni d\'As, sauf si c\'est la valeur demandée (et son effet s\'applique)', () => {
  const m = manche({ A: ['8T', '2C', '5K', '6K'], B: ['AP', '2P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  J(m, 'A', ['8T'], '2');
  interdit(() => J(m, 'B', ['AP']), 'Inter demande 2');
  J(m, 'B', ['2P']);
  assert.strictEqual(m.mains.C.length, 6, 'C pioche 2');
  assert.strictEqual(m.joueurCourant, 'A');
});

test('Un seul 8 à la fois, sauf pour sortir avec ses derniers 8 ; finir sur un 8 : jeu libre', () => {
  const m = manche({ A: ['8T', '8C', '5K', '6K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  interdit(() => J(m, 'A', ['8T', '8C'], '5'), 'Un seul 8');
  const m2 = manche({ A: ['8T', '8C'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '9T', '5T', '6T'] }, remplir('DC'), 'A');
  AN(m2, 'A');
  J(m2, 'A', ['8T', '8C']);
  assert.ok(m2.qualifies.includes('A'));
  assert.strictEqual(m2.demande, null);
  assert.strictEqual(m2.libre, true);
  J(m2, 'B', ['3P']);
});

console.log('\nL\'As');

test('Exemple du règlement : à 3, A pose 3 As, B, C puis B sont sautés, C joue', () => {
  const m = manche({ A: ['AC', 'AP', 'AK', '9K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['AC', 'AP', 'AK']);
  assert.strictEqual(m.joueurCourant, 'C');
});

test('À 2 joueurs, un As fait sauter l\'adversaire et le poseur rejoue', () => {
  const m = manche({ A: ['AC', '3C', '4K', '9K'], B: ['3P', '4P', '5P', '6P'] }, remplir('5C'), 'A');
  J(m, 'A', ['AC']);
  assert.strictEqual(m.joueurCourant, 'A');
});

test('Deux As à 3 joueurs : B et C sautés, A rejoue', () => {
  const m = manche({ A: ['AC', 'AP', '4C', '9K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['AC', 'AP']);
  assert.strictEqual(m.joueurCourant, 'A');
});

console.log('\nMode délire : J retour');

test('Le valet change le sens ; deux valets s\'annulent', () => {
  const mains = () => ({ A: ['VC', 'VP', '4C', '9K'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'], D: ['3K', '4K', '5K', '6K'] });
  const m = manche(mains(), remplir('5C'), 'A', 'delire');
  J(m, 'A', ['VC']);
  assert.strictEqual(m.joueurCourant, 'D');
  const m2 = manche(mains(), remplir('5C'), 'A', 'delire');
  J(m2, 'A', ['VC', 'VP']);
  assert.strictEqual(m2.joueurCourant, 'B');
});

test('Le valet est une carte ordinaire en mode simple et à 2 joueurs', () => {
  const m = manche({ A: ['VC', '4C', '9K', '9P'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A', 'simple');
  J(m, 'A', ['VC']);
  assert.strictEqual(m.joueurCourant, 'B');
  const m2 = manche({ A: ['VC', '4C', '9K', '9P'], B: ['3P', '4P', '5P', '6P'] }, remplir('5C'), 'A', 'delire');
  J(m2, 'A', ['VC']);
  assert.strictEqual(m2.joueurCourant, 'B');
  assert.strictEqual(m2.sens, 1);
});

console.log('\nAnnonce et sortie');

test("Oubli d'annonce : contesté, amende d'1 carte", () => {
  const m = manche({ A: ['3C', '4C'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['3C']);
  assert.deepStrictEqual(m.contestables, ['A']);
  CO(m, 'C');
  assert.strictEqual(m.mains.A.length, 2);
  assert.deepStrictEqual(m.contestables, []);
});

test("Le joueur suivant a joué : on peut toujours contester, jusqu'au prochain tour de l'oublieux", () => {
  const m = manche({ A: ['3C', '4T'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['3C']);
  J(m, 'B', ['3P']);
  assert.ok(peut(m, 'C', 'contester'));
  J(m, 'C', ['3T']);
  assert.ok(peut(m, 'B', 'contester'), 'toujours contestable avant que A ne rejoue');
  J(m, 'A', ['4T']);
  assert.deepStrictEqual(m.contestables, []);
});

test("Deux oublis à la suite : chacun peut être contesté", () => {
  const m = manche({ A: ['3C', '4C'], B: ['3P', '4P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['3C']);
  J(m, 'B', ['3P']);
  assert.deepStrictEqual(m.contestables, ['A', 'B']);
  const cibles = I.actionsPossibles(m, 'C').filter((a) => a.type === 'contester').map((a) => a.cible);
  assert.deepStrictEqual(cibles, ['A', 'B']);
  I.jouer(m, { type: 'contester', joueur: 'C', cible: 'B' });
  assert.strictEqual(m.mains.B.length, 2);
  assert.deepStrictEqual(m.contestables, ['A']);
});

test("Qui a annoncé ne peut pas être contesté ; piocher annule l'annonce", () => {
  const m = manche({ A: ['3C', '4C'], B: ['2C', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  J(m, 'A', ['3C']);
  AN(m, 'A');
  assert.ok(!peut(m, 'C', 'contester'));
  assert.deepStrictEqual(m.annonces, ['A']);
  J(m, 'B', ['2C']); // B est après A : c'est C qui pioche
  assert.deepStrictEqual(m.annonces, ['A']);
  const m2 = manche({ A: ['2C', '4C', '9T', '9P'], B: ['3C'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  AN(m2, 'B');
  J(m2, 'A', ['2C']);
  assert.deepStrictEqual(m2.annonces, [], "B a pioché : son annonce tombe");
});

test('Sortir sur un 2 : la pénalité s\'applique quand même au suivant', () => {
  const m = manche({ A: ['2C'], B: ['3P', '4P', '5P', '6P'], C: ['3T', '4T', '5T', '6T'] }, remplir('5C'), 'A');
  AN(m, 'A');
  J(m, 'A', ['2C']);
  assert.ok(m.qualifies.includes('A'));
  assert.strictEqual(m.mains.B.length, 6);
  assert.strictEqual(m.joueurCourant, 'C');
});

test('Le dernier qui garde des cartes est éliminé', () => {
  const m = manche({ A: ['3C'], B: ['3P', '4P', '5P', '6P'] }, remplir('5C'), 'A');
  J(m, 'A', ['3C']);
  assert.strictEqual(m.phase, 'terminee');
  assert.strictEqual(m.elimine, 'B');
});

console.log('\nPioche vide');

test('Pioche vide : on remélange la défausse sauf la carte de référence', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, ['9T'], 'A');
  m.defausse = ['DK', 'RK', '9T'];
  P(m, 'A');
  assert.strictEqual(m.defausse.length, 1);
  assert.strictEqual(m.defausse[0], '9T');
  assert.strictEqual(m.mains.A.length, 5);
});

test('Plus de pioche ni de défausse : match nul', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, ['9T'], 'A');
  P(m, 'A');
  assert.strictEqual(m.phase, 'nulle');
});

test('Une pénalité plus grande que la pioche : on pioche ce qu\'il y a', () => {
  const m = manche({ A: ['10C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, ['3T', '9C'], 'A');
  J(m, 'A', ['10C']);
  assert.strictEqual(m.mains.B.length, 6, '1 carte de pioche + 1 de la défausse remélangée');
  assert.strictEqual(m.phase, 'jeu');
});

console.log('\nParties complètes');

test('Ce qu\'un joueur voit ne montre jamais les mains des autres', () => {
  const m = manche({ A: ['3C', '4C', '5C', '6C'], B: ['3P', '4P', '5P', '6P'] }, remplir('9C'), 'A');
  const v = I.vuePublique(m, 'A');
  assert.deepStrictEqual(v.main, ['3C', '4C', '5C', '6C']);
  assert.ok(!JSON.stringify(v).includes('4P'));
});

test('2 000 parties au hasard (2 à 8 joueurs, simple et délire) : jamais bloquées, aucune carte perdue', () => {
  const rng = I.hasard(42);
  for (let n = 0; n < 2000; n++) {
    const nb = 2 + (n % 7);
    const joueurs = 'ABCDEFGH'.slice(0, nb).split('');
    const mode = n % 2 ? 'delire' : 'simple';
    const strat = n % 3 ? I.strategieHasard(rng) : I.strategieSimple;
    const total = I.nouveauPaquet(I.nombrePaquets(nb)).length;
    const verifier = (m) => {
      const cartes = [...m.pioche, ...m.defausse, ...Object.values(m.mains).flat()];
      assert.strictEqual(cartes.length, total, 'nombre de cartes');
      assert.strictEqual(new Set(cartes).size, total, 'cartes en double');
    };
    const avecVerif = (m, j, a) => { verifier(m); return strat(m, j, a); };
    const r = I.jouerPartie(joueurs, avecVerif, rng, { mode });
    assert.ok(joueurs.includes(r.vainqueur));
    const elimines = r.manches.filter((m) => m.phase === 'terminee').map((m) => m.elimine);
    assert.strictEqual(elimines.length, nb - 1);
    assert.strictEqual(new Set(elimines.concat(r.vainqueur)).size, nb);
  }
});

console.log(`\n${ok} test(s) réussi(s), ${echecs.length} échec(s).`);
if (echecs.length) process.exit(1);
