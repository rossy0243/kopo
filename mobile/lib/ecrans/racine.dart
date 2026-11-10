// La page : l'écran du moment, puis par-dessus la fenêtre ouverte, le fil du chat, le bandeau,
// les toasts et le calque des animations (bulles, tampons). Comme #voile, #toast, #calque sur le site.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/communes.dart';
import 'accueil.dart';
import 'partie.dart';
import 'salon.dart';

class Racine extends StatefulWidget {
  const Racine({super.key});
  @override
  State<Racine> createState() => _RacineState();
}

// Les écrans lisent directement « app » (comme le site lit son état global) et beaucoup sont « const » :
// à chaque changement, on redemande donc la construction de tout l'arbre (les états internes sont gardés).
class _RacineState extends State<Racine> {
  @override
  void initState() {
    super.initState();
    app.addListener(_maj);
  }

  @override
  void dispose() {
    app.removeListener(_maj);
    super.dispose();
  }

  void _maj() {
    if (!mounted) return;
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      SchedulerBinding.instance.addPostFrameCallback((_) => _maj());
      return;
    }
    void tout(Element e) {
      e.markNeedsBuild();
      e.visitChildren(tout);
    }
    (context as Element).markNeedsBuild();
    context.visitChildElements(tout);
  }

  @override
  Widget build(BuildContext context) {
    return Builder(
      builder: (context) {
        final enJeu = app.ecran == 'partie' || app.ecran == 'salon';
        return PopScope(
          canPop: false,
          onPopInvokedWithResult: (pop, _) => _retour(),
          child: Scaffold(
            backgroundColor: K.table,
            resizeToAvoidBottomInset: true,
            body: Container(
              decoration: K.fond,
              child: Stack(children: [
                Positioned.fill(child: _ecran()),
                if (enJeu && app.filChat.isNotEmpty) const FilChat(),
                if (app.fenetre != null) ...[
                  const Positioned.fill(child: ColoredBox(color: Color(0x9E060E18))),
                  Positioned.fill(child: SafeArea(child: Builder(builder: app.fenetre!))),
                ],
                const Positioned.fill(child: IgnorePointer(child: CalqueEffets())),
                if (app.bandeau != null)
                  Positioned(top: MediaQuery.of(context).padding.top + 8, left: 0, right: 0, child: Center(child: _Bandeau(app.bandeau!))),
                if (app.toastTexte != null)
                  Positioned(bottom: MediaQuery.of(context).padding.bottom + 24, left: 16, right: 16, child: Center(child: _Toast(app.toastTexte!))),
                if (app.annonceOuverte && app.maintenance == null) const Positioned.fill(child: _Annonce()),
                if (app.maintenance != null) const Positioned.fill(child: _Maintenance()),
                if (app.miseAJourStore != null) const Positioned.fill(child: _MiseAJour()),
              ]),
            ),
          ),
        );
      },
    );
  }

  void _retour() {
    if (app.fenetre != null) {
      if (app.fenetreType == 'recap') return;
      app.fermerFenetre();
      return;
    }
    if (app.ecran == 'partie' || app.ecran == 'salon' || app.ecran == 'connexion') demanderQuitter();
  }

  Widget _ecran() {
    switch (app.ecran) {
      case 'splash':
        return const Splash();
      case 'bienvenue':
        return const Bienvenue();
      case 'connexion':
        return const Connexion();
      case 'salon':
        return app.vue == null ? const Connexion() : const Salon();
      case 'partie':
        return app.vue == null ? const Connexion() : const Partie();
      default:
        return const Accueil();
    }
  }
}

class _Bandeau extends StatelessWidget {
  final String t;
  const _Bandeau(this.t);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(color: const Color(0xEB0B1828), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.brass)),
        child: Text(t, style: K.texte(14, poids: FontWeight.w600)),
      );
}

