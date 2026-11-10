// Avatars et cadres (identifiants du site : av-…, cadre-…).
import 'package:flutter/material.dart';

import 'theme.dart';

LinearGradient _bandes(List<Color> cols, {List<double>? stops, Alignment debut = Alignment.centerLeft, Alignment fin = Alignment.centerRight}) {
  final st = stops ?? [for (var i = 0; i <= cols.length; i++) i / cols.length];
  final colors = <Color>[], ss = <double>[];
  for (var i = 0; i < cols.length; i++) { colors..add(cols[i])..add(cols[i]); ss..add(st[i])..add(st[i + 1]); }
  return LinearGradient(begin: debut, end: fin, colors: colors, stops: ss);
}

({Gradient? degrade, Color fond, Color encre, bool ombreTexte, Color? anneau}) styleAvatar(String? id) {
  switch (id) {
    case 'av-nuit':
      return (degrade: null, fond: K.table, encre: K.brass, ombreTexte: false, anneau: K.brass);
    case 'av-kinshasa':
      return (degrade: _bandes(const [Color(0xFF3B8FD6), Color(0xFFF7D038), Color(0xFFCE1021), Color(0xFFF7D038), Color(0xFF3B8FD6)], stops: const [0, .38, .44, .56, .62, 1], debut: Alignment.topLeft, fin: Alignment.bottomRight), fond: K.brass, encre: Colors.white, ombreTexte: true, anneau: null);
    case 'av-fleuve':
      return (degrade: const RadialGradient(center: Alignment(-.4, -.4), radius: .9, colors: [Color(0xFF5FB3C9), Color(0xFF1D5F7A)]), fond: K.brass, encre: Colors.white, ombreTexte: false, anneau: null);
    case 'av-lubumbashi':
      return (degrade: const LinearGradient(begin: Alignment(-.35, -1), end: Alignment(.35, 1), colors: [Color(0xFFE39B5B), Color(0xFFB87333), Color(0xFF5A2E0E)], stops: [0, .55, 1]), fond: K.brass, encre: Colors.white, ombreTexte: false, anneau: null);
    case 'av-abidjan':
      return (degrade: _bandes(const [Color(0xFFF77F00), Colors.white, Color(0xFF009E60)]), fond: K.brass, encre: K.encre, ombreTexte: false, anneau: null);
    case 'av-dakar':
      return (degrade: _bandes(const [Color(0xFF00853F), Color(0xFFFDEF42), Color(0xFFE31B23)]), fond: K.brass, encre: K.encre, ombreTexte: false, anneau: null);
    case 'av-douala':
      return (degrade: _bandes(const [Color(0xFF007A5E), Color(0xFFCE1126), Color(0xFFFCD116)]), fond: K.brass, encre: Colors.white, ombreTexte: true, anneau: null);
    case 'av-brazzaville':
      return (degrade: _bandes(const [Color(0xFF009543), Color(0xFFFBDE4A), Color(0xFFDC241F)], stops: const [0, .4, .6, 1], debut: Alignment.topLeft, fin: Alignment.bottomRight), fond: K.brass, encre: Colors.white, ombreTexte: true, anneau: null);
    case 'av-goma':
      return (degrade: const RadialGradient(center: Alignment(0, 1.2), radius: 1, colors: [Color(0xFFFF7A2F), Color(0xFFA3200F), Color(0xFF1B0B07)], stops: [0, .45, .8]), fond: K.brass, encre: const Color(0xFFFFD7A8), ombreTexte: false, anneau: null);
    case 'av-fondateur':
      return (degrade: const RadialGradient(center: Alignment(-.4, -.5), radius: .9, colors: [Color(0xFFF6DC9A), Color(0xFFE2B04A), Color(0xFF8A6420)], stops: [0, .55, 1]), fond: K.brass, encre: K.encre, ombreTexte: false, anneau: K.encre);
    case 'av-ambassadeur':
      return (degrade: const RadialGradient(center: Alignment(0, -.4), radius: .8, colors: [Color(0xFFFFF3C8), Color(0xFFE2B04A), Color(0xFF1F4D3A), Color(0xFF123326)], stops: [0, .45, .46, 1]), fond: K.brass, encre: K.encre, ombreTexte: false, anneau: null);
    default:
      return (degrade: null, fond: K.brass, encre: K.encre, ombreTexte: false, anneau: null);
  }
}

