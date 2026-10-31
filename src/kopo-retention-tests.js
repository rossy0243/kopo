// Tests de la rétention (missions, bienvenue, joker, XP, face-à-face). Lancer : node src/kopo-retention-tests.js
'use strict';
const assert = require('assert');
const R = require('./kopo-retention.js');

let ok = 0, ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nom); }
  catch (e) { ko++; console.log('  ✗ ' + nom + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); }
}
const profil = () => ({ version: 1 });
// Partie type : e = bilan déjà calculé.
const partie = (o = {}) => Object.assign({ place: 3, nbJoueurs: 5, manches: 2, finale: false, victoire: false, katapss: 0, premierSorti: 0, avecRobots: false, publique: true, adversaires: [] }, o);

console.log('Dates');
test('Semaine ISO', () => {
  assert.strictEqual(R.semaineDe('2026-10-31'), '2026-W44'); // samedi
  assert.strictEqual(R.semaineDe('2026-11-01'), '2026-W44'); // dimanche
  assert.strictEqual(R.semaineDe('2026-11-02'), '2026-W45'); // lundi
  assert.strictEqual(R.semaineDe('2027-01-01'), '2026-W53');
  assert.strictEqual(R.semaineDe('2025-12-29'), '2026-W01');
});
test('Décalage de jours et écart', () => {
  assert.strictEqual(R.decaler('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(R.decaler('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(R.ecart('2026-10-30', '2026-11-02'), 3);
});

console.log('\nXP et niveau');
test('Courbe : 100 XP pour le niveau 2, 125 pour le 3', () => {
  assert.deepStrictEqual(R.niveauDe(0), { niveau: 1, dansNiveau: 0, pourSuivant: 100 });
  assert.strictEqual(R.niveauDe(99).niveau, 1);
  assert.strictEqual(R.niveauDe(100).niveau, 2);
  assert.strictEqual(R.niveauDe(224).niveau, 2);
  assert.strictEqual(R.niveauDe(225).niveau, 3);
});
test('Première partie, même perdue contre des robots : niveau 2 et avatar débloqué', () => {
  const p = profil();
  const r = R.enregistrerPartie(p, partie({ place: 3, nbJoueurs: 3, manches: 0, avecRobots: true, publique: false }), '2026-10-31');
  assert.strictEqual(r.premiere, true);
  assert.strictEqual(r.niveauApres.niveau, 2);
  assert.deepStrictEqual(r.objets, ['av-nuit']);
  assert.strictEqual(p.collection.equipes.avatar, 'av-nuit');
  assert.strictEqual(p.entrainement.parties, 1);
  assert.ok(!p.stats, 'les parties avec robots ne comptent pas dans les stats');
});
test('XP : victoire à 5 = 5 + 4×10 + 20 + 50, divisée par deux avec des robots', () => {
  const p = profil(); p.premierePartie = 'x';
  let r = R.enregistrerPartie(p, partie({ place: 1, manches: 4, finale: true, victoire: true }), '2026-10-31');
  assert.strictEqual(r.xpPartie, 115);
  r = R.enregistrerPartie(p, partie({ place: 1, manches: 4, finale: true, victoire: true, avecRobots: true }), '2026-10-31');
  assert.strictEqual(r.xpPartie, 57);
});

console.log('\nFace-à-face');
test('Toi 1 – 0, puis 1 – 1 ; rien contre des robots', () => {
  const p = profil();
  let r = R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: false }] }), '2026-10-31');
  assert.deepStrictEqual(r.faceAFace, { nom: 'Kevin', gagnes: 1, perdus: 0, gagne: true });
  r = R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: true }] }), '2026-10-31');
  assert.deepStrictEqual(r.faceAFace, { nom: 'Kevin', gagnes: 1, perdus: 1, gagne: false });
  r = R.enregistrerPartie(p, partie({ avecRobots: true, adversaires: [{ id: 'k', nom: 'Kevin', devant: true }] }), '2026-10-31');
  assert.strictEqual(r.faceAFace, null);
  assert.strictEqual(p.rivaux.k.perdus, 1);
});
test('On montre le rival avec la plus longue histoire', () => {
  const p = profil();
  R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: false }] }), '2026-10-31');
  const r = R.enregistrerPartie(p, partie({ adversaires: [{ id: 'n', nom: 'Nadia', devant: true }, { id: 'k', nom: 'Kevin', devant: false }] }), '2026-10-31');
  assert.strictEqual(r.faceAFace.nom, 'Kevin');
  assert.strictEqual(r.faceAFace.gagnes, 2);
});
test('Titre « Le Cauchemar de Kevin » à 10 victoires, perdu s\'il reprend l\'avantage', () => {
  const p = profil();
  for (let i = 0; i < 9; i++) R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: false }] }), '2026-10-31');
  assert.strictEqual(R.titre(p), null);
  const r = R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: false }] }), '2026-10-31');
  assert.strictEqual(r.titre, 'Le Cauchemar de Kevin');
  for (let i = 0; i < 10; i++) R.enregistrerPartie(p, partie({ adversaires: [{ id: 'k', nom: 'Kevin', devant: true }] }), '2026-10-31');
  assert.strictEqual(R.titre(p), null);
});

