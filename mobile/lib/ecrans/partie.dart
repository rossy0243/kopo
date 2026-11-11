// La partie : sièges autour de la table, centre (poses Kopo ou carte du centre et pioche d'Inter), consigne, main et actions.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../commun/cartes.dart';
import '../commun/sons.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/communes.dart';
import '../fenetres/parametres.dart';
import '../fenetres/partie_fenetres.dart';
import '../fenetres/social.dart';

class Partie extends StatelessWidget {
  const Partie({super.key});

  @override
  Widget build(BuildContext context) {
    final v = app.vue!;
    final m = v['manche'] as Map?;
    if (m == null) return const SizedBox();
    final inter = v['jeu'] == 'inter8';
    final finale = (v['restants'] as List).length == 2;
    final style = inter ? ' · ${v['mode'] == 'delire' ? (v['jRetour'] == true ? 'Délire · J retour' : 'Délire') : 'Simple'}' : '';
    final jeJoue = (m['enJeu'] as List).contains(v['moi']);
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;

    final table = Expanded(child: _Table(v, m, inter));
    final bas = _Bas(v, m, inter, jeJoue);
    return SafeArea(
      child: Column(children: [
        // En-tête
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 2, 4, 0),
          child: Row(children: [
            IconButton(onPressed: demanderQuitter, icon: const Icon(Icons.arrow_back, color: K.muted), tooltip: 'Quitter'),
            Expanded(
              child: Text.rich(TextSpan(style: K.texte(15, couleur: K.muted), children: [
                TextSpan(text: finale ? 'Finale' : 'Manche ${v['numeroManche']}', style: const TextStyle(color: K.ink, fontWeight: FontWeight.w700)),
                TextSpan(text: '$style · ${v['code']}'),
              ]), overflow: TextOverflow.ellipsis),
            ),
            IconButton(onPressed: ouvrirChat, icon: const Icon(Icons.chat_bubble_outline, color: K.brass), tooltip: 'Chat'),
            IconButton(onPressed: ouvrirParametres, icon: const Ico('reglages', taille: 22), tooltip: 'Paramètres'),
          ]),
        ),
        if (paysage)
          Expanded(child: Row(children: [Expanded(flex: 3, child: Column(children: [table])), SizedBox(width: math.min(420, MediaQuery.of(context).size.width * .42), child: SingleChildScrollView(child: bas))]))
        else ...[table, ConstrainedBox(constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * .56), child: SingleChildScrollView(reverse: true, child: bas))],
      ]),
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

// ---------------------------------------------------------------- la table et les sièges
class _Table extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool inter;
  const _Table(this.v, this.m, this.inter);

  @override
  Widget build(BuildContext context) {
    final sieges = (m['sieges'] as List).map((e) => e.toString()).toList();
    final i0 = math.max(0, sieges.indexOf(v['moi'].toString()));
    final ordre = [...sieges.sublist(i0), ...sieges.sublist(0, i0)];
    final autres = ordre.where((id) => id != v['moi']).toList();
    return LayoutBuilder(builder: (context, c) {
      final w = c.maxWidth, h = c.maxHeight;
      final enfants = <Widget>[
        // Le tapis
        Positioned(
          left: w * .05, right: w * .05, top: h * .1, bottom: h * .1,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.all(Radius.elliptical(w * .45, h * .4)),
              gradient: const RadialGradient(colors: [Color(0xFF1C6B4A), Color(0xFF0F4430)], radius: .8),
              border: Border.all(color: const Color(0xFF6B4A22), width: 6),
              boxShadow: const [BoxShadow(color: Color(0x80000000), blurRadius: 24, offset: Offset(0, 10))],
            ),
          ),
        ),
        // Le centre
        Positioned(left: w * .14, right: w * .14, top: h * .26, bottom: h * .2, child: Center(child: inter ? _CentreInter(v, m) : _CentreKopo(v, m))),
      ];
      for (var k = 0; k < autres.length; k++) {
        final a = math.pi * (1 - (k + .5) / autres.length);
        final x = .5 + .41 * math.cos(a), y = .5 - .37 * math.sin(a);
        enfants.add(Positioned(left: w * x - 55, top: h * y - 42, width: 110, child: _Siege(v, m, autres[k])));
      }
      enfants.add(Positioned(left: w * .5 - 60, bottom: 0, width: 120, child: _Siege(v, m, v['moi'].toString())));
      return Stack(clipBehavior: Clip.none, children: enfants);
    });
  }
}

