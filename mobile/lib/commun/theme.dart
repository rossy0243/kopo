// Couleurs, polices et petits éléments du site (boutons, pastilles, puces, bascules, fenêtres).
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'icones_data.dart';

class K {
  static const table = Color(0xFF10233A);
  static const table2 = Color(0xFF183252);
  static const ink = Color(0xFFEEF2F7);
  static const muted = Color(0xFF9FB2C8);
  static const brass = Color(0xFFE2B04A);
  static const brassFonce = Color(0xFF9C7524);
  static const card = Color(0xFFFBF7EE);
  static const cardInk = Color(0xFF1B2533);
  static const red = Color(0xFFC7362F);
  static const good = Color(0xFF3FBF7F);
  static const bad = Color(0xFFEF6B5F);
  static const line = Color(0x1FFFFFFF);
  static const encre = Color(0xFF1D1606);
  static const display = 'Bebas';
  static const body = 'Outfit';

  static const divisions = {
    'bois': Color(0xFFB07A46), 'bronze': Color(0xFFD08A4A), 'argent': Color(0xFFC9D1DA),
    'or': Color(0xFFE2B04A), 'diamant': Color(0xFF7FD3E6), 'legende': Color(0xFFE0564C),
  };

  static const fond = BoxDecoration(
    gradient: RadialGradient(center: Alignment(0, -0.6), radius: 1.3, colors: [table2, table]),
  );

  static TextStyle titre(double taille, {Color couleur = brass}) =>
      TextStyle(fontFamily: display, fontSize: taille, color: couleur, letterSpacing: 1, height: 1.05);
  static TextStyle texte(double taille, {Color couleur = ink, FontWeight poids = FontWeight.w400}) =>
      TextStyle(fontFamily: body, fontSize: taille, color: couleur, fontWeight: poids, height: 1.3);

  static ThemeData theme() => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: table,
        fontFamily: body,
        colorScheme: const ColorScheme.dark(primary: brass, secondary: brass, surface: table2, error: bad, onPrimary: encre),
        textTheme: const TextTheme().apply(bodyColor: ink, displayColor: ink, fontFamily: body),
        textSelectionTheme: const TextSelectionThemeData(cursorColor: brass, selectionColor: Color(0x55E2B04A)),
        splashFactory: InkRipple.splashFactory,
      );
}

/// Icône du site (symboles « i-… », trait laiton).
class Ico extends StatelessWidget {
  final String nom;
  final double taille;
  final Color? couleur;
  const Ico(this.nom, {super.key, this.taille = 24, this.couleur});
  @override
  Widget build(BuildContext context) {
    final corps = iconesSvg[nom] ?? '';
    final c = couleur == null ? '#e2b04a' : '#${(couleur!.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    final svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="$c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">$corps</svg>';
    return SvgPicture.string(svg, width: taille, height: taille);
  }
}

enum StyleBtn { normal, principal, danger, discret }

class Btn extends StatelessWidget {
  final String? texte;
  final Widget? enfant;
  final VoidCallback? onTap;
  final StyleBtn style;
  final String? icone;
  final bool large;
  final double taille;
  final EdgeInsets? marge;
  const Btn(this.texte, {super.key, this.onTap, this.style = StyleBtn.normal, this.icone, this.enfant, this.large = false, this.taille = 15, this.marge});
  const Btn.principal(this.texte, {super.key, this.onTap, this.icone, this.enfant, this.large = false, this.taille = 15, this.marge}) : style = StyleBtn.principal;

  @override
  Widget build(BuildContext context) {
    final actif = onTap != null;
    final Color fond, bord, encre;
    switch (style) {
      case StyleBtn.principal:
        fond = K.brass; bord = K.brass; encre = K.encre;
      case StyleBtn.danger:
        fond = K.red; bord = K.red; encre = Colors.white;
      case StyleBtn.discret:
        fond = Colors.transparent; bord = Colors.transparent; encre = K.muted;
      case StyleBtn.normal:
        fond = const Color(0x12FFFFFF); bord = K.line; encre = K.ink;
    }
    final contenu = enfant ??
        Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
          if (icone != null) ...[Ico(icone!, taille: 20, couleur: style == StyleBtn.principal ? K.encre : null), if (texte != null) const SizedBox(width: 8)],
          if (texte != null) Flexible(child: Text(texte!, textAlign: TextAlign.center, style: K.texte(taille, couleur: encre, poids: FontWeight.w600))),
        ]);
    final b = Opacity(
      opacity: actif ? 1 : .45,
      child: Material(
        color: fond,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: bord)),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(padding: marge ?? const EdgeInsets.symmetric(horizontal: 16, vertical: 11), child: Center(widthFactor: 1, heightFactor: 1, child: contenu)),
        ),
      ),
    );
    return large ? SizedBox(width: double.infinity, child: b) : b;
  }
}

enum TypePastille { ok, ko, tour, neutre }

class Pastille extends StatelessWidget {
  final String texte;
  final TypePastille type;
  const Pastille(this.texte, {super.key, this.type = TypePastille.neutre});
  @override
  Widget build(BuildContext context) {
    final (fond, encre) = switch (type) {
      TypePastille.ok => (const Color(0x333FBF7F), K.good),
      TypePastille.ko => (const Color(0x33EF6B5F), K.bad),
      TypePastille.tour => (K.brass, K.encre),
      TypePastille.neutre => (const Color(0x1AFFFFFF), K.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(99)),
      child: Text(texte, style: K.texte(12, couleur: encre, poids: FontWeight.w600)),
    );
  }
}

