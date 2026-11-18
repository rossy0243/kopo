// Micro des abonnés Kopo+ : invitation avec les prix, qui parle (pseudo ou initiale), couronne.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/theme.dart';
import 'package:masano/commun/vocal.dart';
import 'package:masano/etat.dart';
import 'package:masano/fenetres/vocal_ui.dart';

Map<String, dynamic> vue() => {
      'moi': 'a', 'hote': 'a', 'code': 'VOIX', 'etat': 'salon',
      'joueurs': [
        {'id': 'a', 'nom': 'Rossy', 'plus': true, 'voix': true, 'muet': false},
        {'id': 'b', 'nom': 'Mamie_Kinshasa', 'plus': true, 'voix': true, 'muet': false},
        {'id': 'c', 'nom': 'Papa_Wemba_Fan', 'plus': true, 'voix': true, 'muet': false},
        {'id': 'd', 'nom': 'Kiki', 'voix': false},
      ],
    };

Widget cadre(Widget w, double largeur) => MaterialApp(theme: K.theme(), home: Scaffold(body: Center(child: SizedBox(width: largeur, child: w))));

void main() {
  test('initiale : première lettre en majuscule, émoji compris', () {
    expect(initiale('mamie'), 'M');
    expect(initiale('  kiki '), 'K');
    expect(initiale(''), '?');
  });

  testWidgets('qui parle : le pseudo quand il tient, sinon les initiales', (t) async {
    app.vue = vue();
    app.vocal.parleurs = {'b', 'c'};
    await t.pumpWidget(cadre(BandeauParleurs(app.vue!), 780));
    expect(find.text('Mamie_Kinshasa  ·  Papa_Wemba_Fan'), findsOneWidget);
    await t.pumpWidget(cadre(BandeauParleurs(app.vue!), 160));
    expect(find.text('M'), findsOneWidget);
    expect(find.text('P'), findsOneWidget);
    app.vocal.parleurs = {'zz'}; // quelqu'un qui n'est plus à la table : rien
    await t.pumpWidget(cadre(BandeauParleurs(app.vue!), 420));
    expect(find.byType(Container), findsNothing);
    app.vocal.parleurs = {};
  });

  testWidgets('siège étroit : l\'initiale du pseudo', (t) async {
    final style = K.texte(13, poids: FontWeight.w700);
    await t.pumpWidget(cadre(Row(children: [Flexible(child: NomOuInitiale('Mamie_Kinshasa', style: style))]), 24));
    expect(find.text('M'), findsOneWidget);
    await t.pumpWidget(cadre(Row(children: [Flexible(child: NomOuInitiale('Mamie_Kinshasa', style: style))]), 200));
    expect(find.text('Mamie_Kinshasa'), findsOneWidget);
  });

  testWidgets('non-abonné : la fenêtre montre les deux prix en francs congolais', (t) async {
    final offre = {
      'refuse': 'abonnement', 'paiement': false,
      'formules': [{'id': 'mois', 'nom': '1 mois', 'francs': 2500, 'jours': 30, 'note': null}, {'id': 'an', 'nom': '1 an', 'francs': 25000, 'jours': 365, 'note': '2 mois offerts'}],
      'avantages': ['Parle et entends les autres abonnés de ta table', 'Couronne dorée à côté de ton pseudo'],
    };
    Map? recu;
    app.vocal.inviterAbonnement = (o) => recu = o;
    await app.vocal.recevoir(offre);
    expect(recu, same(offre));
    await t.pumpWidget(MaterialApp(theme: K.theme(), home: Scaffold(body: fenetreAbonnement(offre))));
    expect(find.text('Le micro en partie'), findsOneWidget);
    expect(find.text('${App.formatPieces(2500)} FC'), findsOneWidget);
    expect(find.text('${App.formatPieces(25000)} FC'), findsOneWidget);
    expect(find.text('2 MOIS OFFERTS'), findsOneWidget);
    expect(find.textContaining('\$'), findsNothing);
  });

  testWidgets('micro : bouton « + » pour un non-abonné, rien sans autre humain', (t) async {
    app.microEssai = true;
    final v = vue();
    v['moi'] = 'd';
    app.vue = v;
    await t.pumpWidget(cadre(BoutonsMicro(v), 300));
    expect(find.text('+'), findsOneWidget);
    app.vue = {'moi': 'a', 'joueurs': [{'id': 'a', 'nom': 'Rossy'}, {'id': 'r', 'nom': 'Robot 1', 'robot': true}]};
    await t.pumpWidget(cadre(BoutonsMicro(app.vue!), 300));
    expect(find.byType(IconButton), findsNothing);
    app.microEssai = false;
  });
}