class _Siege extends StatelessWidget {
  final Vue v;
  final Map m;
  final String id;
  const _Siege(this.v, this.m, this.id);

  @override
  Widget build(BuildContext context) {
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
    final pastilles = <Widget>[
      if (q >= 0) Pastille(qualifies[q]['raison'] == 'Katapss' ? 'Katapss ✓' : q == 0 ? 'qualifié 1er' : 'qualifié ${q + 1}e', type: TypePastille.ok)
      else if (m['elimine'] == id) const Pastille('éliminé', type: TypePastille.ko)
      else if (courant && v['chrono'] != null && pause == null) SizedBox(width: 70, child: Horloge(builder: (_) => Barre(app.resteChrono / math.max(1, app.totalChrono), hauteur: 4, couleur: app.resteChrono < 2000 ? K.bad : K.brass))),
      if (v['jeu'] == 'inter8' && ((m['annonces'] as List?) ?? []).contains(id) && q < 0) const Pastille('annonce', type: TypePastille.tour),
      if (j['connecte'] != true && !robot) ...[
        const Pastille('déconnecté', type: TypePastille.ko),
        if (v['hote'] == v['moi'] && (v['restants'] as List).contains(id))
          Btn('Remplacer', icone: 'robots', taille: 12, marge: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), onTap: () => app.envoyer({'type': 'remplacerParRobot', 'cible': id})),
      ] else if (j['remplace'] == true) const Pastille('remplacé')
      else if (j['absent'] == true && (m['enJeu'] as List).contains(id)) const Pastille('absent · 5 s', type: TypePastille.ko),
    ];
    final contenu = Opacity(
      opacity: sorti ? .55 : 1,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (!moi)
          SizedBox(
            height: 30,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              SizedBox(
                width: nb == 0 ? 0 : 18 + 6.0 * (math.min(nb, 10) - 1),
                height: 28,
                child: Stack(children: [for (var c = 0; c < math.min(nb, 10); c++) Positioned(left: 6.0 * c, child: DosCarte(l: 18, h: 27, rayon: 3, bord: 1))]),
              ),
            ]),
          ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: courant ? K.brass : const Color(0xCC0B1828),
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: meneur ? K.good : courant ? const Color(0xFFF3D48A) : K.line, width: meneur ? 2 : 1),
            boxShadow: courant ? const [BoxShadow(color: Color(0x80E2B04A), blurRadius: 12)] : null,
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (robot) Padding(padding: const EdgeInsets.only(right: 4), child: Ico('robots', taille: 15, couleur: courant ? K.encre : null)),
            Flexible(child: Text(moi ? 'Toi' : (j['nom'] ?? '?').toString(), overflow: TextOverflow.ellipsis, style: K.texte(13, couleur: courant ? K.encre : K.ink, poids: FontWeight.w700))),
            if (nb > 0) ...[
              const SizedBox(width: 5),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5),
                decoration: BoxDecoration(color: courant ? K.encre : K.brass, borderRadius: BorderRadius.circular(99)),
                child: Text('$nb', style: K.texte(11, couleur: courant ? K.brass : K.encre, poids: FontWeight.w700)),
              ),
            ],
          ]),
        ),
        if (pastilles.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Wrap(alignment: WrapAlignment.center, spacing: 3, runSpacing: 3, children: pastilles)),
      ]),
    );
    return KeyedSubtree(
      key: app.cleSiege(id),
      child: GestureDetector(
        onTap: !moi && !robot ? () => ficheJoueur(id, (j['nom'] ?? '').toString()) : null,
        child: contenu,
      ),
    );
  }
}