List<BoxShadow> ombresCadre(String? id) {
  BoxShadow a(Color c, double r, [double flou = 0]) => BoxShadow(color: c, spreadRadius: r, blurRadius: flou);
  switch (id) {
    case 'cadre-kinshasa': return [a(const Color(0xFFCE1021), 5), a(const Color(0xFF3B8FD6), 3)];
    case 'cadre-lubumbashi': return [a(const Color(0xFF5A2E0E), 5), a(const Color(0xFFB87333), 3)];
    case 'cadre-abidjan': return [a(const Color(0xFF009E60), 5), a(const Color(0xFFF77F00), 3)];
    case 'cadre-dakar': return [a(const Color(0xFFFDEF42), 5), a(const Color(0xFF00853F), 3)];
    case 'cadre-douala': return [a(const Color(0xFFCE1126), 5), a(const Color(0xFF007A5E), 3)];
    case 'cadre-brazzaville': return [a(const Color(0xFFDC241F), 5), a(const Color(0xFF009543), 3)];
    case 'cadre-fondateurs': return [a(K.brass, 7), a(K.encre, 5), a(K.brass, 3)];
    case 'cadre-legende': return [a(const Color(0x99E0564C), 4, 14), a(K.brass, 6), a(const Color(0xFFE0564C), 3)];
    case 'cadre-ambassadeur': return [a(K.brass, 5), a(const Color(0xFF1F8A5B), 3)];
    case 'cadre-ambassadeur-or': return [a(const Color(0x8CE2B04A), 4, 14), a(K.brass, 7), a(const Color(0xFFFFF3C8), 5), a(K.brass, 3)];
    default: return const [];
  }
}

/// Rond avec l'initiale du pseudo, l'apparence et le cadre équipés, et la pastille de niveau.
class Avatar extends StatelessWidget {
  final String nom;
  final String? avatar;
  final String? cadre;
  final double taille;
  final int? niveau;
  final bool gris;
  const Avatar(this.nom, {super.key, this.avatar, this.cadre, this.taille = 40, this.niveau, this.gris = false});

  @override
  Widget build(BuildContext context) {
    final s = styleAvatar(avatar);
    final lettre = nom.trim().isEmpty ? '?' : nom.trim().characters.first.toUpperCase();
    Widget rond = Container(
      width: taille,
      height: taille,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: s.fond,
        gradient: s.degrade,
        border: s.anneau == null ? null : Border.all(color: s.anneau!, width: 2),
        boxShadow: ombresCadre(cadre),
      ),
      child: Text(lettre, style: TextStyle(fontFamily: K.display, fontSize: taille * .6, height: 1, color: s.encre, shadows: s.ombreTexte ? const [Shadow(color: Color(0x99000000), blurRadius: 3, offset: Offset(0, 1))] : null)),
    );
    if (gris) rond = ColorFiltered(colorFilter: const ColorFilter.matrix([.3, .59, .11, 0, 0, .3, .59, .11, 0, 0, .3, .59, .11, 0, 0, 0, 0, 0, .85, 0]), child: rond);
    if (niveau == null) return rond;
    return Stack(clipBehavior: Clip.none, children: [
      rond,
      Positioned(
        right: -5,
        bottom: -4,
        child: Container(
          constraints: const BoxConstraints(minWidth: 18),
          height: 18,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(color: K.table, borderRadius: BorderRadius.circular(9), border: Border.all(color: K.brass, width: 1.5)),
          alignment: Alignment.center,
          child: Text('$niveau', style: K.texte(11, couleur: K.brass, poids: FontWeight.w600).copyWith(height: 1)),
        ),
      ),
    ]);
  }
}