console.log('\nMissions du jour');
test('3 missions par jour, dont une « joue N parties », toujours les mêmes pour un jour donné', () => {
  const a = R.missionsDuJour(profil(), '2026-10-31'), b = R.missionsDuJour(profil(), '2026-10-31');
  assert.strictEqual(a.length, 3);
  assert.deepStrictEqual(a.map((m) => m.id), b.map((m) => m.id));
  assert.strictEqual(a.filter((m) => /^jouer/.test(m.id)).length, 1);
  assert.strictEqual(new Set(a.map((m) => m.id)).size, 3);
  for (const m of a) assert.ok(m.pieces >= 20 && m.pieces <= 100);
});
test('Les jours suivants donnent d\'autres tirages', () => {
  const tirages = new Set();
  for (let i = 0; i < 10; i++) tirages.add(R.missionsDuJour(profil(), R.decaler('2026-10-31', i)).map((m) => m.id).sort().join());
  assert.ok(tirages.size >= 6);
});
test('Une mission finie rapporte ses pièces et son XP une seule fois', () => {
  const p = profil(); p.premierePartie = 'x';
  const ms = R.missionsDuJour(p, '2026-10-31');
  const jouer = ms.find((m) => /^jouer/.test(m.id));
  const solde0 = R.pieces(p).solde;
  let gagne = 0;
  for (let i = 0; i < jouer.cible + 2; i++) gagne += R.enregistrerPartie(p, partie({ manches: 0 }), '2026-10-31').missions.filter((m) => m.texte === jouer.texte && m.finie && m.apres > m.avant).length;
  assert.strictEqual(gagne, 1);
  assert.ok(R.pieces(p).solde - solde0 >= jouer.pieces);
  assert.ok(R.missionsDuJour(p, '2026-10-31').find((m) => m.id === jouer.id).finie);
});
test('Les missions pas finies restent un jour de plus (on peut rater un jour)', () => {
  const p = profil();
  const j1 = R.missionsDuJour(p, '2026-10-31').map((m) => m.id);
  const j2 = R.missionsDuJour(p, '2026-11-01');
  assert.ok(j2.length >= 3 && j2.length <= 6);
  assert.ok(j1.every((id) => j2.some((m) => m.id === id && m.hier)));
  const j3 = R.missionsDuJour(p, '2026-11-02');
  assert.ok(!j3.some((m) => j1.includes(m.id) && m.hier && !j2.some((x) => x.id === m.id && !x.hier)), 'celles du 31 ont expiré');
  assert.ok(R.missionsDuJour(p, '2026-11-05').length === 3);
});
test('Un seul « Changer » par jour, sur une mission pas finie', () => {
  const p = profil();
  const ms = R.missionsDuJour(p, '2026-10-31');
  assert.ok(R.peutChanger(p, '2026-10-31'));
  const n = R.changerMission(p, '2026-10-31', ms[1].id);
  assert.ok(n && !ms.some((m) => m.id === n.id));
  assert.strictEqual(R.changerMission(p, '2026-10-31', ms[0].id), null);
  assert.ok(R.missionsDuJour(p, '2026-11-01') && R.peutChanger(p, '2026-11-01'));
});

console.log('\nDéfi de la semaine');
test('Même défi toute la semaine, un autre la semaine suivante', () => {
  const p = profil();
  const a = R.defiSemaine(p, '2026-10-26').texte;
  assert.strictEqual(R.defiSemaine(p, '2026-11-01').texte, a);
  assert.notStrictEqual(R.defiSemaine(p, '2026-11-02').texte, a);
});
test('Défi fini : 300 pièces, XP et le cadre de la ville de la semaine', () => {
  const p = profil();
  const d = R.defiSemaine(p, '2026-10-31');
  const e = partie({ place: 1, victoire: true, finale: true, manches: 30, katapss: 3 });
  let r;
  for (let i = 0; i < d.cible && !(r && r.defi && r.defi.finie); i++) r = R.enregistrerPartie(p, e, '2026-10-31');
  assert.ok(r.defi.finie);
  assert.ok(p.collection.possedes.includes(d.cadre));
  assert.strictEqual(p.collection.equipes.cadre, d.cadre);
  assert.ok(R.defiSemaine(p, '2026-10-31').joursRestants === 2);
});

