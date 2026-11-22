// La partie, comme sur le site (src/source.html, « Partie ») :
// - en paysage, les joueurs autour d'une table ovale bleue, la consigne au milieu, ta main en éventail en bas,
//   ton siège en bas à gauche, les boutons en bas à droite et KATAPSS (ou J'annonce, Contester) en rond au milieu à droite ;
// - en portrait, les sièges en grille, le panneau de la table, puis « Ta main » et ses boutons en bas de l'écran.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../commun/cartes.dart';
import '../commun/sons.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/cahier.dart';
import '../fenetres/communes.dart';
import '../fenetres/parametres.dart';
import '../fenetres/partie_fenetres.dart';
import '../fenetres/social.dart';
import '../fenetres/vocal_ui.dart';

/// Téléphone droit : le conseil « Mets ton téléphone à l'horizontale » a été masqué (✕).
bool _tournerFerme = false;

class Partie extends StatelessWidget {
  const Partie({super.key});

  @override
  Widget build(BuildContext context) {
    final v = app.vue!;
    final m = v['manche'] as Map?;
    if (m == null) return const SizedBox();
    final inter = v['jeu'] == 'inter8';
    final jeJoue = (m['enJeu'] as List).contains(v['moi']);
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;
    final contenu = paysage ? _Paysage(v, m, inter, jeJoue) : _Portrait(v, m, inter, jeJoue);
    // Qui parle (abonnés Kopo+ en vocal), sous l'en-tête, sans pousser la table.
    final parleurs = Positioned(top: MediaQuery.of(context).padding.top + 54, left: 0, right: 0, child: IgnorePointer(child: BandeauParleurs(v)));
    if (v['enPause'] != true) return Stack(children: [Positioned.fill(child: contenu), parleurs]);
    // Partie en pause : la table est voilée jusqu'à « Reprendre ».
    return Stack(children: [
      Positioned.fill(child: contenu),
      Positioned.fill(
        child: Container(
          color: const Color(0xC0060E18),
          alignment: Alignment.center,
          padding: const EdgeInsets.all(16),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 320),
            padding: const EdgeInsets.fromLTRB(24, 22, 24, 22),
            decoration: BoxDecoration(color: K.table2, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0x73E2B04A))),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Ico('pause', taille: 44),
              Text('PARTIE EN PAUSE', style: K.titre(30)),
              const SizedBox(height: 6),
              Text("Les robots t'attendent. Ton chrono est arrêté.", textAlign: TextAlign.center, style: K.texte(15, couleur: K.muted)),
              const SizedBox(height: 16),
              Btn.principal('Reprendre', large: true, onTap: () => app.envoyer({'type': 'enPause', 'pause': false})),
            ]),
          ),
        ),
      ),
    ]);
  }
}

// ---------------------------------------------------------------- l'en-tête (logo, manche, boutons)
class _Entete extends StatelessWidget {
  final Vue v;
  final bool paysage;
  const _Entete(this.v, this.paysage);

  @override
  Widget build(BuildContext context) {
    final inter = v['jeu'] == 'inter8';
    final cahier = cahierDe(v);
    final finale = (v['restants'] as List).length == 2;
    final style = inter ? ' · ${v['mode'] == 'delire' ? (v['jRetour'] == true ? 'Délire · J retour' : 'Délire') : 'Simple'}' : '';
    final w = MediaQuery.of(context).size.width;
    // Téléphone droit et étroit : le logo seul, « Manche 1 · CODE » sur deux lignes (comme sur le site).
    final etroit = !paysage && w <= 420;
    final tailleLogo = w < 360 ? 26.0 : 28.0;
    final logo = Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(tailleLogo * .23), boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 8, offset: Offset(0, 2))]),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(tailleLogo * .23),
          child: SvgPicture.asset(inter ? 'assets/img/masano-logo.svg' : 'assets/img/kopo-logo.svg', width: tailleLogo * 1.05, height: tailleLogo * 1.05),
        ),
      ),
      if (!etroit) ...[
        SizedBox(width: tailleLogo * (inter ? .8 : 1) * .22),
        Text(inter ? 'INTER (8)' : 'KOPO', style: TextStyle(fontFamily: K.display, fontSize: tailleLogo * (inter ? .8 : 1), letterSpacing: 2, color: K.brass, height: 1)),
      ],
    ]);
    final info = Text.rich(
      TextSpan(style: K.texte(etroit ? 12 : 13, couleur: K.muted).copyWith(height: 1.2), children: [
        TextSpan(text: cahier != null ? 'Donne ${v['numeroManche']}' : finale ? 'Finale' : 'Manche ${v['numeroManche']}', style: const TextStyle(color: K.ink, fontWeight: FontWeight.w700)),
        TextSpan(text: '${cahier != null ? ' · Cahier ${cahier['total']}' : ''}$style · ${v['code']}'),
      ]),
      maxLines: etroit ? 2 : 1,
      overflow: TextOverflow.ellipsis,
    );
    final petit = etroit || w < 360;
    return Row(children: [
      logo,
      const SizedBox(width: 10),
      Expanded(child: info),
      BoutonsMicro(v),
      const SizedBox(width: 6),
      _BoutonTete(icone: 'reglages', aide: 'Paramètres', petit: petit, onTap: ouvrirParametres),
      const SizedBox(width: 6),
      _BoutonTete(icone: 'reactions', aide: 'Réactions', petit: petit, onTap: ouvrirChat),
      // Contre les robots (seul humain) : pause. Le serveur arrête robots, chrono et comptes à rebours.
      if (v['pausePossible'] == true && v['enPause'] != true) ...[
        const SizedBox(width: 6),
        _BoutonTete(icone: 'pause', aide: 'Pause', petit: petit, onTap: () => app.envoyer({'type': 'enPause', 'pause': true})),
      ],
      const SizedBox(width: 6),
      _BoutonTete(texte: 'Quitter', aide: 'Quitter', petit: petit, onTap: demanderQuitter),
    ]);
  }
}

/// Bouton de l'en-tête du site (« .btn » : fond à peine clair, filet, coins de 10).
class _BoutonTete extends StatelessWidget {
  final String? icone;
  final String? texte;
  final String aide;
  final bool petit;
  final VoidCallback onTap;
  const _BoutonTete({this.icone, this.texte, required this.aide, required this.onTap, this.petit = false});
  @override
  Widget build(BuildContext context) => Tooltip(
        message: aide,
        child: Material(
          color: const Color(0x12FFFFFF),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: K.line)),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onTap,
            child: Padding(
              padding: icone != null
                  ? EdgeInsets.symmetric(horizontal: petit ? 5 : 9, vertical: petit ? 4 : 7)
                  : EdgeInsets.symmetric(horizontal: petit ? 7 : 10, vertical: petit ? 6 : 7),
              child: icone != null ? Ico(icone!, taille: petit ? 20 : 24) : Text(texte!, style: K.texte(petit ? 12 : 13, poids: FontWeight.w600)),
            ),
          ),
        ),
      );
}

// ---------------------------------------------------------------- paysage : la table ovale
class _Paysage extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool inter;
  final bool jeJoue;
  const _Paysage(this.v, this.m, this.inter, this.jeJoue);

  /// Les adversaires à égale distance les uns des autres le long du bord de la table (et non à angle égal),
  /// de ta gauche à ta droite en descendant un peu sur les côtés (placerSieges du site).
  static List<Offset> places(int n, double w, double h) {
    const cx = 50.0, cy = 51.0, rx = 43.0, ry = 37.0, nb = 240;
    const a0 = math.pi * 1.1, a1 = -math.pi * .1;
    final pts = <Offset>[], l = <double>[0];
    for (var i = 0; i <= nb; i++) {
      final a = a0 + (a1 - a0) * i / nb;
      pts.add(Offset(cx + rx * math.cos(a), cy - ry * math.sin(a)));
      if (i > 0) l.add(l[i - 1] + math.sqrt(math.pow((pts[i].dx - pts[i - 1].dx) * w, 2) + math.pow((pts[i].dy - pts[i - 1].dy) * h, 2)));
    }
    // Sur un écran étroit ou bas, le nom du joueur reste entier dans l'écran et ne passe pas sous l'en-tête.
    final mx = 62 / w * 100, my = 66 / h * 100;
    return [
      for (var k = 0; k < n; k++)
        () {
          final cible = l[nb] * (k + .5) / n;
          var i = l.indexWhere((x) => x >= cible);
          if (i < 0) i = nb;
          return Offset(pts[i].dx.clamp(mx, math.max(mx, 100 - mx)) * w / 100, math.max(my, pts[i].dy) * h / 100);
        }(),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final pad = mq.padding;
    final sieges = (m['sieges'] as List).map((e) => e.toString()).toList();
    final i0 = math.max(0, sieges.indexOf(v['moi'].toString()));
    final ordre = [...sieges.sublist(i0), ...sieges.sublist(0, i0)];
    final autres = ordre.where((id) => id != v['moi']).toList();
    final bas = _Bas(v, m, inter, jeJoue, paysage: true);
    final g = math.max(10.0, pad.left), d = math.max(10.0, pad.right), b = math.max(10.0, pad.bottom);
    return LayoutBuilder(builder: (context, c) {
      final w = c.maxWidth, h = c.maxHeight;
      final petit = h <= 430;
      final pts = places(autres.length, w, h);
      return Stack(clipBehavior: Clip.none, children: [
        // Le tapis
        Positioned(left: w * .06, right: w * .06, top: h * .10, bottom: h * .12, child: const _Tapis()),
        // Les adversaires autour de la table
        for (var k = 0; k < autres.length; k++)
          Positioned(
            left: pts[k].dx, top: pts[k].dy,
            child: FractionalTranslation(translation: const Offset(-.5, -.5), child: SizedBox(width: 118, child: _Siege(v, m, autres[k], paysage: true))),
          ),
        // Le centre : puces, cartes posées (ou carte du centre et pioche), consigne, chrono
        Positioned(
          left: w / 2, top: h * .47,
          child: FractionalTranslation(
            translation: const Offset(-.5, -.5),
            child: SizedBox(width: math.min(w * .5, 480), child: _CentreTable(v, m, inter, jeJoue, paysage: true, petit: petit)),
          ),
        ),
        // Ton siège, en bas à gauche
        Positioned(left: g, bottom: b, child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 118), child: _Siege(v, m, v['moi'].toString(), paysage: true))),
        // Ta main, entre ton siège et la colonne des boutons
        if (jeJoue)
          Positioned(
            left: g + 118 + 16, right: d + 150 + 16, bottom: math.max(6.0, pad.bottom),
            child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 640), child: bas.main(context, paysage: true, petit: petit, hMax: math.max((petit ? 84 : 96) + 60.0, h * .36)))),
          ),
        // Les boutons en bas à droite, KATAPSS (ou J'annonce, Contester) en rond au-dessus, au milieu à droite.
        if (jeJoue)
          Positioned(
            right: d, top: pad.top + 52, bottom: b, width: 150,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(child: LayoutBuilder(builder: (context, place) => bas.zoneRonde(place.maxHeight, h / 2 - pad.top - 52, petit: petit))),
              ...bas.boutons(paysage: true),
            ]),
          ),
        // L'en-tête, par-dessus la table
        Positioned(left: math.max(10.0, pad.left), right: math.max(10.0, pad.right), top: pad.top + 6, child: _Entete(v, true)),
      ]);
    });
  }
}