// ---------------------------------------------------------------- Kopo : le centre
class _Depart extends StatelessWidget {
  final Vue v;
  final Map m;
  const _Depart(this.v, this.m);
  @override
  Widget build(BuildContext context) {
    final finale = (v['restants'] as List).length == 2;
    final qui = m['joueurCourant'] == v['moi'] ? 'Toi' : app.nomDe(v, m['joueurCourant']);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Text(finale ? 'Finale' : 'Manche ${v['numeroManche']}', style: K.titre(30)),
      Horloge(builder: (_) {
        _sonsChrono(v);
        return Text('${math.max(1, (app.resteChrono / 1000).ceil())}', style: K.titre(64, couleur: Colors.white));
      }),
      Row(mainAxisSize: MainAxisSize.min, children: [const Ico('depart', taille: 20), const SizedBox(width: 6), Text(qui, style: K.texte(15, poids: FontWeight.w700))]),
      for (final r in ((m['redistributions'] as List?) ?? []).cast<Map>())
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            'Cartes redistribuées : la plus forte carte de ${r['joueur'] == v['moi'] ? 'ta main' : app.nomDe(v, r['joueur'])} était un 4 (${(r['main'] as List).map((c) => KopoCartes.afficher(c as String)).join(' ')}).',
            textAlign: TextAlign.center,
            style: K.texte(12, couleur: K.muted),
          ),
        ),
    ]);
  }
}

class _CentreKopo extends StatelessWidget {
  final Vue v;
  final Map m;
  const _CentreKopo(this.v, this.m);
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
    final l = serre ? 40.0 : 50.0;
    final an = pause?['annonce'] as Map?;
    return SingleChildScrollView(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
          if (pause == null && m['couleurTour'] != null)
            Puce(Text.rich(TextSpan(children: [const TextSpan(text: 'Couleur du tour '), TextSpan(text: KopoCartes.symboles[m['couleurTour']], style: TextStyle(color: _rougeSym(m['couleurTour']) ? const Color(0xFFFF8A80) : K.ink, fontSize: 16))]))),
          if (pause == null && m['couleurInterdite'] != null && m['phase'] == 'ouverture')
            Puce(Text.rich(TextSpan(children: [const TextSpan(text: 'Interdit pour ouvrir '), TextSpan(text: KopoCartes.symboles[m['couleurInterdite']], style: const TextStyle(fontSize: 16))])), couleur: K.bad),
        ]),
        const SizedBox(height: 6),
        if (pause?['type'] == 'depart') _Depart(v, m),
        Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 6, children: [
          for (var i = 0; i < table.length; i++)
            Opacity(
              opacity: table[i]['compte'] == true ? 1 : .5,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  for (final c in (table[i]['cartes'] as List).cast<String>())
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 1),
                      child: CarteVue(c, l: l, forte: (forte != null && forte.i == i && forte.carte == c) || (an != null && an['carte'] == c), pale: an != null && an['type'] == 'ramasse' && an['carte'] == c),
                    ),
                ]),
                const SizedBox(height: 2),
                Text((table[i]['joueur'] == v['moi'] ? 'Toi' : app.nomDe(v, table[i]['joueur'])) + (table[i]['compte'] == true ? '' : ' · sort'), style: K.texte(11, couleur: K.muted)),
              ]),
            ),
        ]),
      ]),
    );
  }
}

bool _rougeSym(Object? c) => c == 'C' || c == 'K';

