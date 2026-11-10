// Les cartes : Kopo (36 cartes, « 10P ») et Inter (8) (A..R, jokers XR/XN, « * » pour le 2e paquet).
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'theme.dart';

class KopoCartes {
  static const couleurs = ['P', 'C', 'K', 'T'];
  static const symboles = {'P': '♠', 'C': '♥', 'K': '♦', 'T': '♣'};
  static const noms = {'P': 'pique', 'C': 'cœur', 'K': 'carreau', 'T': 'trèfle'};
  static int valeur(String c) => int.tryParse(c.substring(0, c.length - 1)) ?? 0;
  static String couleur(String c) => c.substring(c.length - 1);
  static bool rouge(String c) => couleur(c) == 'C' || couleur(c) == 'K';
  static String afficher(String c) => '${valeur(c)}${symboles[couleur(c)]}';
  static int _parCouleur(String a, String b) => couleurs.indexOf(couleur(a)) - couleurs.indexOf(couleur(b));
  static List<String> trier(List<String> main, String tri) {
    final l = [...main];
    l.sort(tri == 'valeur'
        ? (a, b) { final d = valeur(a) - valeur(b); return d != 0 ? d : _parCouleur(a, b); }
        : (a, b) { final d = _parCouleur(a, b); return d != 0 ? d : valeur(a) - valeur(b); });
    return l;
  }
  /// Katapss : 'couleur' (4 cartes d'une couleur) ou 'petite' (plus de 2 joueurs, la plus forte est un 4).
  static String? typeKatapss(List<String> main, int nb) {
    if (main.length != 4) return null;
    if (main.every((c) => couleur(c) == couleur(main[0]))) return 'couleur';
    if (nb > 2 && main.map(valeur).reduce(math.max) == 4) return 'petite';
    return null;
  }
}

class InterCartes {
  static const valeurs = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  static const couleurs = ['P', 'C', 'K', 'T'];
  static const symboles = KopoCartes.symboles;
  static const lettres = {'V': 'J', 'D': 'Q', 'R': 'K'};
  static const nomsValeurs = {'A': 'As', 'V': 'Valet', 'D': 'Dame', 'R': 'Roi'};
  static String brut(String c) => c.endsWith('*') ? c.substring(0, c.length - 1) : c;
  static String valeur(String c) { final b = brut(c); return b.startsWith('X') ? 'X' : b.substring(0, b.length - 1); }
  static String couleur(String c) { final b = brut(c); return b.substring(b.length - 1); }
  static bool joker(String c) => valeur(c) == 'X';
  static bool rouge(String c) => joker(c) ? brut(c) == 'XR' : (couleur(c) == 'C' || couleur(c) == 'K');
  static String lettre(String v) => lettres[v] ?? v;
  static String afficher(String c) => joker(c) ? 'Joker' : '${lettre(valeur(c))}${symboles[couleur(c)]}';
  static String nomValeur(String v) => v == 'A' ? 'As' : v == 'X' ? 'Joker' : (lettres[v] ?? v);
  static int rang(String c) => joker(c) ? 99 : valeurs.indexOf(valeur(c));
  static int _coul(String c) => joker(c) ? 9 : couleurs.indexOf(couleur(c));
  static List<String> trier(List<String> main) {
    final l = [...main];
    l.sort((a, b) { final d = rang(a) - rang(b); return d != 0 ? d : _coul(a) - _coul(b); });
    return l;
  }
  static const dessins = {
    'R': '<path d="M3 18 3 7l5 5 4-8 4 8 5-5v11z"/><rect x="3" y="19" width="18" height="2.5" rx="1"/><circle cx="12" cy="4" r="1.6"/>',
    'D': '<path d="M4 18c0-6 4-9 8-11 4 2 8 5 8 11z"/><rect x="4" y="19" width="16" height="2.5" rx="1"/><circle cx="12" cy="5" r="2"/><circle cx="6" cy="10" r="1.3"/><circle cx="18" cy="10" r="1.3"/>',
    'V': '<path d="M4 16c1-6 5-9 9-9s6 3 7 9z"/><rect x="3" y="16.5" width="18" height="3" rx="1.4"/><path d="M15 8c2-5 5-6 7-6-1 3-3 6-6 7z"/>',
  };
  static const dessinJoker = '<path d="M3 20 6 7l4 7 2-11 2 11 4-7 3 13z"/><circle cx="6" cy="6" r="1.8"/><circle cx="12" cy="2.6" r="1.8"/><circle cx="18" cy="6" r="1.8"/><rect x="2.5" y="19.5" width="19" height="2.8" rx="1.2"/>';
}

/// Réglage « 4 couleurs » : cœur rouge, carreau bleu, trèfle vert.
class Couleurs4 {
  static bool actif = false;
}