/// Le tapis du site : ovale bleu, liseré de bois et filet laiton, ombre portée.
class _Tapis extends StatelessWidget {
  const _Tapis();
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final forme = BorderRadius.all(Radius.elliptical(c.maxWidth / 2, c.maxHeight / 2));
        return Container(
          decoration: BoxDecoration(borderRadius: forme, boxShadow: const [BoxShadow(color: Color(0x80000000), blurRadius: 40, offset: Offset(0, 14))]),
          child: ClipRRect(
            borderRadius: forme,
            child: CustomPaint(painter: _TapisPeintre(), size: Size(c.maxWidth, c.maxHeight)),
          ),
        );
      });
}

class _TapisPeintre extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final r = Offset.zero & s;
    // Fond : dégradé radial (ellipse) centré à 50 % / 42 %.
    canvas.save();
    canvas.translate(s.width / 2, s.height * .42);
    canvas.scale(1, s.height / s.width);
    final rayon = s.width * .75;
    canvas.drawCircle(Offset.zero, rayon * 2,
        Paint()..shader = const RadialGradient(colors: [Color(0xFF24497A), Color(0xFF142C4A)], stops: [0, .72]).createShader(Rect.fromCircle(center: Offset.zero, radius: rayon)));
    canvas.restore();
    // Ombre intérieure (inset 0 0 60px noir .45)
    final ovale = Path()..addOval(r);
    canvas.drawPath(
      ovale,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 60
        ..color = const Color(0x73000000)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 22),
    );
    // Liseré de bois (7 px) puis filet laiton (3 px).
    canvas.drawOval(r.deflate(3.5), Paint()..style = PaintingStyle.stroke..strokeWidth = 7..color = const Color(0xFF3B2A12));
    canvas.drawOval(r.deflate(8.5), Paint()..style = PaintingStyle.stroke..strokeWidth = 3..color = const Color(0x73E2B04A));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ---------------------------------------------------------------- portrait : sièges en grille, table, ta main
class _Portrait extends StatefulWidget {
  final Vue v;
  final Map m;
  final bool inter;
  final bool jeJoue;
  const _Portrait(this.v, this.m, this.inter, this.jeJoue);
  @override
  State<_Portrait> createState() => _PortraitState();
}

class _PortraitState extends State<_Portrait> {
  @override
  Widget build(BuildContext context) {
    final v = widget.v, m = widget.m;
    final mq = MediaQuery.of(context);
    final sieges = (m['sieges'] as List).map((e) => e.toString()).toList();
    final i0 = math.max(0, sieges.indexOf(v['moi'].toString()));
    final ordre = [...sieges.sublist(i0), ...sieges.sublist(0, i0)];
    final w = mq.size.width;
    // Sièges : 2 colonnes sur téléphone (3 si l'écran est bas), plus sur tablette.
    final cols = w < 480 ? (mq.size.height <= 640 ? 3 : 2) : math.max(2, ((w - 16 + 4) / 154).floor());
    final bas = _Bas(v, m, widget.inter, widget.jeJoue, paysage: false);
    final grille = <Widget>[];
    for (var i = 0; i < ordre.length; i += cols) {
      if (i > 0) grille.add(const SizedBox(height: 4));
      grille.add(Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var k = 0; k < cols; k++) ...[
          if (k > 0) const SizedBox(width: 4),
          Expanded(child: i + k < ordre.length ? _Siege(v, m, ordre[i + k], paysage: false, petit: mq.size.height <= 640) : const SizedBox()),
        ],
      ]));
    }
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _Entete(v, false),
          const SizedBox(height: 8),
          Expanded(
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (!_tournerFerme) ...[_Tourner(onFermer: () => setState(() => _tournerFerme = true)), const SizedBox(height: 8)],
                ...grille,
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: const Color(0x38000000), borderRadius: BorderRadius.circular(14), border: Border.all(color: K.line)),
                  child: _CentreTable(v, m, widget.inter, widget.jeJoue, paysage: false, petit: false),
                ),
              ]),
            ),
          ),
          if (widget.jeJoue) ...[
            const SizedBox(height: 8),
            // Comme sur le site, la zone de ta main garde toute sa hauteur : c'est le haut (sièges, table) qui défile.
            // Filet de sécurité sur un tout petit écran : elle défile à son tour, KATAPSS restant en haut.
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: mq.size.height * .8),
              child: Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                decoration: BoxDecoration(color: const Color(0x0FE2B04A), borderRadius: BorderRadius.circular(14), border: Border.all(color: K.line)),
                child: SingleChildScrollView(child: bas.zonePortrait(context, hMax: math.max(96 + 60.0, mq.size.height * .36))),
              ),
            ),
          ],
        ]),
      ),
    );
  }
}

/// « Mets ton téléphone à l'horizontale pour voir la table en grand. »
class _Tourner extends StatelessWidget {
  final VoidCallback onFermer;
  const _Tourner({required this.onFermer});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(10, 6, 4, 6),
        decoration: BoxDecoration(color: const Color(0x1AE2B04A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0x59E2B04A))),
        child: Row(children: [
          const _TelMini(),
          const SizedBox(width: 8),
          Expanded(child: Text("Mets ton téléphone à l'horizontale pour voir la table en grand.", style: K.texte(13, couleur: K.brass))),
          InkWell(
            onTap: onFermer,
            borderRadius: BorderRadius.circular(8),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), child: Text('✕', style: K.texte(15, couleur: K.brass).copyWith(height: 1))),
          ),
        ]),
      );
}

/// Petit téléphone qui se couche (animation du site).
class _TelMini extends StatefulWidget {
  const _TelMini();
  @override
  State<_TelMini> createState() => _TelMiniState();
}

class _TelMiniState extends State<_TelMini> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 3200));
  @override
  void initState() {
    super.initState();
    if (!app.sansAnim) _a.repeat();
  }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 22, height: 22,
        child: AnimatedBuilder(
          animation: _a,
          builder: (_, child) {
            // 0–22 % droit, 50–82 % couché, retour à 100 %.
            final t = _a.value;
            final f = t < .22 ? 0.0 : t < .5 ? Curves.easeInOut.transform((t - .22) / .28) : t < .82 ? 1.0 : 1 - Curves.easeInOut.transform((t - .82) / .18);
            return Transform.rotate(angle: -f * math.pi / 2, child: child);
          },
          child: Center(
            child: Container(
              width: 10, height: 20,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(2.5), border: Border.all(color: K.brass, width: 1.8)),
              alignment: Alignment.bottomCenter,
              padding: const EdgeInsets.only(bottom: 2),
              child: Container(width: 3, height: 1.6, color: K.brass),
            ),
          ),
        ),
      );
}

// ---------------------------------------------------------------- les sièges
/// Petit dos de carte rayé (compte de cartes du site).
class _MiniDos extends StatelessWidget {
  final Color? couleur;
  const _MiniDos({this.couleur});
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 9, height: 13,
        child: couleur != null
            ? DecoratedBox(decoration: BoxDecoration(color: couleur, borderRadius: BorderRadius.circular(2)))
            : const DosCarte(l: 9, h: 13, rayon: 2, bord: 0),
      );
}