// ---------------------------------------------------------------- Inter (8) : le centre
class _CentreInter extends StatelessWidget {
  final Vue v;
  final Map m;
  const _CentreInter(this.v, this.m);
  @override
  Widget build(BuildContext context) {
    final pause = m['pause'] as Map?;
    String qui(Object? id) => id == v['moi'] ? 'Toi' : app.nomDe(v, id);
    final jeu = pause == null && m['phase'] == 'jeu';
    final demande = m['demande'] as Map?;
    final roue = v['mode'] == 'delire' && v['jRetour'] == true && (m['enJeu'] as List).length > 2;
    if (pause?['type'] == 'depart') return _Depart(v, m);
    return SingleChildScrollView(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
          if (jeu && demande != null)
            Puce(Text.rich(TextSpan(children: [const TextSpan(text: 'Demande '), TextSpan(text: InterCartes.nomValeur(demande['valeur'].toString()), style: const TextStyle(color: K.brass)), TextSpan(text: ' · ${qui(demande['par'])}')])), couleur: K.brass)
          else if (jeu && m['libre'] == true) Puce.texte('Jeu libre : pose la carte de ton choix'),
          if (jeu && m['piochable'] == 0) Puce.texte('Pioche vide : qui ne peut pas jouer passe', couleur: K.bad),
          if (jeu && roue) Puce(Text.rich(TextSpan(children: [const TextSpan(text: 'Sens '), TextSpan(text: m['sens'] == 1 ? '↻' : '↺', style: const TextStyle(fontSize: 16))]))),
        ]),
        const SizedBox(height: 8),
        Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (roue) Padding(padding: const EdgeInsets.only(right: 10, top: 16), child: _RoueSens(m['sens'] == 1)),
          Column(mainAxisSize: MainAxisSize.min, children: [
            if (m['reference'] != null) CarteVue(m['reference'] as String, inter: true, l: 56) else const SizedBox(width: 56, height: 81),
            const SizedBox(height: 3),
            Text(m['dernier'] != null ? 'Posée par ${qui(m['dernier'])}' : 'Au centre', style: K.texte(11, couleur: K.muted)),
            if (jeu && demande != null) Text('Demande ${InterCartes.nomValeur(demande['valeur'].toString())}', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700))
            else if (jeu && m['libre'] == true) Text('Jeu libre', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700)),
          ]),
          const SizedBox(width: 18),
          Opacity(
            opacity: m['piochable'] == 0 ? .4 : 1,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const DosCarte(l: 44),
              const SizedBox(height: 3),
              Text(m['piochable'] == 0 ? 'Vide' : '${m['pioche']}', style: K.texte(11, couleur: K.muted)),
            ]),
          ),
        ]),
      ]),
    );
  }
}

class _RoueSens extends StatefulWidget {
  final bool horaire;
  const _RoueSens(this.horaire);
  @override
  State<_RoueSens> createState() => _RoueSensState();
}

class _RoueSensState extends State<_RoueSens> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(seconds: 6))..repeat();
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _a,
        builder: (_, __) => Transform.rotate(
          angle: (app.sansAnim ? 0 : _a.value) * 2 * math.pi * (widget.horaire ? 1 : -1),
          child: Text(widget.horaire ? '↻' : '↺', style: const TextStyle(fontSize: 34, color: K.brass, height: 1)),
        ),
      );
}

// ---------------------------------------------------------------- consigne, main, actions
class _Bas extends StatelessWidget {
  final Vue v;
  final Map m;
  final bool inter;
  final bool jeJoue;
  const _Bas(this.v, this.m, this.inter, this.jeJoue);