class _Toast extends StatelessWidget {
  final String t;
  const _Toast(this.t);
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.transparent,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 480),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          decoration: BoxDecoration(color: const Color(0xF20B1828), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line), boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 18, offset: Offset(0, 6))]),
          child: Text(t, textAlign: TextAlign.center, style: K.texte(14.5)),
        ),
      );
}

// ------------------------------------------------------------------ écran de démarrage
class Splash extends StatefulWidget {
  const Splash({super.key});
  @override
  State<Splash> createState() => _SplashState();
}

class _SplashState extends State<Splash> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat();
  double _affiche = 0;
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () { if (app.splashAttente) app.finirSplash(true); },
      child: Container(
        decoration: const BoxDecoration(gradient: RadialGradient(center: Alignment(0, -0.1), radius: 1.1, colors: [K.table2, Color(0xFF08131F)])),
        child: Center(
          child: AnimatedBuilder(
            animation: _a,
            builder: (context, _) {
              final vise = app.splash;
              if (_affiche < vise) _affiche = math.min(vise, _affiche + math.max((vise - _affiche) * .16, .4));
              final h = MediaQuery.of(context).size.height, w = MediaQuery.of(context).size.width;
              return Column(mainAxisSize: MainAxisSize.min, children: [
                ClipRRect(borderRadius: BorderRadius.circular(28), child: SvgPicture.asset('assets/img/masano-logo.svg', width: math.min(140, math.min(w * .26, h * .24)))),
                const SizedBox(height: 14),
                Text('MASANO', style: K.titre(math.min(170, math.min(w * .28, h * .3)) * .75).copyWith(letterSpacing: 12, shadows: const [Shadow(color: Color(0x59E2B04A), blurRadius: 30, offset: Offset(0, 6))])),
                const SizedBox(height: 6),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  for (var i = 0; i < 4; i++)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 11),
                      child: Transform.translate(
                        offset: Offset(0, -8 * math.max(0, math.sin((_a.value - i * .12) * 2 * math.pi))),
                        child: Text('♠♥♦♣'[i], style: TextStyle(fontSize: 34, color: i == 1 || i == 2 ? K.bad : K.ink)),
                      ),
                    ),
                ]),
                const SizedBox(height: 8),
                Text('KOPO · INTER (8) · ENTRE AMIS', style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 4)),
                const SizedBox(height: 30),
                SizedBox(
                  width: math.min(w * .62, 260),
                  child: Column(children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: Container(
                        height: 6,
                        color: const Color(0x14FFFFFF),
                        alignment: Alignment.centerLeft,
                        child: FractionallySizedBox(
                          widthFactor: (_affiche / 100).clamp(0, 1),
                          child: Container(decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xFFB9862C), K.brass, Color(0xFFF6D68C)], stops: [0, .7, 1]))),
                        ),
                      ),
                    ),
                    const SizedBox(height: 9),
                    Text(app.splashEtat, style: K.texte(12, couleur: K.muted)),
                    const SizedBox(height: 4),
                    Opacity(opacity: app.splashAttente ? 1 : 0, child: Text("Touche l'écran pour passer", style: K.texte(11, couleur: const Color(0x999FB2C8)))),
                  ]),
                ),
              ]);
            },
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ première ouverture
class Bienvenue extends StatefulWidget {
  const Bienvenue({super.key});
  @override
  State<Bienvenue> createState() => _BienvenueState();
}

class _BienvenueState extends State<Bienvenue> {
  final _pseudo = TextEditingController();
  @override
  void dispose() { _pseudo.dispose(); super.dispose(); }

  void _invite() {
    final p = App.nettoyerPseudo(_pseudo.text);
    if (p.isEmpty) { app.toast('Choisis ton pseudo pour jouer.'); return; }
    if (p.length < 3) { app.toast('Le pseudo fait au moins 3 caractères, en un seul mot.'); return; }
    Stock.ecrire('kopo-pseudo', p);
    Stock.ecrire('kopo-entree', 'invite');
    app.afficherAccueil(premiere: true);
  }