class _Siege extends StatelessWidget {
  final Vue v;
  final Map m;
  final String id;
  final bool paysage;
  final bool petit;
  const _Siege(this.v, this.m, this.id, {required this.paysage, this.petit = false});

  // Seul le siège se redessine quand quelqu'un se met à parler ou se tait (pas tout l'écran).
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Set<String>>(valueListenable: app.vocal.quiParle, builder: (context, _, _) => _siege(context));

  Widget _siege(BuildContext context) {
    final j = (v['joueurs'] as List).cast<Map>().firstWhere((x) => x['id'] == id, orElse: () => {});
    final moi = id == v['moi'];
    final courant = id == m['joueurCourant'];
    final qualifies = (m['qualifies'] as List).cast<Map>();
    final q = qualifies.indexWhere((x) => x['joueur'] == id);
    final sorti = q >= 0 || m['elimine'] == id;
    final nb = ((m['nbCartes'] as Map)[id] as num?)?.toInt() ?? 0;
    final robot = j['robot'] == true;
    final pause = m['pause'] as Map?;
    final meneur = (pause?['annonce'] as Map?)?['meneur'] == id;
    final parle = app.vocal.parleurs.contains(id); // en vocal (abonnés Kopo+) : le siège s'éclaire en vert
    final cahier = cahierDe(v);
    final encre = paysage && courant ? K.encre : K.ink;
    final pastilles = <Widget>[
      if (q >= 0) Pastille(cahier != null ? 'sorti ✓' : qualifies[q]['raison'] == 'Katapss' ? 'Katapss ✓' : q == 0 ? 'qualifié 1er' : 'qualifié ${q + 1}e', type: TypePastille.ok, petite: !paysage)
      else if (m['elimine'] == id) Pastille('éliminé', type: TypePastille.ko, petite: !paysage),
      if (v['jeu'] == 'inter8' && ((m['annonces'] as List?) ?? []).contains(id) && q < 0) Pastille('annonce', type: TypePastille.tour, petite: !paysage),
      if (j['connecte'] != true && !robot) ...[
        Pastille('déconnecté', type: TypePastille.ko, petite: !paysage),
        if (v['hote'] == v['moi'] && (v['restants'] as List).contains(id))
          Btn('Remplacer', icone: 'robots', taille: 12, marge: const EdgeInsets.symmetric(horizontal: 6, vertical: 3), onTap: () => app.envoyer({'type': 'remplacerParRobot', 'cible': id})),
      ] else if (j['remplace'] == true) Pastille('remplacé', petite: !paysage)
      else if (j['absent'] == true && (m['enJeu'] as List).contains(id)) Pastille('absent · 5 s', type: TypePastille.ko, petite: !paysage),
      // Mode Cahier : le total de chacun sous son nom (rouge près de l'élimination).
      if (cahier != null && (cahier['scores'] as Map)[id] != null)
        () {
          final t = ((cahier['scores'] as Map)[id] as num);
          final rouge = t >= (cahier['total'] as num) * .8;
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(color: rouge ? K.bad : K.brass, borderRadius: BorderRadius.circular(99)),
            child: Text('$t pts', style: K.texte(10, couleur: rouge ? Colors.white : K.encre, poids: FontWeight.w700)),
          );
        }(),
    ];
    final chrono = courant && v['chrono'] != null && pause == null && q < 0 && m['elimine'] != id
        ? Horloge(builder: (_) => Barre(app.resteChrono / math.max(1, app.totalChrono), hauteur: 3, couleur: app.resteChrono < 2000 ? K.bad : K.brass))
        : null;

    // La ligne : icône, pseudo, couronne Kopo+, meneur (↻), nombre de cartes.
    final tailleNom = paysage ? 14.0 : petit ? 13.0 : 15.0;
    final compte = nb > 0 && (moi || !paysage)
        ? Row(mainAxisSize: MainAxisSize.min, children: [
            _MiniDos(couleur: paysage && courant ? K.encre : null),
            const SizedBox(width: 3),
            Text('$nb', style: K.texte(14, couleur: encre, poids: FontWeight.w700).copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
          ])
        : null;
    final ligne = Row(mainAxisSize: paysage ? MainAxisSize.min : MainAxisSize.max, children: [
      if (robot) Padding(padding: const EdgeInsets.only(right: 4), child: Ico('robots', taille: tailleNom, couleur: paysage && courant ? K.encre : K.ink))
      else if (j['voix'] == true) Padding(padding: const EdgeInsets.only(right: 3), child: Ico(app.vocal.icone(j, v['moi'])!, taille: tailleNom, couleur: paysage && courant ? K.encre : parle ? K.good : null)),
      // Pas la place pour le pseudo : son initiale.
      Flexible(fit: paysage ? FlexFit.loose : FlexFit.tight, child: NomOuInitiale(moi ? 'Toi' : (j['nom'] ?? '?').toString(), style: K.texte(tailleNom, couleur: encre, poids: paysage ? FontWeight.w700 : FontWeight.w600))),
      if (j['plus'] == true) Padding(padding: const EdgeInsets.only(left: 4), child: CouronnePlus(taille: tailleNom * .95, couleur: paysage && courant ? K.encre : K.brass)),
      if (meneur) Padding(padding: const EdgeInsets.only(left: 4), child: Text('↻', style: K.texte(tailleNom, couleur: paysage && courant ? K.encre : K.brass, poids: FontWeight.w800))),
      if (compte != null) ...[const SizedBox(width: 6), compte],
    ]);

    final Widget contenu;
    if (paysage) {
      contenu = Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: moi ? CrossAxisAlignment.start : CrossAxisAlignment.center, children: [
        // L'éventail de ses cartes (dos), au-dessus du nom.
        if (!moi && nb > 0)
          SizedBox(
            height: 22,
            child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
              SizedBox(
                width: 15 + 6.0 * (math.min(nb, 10) - 1),
                height: 22,
                child: Stack(children: [for (var c = 0; c < math.min(nb, 10); c++) Positioned(left: 6.0 * c, child: const DosCarte(l: 15, h: 22, rayon: 3, bord: 1))]),
              ),
              const SizedBox(width: 5),
              Text('$nb', style: K.texte(14, poids: FontWeight.w400).copyWith(height: 1, shadows: const [Shadow(color: Color(0xCC000000), blurRadius: 3, offset: Offset(0, 1))])),
            ]),
          ),
        if (!moi && nb > 0) const SizedBox(height: 3),
        _Battement(
          actif: courant,
          rayon: 99,
          child: Container(
            constraints: const BoxConstraints(maxWidth: 118),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
            decoration: BoxDecoration(
              color: courant ? K.brass : const Color(0xFF0B1828),
              borderRadius: BorderRadius.circular(99),
              border: Border.all(color: parle ? K.good : courant ? const Color(0xFFF6D488) : const Color(0x2EFFFFFF), width: 2),
              boxShadow: [
                if (parle) const BoxShadow(color: Color(0x733FBF7F), blurRadius: 14, spreadRadius: 2),
                if (courant) const BoxShadow(color: Color(0x59E2B04A), spreadRadius: 4),
                const BoxShadow(color: Color(0x66000000), blurRadius: 8, offset: Offset(0, 3)),
              ],
            ),
            child: ligne,
          ),
        ),
        if (chrono != null) Padding(padding: const EdgeInsets.only(top: 3), child: SizedBox(width: 80, child: chrono)),
        if (pastilles.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Wrap(alignment: moi ? WrapAlignment.start : WrapAlignment.center, spacing: 3, runSpacing: 3, children: pastilles)),
      ]);
    } else {
      contenu = _Battement(
        actif: courant && !moi,
        rayon: 8,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: courant ? const Color(0x29E2B04A) : moi ? const Color(0x17E2B04A) : const Color(0x2E000000),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: parle ? K.good : courant ? K.brass : K.line, width: courant || parle ? 2 : 1),
            boxShadow: parle ? const [BoxShadow(color: Color(0x733FBF7F), blurRadius: 14, spreadRadius: 2)] : null,
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            ligne,
            if (chrono != null) Padding(padding: const EdgeInsets.only(top: 2), child: chrono),
            if (pastilles.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Wrap(spacing: 3, runSpacing: 2, children: pastilles)),
          ]),
        ),
      );
    }
    return KeyedSubtree(
      key: app.cleSiege(id),
      child: Opacity(
        opacity: sorti ? .55 : 1,
        child: GestureDetector(onTap: !moi && !robot ? () => ficheJoueur(id, (j['nom'] ?? '').toString()) : null, child: contenu),
      ),
    );
  }
}

/// Le joueur dont c'est le tour : un halo laiton qui bat doucement (animation « battement » du site).
class _Battement extends StatefulWidget {
  final bool actif;
  final double rayon;
  final Widget child;
  const _Battement({required this.actif, required this.rayon, required this.child});
  @override
  State<_Battement> createState() => _BattementState();
}