  @override
  Widget build(BuildContext context) {
    final pause = m['pause'] as Map?;
    final monTour = m['joueurCourant'] == v['moi'];
    final restants = (v['restants'] as List);
    final actions = (m['actions'] as List).cast<Map>();
    final consigne = <InlineSpan>[];
    final phaseJeu = inter ? m['phase'] == 'jeu' : m['phase'] != 'terminee';
    WidgetSpan oeil() => const WidgetSpan(alignment: PlaceholderAlignment.middle, child: Ico('oeil', taille: 18));
    if (v['entreRobots'] == true) {
      consigne.addAll([oeil(), TextSpan(text: restants.contains(v['moi']) ? ' Les robots finissent la manche entre eux, en accéléré.' : ' Les robots finissent entre eux, en accéléré.')]);
    } else if (pause != null || !phaseJeu) {
    } else if (!restants.contains(v['moi']) || !jeJoue) {
      consigne.addAll([oeil(), const TextSpan(text: ' Tu regardes la partie.')]);
    } else if (monTour) {
      if (v['chrono'] != null) consigne.add(WidgetSpan(alignment: PlaceholderAlignment.middle, child: Horloge(builder: (_) {
        _sonsChrono(v);
        final r = app.resteChrono;
        return Text('${(r / 1000).ceil()} s ', style: K.texte(16, couleur: r < 2000 ? K.bad : K.brass, poids: FontWeight.w700));
      })));
      consigne.add(const TextSpan(text: 'À toi !', style: TextStyle(fontStyle: FontStyle.italic, color: K.brass, fontWeight: FontWeight.w700)));
      if (inter && !actions.any((a) => a['type'] == 'jouer')) consigne.add(TextSpan(text: m['aPioche'] == true ? ' Tu ne peux pas jouer la carte piochée : passe.' : ' Aucune carte ne va : pioche.'));
    }
    final aide = !inter && v['robots'] == 'gentils' ? aideGuidee(v) : null;
    final barre = (v['chrono'] != null && monTour) || pause != null;

    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 4, 10, 8),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (consigne.isNotEmpty) Text.rich(TextSpan(style: K.texte(15), children: consigne), textAlign: TextAlign.center),
        if (aide != null)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(color: const Color(0x26E2B04A), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0x80E2B04A))),
            child: Text.rich(TextSpan(style: K.texte(14), children: [
              for (var i = 0; i < aide.length; i++) TextSpan(text: aide[i], style: i.isOdd ? const TextStyle(fontWeight: FontWeight.w700, color: K.brass) : null),
            ]), textAlign: TextAlign.center),
          ),
        if (barre)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Horloge(builder: (_) => Barre(app.resteChrono / math.max(1, app.totalChrono), hauteur: 5, couleur: pause != null ? K.muted : app.resteChrono < 2000 ? K.bad : K.brass)),
          ),
        if (v['entreRobots'] == true)
          Padding(padding: const EdgeInsets.only(top: 6), child: Btn(restants.contains(v['moi']) ? 'Passer à la fin de la manche' : 'Passer à la fin', large: true, onTap: () => app.envoyer({'type': 'passerFin'}))),
        if (jeJoue) ...(inter ? _mainInter(context, actions, monTour) : _mainKopo(context, actions, monTour)),
      ]),
    );
  }

  // ---- Kopo
  List<Widget> _mainKopo(BuildContext context, List<Map> actions, bool monTour) {
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
    return [
      if (actions.any((a) => a['type'] == 'katapss')) Padding(padding: const EdgeInsets.only(top: 8), child: _GrosBouton('KATAPSS !', () => app.action({'type': 'katapss'}))),
      const SizedBox(height: 6),
      Text('Ta main ($n carte$s)${jouables.isNotEmpty ? ' · touche une carte' : ''}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted)),
      const SizedBox(height: 4),
      _Main(
        cartes: KopoCartes.trier(main, app.prefs['tri'] as String? ?? 'couleur'),
        inter: false,
        etat: (c) => jouables.contains(c) ? (c == choisie ? _EtatCarte.choisie : _EtatCarte.jouable) : monTour ? _EtatCarte.grisee : _EtatCarte.normale,
        onTap: (c) {
          if (!jouables.contains(c)) return;
          if (app.carteChoisie == c) { app.carteChoisie = null; app.action({'type': 'jouer', 'carte': c}); }
          else { app.carteChoisie = c; }
          app.maj();
        },
      ),
      const SizedBox(height: 6),
      if (choisie != null) Btn.principal('Jouer le ${KopoCartes.afficher(choisie)}', large: true, onTap: () { app.carteChoisie = null; app.action({'type': 'jouer', 'carte': choisie}); }),
      if (toutPoser)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Btn('Tout poser ($n carte$s) et sortir', style: jouables.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () {
            void poser() => app.action({'type': 'toutPoser'});
            app.prefs['confirmerToutPoser'] == true ? demanderConfirmation('Tu poses tes $n carte$s et tu sors de la manche.', poser, titre: 'Tout poser ?', oui: 'Oui, tout poser') : poser();
          }),
        ),
      if (actions.any((a) => a['type'] == 'ramasser') && forte != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Btn('Ramasser le ${KopoCartes.afficher(forte)}${jouables.isNotEmpty || toutPoser ? ' (bluff)' : ''}', style: jouables.isEmpty && !toutPoser ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () => app.action({'type': 'ramasser'})),
        ),
    ];
  }

  // ---- Inter (8)
  List<Widget> _mainInter(BuildContext context, List<Map> actions, bool monTour) {
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

    final zone = <Widget>[
      if (actions.any((a) => a['type'] == 'annoncer')) _GrosBouton("J'ANNONCE !", () => app.action({'type': 'annoncer'})),
      for (final a in actions.where((a) => a['type'] == 'contester'))
        _GrosBouton('CONTESTER ${app.nomDe(v, a['cible']).toUpperCase()}', () => app.action({'type': 'contester', 'cible': a['cible']}), rouge: true),
      for (final id in ((m['enGrace'] as List?) ?? []).where((id) => id != v['moi']))
        _GrosBouton('CONTESTER ${app.nomDe(v, id).toUpperCase()} (dans 3 s)', null, rouge: true),
    ];
    final boutons = <Widget>[];
    if (encore.isNotEmpty) {
      final plusGrand = coups.where((a) => choix.every((x) => contient(a, x))).reduce((g, a) => (a['cartes'] as List).length > (g['cartes'] as List).length ? a : g);
      boutons.add(Btn('Prendre les ${(plusGrand['cartes'] as List).length} cartes (${InterCartes.nomValeur(InterCartes.valeur(choix[0]))})', style: choisis.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () => changer((plusGrand['cartes'] as List).cast<String>().toList())));
    }
    if (choisis.isNotEmpty) {
      final val = InterCartes.valeur(choix[0]);
      boutons.add(Btn.principal(choix.length == 1 ? 'Poser le ${InterCartes.afficher(choix[0])}' : 'Poser ${choix.length} cartes (${InterCartes.nomValeur(val)})', large: true, onTap: () => poserInter(choisis)));
      boutons.add(Btn('Reprendre ${choix.length > 1 ? 'les cartes' : 'la carte'}', large: true, onTap: () => changer([])));
      if (choix.length > 1 && val != '8' && val != 'X') {
        final nbCouleurs = {for (final a in choisis) InterCartes.couleur(((a['cartes'] as List).last) as String)}.length;
        boutons.add(Muet(nbCouleurs > 1 ? 'Tu choisiras la nouvelle couleur.' : 'Plusieurs cartes : la couleur change toute seule.', align: TextAlign.center, taille: 12));
      }
    } else if (choix.isNotEmpty) {
      boutons.add(Btn('Reprendre les cartes', large: true, onTap: () => changer([])));
    }
    if (actions.any((a) => a['type'] == 'piocher')) boutons.add(Btn.principal(m['piochable'] == 0 ? 'Plus de cartes : passer mon tour' : 'Piocher une carte', large: true, onTap: () => app.action({'type': 'piocher'})));
    if (actions.any((a) => a['type'] == 'passer')) boutons.add(Btn('Passer', style: coups.isEmpty ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () { app.choixInter = []; app.action({'type': 'passer'}); }));

    return [
      if (zone.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: zone)),
      const SizedBox(height: 6),
      Text('Ta main ($n carte${n > 1 ? 's' : ''})${coups.isNotEmpty && choix.isEmpty ? ' · touche une carte' : ''}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted)),
      const SizedBox(height: 4),
      _Main(
        cartes: InterCartes.trier(main),
        inter: true,
        etat: (c) => choix.contains(c)
            ? _EtatCarte.choisie
            : (ajoutable(choix, c) || (choix.isNotEmpty && ajoutable(const [], c))) ? _EtatCarte.jouable : monTour ? _EtatCarte.grisee : _EtatCarte.normale,
        onTap: (c) {
          final k = choix.indexOf(c);
          if (k >= 0) {
            if (choix.length == 1 && choisis.isNotEmpty && encore.isEmpty) { poserInter(choisis); return; }
            changer([...choix]..removeAt(k));
          } else if (ajoutable(choix, c)) {
            changer([...choix, c]);
          } else if (choix.isNotEmpty && ajoutable(const [], c)) {
            changer([c]);
          }
        },
      ),
      const SizedBox(height: 6),
      for (final b in boutons) Padding(padding: const EdgeInsets.only(top: 5), child: b),
    ];
  }
}

