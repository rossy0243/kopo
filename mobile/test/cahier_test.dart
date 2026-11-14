// Mode Cahier d'Inter (8) : la fin de donne et le cahier complet s'affichent avec les points de chacun.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/theme.dart';
import 'package:masano/etat.dart';
import 'package:masano/fenetres/cahier.dart';

Vue _vue({required String etat}) => {
      'jeu': 'inter8',
      'code': 'CAHI',
      'etat': etat,
      'moi': 'a',
      'hote': 'a',
      'numeroManche': 2,
      'joueurs': [
        {'id': 'a', 'nom': 'Ami'},
        {'id': 'b', 'nom': 'Bea'},
        {'id': 'c', 'nom': 'Cyr'},
      ],
      'restants': etat == 'finPartie' ? ['a'] : ['a', 'b'],
      'elimines': etat == 'finPartie' ? ['c', 'b'] : ['c'],
      'vainqueur': etat == 'finPartie' ? 'a' : null,
      'formule': 'cahier',
      'totalCahier': 500,
      'cahier': {
        'total': 500,
        'scores': {'a': 120, 'b': 310, 'c': 520},
        'donnes': [
          {'numero': 1, 'sorti': 'b', 'points': {'a': 120, 'b': 0, 'c': 300}, 'mains': {'a': ['XR', '10C'], 'c': ['8P']}, 'elimines': []},
          {'numero': 2, 'sorti': 'a', 'points': {'a': 0, 'b': 310, 'c': 220}, 'mains': {'b': ['2C'], 'c': ['VK']}, 'elimines': ['c']},
        ],
      },
    };

Widget _fenetre() => MaterialApp(home: Scaffold(body: Builder(builder: (c) => app.fenetre!(c))));

void main() {
  testWidgets('fin de donne : qui sort, les points ajoutés, les éliminés', (t) async {
    final v = _vue(etat: 'finManche');
    app.vue = v;
    afficherFinDonne(v, resultat: (_) {});
    expect(app.fenetreType, 'findonne');
    await t.pumpWidget(_fenetre());
    expect(find.text('Tu sors !'), findsOneWidget);
    expect(find.text('Donne 2'), findsOneWidget);
    expect(find.text('+310'), findsOneWidget);
    expect(find.text('sort ✓'), findsOneWidget);
    expect(find.text('Cyr est éliminé.'), findsOneWidget);
    expect(find.text('Donne suivante'), findsOneWidget); // je suis l'hôte
    expect(donnesMontrees.contains(cleDonne(v)), isTrue);
  });

  testWidgets('cahier complet : une ligne par donne et les totaux', (t) async {
    final v = _vue(etat: 'finManche');
    app.vue = v;
    ouvrirCahier(v);
    expect(app.fenetreType, 'cahier');
    await t.pumpWidget(_fenetre());
    expect(find.text('D1'), findsOneWidget);
    expect(find.text('D2'), findsOneWidget);
    expect(find.text('520'), findsOneWidget);
    expect(find.text('Toi'), findsOneWidget);
  });

  testWidgets('fin de partie : la dernière donne, puis « Résultat de la partie »', (t) async {
    final v = _vue(etat: 'finPartie');
    app.vue = v;
    Vue? resultat;
    afficherFinDonne(v, finDePartie: true, resultat: (w) => resultat = w);
    await t.pumpWidget(_fenetre());
    await t.tap(find.text('Résultat de la partie'));
    expect(resultat, isNotNull);
    await t.pump(const Duration(seconds: 6)); // le passage automatique au résultat
  });

  test('formules du Cahier : trois choix comme sur le site', () {
    expect(App.formulesInter.map((f) => f.$1), ['normale', '500', '1000']);
    expect(K.red, isNotNull);
  });
}