class _BattementState extends State<_Battement> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));
  void _regler() {
    if (widget.actif && !app.sansAnim) {
      if (!_a.isAnimating) _a.repeat();
    } else {
      _a.stop();
      _a.value = 0;
    }
  }
  @override
  void initState() { super.initState(); _regler(); }
  @override
  void didUpdateWidget(_Battement old) { super.didUpdateWidget(old); _regler(); }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    if (!widget.actif) return widget.child;
    return AnimatedBuilder(
      animation: _a,
      builder: (_, child) {
        final f = math.sin(_a.value * math.pi); // 0 → 1 (à 50 %) → 0
        return DecoratedBox(
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(widget.rayon), boxShadow: [BoxShadow(color: const Color(0x38E2B04A), spreadRadius: 7 * Curves.easeInOut.transform(f))]),
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

// ---------------------------------------------------------------- le centre de la table
/// Puce du site (« .chip ») : filet, coins ronds, symbole un peu plus grand.
class _Chip extends StatelessWidget {
  final List<InlineSpan> morceaux;
  final Color? couleur;
  final VoidCallback? onTap;
  const _Chip(this.morceaux, {this.couleur, this.onTap});
  @override
  Widget build(BuildContext context) {
    final w = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), border: Border.all(color: couleur ?? K.line)),
      child: Text.rich(TextSpan(style: K.texte(13, couleur: couleur ?? K.ink), children: morceaux)),
    );
    return onTap == null ? w : GestureDetector(onTap: onTap, child: w);
  }
}

TextSpan _gras(String t, {Color? couleur}) => TextSpan(text: t, style: TextStyle(fontSize: 17, height: 1, fontWeight: FontWeight.w700, color: couleur));

class _CentreTable extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool inter;
  final bool jeJoue;
  final bool paysage;
  final bool petit;
  const _CentreTable(this.v, this.m, this.inter, this.jeJoue, {required this.paysage, required this.petit});

  @override
  Widget build(BuildContext context) {
    final pause = m['pause'] as Map?;
    final cahier = cahierDe(v);
    String qui(Object? id) => id == v['moi'] ? 'Toi' : app.nomDe(v, id);
    final puces = <Widget>[];
    if (!inter) {
      if (pause == null && m['couleurTour'] != null) {
        puces.add(_Chip([const TextSpan(text: 'Couleur du tour '), _gras(KopoCartes.symboles[m['couleurTour']] ?? '')]));
      }
      if (pause == null && m['couleurInterdite'] != null && m['phase'] == 'ouverture') {
        puces.add(_Chip([const TextSpan(text: 'Interdit pour ouvrir '), TextSpan(text: KopoCartes.symboles[m['couleurInterdite']], style: const TextStyle(fontSize: 17, height: 1, fontWeight: FontWeight.w700, decoration: TextDecoration.lineThrough))], couleur: K.bad));
      }
    } else if (pause == null && m['phase'] == 'jeu') {
      final demande = m['demande'] as Map?;
      if (demande != null) {
        puces.add(_Chip([const TextSpan(text: 'Demande '), _gras(InterCartes.nomValeur(demande['valeur'].toString())), TextSpan(text: ' · ${qui(demande['par'])}')], couleur: K.brass));
      } else if (m['libre'] == true) {
        puces.add(_Chip(const [TextSpan(text: 'Jeu libre : pose la carte de ton choix')]));
      }
      if (m['piochable'] == 0) puces.add(_Chip(const [TextSpan(text: 'Pioche vide : qui ne peut pas jouer passe')], couleur: K.bad));
      if (v['mode'] == 'delire' && v['jRetour'] == true && (m['enJeu'] as List).length > 2) puces.add(_Chip([const TextSpan(text: 'Sens '), _gras(m['sens'] == 1 ? '↻' : '↺')]));
    }
    // Mode Cahier : le cahier s'ouvre à tout moment depuis la table.
    if (cahier != null) {
      puces.add(_Chip([const TextSpan(text: 'Cahier · '), _gras('${(cahier['scores'] as Map)[v['moi']] ?? '–'}'), TextSpan(text: ' / ${cahier['total']}')], couleur: K.brass, onTap: () => ouvrirCahier(v)));
    }

    final consigne = _consigne();
    final aide = v['robots'] == 'gentils' ? (inter ? aideGuideeInter(v) : aideGuidee(v)) : null;
    final monTour = m['joueurCourant'] == v['moi'];
    final barre = (v['chrono'] != null && monTour) || pause != null;
    final restants = v['restants'] as List;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: paysage ? CrossAxisAlignment.center : CrossAxisAlignment.stretch, children: [
      if (puces.isNotEmpty) ...[
        Wrap(alignment: paysage ? WrapAlignment.center : WrapAlignment.start, spacing: 8, runSpacing: 6, children: puces),
        SizedBox(height: paysage ? 6 : 8),
      ],
      if (pause?['type'] == 'depart') _Depart(v, m, paysage: paysage)
      else if (inter) _CentreInter(v, m, paysage: paysage, petit: petit)
      else _PosesKopo(v, m, paysage: paysage, petit: petit),
      if (consigne.isNotEmpty || aide != null) ...[
        SizedBox(height: paysage ? 6 : 8),
        if (consigne.isNotEmpty)
          Text.rich(
            TextSpan(style: K.texte(paysage ? 15 : 16, poids: FontWeight.w500).copyWith(shadows: paysage ? const [Shadow(color: Color(0xB3000000), blurRadius: 3, offset: Offset(0, 1))] : null), children: consigne),
            textAlign: paysage ? TextAlign.center : TextAlign.start,
          ),
        if (aide != null) Padding(padding: EdgeInsets.only(top: consigne.isEmpty ? 0 : 6), child: _AideGuidee(aide)),
      ],
      if (v['entreRobots'] == true)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Center(child: Btn(restants.contains(v['moi']) ? 'Passer à la fin de la manche' : 'Passer à la fin', taille: 14, marge: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), onTap: () => app.envoyer({'type': 'passerFin'}))),
        ),
      if (barre) ...[
        SizedBox(height: paysage ? 6 : 8),
        FractionallySizedBox(
          widthFactor: paysage ? .6 : 1,
          child: Horloge(builder: (_) => Barre(app.resteChrono / math.max(1, app.totalChrono), hauteur: 4, couleur: pause != null ? K.muted : app.resteChrono < 2000 ? K.bad : K.brass)),
        ),
      ],
    ]);
  }

  /// Ce que tu dois faire (ce qui se passe est montré par les animations).
  List<InlineSpan> _consigne() {
    final pause = m['pause'] as Map?;
    final restants = v['restants'] as List;
    final jeJoue = (m['enJeu'] as List).contains(v['moi']);
    final phaseJeu = inter ? m['phase'] == 'jeu' : m['phase'] != 'terminee';
    final monTour = m['joueurCourant'] == v['moi'];
    final actions = (m['actions'] as List).cast<Map>();
    WidgetSpan oeil() => const WidgetSpan(alignment: PlaceholderAlignment.middle, child: Ico('oeil', taille: 18));
    final c = <InlineSpan>[];
    if (v['entreRobots'] == true) {
      c.addAll([oeil(), TextSpan(text: restants.contains(v['moi']) ? ' Les robots finissent la manche entre eux, en accéléré.' : ' Les robots finissent entre eux, en accéléré.')]);
    } else if (pause != null || !phaseJeu) {
    } else if (!restants.contains(v['moi']) || !jeJoue) {
      c.addAll([oeil(), const TextSpan(text: ' Tu regardes la partie.')]);
    } else if (monTour) {
      if (v['chrono'] != null) {
        c.add(WidgetSpan(alignment: PlaceholderAlignment.baseline, baseline: TextBaseline.alphabetic, child: Horloge(builder: (_) {
          _sonsChrono(v);
          final r = app.resteChrono;
          return Text('${(r / 1000).ceil()} s ', style: K.texte(paysage ? 15 : 16, couleur: r < 2000 ? K.bad : K.brass, poids: FontWeight.w700).copyWith(fontFeatures: const [FontFeature.tabularFigures()]));
        })));
      }
      c.add(const TextSpan(text: 'À toi !', style: TextStyle(color: K.brass)));
      if (inter && !actions.any((a) => a['type'] == 'jouer')) c.add(TextSpan(text: m['aPioche'] == true ? ' Tu ne peux pas jouer la carte piochée : passe.' : ' Aucune carte ne va : pioche.'));
    }
    return c;
  }
}

/// Bulle crème de la partie guidée (« .aide-guidee » du site), avec sa pointe.
class _AideGuidee extends StatelessWidget {
  final List<String> morceaux;
  const _AideGuidee(this.morceaux);
  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: const Color(0xFFFBF3DC), borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 18, offset: Offset(0, 6))]),
              child: Text.rich(TextSpan(style: K.texte(14, couleur: const Color(0xFF2A1F08), poids: FontWeight.w600), children: [
                for (var i = 0; i < morceaux.length; i++) TextSpan(text: morceaux[i], style: i.isOdd ? const TextStyle(color: K.red, fontWeight: FontWeight.w700) : null),
              ])),
            ),
            CustomPaint(size: const Size(14, 7), painter: _Pointe()),
          ]),
        ),
      );
}

class _Pointe extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) => canvas.drawPath(Path()..moveTo(0, 0)..lineTo(s.width, 0)..lineTo(s.width / 2, s.height)..close(), Paint()..color = const Color(0xFFFBF3DC));
  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ---------------------------------------------------------------- départ (compte à rebours)
