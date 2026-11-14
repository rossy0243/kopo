// Stickers animés (ergonomie/stickers) : le même personnage que sur le site.
// Les images fixes (assets/stickers/<id>.svg) sont tirées de src/kopo-stickers.js par mobile/outils/stickers-svg.js ;
// flutter_svg ne lit pas les mouvements CSS, alors l'appli anime l'image entière (apparition, balancement, sortie).
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'theme.dart';

class Stickers {
  /// Noms de secours (les vrais viennent de GET /api/v1/stickers) et durée du mouvement, en ms (comme sur le site).
  static const noms = {
    'ouf': 'Ouf !', 'rire': 'Je t’ai eu !', 'louche': 'Bluff ?', 'encore': 'Encore moi…', 'katapss': 'Katapss !', 'grrr': 'Grrr…',
    'danse': 'On danse !', 'dodo': 'Tu dors ?', 'supporter': 'Allez la RDC !',
  };
  static const durees = {'ouf': 3200, 'rire': 2400, 'louche': 2800, 'encore': 3000, 'katapss': 2600, 'grrr': 2800, 'danse': 2800, 'dodo': 2400, 'supporter': 2400};
  static const packs = [('emotions', 'Émotions'), ('ambiance', 'Ambiance'), ('supporters', 'Supporters')];
  static const packDe = {'ouf': 'emotions', 'rire': 'emotions', 'louche': 'emotions', 'encore': 'emotions', 'katapss': 'emotions', 'grrr': 'emotions', 'danse': 'ambiance', 'dodo': 'ambiance', 'supporter': 'supporters'};
  static bool connu(String? id) => id != null && noms.containsKey(id);
  static int duree(String id) => durees[id] ?? 2800;
  /// Six stickers au plus à l'écran (règle de foule du 11/11), les suivants attendent.
  static const max = 6;
}

/// Image d'un sticker ; grisée quand il est verrouillé.
class StickerImage extends StatelessWidget {
  final String id;
  final double taille;
  final bool verrou;
  const StickerImage(this.id, {super.key, this.taille = 56, this.verrou = false});
  @override
  Widget build(BuildContext context) {
    final img = SvgPicture.asset('assets/stickers/$id.svg', width: taille, height: taille, semanticsLabel: Stickers.noms[id]);
    if (!verrou) return img;
    return ColorFiltered(
      colorFilter: const ColorFilter.matrix([.11, .37, .04, 0, 0, .11, .37, .04, 0, 0, .11, .37, .04, 0, 0, 0, 0, 0, 1, 0]), // gris foncé
      child: img,
    );
  }
}

/// Case de la grille (chat, boutique, cadeau) : image, cadenas si verrouillé, utilisations restantes.
class CaseSticker extends StatelessWidget {
  final String id;
  final bool verrou;
  final int reste;
  final VoidCallback? onTap;
  final double taille;
  const CaseSticker(this.id, {super.key, this.verrou = true, this.reste = 0, this.onTap, this.taille = 58});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: taille, height: taille,
          decoration: BoxDecoration(color: const Color(0x40000000), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)),
          child: Stack(clipBehavior: Clip.none, children: [
            Center(child: StickerImage(id, taille: taille * .82, verrou: verrou)),
            if (verrou) const Positioned(right: 3, top: 1, child: Text('🔒', style: TextStyle(fontSize: 11))),
            if (reste > 0)
              Positioned(right: 2, bottom: 2, child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5),
                decoration: BoxDecoration(color: K.brass, borderRadius: BorderRadius.circular(99)),
                child: Text('×$reste', style: K.texte(10, couleur: K.encre, poids: FontWeight.w700)),
              )),
          ]),
        ),
      );
}

/// Sticker qui joue une fois près du siège de l'envoyeur, avec son nom, puis sort pendant sa pose finale.
class StickerAnime extends StatefulWidget {
  final String id, qui;
  final int duree;
  final double taille;
  const StickerAnime({super.key, required this.id, required this.qui, required this.duree, required this.taille});
  @override
  State<StickerAnime> createState() => _StickerAnimeState();
}

class _StickerAnimeState extends State<StickerAnime> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: Duration(milliseconds: widget.duree))..forward();
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _a,
        builder: (context, child) {
          final t = _a.value;
          double s, op, dy;
          if (t < .07) { final k = t / .07; s = .2 + .9 * k; op = k; dy = 20 * (1 - k); }
          else if (t < .11) { s = 1.1 - .1 * ((t - .07) / .04); op = 1; dy = 0; }
          else if (t < .86) { s = 1; op = 1; dy = 0; }
          else { final k = (t - .86) / .14; s = 1 - .6 * k; op = 1 - k; dy = 30 * k; }
          final balance = t > .11 && t < .86 ? math.sin((t - .11) * math.pi * 6) * .06 : 0.0; // il vit un peu pendant sa pose
          return Opacity(opacity: op.clamp(0, 1), child: Transform.translate(offset: Offset(0, dy), child: Transform.scale(scale: s, child: Transform.rotate(angle: balance, child: child))));
        },
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          StickerImage(widget.id, taille: widget.taille),
          Transform.translate(
            offset: const Offset(0, -6),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(color: K.encre, borderRadius: BorderRadius.circular(99)),
              child: Text(widget.qui, maxLines: 1, style: K.texte(11, couleur: K.brass, poids: FontWeight.w600)),
            ),
          ),
        ]),
      );
}