class _GrosBouton extends StatelessWidget {
  final String texte;
  final VoidCallback? onTap;
  final bool rouge;
  const _GrosBouton(this.texte, this.onTap, {this.rouge = false});
  @override
  Widget build(BuildContext context) => Opacity(
        opacity: onTap == null ? .5 : 1,
        child: Material(
          color: rouge ? K.red : K.brass,
          borderRadius: BorderRadius.circular(14),
          elevation: 6,
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onTap == null ? null : () { app.vibrer(80); onTap!(); },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
              child: Text(texte, textAlign: TextAlign.center, style: TextStyle(fontFamily: K.display, fontSize: 30, letterSpacing: 2, height: 1, color: rouge ? Colors.white : K.encre)),
            ),
          ),
        ),
      );
}

enum _EtatCarte { normale, jouable, choisie, grisee }

/// La main : cartes côte à côte, qui se chevauchent quand la place manque. La carte choisie se lève.
class _Main extends StatelessWidget {
  final List<String> cartes;
  final bool inter;
  final _EtatCarte Function(String) etat;
  final ValueChanged<String> onTap;
  const _Main({required this.cartes, required this.inter, required this.etat, required this.onTap});
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final n = cartes.length;
        if (n == 0) return const SizedBox(height: 20);
        final w = c.maxWidth;
        const l = 58.0;
        final pas = n == 1 ? 0.0 : math.min(l + 4, (w - l) / (n - 1));
        final largeur = l + pas * (n - 1);
        const h = l * 78 / 54;
        return SizedBox(
          height: h + 16,
          child: Center(
            child: SizedBox(
              width: largeur,
              child: Stack(clipBehavior: Clip.none, children: [
                for (var i = 0; i < n; i++)
                  Builder(builder: (_) {
                    final carte = cartes[i];
                    final e = etat(carte);
                    final recue = app.cartesRecues.contains(carte);
                    return AnimatedPositioned(
                      key: ValueKey(carte),
                      duration: Duration(milliseconds: app.sansAnim ? 0 : 160),
                      left: pas * i,
                      top: e == _EtatCarte.choisie ? 0 : e == _EtatCarte.jouable ? 8 : 14,
                      child: GestureDetector(
                        onTap: () => onTap(carte),
                        child: Container(
                          decoration: recue ? BoxDecoration(borderRadius: BorderRadius.circular(8), boxShadow: const [BoxShadow(color: Color(0xAA3FBF7F), blurRadius: 10, spreadRadius: 1)]) : null,
                          child: CarteVue(carte, inter: inter, l: l, choisie: e == _EtatCarte.choisie, grisee: e == _EtatCarte.grisee),
                        ),
                      ),
                    );
                  }),
              ]),
            ),
          ),
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