console.log('\nParcours de bienvenue');
test('7 cadeaux, un par jour de jeu ; un jour raté ne fait rien perdre', () => {
  const p = profil();
  const jours = ['2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
  const recus = jours.map((j) => R.recevoirBienvenue(p, j));
  assert.strictEqual(recus[0].pieces, 100);
  assert.strictEqual(recus[2].objet, 'av-kinshasa');
  assert.strictEqual(recus[6].objet, 'dos-kinshasa');
  assert.strictEqual(recus[7], null);
  assert.strictEqual(R.recevoirBienvenue(p, '2026-11-22'), null);
  assert.strictEqual(p.collection.equipes.dos, 'dos-kinshasa');
  assert.ok(R.bienvenue(p, '2026-12-01').termine);
});
test('Deux fois le même jour : un seul cadeau', () => {
  const p = profil();
  assert.ok(R.recevoirBienvenue(p, '2026-10-31'));
  assert.strictEqual(R.recevoirBienvenue(p, '2026-10-31'), null);
  assert.strictEqual(R.pieces(p).solde, 600);
});

console.log('\nBonus du jour et joker de série');
test('Série qui monte de 10 en 10, plafonnée à 150', () => {
  const p = profil();
  let j = '2026-10-01', b;
  for (let i = 0; i < 13; i++) { b = R.bonusDuJour(p, j); j = R.decaler(j, 1); }
  assert.strictEqual(b.serie, 13);
  assert.strictEqual(b.gain, 150);
  assert.strictEqual(R.bonusDuJour(p, R.decaler(j, -1)), null);
});
test('Un jour raté : le joker garde la série, une fois par semaine', () => {
  const p = profil();
  R.bonusDuJour(p, '2026-10-26'); R.bonusDuJour(p, '2026-10-27'); // lundi, mardi
  const b = R.bonusDuJour(p, '2026-10-29'); // jeudi (mercredi raté)
  assert.strictEqual(b.joker, true);
  assert.strictEqual(b.serie, 3);
  assert.ok(!R.jokerLibre(p, '2026-10-30'));
  const c = R.bonusDuJour(p, '2026-10-31'); // samedi (vendredi raté) : joker déjà pris cette semaine
  assert.strictEqual(c.joker, false);
  assert.strictEqual(c.serie, 1);
  R.bonusDuJour(p, '2026-11-01');
  const d = R.bonusDuJour(p, '2026-11-03'); // nouvelle semaine : joker de nouveau libre
  assert.strictEqual(d.joker, true);
  assert.strictEqual(d.serie, 3);
});
test('Deux jours ratés : la série repart à 1', () => {
  const p = profil();
  R.bonusDuJour(p, '2026-10-26'); R.bonusDuJour(p, '2026-10-27');
  const b = R.bonusDuJour(p, '2026-10-30');
  assert.strictEqual(b.serie, 1);
  assert.strictEqual(b.joker, false);
});

console.log('\nCollection');
test('Équiper seulement un objet possédé ; retirer un cadre', () => {
  const p = profil();
  assert.strictEqual(R.equiper(p, 'av-kinshasa'), false);
  R.donnerObjet(p, 'cadre-dakar');
  assert.strictEqual(p.collection.equipes.cadre, 'cadre-dakar');
  assert.ok(R.equiper(p, 'cadre-dakar'));
  assert.strictEqual(p.collection.equipes.cadre, null);
  assert.ok(R.equiper(p, 'av-laiton'));
});

console.log('\nBilan à partir de la vue');
test('Place, manches survécues, adversaires humains devant ou derrière', () => {
  const v = { moi: 'b', vainqueur: 'a', elimines: ['r', 'b', 'c'], numeroManche: 3,
    joueurs: [{ id: 'a', nom: 'Ali' }, { id: 'b', nom: 'Moi' }, { id: 'c', nom: 'Chris' }, { id: 'r', nom: 'Robot 1', robot: true }] };
  const e = R.bilanPartie(v, { avecRobots: true, katapss: 1 });
  assert.strictEqual(e.place, 3);
  assert.strictEqual(e.nbJoueurs, 4);
  assert.strictEqual(e.manches, 1);
  assert.strictEqual(e.finale, false);
  assert.deepStrictEqual(e.adversaires, [{ id: 'a', nom: 'Ali', devant: true }, { id: 'c', nom: 'Chris', devant: true }]);
  const g = R.bilanPartie(Object.assign({}, v, { moi: 'a' }), {});
  assert.strictEqual(g.victoire, true);
  assert.strictEqual(g.manches, 3);
});

console.log(`\n${ok} tests réussis, ${ko} en échec.`);
process.exit(ko ? 1 : 0);
