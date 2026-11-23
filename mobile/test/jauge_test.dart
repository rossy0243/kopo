// Le Fleuve : la jauge des étoiles en direct (commun/jauge.dart, fenetres/fleuve.dart).
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/jauge.dart';
import 'package:masano/commun/theme.dart';
import 'package:masano/ecrans/partie.dart';
import 'package:masano/etat.dart';

const _seuils = {'deux': 7, 'trois': 11};
Map _d(int score, String prog, double val, String etat) => {'score': score, 'prog': prog, 'val': val, 'etat': etat, 'texte': 'Qualifie-toi pour 3 manches', 'seuils': _seuils};

// Une table de Kopo à 5 (toi et 4 robots), manche 2, toi qualifié 1er.
final _vue = jsonDecode(r'''{"code": "WGAJ", "etat": "manche", "moi": "j86xysmx4aaxt", "hote": "j86xysmx4aaxt", "joueurs": [{"id": "j86xysmx4aaxt", "nom": "Rossy", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": false, "niveau": null, "pret": false, "remplace": false, "absent": false}, {"id": "robot-1-236469", "nom": "Robot 1", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": true, "niveau": "normaux", "pret": true, "remplace": false, "absent": false}, {"id": "robot-2-570772", "nom": "Robot 2", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": true, "niveau": "normaux", "pret": true, "remplace": false, "absent": false}, {"id": "robot-3-57808", "nom": "Robot 3", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": true, "niveau": "normaux", "pret": true, "remplace": false, "absent": false}, {"id": "robot-4-929558", "nom": "Robot 4", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": true, "niveau": "normaux", "pret": true, "remplace": false, "absent": false}, {"id": "robot-5-311301", "nom": "Robot 5", "connecte": true, "peerId": null, "voix": false, "muet": true, "micCoupe": false, "robot": true, "niveau": "normaux", "pret": true, "remplace": false, "absent": false}], "delai": 5, "publique": false, "taille": null, "chrono": null, "suite": null, "revanche": null, "revancheRatee": false, "robots": "normaux", "entreRobots": false, "restants": ["robot-4-929558", "j86xysmx4aaxt", "robot-1-236469", "robot-5-311301", "robot-3-57808"], "elimines": ["robot-2-570772"], "numeroManche": 2, "vainqueur": null, "enPause": false, "pausePossible": true, "manche": {"sieges": ["robot-4-929558", "j86xysmx4aaxt", "robot-1-236469", "robot-5-311301", "robot-3-57808"], "enJeu": ["robot-4-929558", "robot-1-236469", "robot-5-311301", "robot-3-57808"], "nbCartes": {"robot-4-929558": 4, "j86xysmx4aaxt": 0, "robot-1-236469": 4, "robot-5-311301": 4, "robot-3-57808": 5}, "table": [{"joueur": "j86xysmx4aaxt", "cartes": ["10T"], "compte": true}], "pause": null, "couleurTour": "T", "couleurInterdite": null, "phase": "suite", "joueurCourant": "robot-4-929558", "qualifies": [{"joueur": "j86xysmx4aaxt", "raison": "vide"}], "elimine": null, "journal": ["D\u00e9but de la manche 2."], "redistributions": 0, "main": [], "actions": [], "annonces": []}}''') as Map<String, dynamic>;

void main() {
  test('effets : points, 2e étoile, objectif réussi', () {
    final e = effetJauge(_d(4, '1/3', .33, 'en_cours'), _d(8, '2/3', .67, 'en_cours'), 'manches', _vue, 1)!;
    expect([e.plus, e.plusLabel, e.etoiles, e.bulle, e.score0], [4, 'qualifié 1er', [2], '★★ 2e étoile !', 4]);
    final f = effetJauge(_d(8, '2/3', .67, 'en_cours'), _d(11, '3/3 ✓', 1, 'ok'), 'manches', null, 2)!;
    expect([f.etoiles, f.bulle, f.ton], [[1, 3], '★★★ Objectif réussi !', 'bien']);
    expect(effetJauge(null, _d(0, '0/3', 0, 'en_cours'), 'manches', null, 3), isNull, reason: 'la première avancée ne fête rien');
  });
  test('effets : danger puis raté (les étoiles s\'éteignent)', () {
    final a = effetJauge(_d(2, 'ramassé 0/1', .33, 'en_cours'), _d(2, 'ramassé 1/1', .33, 'danger'), 'ramasser', null, 1)!;
    expect([a.bulle, a.ton, a.plus], ['Attention : plus le droit de ramasser', 'alerte', null]);
    final b = effetJauge(_d(8, 'ramassé 1/1', .67, 'danger'), _d(8, 'ramassé 2/1', .67, 'rate'), 'ramasser', null, 2)!;
    expect([b.bulle, b.ton, b.secoue, b.etoiles], ["Objectif raté : plus d'étoile possible", 'echec', true, <int>[]]);
  });
  for (final (nom, taille) in [('portrait', const Size(390, 844)), ('paysage', const Size(844, 390))]) {
    testWidgets('jauge sur la table ($nom)', (t) async {
      t.view.physicalSize = taille * 2; t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      app.vue = jsonDecode(jsonEncode(_vue)) as Map<String, dynamic>;
      app.ecran = 'partie';
      app.directFleuve = _d(4, '1/3', .33, 'en_cours');
      app.effetFleuve = null;
      await t.pumpWidget(MaterialApp(theme: K.theme(), home: Scaffold(body: Container(decoration: K.fond, child: const Partie()))));
      expect(find.text('🛶 Qualifie-toi pour 3 manches'), findsOneWidget);
      app.directFleuve = _d(8, '2/3', .67, 'en_cours');
      app.effetFleuve = effetJauge(_d(4, '1/3', .33, 'en_cours'), app.directFleuve!, 'manches', app.vue, 1);
      await t.pumpWidget(MaterialApp(theme: K.theme(), home: Scaffold(body: Container(decoration: K.fond, child: const Partie()))));
      await t.pump(const Duration(milliseconds: 500));
      expect(find.text('★★ 2e étoile !'), findsOneWidget);
      await t.pump(const Duration(seconds: 3));
      expect(find.text('★★ 2e étoile !'), findsNothing, reason: 'la bulle s\'en va');
      expect(t.takeException(), isNull);
      app.directFleuve = null; app.vue = null;
    });
  }
}