class _Depart extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool paysage;
  const _Depart(this.v, this.m, {required this.paysage});
  @override
  Widget build(BuildContext context) {
    final finale = (v['restants'] as List).length == 2;
    final qui = m['joueurCourant'] == v['moi'] ? 'Toi' : app.nomDe(v, m['joueurCourant']);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: paysage ? 0 : 6),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text((finale ? 'Finale' : 'Manche ${v['numeroManche']}').toUpperCase(), style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 2)),
        const SizedBox(height: 4),
        Horloge(builder: (_) {
          _sonsChrono(v);
          return Text('${math.max(1, (app.resteChrono / 1000).ceil())}', style: K.titre(paysage ? 52 : 72).copyWith(height: 1, letterSpacing: 0));
        }),
        const SizedBox(height: 4),
        Row(mainAxisSize: MainAxisSize.min, children: [Ico('depart', taille: paysage ? 17 : 20), const SizedBox(width: 6), Text(qui, style: K.texte(paysage ? 17 : 20, poids: FontWeight.w600))]),
        for (final r in ((m['redistributions'] as List?) ?? []).cast<Map>())
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 280),
              child: Text(
                'Cartes redistribuées : la plus forte carte de ${r['joueur'] == v['moi'] ? 'ta main' : app.nomDe(v, r['joueur'])} était un 4 (${(r['main'] as List).map((c) => KopoCartes.afficher(c as String)).join(' ')}).',
                textAlign: TextAlign.center,
                style: K.texte(13, couleur: K.muted),
              ),
            ),
          ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- Kopo : les cartes posées
class _PosesKopo extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool paysage;
  final bool petit;
  const _PosesKopo(this.v, this.m, {required this.paysage, required this.petit});
  @override
  Widget build(BuildContext context) {
    final pause = m['pause'] as Map?;
    final table = (m['table'] as List).cast<Map>();
    ({String carte, int i})? forte;
    for (var i = 0; i < table.length; i++) {
      if (table[i]['compte'] != true) continue;
      for (final c in (table[i]['cartes'] as List).cast<String>()) {
        if (forte == null || KopoCartes.valeur(c) > KopoCartes.valeur(forte.carte)) forte = (carte: c, i: i);
      }
    }
    final serre = table.length > 4;
    // Tailles du site : 54 × 78, 42 × 60 quand la table est serrée, 46 × 66 sur un téléphone couché.
    final l = serre ? 42.0 : paysage && petit ? 46.0 : 54.0;
    final chevauche = serre ? 28.0 : paysage && petit ? 30.0 : 34.0;
    final an = pause?['annonce'] as Map?;
    if (table.isEmpty) return SizedBox(height: pause?['type'] == 'depart' ? 0 : (paysage ? 0 : 84));
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: paysage ? 0 : (serre ? 80 : 84)),
      child: Wrap(
        alignment: paysage ? WrapAlignment.center : WrapAlignment.start,
        crossAxisAlignment: WrapCrossAlignment.end,
        spacing: serre ? 6 : 10,
        runSpacing: 6,
        children: [
          for (var i = 0; i < table.length; i++)
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: math.max(serre ? 70 : 90, l + (((table[i]['cartes'] as List).length) - 1) * (l - chevauche))),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  for (final (k, c) in (table[i]['cartes'] as List).cast<String>().indexed)
                    Transform.translate(
                      offset: Offset(-chevauche * k, 0),
                      child: Opacity(
                        opacity: table[i]['compte'] == true ? 1 : .45,
                        child: CarteVue(c, l: l, forte: (forte != null && forte.i == i) || (an != null && an['type'] != 'ramasse' && an['carte'] == c), pale: an != null && an['type'] == 'ramasse' && an['carte'] == c),
                      ),
                    ),
                ]),
                const SizedBox(height: 3),
                Text(
                  (table[i]['joueur'] == v['moi'] ? 'Toi' : app.nomDe(v, table[i]['joueur'])) + (table[i]['compte'] == true ? '' : ' · sort'),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: K.texte(12, couleur: table[i]['compte'] == true ? K.muted : K.bad),
                ),
              ]),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- Inter (8) : la carte du centre et la pioche
