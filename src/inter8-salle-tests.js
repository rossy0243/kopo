// Tests de la salle d'Inter (8). Lancer : node src/inter8-salle-tests.js
'use strict';
const assert = require('assert');
const I = require('../moteur/inter8-moteur.js');
const S = require('./inter8-salle.js');

let ok = 0, ko = 0;
function test(nom, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nom); }
  catch (e) { ko++; console.log('  ✗ ' + nom + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); }
}

// Horloge manuelle pour les tests de chrono.
function horloge() { let t = 1000; const h = () => t; h.avancer = (ms) => (t += ms); return h; }

function salleAvec(n, graine) {
  const s = S.creerSalle('ABCD', I.hasard(graine === undefined ? 1 : graine));
  s.durees = { depart: 0, mancheAuto: 0, revanche: 15000 };
  for (let i = 1; i <= n; i++) assert.ok(S.recevoir(s, 'p' + i, { type: 'rejoindre', nom: 'Ami' + i }).ok);
  return s;
}

// Fait jouer tous les téléphones au hasard, uniquement à partir de leur vue.
function jouerPartieParLesVues(s, rng) {
  let coups = 0;
  while (s.etat !== 'finPartie') {
    if (++coups > 100000) throw new Error('Partie bloquée');
    if (s.etat === 'finManche') { assert.ok(S.recevoir(s, s.hote, { type: 'mancheSuivante' }).ok); continue; }
    const ids = s.manche.enJeu.slice().sort(() => rng() - 0.5);
    let fait = false;
    for (const id of ids) {
      const v = S.vue(s, id);
      const actions = v.manche.actions;
      if (!actions.length) continue;
      const horsTour = actions.filter((a) => a.type === 'annoncer' || a.type === 'contester');
      if (horsTour.length && rng() < 0.5) { assert.ok(S.recevoir(s, id, { type: 'action', action: horsTour[0] }).ok); fait = true; break; }
      if (v.manche.joueurCourant === id) {
        const jeu = actions.filter((a) => a.type !== 'annoncer' && a.type !== 'contester');
        const a = jeu[Math.floor(rng() * jeu.length)];
        assert.ok(S.recevoir(s, id, { type: 'action', action: a }).ok, JSON.stringify(a));
        fait = true; break;
      }
    }
    assert.ok(fait, 'personne ne pouvait agir');
  }
}

console.log('\nSalon');

test("Le premier arrivé est l'hôte, 8 joueurs maximum", () => {
  const s = salleAvec(8);
  assert.strictEqual(s.hote, 'p1');
  assert.ok(!S.recevoir(s, 'p9', { type: 'rejoindre', nom: 'X' }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'ajouterRobot' }).ok);
});