/// Puce d'information (« Couleur du tour », « Demande »…).
class Puce extends StatelessWidget {
  final Widget enfant;
  final Color? couleur;
  const Puce(this.enfant, {super.key, this.couleur});
  Puce.texte(String t, {super.key, this.couleur}) : enfant = Text(t, style: K.texte(13, poids: FontWeight.w600));
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: const Color(0x590B1828), borderRadius: BorderRadius.circular(99), border: Border.all(color: couleur ?? K.line)),
        child: DefaultTextStyle(style: K.texte(13, poids: FontWeight.w600), child: enfant),
      );
}

/// Ligne de réglage avec un interrupteur.
class Bascule extends StatelessWidget {
  final String texte;
  final String? aide;
  final bool valeur;
  final ValueChanged<bool>? onChange;
  const Bascule(this.texte, this.valeur, this.onChange, {super.key, this.aide});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onChange == null ? null : () => onChange!(!valeur),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(texte, style: K.texte(15)),
                if (aide != null) Text(aide!, style: K.texte(12, couleur: K.muted)),
              ]),
            ),
            Switch(value: valeur, onChanged: onChange, activeThumbColor: K.encre, activeTrackColor: K.brass),
          ]),
        ),
      );
}

/// Choix parmi quelques valeurs (boutons accolés, l'actif en laiton).
class Choix<T> extends StatelessWidget {
  final List<(T, String)> options;
  final T valeur;
  final ValueChanged<T>? onChange;
  const Choix(this.options, this.valeur, this.onChange, {super.key});
  @override
  Widget build(BuildContext context) => Wrap(spacing: 6, runSpacing: 6, children: [
        for (final (v, t) in options)
          Btn(t, style: v == valeur ? StyleBtn.principal : StyleBtn.normal, marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), taille: 14, onTap: onChange == null ? null : () => onChange!(v)),
      ]);
}

/// Fenêtre centrée du site (fond table-2, titre en Bebas laiton).
class Fenetre extends StatelessWidget {
  final String? titre;
  final List<Widget> enfants;
  final VoidCallback? onFermer;
  final double largeur;
  const Fenetre({super.key, this.titre, required this.enfants, this.onFermer, this.largeur = 440});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: largeur, maxHeight: MediaQuery.of(context).size.height * .92),
          child: Material(
            color: K.table2,
            elevation: 24,
            shadowColor: Colors.black,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: K.line)),
            child: Stack(children: [
              SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (titre != null) Padding(padding: const EdgeInsets.only(bottom: 10, right: 30), child: Text(titre!, style: K.titre(36))),
                  ...enfants,
                ]),
              ),
              if (onFermer != null)
                Positioned(right: 4, top: 4, child: IconButton(onPressed: onFermer, icon: const Icon(Icons.close, color: K.muted), tooltip: 'Fermer')),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Texte d'aide gris.
class Muet extends StatelessWidget {
  final String texte;
  final double taille;
  final TextAlign? align;
  const Muet(this.texte, {super.key, this.taille = 13, this.align});
  @override
  Widget build(BuildContext context) => Text(texte, textAlign: align, style: K.texte(taille, couleur: K.muted));
}

class Ecart extends StatelessWidget {
  final double h;
  const Ecart([this.h = 10, Key? key]) : super(key: key);
  @override
  Widget build(BuildContext context) => SizedBox(height: h, width: h);
}

/// Barre de progression (XP, chrono, revanche).
class Barre extends StatelessWidget {
  final double fraction;
  final double hauteur;
  final Color couleur;
  const Barre(this.fraction, {super.key, this.hauteur = 6, this.couleur = K.brass});
  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(hauteur),
        child: Container(
          height: hauteur,
          color: const Color(0x1FFFFFFF),
          alignment: Alignment.centerLeft,
          child: FractionallySizedBox(widthFactor: fraction.clamp(0, 1).toDouble(), child: Container(color: couleur)),
        ),
      );
}

/// Champ de saisie au style du site.
class Champ extends StatelessWidget {
  final TextEditingController controleur;
  final String? indice;
  final int? max;
  final bool majuscules;
  final TextAlign align;
  final TextStyle? style;
  final ValueChanged<String>? onValider;
  final TextInputType? clavier;
  const Champ(this.controleur, {super.key, this.indice, this.max, this.majuscules = false, this.align = TextAlign.start, this.style, this.onValider, this.clavier});
  @override
  Widget build(BuildContext context) => TextField(
        controller: controleur,
        maxLength: max,
        textAlign: align,
        keyboardType: clavier,
        textCapitalization: majuscules ? TextCapitalization.characters : TextCapitalization.none,
        style: style ?? K.texte(16),
        onSubmitted: onValider,
        decoration: InputDecoration(
          hintText: indice,
          hintStyle: K.texte(15, couleur: K.muted),
          counterText: '',
          filled: true,
          fillColor: const Color(0x590B1828),
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: K.line)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: K.brass)),
        ),
      );
}
