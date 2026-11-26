// Le Fleuve : la carte tient dans l'écran (un seul défilement, celui de la carte), en portrait comme couché,
// et « Mon étape » ramène sur la pirogue (fenetres/fleuve.dart, comme sur le site).
// Captures : flutter test test/fleuve_carte_test.dart --update-goldens (écrites dans test/out/, non suivies).
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/stock.dart';
import 'package:masano/commun/theme.dart';
import 'package:masano/etat.dart';
import 'package:masano/fenetres/fleuve.dart';

const _villes = {'congo': 'Kinshasa', 'niger': 'Onitsha', 'kasai': 'Ilebo', 'oubangui': 'Bangui', 'nil': 'Assouan'};
Map _fleuve(String cle, String nom, String jeu, int courante) => {
      'nom': nom, 'jeu': jeu, 'courante': courante, 'publiees': 60, 'bief': 1, 'etoiles': 29, 'suiteBientot': false, 'ville': _villes[cle],
      'etapes': [for (var n = 1; n <= 50; n++) {'n': n, 'etoiles': n < courante ? 2 + n % 2 : 0, if (n % 10 == 0) ...{'escale': true, 'ville': n == 10 ? _villes[cle] : 'Ville $n'}}],
      'amis': [{'id': 2, 'pseudo': 'Junior', 'n': 9, 'etoiles': 20}, {'id': 3, 'pseudo': 'Sarah', 'n': 9, 'etoiles': 22}, {'id': 4, 'pseudo': 'Willy', 'n': 14, 'etoiles': 30}],
      'marques': {'premiers': [], 'pagayeur': false},
      'course': {'lignes': [{'id': 1, 'pseudo': 'Mac', 'etoiles': 9, 'moi': true}, {'id': 4, 'pseudo': 'Willy', 'etoiles': 6}], 'finMs': 3 * 864e5, 'pieces': 200, 'amis': 3},
    };
Map<String, dynamic> _etat() => {
      'ouvert': true, 'google': true, 'etoilesVille': 20,
      'pagaies': {'restantes': 2, 'max': 5, 'retourMs': 13 * 3600000 + 55 * 60000},
      'fleuves': {
        'congo': _fleuve('congo', 'Congo', 'kopo', 16), 'niger': _fleuve('niger', 'Niger', 'inter8', 12), 'kasai': _fleuve('kasai', 'Kasaï', 'kopo', 4),
        'oubangui': _fleuve('oubangui', 'Oubangui', 'inter8', 1), 'nil': _fleuve('nil', 'Nil', 'kopo', 1),
      },
    };

Future<void> _polices() async {
  for (final (f, p) in [('Outfit', 'assets/fonts/Outfit.ttf'), ('Bebas', 'assets/fonts/BebasNeue-Regular.ttf')]) {
    final l = FontLoader(f)..addFont(Future.value(ByteData.sublistView(File(p).readAsBytesSync())));
    await l.load();
  }
}

Widget _ecran() => MaterialApp(theme: K.theme(), home: Scaffold(backgroundColor: K.table, body: ListenableBuilder(listenable: app, builder: (c, _) => app.fenetre == null ? const SizedBox() : app.fenetre!(c))));

void main() {
  for (final (nom, taille) in [('portrait', const Size(390, 844)), ('paysage', const Size(844, 390)), ('petit', const Size(375, 667))]) {
    testWidgets('carte du Fleuve, $nom : tient dans l\'écran, seule la carte défile', (t) async {
      await t.runAsync(_polices);
      t.view.physicalSize = taille * 2; t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      app.prefs['animations'] = 'reduites';
      Stock.ecrire('kopo-compte-serveur', {'jeton': 'x', 'compte': {'id': 1, 'pseudo': 'Mac'}});
      Stock.ecrire('kopo-fleuve-guide', {'base': true, 'niger': true, 'ville': true});
      app.etatFleuve = _etat();
      await t.pumpWidget(_ecran());
      ouvrirFleuve('niger');
      await t.pump(); await t.pump(const Duration(milliseconds: 300));
      expect(t.takeException(), isNull, reason: 'aucun débordement');
      // L'étape en cours est à l'écran dès l'ouverture, et la carte va jusqu'en bas de la fenêtre.
      final douze = find.text('12');
      expect(douze, findsOneWidget);
      final r = t.getRect(douze);
      expect(r.top >= 0 && r.bottom <= taille.height, isTrue, reason: 'étape 12 visible : $r');
      expect(find.text('Fermer'), findsNothing, reason: 'la croix remplace « Fermer » en bas');
      expect(find.text('Niger'), findsOneWidget, reason: 'onglet : le nom seul');
      if (Platform.environment['CAPTURES'] != null) await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/fleuve-$nom.png'));
      // On remonte loin sur la carte : « Mon étape » apparaît et ramène sur la pirogue.
      expect(find.text('🛶 Mon étape'), findsNothing);
      await t.drag(find.text('11'), const Offset(0, 1200));
      await t.pump(const Duration(milliseconds: 300));
      expect(find.text('🛶 Mon étape'), findsOneWidget);
      if (Platform.environment['CAPTURES'] != null && nom == 'portrait') await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/fleuve-$nom-defile.png'));
      await t.tap(find.text('🛶 Mon étape'));
      await t.pump(const Duration(milliseconds: 300));
      expect(find.text('🛶 Mon étape'), findsNothing);
      app.fermerFenetre();
      await t.pump();
    });
  }
}