  @override
  Widget build(BuildContext context) {
    final cfg = app.config;
    final google = cfg?['google'] as String?;
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;
    final h = MediaQuery.of(context).size.height, w = MediaQuery.of(context).size.width;
    final haut = Column(mainAxisSize: MainAxisSize.min, children: [
      ClipRRect(borderRadius: BorderRadius.circular(26), child: SvgPicture.asset('assets/img/masano-logo.svg', width: math.min(120, math.min(w * .3, h * .22)))),
      const SizedBox(height: 6),
      Text('MASANO', style: K.titre(math.min(92, math.min(w * .18, h * .14))).copyWith(letterSpacing: 10)),
      Text('KOPO · INTER (8) · ENTRE AMIS', style: K.texte(12, couleur: K.muted).copyWith(letterSpacing: 3)),
    ]);
    final choix = SizedBox(
      width: 340,
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (google != null) ...[
          BoutonGoogle(onTap: () => connecterGoogle(google)),
          const Ecart(6),
          const Muet('Tes pièces et ton compte te suivent sur tous tes téléphones.', taille: 12, align: TextAlign.center),
          const Ecart(10),
          Row(children: [const Expanded(child: Divider(color: K.line)), Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Text('OU', style: K.texte(12, couleur: K.muted).copyWith(letterSpacing: 2))), const Expanded(child: Divider(color: K.line))]),
          const Ecart(10),
        ],
        Container(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          decoration: BoxDecoration(color: const Color(0x4D000000), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Ton pseudo', style: K.texte(11, couleur: K.muted)),
            TextField(
              controller: _pseudo,
              maxLength: 16,
              style: K.texte(17, poids: FontWeight.w700),
              onChanged: (t) { final v = App.nettoyerPseudo(t, true); if (v != t) _pseudo.value = TextEditingValue(text: v, selection: TextSelection.collapsed(offset: v.length)); },
              onSubmitted: (_) => _invite(),
              decoration: InputDecoration(isDense: true, border: InputBorder.none, counterText: '', hintText: 'Ex. As_de_Pique', hintStyle: K.texte(16, couleur: K.muted)),
            ),
          ]),
        ),
        const Ecart(10),
        Btn.principal('Jouer en invité', large: true, onTap: _invite),
        const Ecart(8),
        Muet(google != null ? 'En invité, tu joues contre les robots. Pour jouer en ligne ou entre amis, connecte-toi avec Google (ici ou plus tard).' : 'Tu pourras te connecter avec Google plus tard, dans les Paramètres.', taille: 12, align: TextAlign.center),
      ]),
    );
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: paysage
              ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [haut, SizedBox(width: math.min(72, w * .06)), choix])
              : Column(mainAxisSize: MainAxisSize.min, children: [haut, const Ecart(28), choix]),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ connexion à une salle
class Connexion extends StatelessWidget {
  const Connexion({super.key});
  @override
  Widget build(BuildContext context) => SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('Connexion…', style: K.titre(36)),
              const Ecart(10),
              Text(app.texteConnexion.isEmpty ? 'Connexion à la partie en cours.' : app.texteConnexion, textAlign: TextAlign.center, style: K.texte(16)),
              const Ecart(18),
              const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(color: K.brass, strokeWidth: 3)),
              const Ecart(18),
              Btn('Annuler', onTap: () => app.quitter()),
            ]),
          ),
        ),
      );
}

// ------------------------------------------------------------------ annonce, maintenance, mise à jour
class _Annonce extends StatelessWidget {
  const _Annonce();
  @override
  Widget build(BuildContext context) {
    final t = (app.config?['annonce'] ?? '').toString().trim();
    return ColoredBox(
      color: const Color(0x9E060E18),
      child: Fenetre(titre: 'Annonce', enfants: [
        Text(t, style: K.texte(16)),
        const Ecart(14),
        Btn.principal('OK', onTap: () { Stock.ecrire('kopo-annonce-vue', t); app.annonceOuverte = false; app.maj(); }),
      ]),
    );
  }
}

