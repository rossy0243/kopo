// Fenêtres maniables au doigt : les grands boutons de fin (Jouer, Fermer, Compris…) restent en bas, visibles sans
// défiler, côte à côte quand le téléphone est couché ; la carte du Fleuve de l'accueil tient couchée (comme le site).
// Captures : CAPTURES=1 flutter test test/fenetres_maniables_test.dart --update-goldens (dans test/out/, non suivies).
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/stock.dart';
import 'package:masano/commun/theme.dart';
import 'package:masano/ecrans/accueil.dart';
import 'package:masano/etat.dart';
import 'package:masano/fenetres/accueil_fenetres.dart';
import 'package:masano/fenetres/progres.dart';

Future<void> _polices() async {
  for (final (f, p) in [('Outfit', 'assets/fonts/Outfit.ttf'), ('Bebas', 'assets/fonts/BebasNeue-Regular.ttf')]) {
    final l = FontLoader(f)..addFont(Future.value(ByteData.sublistView(File(p).readAsBytesSync())));
    await l.load();
  }
}

Widget _ecran() => MaterialApp(theme: K.theme(), home: Scaffold(backgroundColor: K.table, body: ListenableBuilder(listenable: app, builder: (c, _) => app.fenetre == null ? const SizedBox() : app.fenetre!(c))));
final _captures = Platform.environment['CAPTURES'] != null;

void main() {
  test('le pied : les grands boutons de la fin, sans les écarts', () {
    final l = <Widget>[const Text('a'), const Ecart(14), Btn.principal('Jouer', large: true, onTap: () {}), const Ecart(8), Btn('Retour', large: true, onTap: () {})];
    expect(Fenetre.debutPied(l), 2);
    expect(Fenetre.debutPied([const Text('a'), Btn('petit', onTap: () {})]), 2, reason: 'un petit bouton reste dans le contenu');
    expect(Fenetre.debutPied([Btn('Seul', large: true, onTap: () {})]), 1, reason: 'que des boutons : pas de pied');
  });
  for (final (nom, taille) in [('portrait', const Size(390, 844)), ('paysage', const Size(844, 390)), ('petit', const Size(360, 640))]) {
    for (final (fen, ouvrir, bouton) in [('regles', montrerRegles, "C'est compris"), ('missions', ouvrirMissions, 'Fermer'), ('robots', ouvrirRobots, 'Annuler')]) {
      testWidgets('$fen, $nom : « $bouton » visible sans défiler', (t) async {
        await t.runAsync(_polices);
        t.view.physicalSize = taille * 2; t.view.devicePixelRatio = 2;
        addTearDown(t.view.reset);
        Stock.ecrire('kopo-pseudo', 'Mac');
        await t.pumpWidget(_ecran());
        ouvrir();
        await t.pump(); await t.pump(const Duration(milliseconds: 600));
        expect(t.takeException(), isNull, reason: 'aucun débordement');
        final r = t.getRect(find.text(bouton));
        expect(r.bottom <= taille.height && r.top >= 0, isTrue, reason: '« $bouton » à l\'écran : $r');
        if (_captures) await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$fen-$nom.png'));
        app.fermerFenetre(); await t.pump();
      });
    }
  }
  testWidgets('carte du Fleuve de l\'accueil, couchée : l\'étape sous le nom', (t) async {
    await t.runAsync(_polices);
    t.view.physicalSize = const Size(844, 390) * 2; t.view.devicePixelRatio = 2;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(theme: K.theme(), home: Scaffold(backgroundColor: K.table, body: Center(child: SizedBox(height: 168, child: AspectRatio(aspectRatio: 5 / 7, child: CarteMode('fleuve', 'Le Fleuve', 'Congo · ★ 40', coin: '♠', ligne: true, grand: ('Étape', '16'), onTap: () {})))))));
    expect(t.takeException(), isNull);
    expect(find.text('Le Fleuve'), findsOneWidget);
    expect(find.textContaining('16', findRichText: true), findsOneWidget);
    if (_captures) await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/accueil-carte-fleuve-paysage.png'));
  });
}