Color _encreKopo(String coul, bool rouge) {
  if (Couleurs4.actif) {
    if (coul == 'C') return const Color(0xFFC62828);
    if (coul == 'K') return const Color(0xFF1565C0);
    if (coul == 'T') return const Color(0xFF2E7D32);
  }
  return rouge ? K.red : K.cardInk;
}

/// Une carte retournée. [l] largeur (la hauteur suit : 78/54).
class CarteVue extends StatelessWidget {
  final String carte;
  final bool inter;
  final double l;
  final bool choisie;
  final bool forte;
  final bool pale;
  final bool grisee;
  const CarteVue(this.carte, {super.key, this.inter = false, this.l = 54, this.choisie = false, this.forte = false, this.pale = false, this.grisee = false});

  @override
  Widget build(BuildContext context) {
    final h = l * 78 / 54;
    final coin = l * 15 / 54, centre = l * 28 / 54;
    Widget contenu;
    Decoration deco;
    final ombres = <BoxShadow>[
      if (choisie || forte) const BoxShadow(color: K.brass, spreadRadius: 3),
      BoxShadow(color: const Color(0x59000000), blurRadius: choisie ? 18 : 10, offset: Offset(0, choisie ? 10 : 4)),
    ];
    if (!inter) {
      final c = KopoCartes.couleur(carte), encre = _encreKopo(c, KopoCartes.rouge(carte));
      final s = KopoCartes.symboles[c]!;
      contenu = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${KopoCartes.valeur(carte)}$s', style: TextStyle(fontFamily: K.body, fontWeight: FontWeight.w700, fontSize: coin, height: 1, color: encre)),
        Expanded(child: Center(child: Text(s, style: TextStyle(fontSize: centre, height: 1, color: encre)))),
      ]);
      deco = BoxDecoration(color: K.card, borderRadius: BorderRadius.circular(7), boxShadow: ombres);
    } else {
      final v = InterCartes.valeur(carte), rouge = InterCartes.rouge(carte);
      final encre = v == 'X' ? (rouge ? K.red : const Color(0xFF1B1B22)) : _encreKopo(InterCartes.couleur(carte), rouge);
      final hex = '#${(encre.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
      if (v == 'X') {
        contenu = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('JOKER', style: TextStyle(fontFamily: K.display, fontSize: coin * .8, letterSpacing: 1, height: 1, color: encre)),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(top: 1, bottom: 2),
              decoration: BoxDecoration(border: Border.all(color: encre.withValues(alpha: .7), width: 1.5), borderRadius: BorderRadius.circular(5)),
              alignment: Alignment.center,
              child: FractionallySizedBox(widthFactor: .74, child: SvgPicture.string('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="$hex">${InterCartes.dessinJoker}</svg>')),
            ),
          ),
        ]);
        deco = BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: rouge ? const [Color(0xFFFFF1EA), Color(0xFFF6C3A4)] : const [Color(0xFFFFF7DF), Color(0xFFF5DC98)]),
          borderRadius: BorderRadius.circular(7), boxShadow: ombres);
      } else {
        final sy = InterCartes.symboles[InterCartes.couleur(carte)]!, lettre = InterCartes.lettre(v);
        final dessin = InterCartes.dessins[v];
        Widget milieu;
        if (dessin != null) {
          milieu = Container(
            margin: const EdgeInsets.only(top: 1, bottom: 2),
            decoration: BoxDecoration(border: Border.all(color: encre, width: 1.5), borderRadius: BorderRadius.circular(5)),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              FractionallySizedBox(widthFactor: .62, child: SvgPicture.string('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="$hex">$dessin</svg>')),
              Text(lettre, style: TextStyle(fontFamily: K.display, fontSize: centre * .62, height: 1, color: encre)),
            ]),
          );
        } else {
          milieu = Center(child: Text(sy, style: TextStyle(fontSize: v == 'A' ? centre * 1.55 : centre, height: 1, color: encre)));
        }
        contenu = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('$lettre$sy', style: TextStyle(fontFamily: K.body, fontWeight: FontWeight.w700, fontSize: coin, height: 1, color: encre)),
          Expanded(child: milieu),
        ]);
        deco = BoxDecoration(color: K.card, borderRadius: BorderRadius.circular(7), boxShadow: ombres);
      }
    }
    Widget w = Container(width: l, height: h, padding: EdgeInsets.symmetric(horizontal: l * 5 / 54, vertical: l * 3 / 54), decoration: deco, child: contenu);
    if (pale || grisee) w = Opacity(opacity: grisee ? .4 : .45, child: w);
    return Semantics(label: inter ? InterCartes.afficher(carte) : '${KopoCartes.valeur(carte)} de ${KopoCartes.noms[KopoCartes.couleur(carte)]}', child: w);
  }
}