class _Maintenance extends StatelessWidget {
  const _Maintenance();
  @override
  Widget build(BuildContext context) => ColoredBox(
        color: const Color(0xE6060E18),
        child: Fenetre(titre: 'Maintenance', enfants: [
          Text(app.maintenance ?? '', style: K.texte(16)),
          const Ecart(14),
          Btn('Réessayer', onTap: app.relireConfig),
          const Ecart(8),
          const Muet('Le jeu se rouvrira tout seul dès la fin de la maintenance.', taille: 12),
        ]),
      );
}

class _MiseAJour extends StatelessWidget {
  const _MiseAJour();
  @override
  Widget build(BuildContext context) => ColoredBox(
        color: const Color(0xE6060E18),
        child: Fenetre(titre: 'Mise à jour', enfants: [
          Text('Une nouvelle version de Masano est obligatoire pour continuer à jouer.', style: K.texte(16)),
          const Ecart(14),
          Btn.principal('Mettre à jour', onTap: () {
            final s = app.miseAJourStore;
            if (s != null && s.isNotEmpty) launchUrl(Uri.parse(s), mode: LaunchMode.externalApplication);
          }),
        ]),
      );
}

// ------------------------------------------------------------------ fil du chat (en bas à gauche)
class FilChat extends StatelessWidget {
  const FilChat({super.key});
  @override
  Widget build(BuildContext context) {
    final bas = app.ecran == 'salon' ? 86.0 : MediaQuery.of(context).size.height * .38;
    return Positioned(
      left: 10,
      bottom: bas,
      child: IgnorePointer(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 260),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final m in app.filChat)
              TweenAnimationBuilder<double>(
                key: ValueKey(m),
                tween: Tween(begin: 0, end: 1),
                duration: const Duration(milliseconds: 250),
                builder: (context, t, child) {
                  final age = DateTime.now().difference(m.le).inMilliseconds;
                  return Opacity(opacity: age > 6000 ? .0 : t, child: Transform.translate(offset: Offset(-20 * (1 - t), 0), child: child));
                },
                child: Container(
                  margin: const EdgeInsets.only(top: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: m.moi ? const Color(0xD9473513) : const Color(0xD90B1828), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)),
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${m.moi ? 'Moi' : m.nom} ', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700)),
                    TextSpan(text: m.texte, style: App.estPhrase(m.texte ?? '') ? K.texte(13) : const TextStyle(fontSize: 20)),
                  ])),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ calque des animations
class CalqueEffets extends StatelessWidget {
  const CalqueEffets({super.key});
  @override
  Widget build(BuildContext context) {
    final racine = context.findRenderObject() as RenderBox?;
    return LayoutBuilder(builder: (context, c) {
      final enfants = <Widget>[];
      for (final e in app.effets) {
        if (e.type == 'tampon') {
          enfants.add(Positioned.fill(child: _Tampon(key: ValueKey(e.id), e: e)));
          continue;
        }
        final k = app.clesSieges[e.joueur];
        final box = k?.currentContext?.findRenderObject() as RenderBox?;
        if (box == null || !box.attached) continue;
        final moiBox = context.findRenderObject() as RenderBox?;
        final ref = moiBox ?? racine;
        if (ref == null) continue;
        final centre = box.localToGlobal(box.size.center(Offset.zero), ancestor: ref);
        enfants.add(Positioned(left: centre.dx - 100, top: centre.dy - 100, width: 200, height: 200, child: _Bulle(key: ValueKey(e.id), e: e)));
      }
      return Stack(clipBehavior: Clip.none, children: enfants);
    });
  }
}