class _CentreInter extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool paysage;
  final bool petit;
  const _CentreInter(this.v, this.m, {required this.paysage, required this.petit});
  @override
  Widget build(BuildContext context) {
    final pause = m['pause'] as Map?;
    String qui(Object? id) => id == v['moi'] ? 'Toi' : app.nomDe(v, id);
    final jeu = pause == null && m['phase'] == 'jeu';
    final demande = m['demande'] as Map?;
    final roue = v['mode'] == 'delire' && v['jRetour'] == true && (m['enJeu'] as List).length > 2;
    final l = paysage && petit ? 54.0 : 66.0;
    final lp = paysage && petit ? 34.0 : 40.0;
    final vide = m['piochable'] == 0;
    Widget consigneCentre(String t, {bool plein = false}) => Container(
          margin: const EdgeInsets.only(top: 4),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
          decoration: BoxDecoration(color: plein ? K.brass : null, borderRadius: BorderRadius.circular(999), border: Border.all(color: K.brass)),
          child: Text(t, style: K.texte(12, couleur: plein ? K.encre : K.brass, poids: FontWeight.w600)),
        );
    return SizedBox(
      width: double.infinity,
      child: ConstrainedBox(
        constraints: BoxConstraints(minHeight: paysage && petit ? 96 : 128),
        child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
          if (roue) Positioned.fill(child: Center(child: Transform.translate(offset: const Offset(0, -12), child: _RoueSens(m['sens'] == 1, taille: paysage && petit ? 124 : 150)))),
          Column(mainAxisSize: MainAxisSize.min, children: [
            if (m['reference'] != null) CarteVue(m['reference'] as String, inter: true, l: l) else SizedBox(width: l, height: l * 78 / 54),
            const SizedBox(height: 4),
            Text(m['dernier'] != null ? 'Posée par ${qui(m['dernier'])}' : 'Au centre', style: K.texte(12, couleur: K.muted)),
            if (jeu && demande != null) consigneCentre('Demande ${InterCartes.nomValeur(demande['valeur'].toString())}', plein: true)
            else if (jeu && m['libre'] == true) consigneCentre('Jeu libre'),
          ]),
          // La pioche, dans un coin.
          Positioned(
            right: 4, top: 0,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Opacity(opacity: vide ? .35 : 1, child: DosCarte(l: lp, h: lp * 58 / 40)),
              const SizedBox(height: 2),
              Text(vide ? 'Vide' : '${m['pioche']}', style: K.texte(12, couleur: vide ? K.bad : K.ink, poids: FontWeight.w700)),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Deux flèches en cercle qui tournent dans le sens du jeu (↻ : sens des aiguilles d'une montre), derrière la carte du centre.
class _RoueSens extends StatefulWidget {
  final bool horaire;
  final double taille;
  const _RoueSens(this.horaire, {required this.taille});
  @override
  State<_RoueSens> createState() => _RoueSensState();
}

class _RoueSensState extends State<_RoueSens> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(seconds: 9));
  @override
  void initState() {
    super.initState();
    if (!app.sansAnim) _a.repeat();
  }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    const fleche = '<path d="M50 6 A44 44 0 0 1 91 36" fill="none" stroke="#e2b04a" stroke-width="5" stroke-linecap="round"/><path d="M95 27 L92 41 L80 33 Z" fill="#e2b04a"/>';
    const deux = '<g>$fleche</g><g transform="rotate(180 50 50)">$fleche</g>';
    final svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${widget.horaire ? deux : '<g transform="scale(-1 1) translate(-100 0)">$deux</g>'}</svg>';
    return IgnorePointer(
      child: Opacity(
        opacity: .55,
        child: AnimatedBuilder(
          animation: _a,
          builder: (_, child) => Transform.rotate(angle: _a.value * 2 * math.pi * (widget.horaire ? 1 : -1), child: child),
          child: SvgPicture.string(svg, width: widget.taille, height: widget.taille),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- horloge (chrono, compte à rebours)
/// Se redessine 10 fois par seconde tant qu'un chrono tourne.
class Horloge extends StatefulWidget {
  final WidgetBuilder builder;
  const Horloge({super.key, required this.builder});
  @override
  State<Horloge> createState() => _HorlogeState();
}

class _HorlogeState extends State<Horloge> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(milliseconds: 100), (_) { if (mounted && app.finChrono != null) setState(() {}); });
  }
  @override
  void dispose() { _t?.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) => widget.builder(context);
}

int? _dernierDecompte, _dernierTic;
/// Sons du chrono : décompte de départ et tic des 3 dernières secondes.
void _sonsChrono(Vue v) {
  final m = v['manche'] as Map?;
  final reste = app.resteChrono;
  if (m?['pause'] is Map && (m!['pause'] as Map)['type'] == 'depart') {
    final s = math.max(1, (reste / 1000).ceil());
    if (s != _dernierDecompte) { _dernierDecompte = s; Sons.jouer('decompte'); }
  } else {
    _dernierDecompte = null;
  }
  final sec = (reste / 1000).ceil();
  if (v['chrono'] != null && m != null && m['pause'] == null && m['joueurCourant'] == v['moi'] && sec <= 3 && sec > 0 && sec != _dernierTic) Sons.jouer('tic');
  _dernierTic = sec;
}


// ---------------------------------------------------------------- ta main, KATAPSS et les boutons
/// Un bouton de la zone KATAPSS : « KATAPSS ! », « J'ANNONCE ! » ou « CONTESTER … ».
class _Rond {
  final String texte;
  final VoidCallback? onTap;
  final bool contester;
  const _Rond(this.texte, this.onTap, {this.contester = false});
}

/// Ce qui va sous la table : la zone KATAPSS, ta main et les boutons d'action (logique du site, afficherPartie).
class _Bas {
  final Vue v;
  final Map m;
  final bool inter;
  final bool jeJoue;
  final bool paysage;
  late final List<_Rond> ronds = [];
  late final List<Btn> _boutons = [];
  late final List<Widget> notes = [];
  late final List<String> cartes;
  late final _EtatCarte Function(String) etat;
  late final ValueChanged<String> onTap;
  late final String titre;

  _Bas(this.v, this.m, this.inter, this.jeJoue, {required this.paysage}) {
    final actions = (m['actions'] as List).cast<Map>();
    final monTour = m['joueurCourant'] == v['moi'];
    inter ? _inter(actions, monTour) : _kopo(actions, monTour);
  }

  void _kopo(List<Map> actions, bool monTour) {
    final main = (m['main'] as List).cast<String>();
    final jouables = {for (final a in actions) if (a['type'] == 'jouer') a['carte'] as String};
    if (app.carteChoisie != null && !jouables.contains(app.carteChoisie)) app.carteChoisie = null;
    final choisie = app.carteChoisie;
    final table = (m['table'] as List).cast<Map>();
    String? forte;
    for (final p in table) {
      if (p['compte'] != true) continue;
      for (final c in (p['cartes'] as List).cast<String>()) { if (forte == null || KopoCartes.valeur(c) > KopoCartes.valeur(forte)) forte = c; }
    }
    final toutPoser = actions.any((a) => a['type'] == 'toutPoser');
    final n = main.length;
    final s = n > 1 ? 's' : '';
    if (actions.any((a) => a['type'] == 'katapss')) ronds.add(_Rond('KATAPSS !', () => app.action({'type': 'katapss'})));
    titre = 'Ta main ($n carte$s)${jouables.isNotEmpty ? ' · touche une carte' : ''}';
    cartes = KopoCartes.trier(main, app.prefs['tri'] as String? ?? 'couleur');
    etat = (c) => jouables.contains(c) ? (c == choisie ? _EtatCarte.choisie : _EtatCarte.jouable) : monTour ? _EtatCarte.grisee : _EtatCarte.normale;
    onTap = (c) {
      if (!jouables.contains(c)) return;
      if (app.carteChoisie == c) { app.carteChoisie = null; app.action({'type': 'jouer', 'carte': c}); }
      else { app.carteChoisie = c; }
      app.maj();
    };
    if (choisie != null) _boutons.add(Btn.principal('Jouer le ${KopoCartes.afficher(choisie)}', large: true, onTap: () { app.carteChoisie = null; app.action({'type': 'jouer', 'carte': choisie}); }));
    if (toutPoser) {
      _boutons.add(Btn('Tout poser ($n carte$s) et sortir', style: jouables.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () {
        void poser() => app.action({'type': 'toutPoser'});
        app.prefs['confirmerToutPoser'] == true ? demanderConfirmation('Tu poses tes $n carte$s et tu sors de la manche.', poser, titre: 'Tout poser ?', oui: 'Oui, tout poser') : poser();
      }));
    }
    if (actions.any((a) => a['type'] == 'ramasser') && forte != null) {
      final bluff = jouables.isNotEmpty || toutPoser;
      _boutons.add(Btn('Ramasser le ${KopoCartes.afficher(forte)}${bluff ? ' (bluff)' : ''}', style: bluff ? StyleBtn.normal : StyleBtn.principal, large: true, onTap: () => app.action({'type': 'ramasser'})));
    }
  }

  void _inter(List<Map> actions, bool monTour) {
    final main = (m['main'] as List).cast<String>();
    final coups = actions.where((a) => a['type'] == 'jouer').toList();
    bool contient(Map a, String c) => (a['cartes'] as List).contains(c);
    bool ajoutable(List<String> choix, String c) => coups.any((a) => contient(a, c) && choix.every((x) => contient(a, x)));
    var choix = app.choixInter.where(main.contains).toList();
    if (coups.isEmpty || (choix.isNotEmpty && !coups.any((a) => choix.every((x) => contient(a, x))))) choix = [];
    app.choixInter = choix;
    final choisis = choix.isEmpty ? <Map>[] : coups.where((a) => (a['cartes'] as List).length == choix.length && choix.every((c) => contient(a, c))).toList();
    final encore = choix.isEmpty ? <String>[] : main.where((c) => !choix.contains(c) && ajoutable(choix, c)).toList();
    final n = main.length;
    void changer(List<String> l) { app.choixInter = l; app.maj(); }

    // J'annonce et Contester : possibles à tout moment, même hors de son tour.
    if (actions.any((a) => a['type'] == 'annoncer')) ronds.add(_Rond("J'ANNONCE !", () => app.action({'type': 'annoncer'})));
    for (final a in actions.where((a) => a['type'] == 'contester')) {
      ronds.add(_Rond('CONTESTER ${app.nomDe(v, a['cible']).toUpperCase()}', () => app.action({'type': 'contester', 'cible': a['cible']}), contester: true));
    }
    // Les 3 premières secondes sont pour lui : il peut encore toucher « J'annonce ».
    if (jeJoue) {
      for (final id in ((m['enGrace'] as List?) ?? []).where((id) => id != v['moi'])) {
        ronds.add(_Rond('CONTESTER ${app.nomDe(v, id).toUpperCase()} (dans 3 s)', null, contester: true));
      }
    }
    titre = 'Ta main ($n carte${n > 1 ? 's' : ''})${coups.isNotEmpty && choix.isEmpty ? ' · touche une carte' : ''}';
    cartes = InterCartes.trier(main);
    etat = (c) => choix.contains(c)
        ? _EtatCarte.choisie
        : (ajoutable(choix, c) || (choix.isNotEmpty && ajoutable(const [], c))) ? _EtatCarte.jouable : monTour ? _EtatCarte.grisee : _EtatCarte.normale;
    onTap = (c) {
      final k = choix.indexOf(c);
      if (k >= 0) {
        if (choix.length == 1 && choisis.isNotEmpty && encore.isEmpty) { poserInter(choisis); return; }
        changer([...choix]..removeAt(k));
      } else if (ajoutable(choix, c)) {
        changer([...choix, c]);
      } else if (choix.isNotEmpty && ajoutable(const [], c)) {
        changer([c]);
      }
    };
    if (encore.isNotEmpty) {
      final plusGrand = coups.where((a) => choix.every((x) => contient(a, x))).reduce((g, a) => (a['cartes'] as List).length > (g['cartes'] as List).length ? a : g);
      _boutons.add(Btn('Prendre les ${(plusGrand['cartes'] as List).length} cartes (${InterCartes.nomValeur(InterCartes.valeur(choix[0]))})', style: choisis.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () => changer((plusGrand['cartes'] as List).cast<String>().toList())));
    }
    if (choisis.isNotEmpty) {
      final val = InterCartes.valeur(choix[0]);
      _boutons.add(Btn.principal(choix.length == 1 ? 'Poser le ${InterCartes.afficher(choix[0])}' : 'Poser ${choix.length} cartes (${InterCartes.nomValeur(val)})', large: true, onTap: () => poserInter(choisis)));
      _boutons.add(Btn('Reprendre ${choix.length > 1 ? 'les cartes' : 'la carte'}', large: true, onTap: () => changer([])));
      if (choix.length > 1 && val != '8' && val != 'X') {
        final nbCouleurs = {for (final a in choisis) InterCartes.couleur(((a['cartes'] as List).last) as String)}.length;
        notes.add(Muet(nbCouleurs > 1 ? 'Tu choisiras la nouvelle couleur.' : 'Plusieurs cartes : la couleur change toute seule.', align: TextAlign.center, taille: 12));
      }
    } else if (choix.isNotEmpty) {
      _boutons.add(Btn('Reprendre les cartes', large: true, onTap: () => changer([])));
    }
    // Bluff : on peut piocher même avec une carte jouable, pour se donner une chance.
    if (actions.any((a) => a['type'] == 'piocher')) {
      _boutons.add(Btn(m['piochable'] == 0 ? 'Plus de cartes : passer mon tour' : coups.isNotEmpty ? 'Piocher une carte (bluff)' : 'Piocher une carte',
          style: coups.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () => app.action({'type': 'piocher'})));
    }
    if (actions.any((a) => a['type'] == 'passer')) _boutons.add(Btn('Passer', style: coups.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () { app.choixInter = []; app.action({'type': 'passer'}); }));
  }

  /// Ta main (cartes placées comme sur le site : une rangée, ou plusieurs qui se chevauchent).
  Widget main(BuildContext context, {required bool paysage, bool petit = false, required double hMax}) =>
      _Main(cartes: cartes, inter: inter, paysage: paysage, petit: petit, hMax: hMax, etat: etat, onTap: onTap);

  /// Paysage : la colonne des boutons (en bas à droite), arrondis et ombrés comme sur le site.
  List<Widget> boutons({required bool paysage}) => [
        for (final (i, b) in _boutons.indexed)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : 6),
            child: DecoratedBox(
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 12, offset: Offset(0, 4))]),
              child: b.copie(rayon: 14, taille: 15, marge: const EdgeInsets.symmetric(horizontal: 8, vertical: 10)),
            ),
          ),
        if (notes.isNotEmpty) ...[const SizedBox(height: 4), ...notes],
      ];

  /// Paysage : KATAPSS (ou J'annonce, Contester) en rond, au milieu à droite ; sur un écran bas, ou avec
  /// plusieurs boutons, les ronds rapetissent juste au-dessus des boutons, sur 1 ou 2 colonnes (placerKatapss du site).
  Widget zoneRonde(double place, double centre, {required bool petit}) {
    final n = ronds.length;
    if (n == 0) return const SizedBox();
    final base = petit ? 96.0 : 112.0;
    const ecart = 8.0;
    // Au milieu de l'écran si tout tient, sinon juste au-dessus des boutons.
    final haut = n * base + (n - 1) * ecart;
    if (n == 1 && centre - base / 2 >= 0 && centre + base / 2 <= place - ecart) {
      return Stack(children: [Positioned(top: centre - base / 2, left: 0, right: 0, child: Center(child: _GrosBouton(ronds[0], rond: true, taille: base)))]);
    }
    if (haut <= place - ecart && centre + haut / 2 <= place - ecart && centre - haut / 2 >= 0) {
      return Stack(children: [
        Positioned(
          top: centre - haut / 2, left: 0, right: 0,
          child: Column(children: [for (final (i, r) in ronds.indexed) Padding(padding: EdgeInsets.only(top: i == 0 ? 0 : ecart), child: _GrosBouton(r, rond: true, taille: base))]),
        ),
      ]);
    }
    var kt = 0.0, kc = 1;
    for (final c in [1, 2]) {
      final rangs = (n / c).ceil();
      final t = math.min(base, math.min((place - ecart - (rangs - 1) * ecart) / rangs, (150 - (c - 1) * ecart) / c)).floorToDouble();
      if (t > kt + 4) { kt = t; kc = c; }
    }
    kt = math.max(56, kt);
    return Align(
      alignment: Alignment.bottomCenter,
      child: Padding(
        padding: const EdgeInsets.only(bottom: ecart),
        child: Wrap(alignment: WrapAlignment.center, spacing: ecart, runSpacing: ecart, children: [
          for (final r in ronds) SizedBox(width: kc == 2 ? kt : 150, child: Center(child: _GrosBouton(r, rond: true, taille: kt))),
        ]),
      ),
    );
  }

  /// Portrait : la zone « Ta main » (KATAPSS en long, le titre, la main, les boutons en grille).
  Widget zonePortrait(BuildContext context, {required double hMax}) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        for (final r in ronds) Padding(padding: const EdgeInsets.only(bottom: 8), child: _GrosBouton(r, rond: false)),
        Text(titre, style: K.texte(13, couleur: K.muted, poids: FontWeight.w600)),
        // La main garde 12 px au-dessus d'elle pour la carte choisie, qui se lève.
        main(context, paysage: false, hMax: hMax),
        if (_boutons.isNotEmpty) ...[
          const SizedBox(height: 8),
          LayoutBuilder(builder: (context, c) {
            // Grille du site : repeat(auto-fit, minmax(130px, 1fr)), 8 px entre les boutons.
            final cols = math.max(1, math.min(_boutons.length, ((c.maxWidth + 8) / 138).floor()));
            final lignes = <Widget>[];
            for (var i = 0; i < _boutons.length; i += cols) {
              if (i > 0) lignes.add(const SizedBox(height: 8));
              lignes.add(IntrinsicHeight(
                child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  for (var k = 0; k < cols; k++) ...[
                    if (k > 0) const SizedBox(width: 8),
                    Expanded(child: i + k < _boutons.length ? _boutons[i + k].copie(taille: 16, marge: const EdgeInsets.symmetric(horizontal: 8, vertical: 13)) : const SizedBox()),
                  ],
                ]),
              ));
            }
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: lignes);
          }),
        ],
        if (notes.isNotEmpty) ...[const SizedBox(height: 6), ...notes],
      ]);
}