/// Dos de carte (motif selon l'apparence « dos-… » équipée).
class DosCarte extends StatelessWidget {
  final double l;
  final String? dos;
  final double? h;
  final double rayon;
  final double bord;
  const DosCarte({super.key, this.l = 54, this.dos, this.h, this.rayon = 7, this.bord = 2});
  @override
  Widget build(BuildContext context) => Container(
        width: l,
        height: h ?? l * 78 / 54,
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(rayon), border: Border.all(color: const Color(0xFFF3E3BD), width: bord), boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 4, offset: Offset(0, 2))]),
        child: ClipRRect(borderRadius: BorderRadius.circular(rayon - 1), child: CustomPaint(painter: MotifDos(dos ?? DosActuel.id, l < 30 ? 3 : 4))),
      );
}

class DosActuel {
  static String id = 'dos-laiton';
}

/// Motifs des dos, d'après les dégradés CSS du site.
class MotifDos extends CustomPainter {
  final String id;
  final double pas;
  MotifDos(this.id, this.pas);

  void _rayures(Canvas c, Size s, Color a, Color b, double p) {
    c.drawRect(Offset.zero & s, Paint()..color = b);
    final pa = Paint()..color = a..strokeWidth = p * .7071 * 1.0;
    // bandes à 45° de largeur p (une sur deux)
    final d = s.width + s.height;
    for (double x = -d; x < d; x += p * 2 * 1.4142) {
      final path = Path()
        ..moveTo(x, 0)
        ..lineTo(x + p * 1.4142, 0)
        ..lineTo(x + p * 1.4142 + s.height, s.height)
        ..lineTo(x + s.height, s.height)
        ..close();
      c.drawPath(path, pa..style = PaintingStyle.fill);
    }
  }

  void _bandes(Canvas c, Size s, List<Color> cols, {bool diag = false, List<double>? stops}) {
    final st = stops ?? [for (var i = 0; i <= cols.length; i++) i / cols.length];
    final colors = <Color>[], ss = <double>[];
    for (var i = 0; i < cols.length; i++) { colors..add(cols[i])..add(cols[i]); ss..add(st[i])..add(st[i + 1]); }
    c.drawRect(Offset.zero & s, Paint()..shader = LinearGradient(begin: diag ? Alignment.topLeft : Alignment.centerLeft, end: diag ? Alignment.bottomRight : Alignment.centerRight, colors: colors, stops: ss).createShader(Offset.zero & s));
  }

  @override
  void paint(Canvas c, Size s) {
    switch (id) {
      case 'dos-lubumbashi':
        _rayures(c, s, const Color(0xFFB87333), const Color(0xFF5A2E0E), pas + 1);
      case 'dos-abidjan':
        _bandes(c, s, const [Color(0xFFF77F00), Colors.white, Color(0xFF009E60)]);
      case 'dos-dakar':
        _bandes(c, s, const [Color(0xFF00853F), Color(0xFFFDEF42), Color(0xFFE31B23)]);
      case 'dos-douala':
        _bandes(c, s, const [Color(0xFF007A5E), Color(0xFFCE1126), Color(0xFFFCD116)]);
      case 'dos-brazzaville':
        _bandes(c, s, const [Color(0xFF009543), Color(0xFFFBDE4A), Color(0xFFDC241F)], diag: true, stops: const [0, .4, .6, 1]);
      case 'dos-kinshasa':
        _bandes(c, s, const [Color(0xFF3B8FD6), Color(0xFFF7D038), Color(0xFFCE1021), Color(0xFFF7D038), Color(0xFF3B8FD6)], diag: true, stops: const [0, .38, .44, .56, .62, 1]);
      case 'dos-goma':
        c.drawRect(Offset.zero & s, Paint()..color = const Color(0xFF1F4D3A));
        c.drawCircle(Offset(s.width * .7, s.height * .25), s.width * .3, Paint()..color = const Color(0xFFF39A3C));
        c.drawCircle(Offset(s.width * .7, s.height * .25), s.width * .2, Paint()..color = const Color(0xFFE0564C));
      case 'dos-fondateurs':
        c.drawRect(Offset.zero & s, Paint()..color = K.encre);
        final p = Paint()..color = K.brass;
        final t = pas * 2;
        for (double y = t / 2; y < s.height; y += t) { for (double x = t / 2; x < s.width; x += t) { c.drawCircle(Offset(x, y), t * .2, p); } }
      case 'dos-ambassadeur':
        c.drawRect(Offset.zero & s, Paint()..color = const Color(0xFF155F3F));
        final v = Paint()..color = const Color(0xFF1F8A5B);
        for (double x = 0; x < s.width; x += 12) { c.drawRect(Rect.fromLTWH(x, 0, 6, s.height), v); }
        c.drawCircle(s.center(Offset.zero), s.shortestSide * .16, Paint()..color = K.brass);
      default:
        _rayures(c, s, K.brass, K.brassFonce, pas);
    }
  }

  @override
  bool shouldRepaint(MotifDos o) => o.id != id || o.pas != pas;
}