class _Bulle extends StatefulWidget {
  final Effet e;
  const _Bulle({super.key, required this.e});
  @override
  State<_Bulle> createState() => _BulleState();
}

class _BulleState extends State<_Bulle> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: Duration(milliseconds: widget.e.duree));
  @override
  void initState() {
    super.initState();
    Future.delayed(Duration(milliseconds: widget.e.delai), () { if (mounted) _a.forward(); });
  }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final e = widget.e;
    Widget contenu;
    if (e.icone != null) {
      contenu = Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(color: K.table, shape: BoxShape.circle, border: Border.all(color: K.brass, width: 2)),
        child: Ico(e.icone!, taille: 26),
      );
    } else if (e.cls == 'texte') {
      contenu = Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5), decoration: BoxDecoration(color: K.good, borderRadius: BorderRadius.circular(99)), child: Text(e.texte, style: K.texte(16, couleur: const Color(0xFF062014), poids: FontWeight.w700)));
    } else {
      contenu = Text(e.texte, style: TextStyle(fontSize: e.type == 'reaction' ? 30 : e.cls == 'ko' ? 46 : 30, fontWeight: FontWeight.w700, color: e.cls == 'ko' ? K.bad : K.ink, shadows: const [Shadow(color: Colors.black87, blurRadius: 6, offset: Offset(0, 3))]));
    }
    return AnimatedBuilder(
      animation: _a,
      builder: (context, child) {
        final t = _a.value;
        if (_a.status == AnimationStatus.dismissed) return const SizedBox();
        double op, s, dy;
        if (t < .2) { final k = t / .2; op = k; s = .2 + 1.1 * k; dy = -45 * k; }
        else if (t < .8) { final k = (t - .2) / .6; op = 1; s = 1.3 - .3 * k; dy = -45 - 15 * k; }
        else { final k = (t - .8) / .2; op = 1 - k; s = 1 - .1 * k; dy = -60 - 40 * k; }
        return Opacity(opacity: op.clamp(0, 1), child: Transform.translate(offset: Offset(0, dy), child: Transform.scale(scale: s, child: Center(child: child))));
      },
      child: contenu,
    );
  }
}

class _Tampon extends StatefulWidget {
  final Effet e;
  const _Tampon({super.key, required this.e});
  @override
  State<_Tampon> createState() => _TamponState();
}

class _TamponState extends State<_Tampon> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1900))..forward();
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final taille = math.min(120.0, math.min(size.width * .17, size.height * .26));
    return AnimatedBuilder(
      animation: _a,
      builder: (context, child) {
        final t = _a.value;
        double s, op;
        if (t < .15) { final k = t / .15; s = 3 - 2.08 * k; op = k; }
        else if (t < .25) { s = .92 + .08 * ((t - .15) / .1); op = 1; }
        else if (t < .85) { s = 1; op = 1; }
        else { final k = (t - .85) / .15; s = 1 + .1 * k; op = 1 - k; }
        return Align(alignment: const Alignment(0, -.1), child: Opacity(opacity: op.clamp(0, 1), child: Transform.rotate(angle: -8 * math.pi / 180, child: Transform.scale(scale: s, child: child))));
      },
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: taille * .3, vertical: taille * .05),
        decoration: BoxDecoration(color: K.red, borderRadius: BorderRadius.circular(18), border: Border.all(color: Colors.white, width: 6), boxShadow: const [BoxShadow(color: Color(0x99000000), blurRadius: 34, offset: Offset(0, 12))]),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(widget.e.texte, style: TextStyle(fontFamily: K.display, fontSize: taille, height: 1, color: Colors.white, letterSpacing: 3)),
          if (widget.e.sous != null) Padding(padding: EdgeInsets.only(bottom: taille * .05), child: Text(widget.e.sous!, style: K.texte(taille * .2, couleur: Colors.white, poids: FontWeight.w700))),
        ]),
      ),
    );
  }
}