/// « KATAPSS ! », « J'ANNONCE ! », « CONTESTER … » : en long (portrait) ou en rond (paysage), qui pulse.
class _GrosBouton extends StatefulWidget {
  final _Rond r;
  final bool rond;
  final double taille;
  const _GrosBouton(this.r, {required this.rond, this.taille = 112});
  @override
  State<_GrosBouton> createState() => _GrosBoutonState();
}

class _GrosBoutonState extends State<_GrosBouton> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));
  @override
  void initState() {
    super.initState();
    if (!app.sansAnim) _a.repeat();
  }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    final fond = r.contester ? K.brass : K.red;
    final encre = r.contester ? K.encre : Colors.white;
    final inter = r.texte != 'KATAPSS !';
    final t = widget.taille;
    void toucher() { app.vibrer(80); r.onTap!(); }
    final Widget bouton;
    if (widget.rond) {
      // Rond rouge en relief (bord rosé, ombre portée sous le bouton).
      final police = inter ? (t >= 96 ? 18.0 : t * .16) : (t >= 112 ? 24.0 : t >= 96 ? 21.0 : t * .21);
      bouton = Container(
        width: t, height: t,
        decoration: BoxDecoration(
          color: fond,
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0xFFFF8F86), width: t < 96 ? 3 : 4),
          boxShadow: [
            BoxShadow(color: const Color(0xFF7D1D18), offset: Offset(0, t < 96 ? 5 : 8)),
            BoxShadow(color: const Color(0x80000000), blurRadius: t < 96 ? 16 : 24, offset: Offset(0, t < 96 ? 8 : 12)),
          ],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: r.onTap == null ? null : toucher,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Text(r.texte, textAlign: TextAlign.center, style: TextStyle(fontFamily: K.display, fontSize: police, letterSpacing: inter ? 0 : 1, height: 1, color: encre)),
              ),
            ),
          ),
        ),
      );
    } else {
      bouton = Material(
        color: fond,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: fond)),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: r.onTap == null ? null : toucher,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
            child: Text(r.texte, textAlign: TextAlign.center, style: TextStyle(fontFamily: K.display, fontSize: r.contester ? 22 : 30, letterSpacing: 2, height: 1.4, color: encre)),
          ),
        ),
      );
    }
    final anime = AnimatedBuilder(
      animation: _a,
      builder: (_, child) {
        final f = math.sin(_a.value * math.pi);
        return DecoratedBox(
          decoration: BoxDecoration(
            shape: widget.rond ? BoxShape.circle : BoxShape.rectangle,
            borderRadius: widget.rond ? null : BorderRadius.circular(10),
            boxShadow: [BoxShadow(color: const Color(0x40C7362F), spreadRadius: 8 * Curves.easeInOut.transform(f))],
          ),
          child: child,
        );
      },
      child: bouton,
    );
    return Opacity(opacity: r.onTap == null ? .35 : 1, child: r.contester ? bouton : anime);
  }
}

enum _EtatCarte { normale, jouable, choisie, grisee }

/// Ta main, placée comme sur le site (ajusterMain) : une rangée si elle tient, sinon des cartes qui se chevauchent
/// en gardant le coin (« 10♥ ») lisible, puis plusieurs rangées (4 en portrait, 3 en paysage) qui se chevauchent aussi.
/// En paysage, une seule rangée s'ouvre en éventail (légère rotation et arc). La carte choisie se lève.
class _Main extends StatelessWidget {
  final List<String> cartes;
  final bool inter;
  final bool paysage;
  final bool petit;
  final double hMax;
  final _EtatCarte Function(String) etat;
  final ValueChanged<String> onTap;
  const _Main({required this.cartes, required this.inter, required this.paysage, this.petit = false, required this.hMax, required this.etat, required this.onTap});

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final n = cartes.length;
        if (n == 0) return const SizedBox(height: 20);
        // Tailles du site : 66 × 96 ; 58 × 84 sur un téléphone couché (Inter : 52 × 76).
        final cw = paysage && petit ? (inter ? 52.0 : 58.0) : 66.0;
        final ch = cw * 96 / 66;
        const ecart = 6.0, padH = 12.0;
        final lisible = paysage ? 30.0 : 32.0;
        final maxRangs = paysage ? 3 : 4;
        final w = c.maxWidth;
        double pasPour(int parRang) => parRang < 2 ? cw + ecart : math.min(cw + ecart, (w - cw) / (parRang - 1));
        var rangs = 1;
        while (rangs < maxRangs && pasPour((n / rangs).ceil()) < lisible) { rangs++; }
        final parRang = (n / rangs).ceil();
        final pas = math.max(14.0, pasPour(parRang).floorToDouble());
        rangs = (n / parRang).ceil();
        final pasV = rangs < 2 ? 0.0 : math.max(30.0, math.min(ch + ecart, ((hMax - ch) / (rangs - 1)).floorToDouble()));
        final largeur = (math.min(n, parRang) - 1) * pas + cw;
        final x0 = paysage || rangs > 1 || n * (cw + ecart) - ecart > w ? math.max(0.0, ((w - largeur) / 2).roundToDouble()) : 0.0;
        final eventail = paysage && rangs == 1;
        return SizedBox(
          width: w,
          height: padH + (rangs - 1) * pasV + ch,
          child: Stack(clipBehavior: Clip.none, children: [
            for (var i = 0; i < n; i++)
              Builder(builder: (_) {
                final carte = cartes[i];
                final e = etat(carte);
                final recue = app.cartesRecues.contains(carte);
                final ec = i - (n - 1) / 2;
                final rot = eventail ? ec * math.min(2.5, 16 / n) : 0.0;
                final dy = (eventail ? ec * ec * math.min(1, 8 / n) : 0.0) - (e == _EtatCarte.choisie ? (paysage ? 22 : 12) : 0);
                return AnimatedPositioned(
                  key: ValueKey(carte),
                  duration: Duration(milliseconds: app.sansAnim ? 0 : 160),
                  left: x0 + (i % parRang) * pas,
                  top: padH + (i ~/ parRang) * pasV + dy,
                  child: GestureDetector(
                    onTap: () => onTap(carte),
                    child: Transform.rotate(
                      angle: rot * math.pi / 180,
                      alignment: const Alignment(0, 1.6), // transform-origin: 50% 130%
                      child: Container(
                        decoration: recue ? BoxDecoration(borderRadius: BorderRadius.circular(8), boxShadow: const [BoxShadow(color: Color(0xAA3FBF7F), blurRadius: 10, spreadRadius: 1)]) : null,
                        child: CarteVue(carte, inter: inter, l: cw, h: ch, choisie: e == _EtatCarte.choisie, grisee: e == _EtatCarte.grisee, ombreMain: paysage),
                      ),
                    ),
                  ),
                );
              }),
          ]),
        );
      });
}