test("Seul l'hôte lance, et il faut 2 joueurs", () => {
  const s = salleAvec(1);
  assert.ok(!S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  S.recevoir(s, 'p2', { type: 'rejoindre', nom: 'B' });
  assert.ok(!S.recevoir(s, 'p2', { type: 'lancer' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  assert.strictEqual(s.etat, 'manche');
});

test("Style de partie : l'hôte choisit Simple ou Délire dans le salon", () => {
  const s = salleAvec(3);
  assert.ok(!S.recevoir(s, 'p2', { type: 'reglages', mode: 'delire' }).ok, 'pas un invité');
  assert.ok(!S.recevoir(s, 'p1', { type: 'reglages', mode: 'fou' }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'reglages', mode: 'delire', jRetour: 'oui' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', mode: 'delire', jRetour: false }).ok);
  assert.strictEqual(S.vue(s, 'p2').mode, 'delire');
  assert.strictEqual(S.vue(s, 'p2').jRetour, false);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', jRetour: true }).ok);
  assert.strictEqual(S.vue(s, 'p2').jRetour, true);
  S.recevoir(s, 'p1', { type: 'lancer' });
  assert.strictEqual(s.manche.mode, 'delire');
  assert.strictEqual(s.manche.jRetour, true);
  assert.ok(!S.recevoir(s, 'p1', { type: 'reglages', mode: 'simple' }).ok, 'plus pendant la partie');
});

test('J retour : seulement en délire, et une ancienne appli qui envoie « délire » seul le garde', () => {
  const s = salleAvec(3);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', mode: 'simple', jRetour: true }).ok);
  assert.strictEqual(s.jRetour, false, 'pas de J retour en simple');
  S.recevoir(s, 'p1', { type: 'reglages', mode: 'delire' });
  assert.strictEqual(s.jRetour, true);
  const t = salleAvec(3);
  S.recevoir(t, 'p1', { type: 'reglages', mode: 'delire', jRetour: true });
  S.recevoir(t, 'p1', { type: 'lancer' });
  const ancienne = JSON.parse(S.exporter(t));
  delete ancienne.jRetour; delete ancienne.manche.jRetour;
  const u = S.importer(JSON.stringify(ancienne));
  assert.strictEqual(u.jRetour, true);
  assert.strictEqual(u.manche.jRetour, true);
});

test('Simple : 1 paquet même à 8 joueurs ; délire : 2 paquets même à 2 joueurs', () => {
  const s8 = salleAvec(8); S.recevoir(s8, 'p1', { type: 'lancer' });
  assert.strictEqual(s8.paquets, 1);
  assert.strictEqual(S.vue(s8, 'p1').manche.paquets, 1);
  const s2 = salleAvec(2); S.recevoir(s2, 'p1', { type: 'reglages', mode: 'delire', jRetour: false }); S.recevoir(s2, 'p1', { type: 'lancer' });
  assert.strictEqual(s2.paquets, 2);
  assert.strictEqual(S.vue(s2, 'p1').manche.paquets, 2);
});

console.log('\nCe que voit chaque joueur');

test('Chacun ne voit que sa main, la carte de référence et le nombre de cartes des autres', () => {
  const s = salleAvec(3);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const v = S.vue(s, 'p2');
  assert.strictEqual(v.jeu, 'inter8');
  assert.deepStrictEqual(v.manche.main, s.manche.mains.p2);
  assert.strictEqual(v.manche.reference, s.manche.defausse[s.manche.defausse.length - 1]);
  const autres = s.manche.mains.p1.concat(s.manche.mains.p3).filter((c) => !s.manche.mains.p2.includes(c));
  const texte = JSON.stringify(v);
  for (const c of autres) assert.ok(!texte.includes('"' + c + '"'), 'la carte ' + c + ' des autres est visible');
  assert.strictEqual(v.manche.nbCartes.p1, s.manche.mains.p1.length);
});

test('On ne joue que pour soi : une action au nom d\'un autre est ignorée', () => {
  const s = salleAvec(2);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const courant = s.manche.joueurCourant;
  const autre = courant === 'p1' ? 'p2' : 'p1';
  const a = S.vue(s, courant).manche.actions.find((x) => x.type !== 'annoncer');
  assert.ok(!S.recevoir(s, autre, { type: 'action', action: Object.assign({ joueur: courant }, a) }).ok);
});

test('Une action mal formée est refusée sans casser la salle', () => {
  const s = salleAvec(2);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const id = s.manche.joueurCourant;
  assert.ok(!S.recevoir(s, id, { type: 'action', action: { type: 'jouer', cartes: 'AP' } }).ok);
  assert.ok(!S.recevoir(s, id, { type: 'action', action: { type: 'tricher' } }).ok);
  assert.ok(!S.recevoir(s, id, { type: 'action', action: { type: 'jouer', cartes: ['ZZ'] } }).ok);
  assert.strictEqual(s.etat, 'manche');
});

console.log('\nParties complètes');

test('100 parties jouées par les vues (2 à 8 joueurs, simple et délire) : un vainqueur, les autres éliminés', () => {
  const rng = I.hasard(3);
  for (let n = 0; n < 100; n++) {
    const nb = 2 + (n % 7);
    const s = salleAvec(nb, n + 10);
    S.recevoir(s, 'p1', { type: 'reglages', mode: n % 2 ? 'delire' : 'simple' });
    S.recevoir(s, 'p1', { type: 'lancer' });
    jouerPartieParLesVues(s, rng);
    assert.strictEqual(s.elimines.length, nb - 1);
    assert.ok(!s.elimines.includes(s.vainqueur));
  }
});

test('Partie contre les robots : ils jouent seuls jusqu\'à la fin', () => {
  for (const niveau of S.NIVEAUX_ROBOTS) {
    const s = salleAvec(1, 5);
    const h = horloge(); s.horloge = h;
    S.recevoir(s, 'p1', { type: 'reglages', robots: niveau, niveau: 5 });
    for (let i = 0; i < 3; i++) S.recevoir(s, 'p1', { type: 'ajouterRobot' });
    S.recevoir(s, 'p1', { type: 'remplacerParRobot', cible: 'p1' }); // refusé : c'est l'hôte
    S.recevoir(s, 'p1', { type: 'lancer' });
    // L'hôte joue par son coup automatique (temps écoulé), les robots jouent seuls.
    let tours = 0;
    while (s.etat !== 'finPartie') {
      if (++tours > 200000) throw new Error('Partie bloquée');
      if (s.etat === 'finManche') { S.recevoir(s, 'p1', { type: 'mancheSuivante' }); continue; }
      h.avancer(500);
      S.tic(s);
    }
    assert.strictEqual(s.elimines.length, 3);
  }
});

console.log('\nChrono, annonce et pauses');

test('Temps écoulé : coup automatique (pioche) ; après 2 fois, le joueur est absent', () => {
  const s = salleAvec(2, 8);
  const h = horloge(); s.horloge = h;
  S.recevoir(s, 'p1', { type: 'reglages', delai: 5 });
  S.recevoir(s, 'p1', { type: 'lancer' });
  const j = s.manche.joueurCourant;
  h.avancer(5001);
  assert.ok(S.tic(s));
  assert.strictEqual(s.expirations[j], 1);
  assert.ok(s.manche.journal.some((t) => /Temps écoulé/.test(t)));
});

test("Un robot laisse 3 s à un humain pour annoncer avant de le contester", () => {
  // p1 humain, p2 robot. On prépare une manche où p1 peut finir au prochain coup.
  const s = salleAvec(1, 4);
  const h = horloge(); s.horloge = h; s.pauseRobot = 0;
  S.recevoir(s, 'p1', { type: 'reglages', robots: 'normaux' });
  S.recevoir(s, 'p1', { type: 'ajouterRobot' });
  S.recevoir(s, 'p1', { type: 'lancer' });
  const robot = s.joueurs[1].id;
  s.manche = I.nouvelleManche(['p1', robot], { p1: ['3C', '4C'], [robot]: ['3P', '4P', '5P', '6P'] },
    Array.from({ length: 20 }, (_, i) => '9' + 'PCKT'[i % 4] + '*').concat('5C'), 'p1', { graine: 1 });
  assert.ok(S.recevoir(s, 'p1', { type: 'action', action: { type: 'jouer', cartes: ['3C'] } }).ok);
  assert.deepStrictEqual(s.manche.contestables, ['p1']);
  h.avancer(1000);
  S.tic(s);
  assert.deepStrictEqual(s.manche.contestables, ['p1'], 'le robot attend');
  assert.ok(S.recevoir(s, 'p1', { type: 'action', action: { type: 'annoncer' } }).ok);
  assert.deepStrictEqual(s.manche.contestables, []);
  assert.strictEqual(s.manche.mains.p1.length, 1, 'pas d\'amende');
});

test("Un humain ne peut contester qu'après les 3 s laissées pour annoncer", () => {
  const s = salleAvec(2, 4);
  const h = horloge(); s.horloge = h;
  S.recevoir(s, 'p1', { type: 'lancer' });
  s.manche = I.nouvelleManche(['p1', 'p2'], { p1: ['3C', '4C'], p2: ['3P', '4P', '5P', '6P'] },
    Array.from({ length: 20 }, (_, i) => '9' + 'PCKT'[i % 4] + '*').concat('5C'), 'p1', { graine: 1 });
  assert.ok(S.recevoir(s, 'p1', { type: 'action', action: { type: 'jouer', cartes: ['3C'] } }).ok);
  assert.deepStrictEqual(s.manche.contestables, ['p1']);
  assert.ok(!S.vue(s, 'p2').manche.actions.some((a) => a.type === 'contester'), 'pas encore de bouton');
  assert.deepStrictEqual(S.vue(s, 'p2').manche.enGrace, ['p1']);
  assert.ok(!S.recevoir(s, 'p2', { type: 'action', action: { type: 'contester' } }).ok);
  h.avancer(S.DELAI_ANNONCE + 1);
  assert.ok(S.tic(s), 'la vue change à la fin des 3 s');
  assert.ok(S.vue(s, 'p2').manche.actions.some((a) => a.type === 'contester'));
  assert.ok(S.recevoir(s, 'p2', { type: 'action', action: { type: 'contester' } }).ok);
  assert.strictEqual(s.manche.mains.p1.length, 2, "amende d'1 carte");
});

test("Passé ce délai, le robot conteste : amende d'1 carte", () => {
  const s = salleAvec(1, 4);
  const h = horloge(); s.horloge = h; s.pauseRobot = 0;
  S.recevoir(s, 'p1', { type: 'reglages', robots: 'normaux' });
  S.recevoir(s, 'p1', { type: 'ajouterRobot' });
  S.recevoir(s, 'p1', { type: 'lancer' });
  const robot = s.joueurs[1].id;
  s.manche = I.nouvelleManche(['p1', robot], { p1: ['3C', '4C'], [robot]: ['3P', '4P', '5P', '6P'] },
    Array.from({ length: 20 }, (_, i) => '9' + 'PCKT'[i % 4] + '*').concat('5C'), 'p1', { graine: 1 });
  S.recevoir(s, 'p1', { type: 'action', action: { type: 'jouer', cartes: ['3C'] } });
  h.avancer(S.DELAI_ANNONCE + 1);
  S.tic(s);
  assert.strictEqual(s.manche.mains.p1.length, 2);
});

// p1 humain, un robot qui commence et pose son avant-dernière carte.
function robotPresDeFinir(niveau, graine) {
  const s = salleAvec(1, graine);
  const h = horloge(); s.horloge = h; s.pauseRobot = 0;
  S.recevoir(s, 'p1', { type: 'reglages', robots: niveau });
  S.recevoir(s, 'p1', { type: 'ajouterRobot' });
  S.recevoir(s, 'p1', { type: 'lancer' });
  const robot = s.joueurs[1].id;
  s.manche = I.nouvelleManche(['p1', robot], { p1: ['3P', '4P', '6P', '7P'], [robot]: ['3C', '4P'] },
    Array.from({ length: 20 }, (_, i) => '9' + 'PCKT'[i % 4] + '*').concat('5C'), robot, { graine: 1 });
  S.tic(s);
  assert.deepStrictEqual(s.manche.mains[robot], ['4P'], 'le robot a posé son avant-dernière carte');
  return { s, h, robot };
}

test("Un robot normal annonce dans la foulée : on ne peut jamais le contester", () => {
  for (const niveau of ['normaux', 'forts']) {
    const { s, h, robot } = robotPresDeFinir(niveau, 4);
    assert.ok(s.manche.annonces.includes(robot), 'annonce immédiate (' + niveau + ')');
    assert.deepStrictEqual(s.manche.contestables, []);
    h.avancer(S.DELAI_ANNONCE + 1);
    S.tic(s);
    assert.ok(!S.vue(s, 'p1').manche.actions.some((a) => a.type === 'contester'));
  }
});

test("Un robot qui oublie d'annoncer a lui aussi 3 s avant qu'on puisse le contester", () => {
  // Robots faciles : on cherche une graine où le robot oublie.
  let cas = null;
  for (let g = 1; g < 200 && !cas; g++) {
    const c = robotPresDeFinir('faciles', g);
    if (!c.s.manche.annonces.includes(c.robot)) cas = c;
  }
  assert.ok(cas, 'un robot facile oublie parfois');
  const { s, h, robot } = cas;
  assert.deepStrictEqual(S.vue(s, 'p1').manche.enGrace, [robot]);
  assert.ok(!S.recevoir(s, 'p1', { type: 'action', action: { type: 'contester' } }).ok, 'pas avant 3 s');
  h.avancer(S.DELAI_ANNONCE + 1);
  S.tic(s);
  assert.ok(!s.manche.annonces.includes(robot), "il ne se rattrape pas en douce");
  assert.ok(S.recevoir(s, 'p1', { type: 'action', action: { type: 'contester' } }).ok);
  assert.strictEqual(s.manche.mains[robot].length, 2, "amende d'1 carte");
});

test('Compte à rebours de départ : personne ne joue pendant la pause', () => {
  const s = salleAvec(2);
  const h = horloge(); s.horloge = h;
  s.durees.depart = 5000;
  S.recevoir(s, 'p1', { type: 'lancer' });
  const id = s.manche.joueurCourant;
  assert.deepStrictEqual(S.vue(s, id).manche.actions, []);
  h.avancer(5001);
  S.tic(s);
  assert.ok(S.vue(s, id).manche.actions.length > 0);
});

test('Carte de départ pénalisante : la sanction tombe après la distribution', () => {
  // On cherche une graine dont la carte de départ est un 2, un 10 ou un joker.
  for (let graine = 1; graine < 500; graine++) {
    const s = salleAvec(3, graine);
    const h = horloge(); s.horloge = h;
    s.durees.depart = 5000;
    S.recevoir(s, 'p1', { type: 'lancer' });
    const m = s.manche;
    const depart = m.defausse[m.defausse.length - 1];
    const n = I.PENALITES[I.valeur(depart)];
    if (!n) continue;
    const premier = m.joueurCourant;
    // Pendant la distribution : 4 cartes pour tout le monde, rien d'appliqué.
    m.sieges.forEach((j) => assert.strictEqual(m.mains[j].length, 4));
    assert.strictEqual(S.vue(s, premier).manche.nbCartes[premier], 4);
    h.avancer(5001);
    S.tic(s);
    // Fin du compte à rebours : le premier joueur pioche sa pénalité et passe son tour.
    assert.strictEqual(m.mains[premier].length, 4 + n);
    assert.notStrictEqual(m.joueurCourant, premier);
    assert.strictEqual(m.departEnAttente, undefined);
    return;
  }
  throw new Error('Aucune graine avec une carte de départ pénalisante');
});

console.log('\nFin de partie');

test('Revanche : elle repart quand tous les présents ont accepté', () => {
  const s = salleAvec(2, 6);
  S.recevoir(s, 'p1', { type: 'lancer' });
  jouerPartieParLesVues(s, I.hasard(1));
  S.recevoir(s, 'p1', { type: 'revanche' });
  assert.strictEqual(s.etat, 'finPartie');
  S.recevoir(s, 'p2', { type: 'revanche' });
  assert.strictEqual(s.etat, 'manche');
});

test('Duel : en revanche, c\'est l\'autre joueur qui commence', () => {
  const s = salleAvec(2, 7);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const premier = s.dernierDuel.ouvreur;
  jouerPartieParLesVues(s, I.hasard(2));
  S.recevoir(s, 'p1', { type: 'revanche' });
  S.recevoir(s, 'p2', { type: 'revanche' });
  assert.notStrictEqual(s.dernierDuel.ouvreur, premier);
});

test('Sauvegarde et reprise : la partie continue à l\'identique', () => {
  const s = salleAvec(3, 9);
  S.recevoir(s, 'p1', { type: 'lancer' });
  const t = S.exporter(s);
  const s2 = S.importer(t, I.hasard(1));
  assert.deepStrictEqual(s2.manche.mains, s.manche.mains);
  assert.strictEqual(s2.manche.joueurCourant, s.manche.joueurCourant);
  S.recevoir(s2, 'p1', { type: 'rejoindre' });
  S.recevoir(s2, 'p2', { type: 'rejoindre' });
  S.recevoir(s2, 'p3', { type: 'rejoindre' });
  s2.durees = { depart: 0, mancheAuto: 0 };
  jouerPartieParLesVues(s2, I.hasard(4));
  assert.ok(s2.vainqueur);
});

console.log('\nNiveau de chaque robot');
test('Chaque robot ajouté peut avoir son niveau ; sans niveau, il suit la table', () => {
  const s = salleAvec(1);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', robots: 'normaux', niveau: 1 }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'ajouterRobot', niveau: 'faciles' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'ajouterRobot', niveau: 'forts' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'ajouterRobot' }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'ajouterRobot', niveau: 'gentils' }).ok);
  assert.deepStrictEqual(S.vue(s, 'p1').joueurs.map((j) => j.niveau), [null, 'faciles', 'forts', 'normaux']);
  assert.deepStrictEqual(s.joueurs.slice(1).map((j) => S.niveauDuRobot(s, j.id)), ['faciles', 'forts', 'normaux']);
  s.robots = 'gentils'; // partie guidée : tous gentils
  assert.strictEqual(S.niveauDuRobot(s, s.joueurs[2].id), 'gentils');
});
test("Dans le salon, seul l'hôte change le niveau d'un robot ; un remplaçant suit la table", () => {
  const s = salleAvec(3);
  assert.ok(S.recevoir(s, 'p1', { type: 'reglages', robots: 'faciles', niveau: 1 }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'ajouterRobot' }).ok);
  const r = s.joueurs[3];
  assert.ok(!S.recevoir(s, 'p2', { type: 'niveauRobot', cible: r.id, niveau: 'forts' }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'niveauRobot', cible: 'p2', niveau: 'forts' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'niveauRobot', cible: r.id, niveau: 'forts' }).ok);
  assert.strictEqual(S.vue(s, 'p3').joueurs[3].niveau, 'forts');
  assert.ok(S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  assert.ok(!S.recevoir(s, 'p1', { type: 'niveauRobot', cible: r.id, niveau: 'faciles' }).ok);
  assert.ok(S.recevoir(s, 'p1', { type: 'remplacerParRobot', cible: 'p2' }).ok);
  assert.strictEqual(S.niveauDuRobot(s, 'p2'), 'faciles');
  assert.strictEqual(S.importer(S.exporter(s)).joueurs[3].niveau, 'forts');
});
test('Une partie avec des robots de trois niveaux va au bout', () => {
  const s = salleAvec(1, 7);
  const h = horloge(); s.horloge = h;
  for (const n of ['faciles', 'normaux', 'forts']) S.recevoir(s, 'p1', { type: 'ajouterRobot', niveau: n });
  S.recevoir(s, 'p1', { type: 'lancer' });
  let tours = 0;
  while (s.etat !== 'finPartie') {
    if (++tours > 200000) throw new Error('Partie bloquée');
    if (s.etat === 'finManche') { S.recevoir(s, 'p1', { type: 'mancheSuivante' }); continue; }
    h.avancer(500);
    S.tic(s);
  }
  assert.strictEqual(s.elimines.length, 3);
});

console.log('\nRobots entre eux');
function salleRobots(graine, nbRobots, mode) {
  const s = S.creerSalle('ROBO', I.hasard(graine));
  const h = horloge(); s.horloge = h;
  S.recevoir(s, 'p1', { type: 'rejoindre', nom: 'Moi' });
  if (mode) S.recevoir(s, 'p1', { type: 'reglages', mode });
  for (let i = 0; i < nbRobots; i++) S.recevoir(s, 'p1', { type: 'ajouterRobot' });
  assert.ok(S.recevoir(s, 'p1', { type: 'lancer' }).ok);
  return s;
}
function pas(s, ms) {
  s.horloge.avancer(ms);
  const m = s.manche;
  if (s.etat === 'manche' && !s.pause && m.joueurCourant === 'p1') {
    const a = S.coupAutomatique(m, 'p1');
    if (a) S.recevoir(s, 'p1', { type: 'action', action: a });
  }
  S.tic(s);
}
test('Dès que je ne joue plus la manche, les robots jouent vite', () => {
  const s = salleRobots(5, 3);
  assert.strictEqual(S.vue(s, 'p1').entreRobots, false);
  assert.ok(!S.recevoir(s, 'p1', { type: 'passerFin' }).ok, 'pas tant que je joue');
  let k = 0;
  while (s.etat === 'manche' && s.manche.enJeu.includes('p1') && k++ < 50000) pas(s, 100);
  assert.ok(k < 50000);
  if (s.etat === 'manche') {
    assert.strictEqual(S.vue(s, 'p1').entreRobots, true);
    pas(s, 100);
    assert.ok(!s.robotPret || s.robotPret - s.horloge() <= S.RAPIDE.pauseRobot + S.RAPIDE.eventail);
  }
});
test('« Passer à la fin » donne le même classement qu\'à vitesse normale', () => {
  for (const [graine, mode] of [[1, 'simple'], [2, 'simple'], [3, 'delire'], [4, 'delire']]) {
    const a = salleRobots(graine, 5, mode), b = salleRobots(graine, 5, mode);
    let k = 0;
    while (a.etat !== 'finPartie' && k++ < 300000) pas(a, 100);
    k = 0;
    while (b.etat !== 'finPartie' && k++ < 300000) {
      if (S.vue(b, 'p1').entreRobots) assert.ok(S.recevoir(b, 'p1', { type: 'passerFin' }).ok);
      else pas(b, 100);
    }
    assert.strictEqual(a.etat, 'finPartie');
    assert.strictEqual(b.etat, 'finPartie');
    assert.deepStrictEqual(b.elimines, a.elimines, 'graine ' + graine);
    assert.strictEqual(b.vainqueur, a.vainqueur);
  }
});

console.log(`\n${ok} test(s) réussi(s), ${ko} échec(s).`);
if (ko) process.exit(1);
