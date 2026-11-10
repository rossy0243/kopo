// Tests rapides : règles des cartes et calculs de progression, sans réseau.
import 'package:flutter_test/flutter_test.dart';
import 'package:masano/commun/cartes.dart';
import 'package:masano/commun/retention.dart';

void main() {
  test('Kopo : valeur, couleur, Katapss', () {
    expect(KopoCartes.valeur('10P'), 10);
    expect(KopoCartes.afficher('7C'), '7♥');
    expect(KopoCartes.typeKatapss(['2P', '5P', '7P', '10P'], 3), 'couleur');
    expect(KopoCartes.typeKatapss(['2P', '3C', '4K', '2T'], 3), 'petite');
  });
  test('Inter (8) : noms des valeurs', () {
    expect(InterCartes.nomValeur('A'), 'As');
    expect(InterCartes.nomValeur('X'), 'Joker');
    expect(InterCartes.nomValeur('D'), 'Q');
    expect(InterCartes.afficher('VC'), 'J♥');
  });
  test('Niveaux', () {
    expect(R.niveauDe(0).niveau, 1);
    expect(R.niveauDe(100).niveau, 2);
  });
}