// ---------------------------------------------------------------- partie guidée (robots gentils)
List<String>? aideGuidee(Vue v) {
  final m = v['manche'] as Map;
  final a = (m['actions'] as List).cast<Map>();
  String sym(Object? c) => KopoCartes.symboles[c] ?? '';
  final jouables = a.where((x) => x['type'] == 'jouer').toList();
  final tout = a.any((x) => x['type'] == 'toutPoser');
  final moiId = v['moi'];
  String nom(Object? id) => app.nomDe(v, id);
  final pause = m['pause'] as Map?;
  if (!(v['restants'] as List).contains(moiId)) return ['Éliminé : tu avais encore des cartes quand les autres étaient sortis. Regarde la fin, puis ', 'rejoue', ' !'];
  if (pause?['type'] == 'depart') return v['numeroManche'] == 1 ? ['Voici tes 4 cartes. Le but : ', 'te débarrasser de toutes', ' avant les autres.'] : ['Nouvelle manche : le dernier qui garde des cartes est ', 'éliminé', '.'];
  final an = pause?['annonce'] as Map?;
  if (an != null) {
    bool moi(Object? id) => id == moiId;
    List<String> relance(String verbe, String fin) => an['meneur'] != null ? [moi(an['meneur']) ? 'Tu ${verbe}s' : '${nom(an['meneur'])} $verbe', fin] : [];
    final carte = an['carte'] is String ? KopoCartes.afficher(an['carte'] as String) : '';
    if (an['type'] == 'ramasse') return ['${moi(an['joueur']) ? 'Tu as' : '${nom(an['joueur'])} a'} ramassé le $carte : le tour s\'arrête. ', ...relance('relance', ', dans une autre couleur.')];
    if (an['type'] == 'suivi') return ['Tout le monde a suivi : le $carte est la plus forte. Les cartes quittent la partie. ', ...relance('relance', ', dans une autre couleur.')];
    if (an['type'] == 'sortie') return ['${moi(an['joueur']) ? 'Tu as' : '${nom(an['joueur'])} a'} tout posé : qualifié ! ', ...relance('ouvre', moi(an['meneur']) ? ', avec la couleur de ton choix.' : ', avec la couleur de son choix.')];
  }
  if (pause != null || m['phase'] == 'terminee') return null;
  if (a.any((x) => x['type'] == 'katapss')) {
    return [KopoCartes.typeKatapss((m['main'] as List).cast<String>(), (m['sieges'] as List).length) == 'petite' ? 'Ta plus forte carte est un 4 : touche ' : '4 cartes de la même couleur : touche ', 'KATAPSS', ' pour te qualifier tout de suite !'];
  }
  if (!(m['enJeu'] as List).contains(moiId)) return ['Qualifié ! Le dernier qui garde des cartes sera ', 'éliminé', '.'];
  if (m['joueurCourant'] != moiId) return null;
  if (m['phase'] == 'ouverture') {
    if (tout && jouables.isEmpty) return ["Il ne te reste qu'une couleur : ", 'tout poser', ' te fait sortir.'];
    if (tout) return ['Une seule couleur en main : tu peux ', 'tout poser', " d'un coup et sortir."];
    return m['couleurInterdite'] != null
        ? ['Tu relances : joue une carte, mais ', 'pas de ${sym(m['couleurInterdite'])}', " (la couleur du tour d'avant)."]
        : ['Tu ouvres : pose une carte. Les autres devront ', 'suivre sa couleur', '.'];
  }
  if (tout) return ["Tu n'as plus que des ${sym(m['couleurTour'])} : ", 'tout poser', ' te fait sortir.'];
  if (jouables.isNotEmpty) return ['Suis la couleur : joue un ', sym(m['couleurTour']), '. Une carte de moins pour toi.'];
  return ['Pas de ${sym(m['couleurTour'])} en main : tu dois ', 'ramasser', ' la plus forte carte de la table.'];
}

// ---------------------------------------------------------------- partie guidée d'Inter (8)
List<String>? aideGuideeInter(Vue v) {
  final m = v['manche'] as Map;
  final a = ((m['actions'] as List?) ?? []).cast<Map>();
  final coups = a.where((x) => x['type'] == 'jouer').toList();
  final moiId = v['moi'];
  final main = ((m['main'] as List?) ?? []).cast<String>();
  final pause = m['pause'] as Map?;
  String val(Map x) => InterCartes.valeur((x['cartes'] as List).first as String);
  if (!(v['restants'] as List).contains(moiId)) return ['Éliminé : tu avais encore des cartes quand les autres étaient sortis. Regarde la fin, puis ', 'rejoue', ' !'];
  if (pause?['type'] == 'depart') return v['numeroManche'] == 1 ? ['Voici tes 4 cartes. Pose une carte de la ', 'même couleur ou de la même valeur', ' que celle du centre.'] : ['Nouvelle manche : le dernier qui garde des cartes est ', 'éliminé', '.'];
  if (pause != null || m['phase'] != 'jeu') return null;
  if (!(m['enJeu'] as List).contains(moiId)) return ['Qualifié ! Le dernier qui garde des cartes sera ', 'éliminé', '.'];
  if (a.any((x) => x['type'] == 'annoncer')) return ['Tu pourras finir au prochain coup : touche ', "J'annonce", ' tout de suite, sinon on peut te contester.'];
  final co = a.where((x) => x['type'] == 'contester').firstOrNull;
  if (co != null) return ['${app.nomDe(v, co['cible'])} peut finir sans avoir annoncé : touche ', 'Contester', ', il pioche une carte.'];
  if (m['joueurCourant'] != moiId) return null;
  final d = m['demande'] as Map?;
  final videPioche = m['piochable'] == 0;
  if (coups.any((x) => (x['cartes'] as List).length == main.length)) return ['Tu peux ', main.length > 1 ? 'poser toutes tes cartes' : 'poser ta dernière carte', ' et te qualifier.'];
  if (d != null) {
    final dv = d['valeur'] == 'X' ? 'un joker' : InterCartes.nomValeur(d['valeur'].toString());
    if (d['par'] == moiId) return ["Personne n'a posé $dv : la demande te revient, ", 'pose-le', '.'];
    if (coups.any((x) => val(x) == d['valeur'])) return ['Inter demande $dv : ', 'pose-le', ' pour arrêter la demande.'];
    if (coups.isEmpty) return ["Inter demande $dv et tu n'en as pas : ", videPioche ? 'passe ton tour' : 'pioche une carte', '.'];
    return ['Inter demande $dv : tu peux poser un ', '8 ou un joker', ', ou piocher une carte.'];
  }
  if (m['aPioche'] != null && coups.isNotEmpty) return ['La carte piochée va : ', 'pose-la', ', ou garde-la avec Passer.'];
  if (coups.isEmpty) return videPioche ? ['Plus rien à piocher : ', 'passe ton tour', '.'] : ['Aucune carte ne va : ', 'pioche', ' une carte.'];
  if (m['libre'] == true) return ['Jeu libre : pose ', 'la carte de ton choix', '.'];
  if (coups.any((x) => (x['cartes'] as List).length > 1)) return ['Tu peux poser ensemble tes cartes de ', 'même valeur', ' : touche-les une par une, puis Poser.'];
  if (coups.any((x) => ['2', '10', 'X', 'A'].contains(val(x)))) return ['Carte spéciale : le ', '2, le 10 et le joker', " font piocher le suivant, l'As lui fait passer son tour."];
  if (coups.any((x) => val(x) == '8')) return ['Le ', '8', ' se pose sur tout : tu demandes une valeur que tu as encore en main.'];
  return ['Pose une carte de la ', 'même couleur ou de la même valeur', ' que celle du centre.'];
}
