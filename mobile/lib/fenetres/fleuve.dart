// Le Fleuve (fleuve.md) : deux cartes à remonter étape par étape, le Congo (Kopo) et le Niger (Inter (8)).
// Chaque étape : une petite partie contre des robots avec un objectif, 1 à 3 étoiles. 5 pagaies par jour :
// une se perd à chaque échec. Une escale (une vraie ville) toutes les 10 étapes. Le serveur décide de tout ;
// mêmes écrans que sur le site (src/source.html, « Le Fleuve »).
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../commun/apparences.dart';
import '../commun/jauge.dart';
import '../commun/retention.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../ecrans/accueil.dart' show dureeLisible;
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';
import 'progres.dart' show fenetreManquePieces;
import 'social.dart' show messageErreur;

const _fleuves = {
  'congo': (nom: 'Congo', jeu: 'kopo', jeuNom: 'Kopo'),
  'niger': (nom: 'Niger', jeu: 'inter8', jeuNom: 'Inter (8)'),
  'kasai': (nom: 'Kasaï', jeu: 'kopo', jeuNom: 'Kopo'),
  'oubangui': (nom: 'Oubangui', jeu: 'inter8', jeuNom: 'Inter (8)'),
  'nil': (nom: 'Nil', jeu: 'kopo', jeuNom: 'Kopo'),
};
// Le décor de chaque fleuve (Congo vert, Niger sable, Kasaï terre rouge, Oubangui forêt, Nil désert).
const _decors = {
  'congo': [Color(0xFF1A3B2A), Color(0xFF224A33), Color(0xFF1D4130)],
  'niger': [Color(0xFF3B3220), Color(0xFF4A3D24), Color(0xFF3F3420)],
  'kasai': [Color(0xFF3E2A1E), Color(0xFF4D3424), Color(0xFF42301F)],
  'oubangui': [Color(0xFF123224), Color(0xFF17402C), Color(0xFF133827)],
  'nil': [Color(0xFF4A3F26), Color(0xFF5A4C2C), Color(0xFF4D4128)],
};
/// Les fleuves allumés pour ce joueur (chaque fleuve a son interrupteur dans l'admin), dans l'ordre du serveur.
List<String> fleuvesOuverts() => [for (final k in ((app.etatFleuve?['fleuves'] as Map?) ?? const {}).keys) if (_fleuves.containsKey(k)) '$k'];
/// Le fleuve de l'accueil pour ce jeu : le dernier ouvert par le joueur (s'il est encore allumé), sinon le premier.
String fleuveDuJeu(String jeu) {
  final l = fleuvesOuverts().where((k) => _fleuves[k]!.jeu == jeu).toList();
  final d = (Stock.lire('kopo-fleuve-dernier') as Map?)?[jeu];
  return l.contains(d) ? d as String : l.isNotEmpty ? l.first : (jeu == 'inter8' ? 'niger' : 'congo');
}
void _retenir(String cle) {
  final d = Map<String, dynamic>.from((Stock.lire('kopo-fleuve-dernier') as Map?) ?? const {});
  d[_fleuves[cle]!.jeu] = cle;
  Stock.ecrire('kopo-fleuve-dernier', d);
}
// « le Congo », « l'Oubangui » ; « du Congo », « de l'Oubangui ».
String _le(String n) => RegExp('^[AEIOUÉ]').hasMatch(n) ? "l'$n" : 'le $n';
String _du(String n) => RegExp('^[AEIOUÉ]').hasMatch(n) ? "de l'$n" : 'du $n';
String _leMaj(String n) => '${_le(n)[0].toUpperCase()}${_le(n).substring(1)}';
const _robotsNoms = {'faciles': 'Faciles', 'normaux': 'Normaux', 'forts': 'Forts'};
const _parBief = 50;
final Map<String, int> _biefVu = {};
// Animations à jouer au prochain affichage de la carte : la pirogue qui glisse, la brume qui se lève, le cadenas qui monte.
final Map<String, int> _glisse = {}, _brume = {}, _cadenasVu = {};
const _or = Color(0xFFFFD86B);

String _etoiles(int n) => '★' * n + '☆' * (3 - n);
int _n(Object? x) => (x as num?)?.toInt() ?? 0;

Widget _avatar(Map a, double taille) => Avatar('${a['pseudo'] ?? '?'}', avatar: (a['apparence'] as String?) ?? 'av-laiton', taille: taille);

Widget? _marques(Map? m) {
  if (m == null) return null;
  final l = [if (m['pagayeur'] == true) '🏆 Pagayeur de la semaine', for (final t in ((m['premiers'] as List?) ?? const [])) '⛵ $t'];
  if (l.isEmpty) return null;
  return Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
    for (final t in l)
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: const Color(0x24FFD86B), borderRadius: BorderRadius.circular(99), border: Border.all(color: const Color(0x59FFD86B))),
        child: Text(t, style: K.texte(12, couleur: _or)),
      ),
  ]);
}

/// Un ami touché sur la carte : qui c'est, où il en est, ses marques.
void _ficheAmi(String cle, Map a) {
  final F = _fleuves[cle]!;
  final m = _marques(a);
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Center(child: _avatar(a, 56)),
        const Ecart(8),
        Text('${a['pseudo']}', textAlign: TextAlign.center, style: K.titre(30)),
        Muet(a['n'] == null ? "A fini tout ${_le(F.nom)} ouvert pour l'instant." : 'Étape ${a['n']} ${_du(F.nom)} · ★ ${a['etoiles']}', align: TextAlign.center, taille: 15),
        if (m != null) ...[const Ecart(8), m],
        const Ecart(12),
        Btn('Retour à la carte', large: true, onTap: () => _afficherCarte(cle)),
      ]));
}

/// Course de la semaine : moi et mes amis, au nombre d'étoiles nouvelles depuis lundi.
void _course(String cle) {
  final F = _fleuves[cle]!;
  final f = (app.etatFleuve!['fleuves'] as Map)[cle] as Map, c = f['course'] as Map;
  final lignes = ((c['lignes'] as List?) ?? const []).cast<Map>();
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('${F.nom} · course de la semaine'.toUpperCase(), textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 1)),
        Text('Qui rame le plus ?', textAlign: TextAlign.center, style: K.titre(32)),
        const Ecart(6),
        Text("Le plus d'étoiles nouvelles entre amis d'ici dimanche minuit gagne ${App.formatPieces(_n(c['pieces']))} pièces et la marque « Pagayeur de la semaine ». Personne ne mise.", textAlign: TextAlign.center, style: K.texte(14)),
        const Ecart(10),
        for (var i = 0; i < lignes.length; i++)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: lignes[i]['moi'] == true ? const Color(0x1FFFD86B) : const Color(0x0AFFFFFF),
              borderRadius: BorderRadius.circular(10),
              border: lignes[i]['moi'] == true ? Border.all(color: const Color(0x59FFD86B)) : null,
            ),
            child: Row(children: [
              SizedBox(width: 18, child: Text('${i + 1}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted))),
              const SizedBox(width: 8),
              _avatar(lignes[i], 30),
              const SizedBox(width: 10),
              Expanded(child: Text('${lignes[i]['moi'] == true ? 'Toi' : lignes[i]['pseudo']}${lignes[i]['pagayeur'] == true ? ' 🏆' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(15))),
              Text('★ ${lignes[i]['etoiles']}', style: K.texte(15, couleur: _or, poids: FontWeight.w700)),
            ]),
          ),
        if (_n(c['amis']) == 0) const Muet('Ajoute des amis (Paramètres → Mes amis) pour faire la course avec eux.', align: TextAlign.center)
        else if (lignes.length < 2) const Muet("Aucun de tes amis n'a encore gagné d'étoile cette semaine : il faut au moins un rival pour gagner.", align: TextAlign.center),
        Muet('Fin dans ${_n(c['finMs']) >= 2 * 86400000 ? '${_n(c['finMs']) ~/ 86400000} jours' : dureeLisible(_n(c['finMs']))}.', align: TextAlign.center),
        const Ecart(12),
        Btn('Retour à la carte', large: true, onTap: () => _afficherCarte(cle)),
      ]));
}

void _partager(String cle) {
  final f = (app.etatFleuve!['fleuves'] as Map)[cle] as Map;
  final ou = f['courante'] != null ? 'je suis à ${f['ville']}, étape ${f['courante']}' : "j'ai fini tout ${_le('${f['nom']}')} ouvert";
  ouvrirWhatsApp('Masano · Le Fleuve : $ou, ${f['etoiles']} étoiles. Tu me rattrapes ?\n$lienJeu');
}

/// L'objectif de l'étape, rappelé pendant la partie.
/// La jauge des étoiles en direct pendant une étape (fleuve.md, « Les étoiles en direct »), comme sur le site :
/// l'objectif et son avancée, la 1re étoile dans un anneau, la barre du score avec les crans ★★ et ★★★, le score.
/// Téléphone droit : en haut de la table ; couché : dans l'en-tête ([compacte]). La bulle et le « +4 » sont
/// dessinés à part par [EffetsJaugeFleuve], par-dessus la table, accrochés sous la jauge ([lienJaugeFleuve]).
final lienJaugeFleuve = LayerLink();
const _fleuveBleu = Color(0xFF7FC4E8);

double _ease(double x) => 1 - math.pow(1 - x.clamp(0.0, 1.0), 3).toDouble();
double _pop(double age) => age < 0 ? 1 : age < .28 ? 1 + .7 * _ease(age / .28) : age < .7 ? 1.7 - .7 * _ease((age - .28) / .42) : 1;

/// Rejoue l'animation à chaque nouvel effet (même horloge pour la jauge et ses effets).
mixin _HorlogeEffet<T extends StatefulWidget> on State<T>, SingleTickerProviderStateMixin<T> {
  late final AnimationController horloge = AnimationController(vsync: this, duration: const Duration(milliseconds: 2300), value: 1);
  int? _vu;
  void suivre(EffetJauge? e) {
    if (e == null || e.id == _vu) return;
    _vu = e.id;
    if (app.sansAnim) { horloge.value = 1; } else { horloge.forward(from: 0); }
  }
  double get t => horloge.value * 2.3; // secondes depuis l'effet
  @override
  void dispose() { horloge.dispose(); super.dispose(); }
}

class JaugeFleuve extends StatefulWidget {
  final Map d;
  final EffetJauge? effet;
  final bool compacte;
  const JaugeFleuve(this.d, {super.key, this.effet, this.compacte = false});
  @override
  State<JaugeFleuve> createState() => _JaugeFleuveEtat();
}

class _JaugeFleuveEtat extends State<JaugeFleuve> with SingleTickerProviderStateMixin, _HorlogeEffet {
  @override
  void initState() { super.initState(); suivre(widget.effet); }
  @override
  void didUpdateWidget(JaugeFleuve old) { super.didUpdateWidget(old); suivre(widget.effet); }

  Widget _etoile(String txt, bool allumee, double taille, double echelle) => Transform.scale(
        scale: echelle,
        child: Text(txt, style: TextStyle(fontSize: taille, height: 1, letterSpacing: -1, color: allumee ? _or : Colors.white.withValues(alpha: .22), shadows: allumee ? const [Shadow(color: Color(0x99FFD86B), blurRadius: 8)] : null)),
      );

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: horloge, builder: (context, _) {
        final d = widget.d, e = widget.effet, c = widget.compacte;
        final etat = '${d['etat']}', ok = etat == 'ok', rate = etat == 'rate';
        final sl = (d['seuils'] as Map?) ?? const {};
        final deux = _n(sl['deux']), trois = _n(sl['trois']), score = _n(d['score']);
        final k = e == null ? 1.0 : _ease(t / .6); // la barre et l'anneau glissent en 0,6 s
        final scoreVu = e == null ? score.toDouble() : e.score0 + (score - e.score0) * k;
        final valCible = rate ? 0.0 : ok ? 1.0 : (d['val'] is num ? (d['val'] as num).toDouble() : 0.0);
        final valVu = e == null ? valCible : e.val0 + (valCible - e.val0) * k;
        final max = math.max(trois * 1.12, math.max(score.toDouble(), 1.0));
        final bord = switch (etat) { 'ok' => K.good, 'danger' => K.warn, 'rate' => K.bad, _ => _fleuveBleu };
        double pop(int i) => e != null && e.etoiles.contains(i) ? _pop(t - .35) : 1.0;
        bool rayons(int i) => e != null && e.etoiles.contains(i) && t > .35 && t < 1.25 && !app.sansAnim;
        final r1 = c ? 19.0 : 24.0, rc = c ? 18.0 : 24.0, epais = c ? 6.0 : 8.0;
        final secoue = e != null && e.secoue && t < .45 ? math.sin(t * 40) * 6 * (1 - t / .45) : 0.0;
        return Transform.translate(
          offset: Offset(secoue, 0),
          child: Container(
            padding: EdgeInsets.fromLTRB(c ? 9 : 10, c ? 3 : 6, c ? 9 : 10, c ? 4 : 7),
            decoration: BoxDecoration(color: const Color(0xF010233A), borderRadius: BorderRadius.circular(c ? 11 : 14), border: Border.all(color: bord), boxShadow: c ? null : const [BoxShadow(color: Color(0x59000000), blurRadius: 18, offset: Offset(0, 6))]),
            child: Semantics(
              liveRegion: true,
              label: '${d['texte']} : ${d['prog']}. Score $score.',
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text('🛶 ${d['texte'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(c ? 11 : 12.5))),
                  const SizedBox(width: 8),
                  if ('${d['prog'] ?? ''}'.isNotEmpty)
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: c ? 6 : 8, vertical: c ? 0 : 1),
                      decoration: BoxDecoration(color: bord.withValues(alpha: .2), borderRadius: BorderRadius.circular(99)),
                      child: Text('${d['prog']}', style: K.texte(c ? 10.5 : 12, couleur: Color.lerp(bord, Colors.white, .25)!, poids: FontWeight.w700)),
                    ),
                ]),
                SizedBox(height: c ? 2 : 6),
                Row(children: [
                  SizedBox(width: r1, height: r1, child: Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
                    CustomPaint(size: Size(r1, r1), painter: _Anneau(valVu, ok ? _or : etat == 'danger' ? K.warn : _fleuveBleu)),
                    if (rayons(1)) CustomPaint(size: Size(r1, r1), painter: _Rayons((t - .35) / .9)),
                    _etoile('★', ok, c ? 13 : 17, pop(1)),
                    if (rate) Text('✕', style: K.texte(c ? 16 : 20, couleur: K.bad, poids: FontWeight.w800)),
                  ])),
                  const SizedBox(width: 8),
                  Expanded(child: LayoutBuilder(builder: (context, place) {
                    final w = place.maxWidth - 12;
                    return SizedBox(height: rc + (c ? 0 : 10), child: Stack(clipBehavior: Clip.none, children: [
                      Positioned(left: 0, right: 12, top: rc / 2 - epais / 2, height: epais, child: Container(decoration: BoxDecoration(color: Colors.white.withValues(alpha: .1), borderRadius: BorderRadius.circular(99)))),
                      Positioned(left: 0, width: w * (scoreVu / max).clamp(0.0, 1.0), top: rc / 2 - epais / 2, height: epais,
                          child: Container(decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), gradient: rate ? null : const LinearGradient(colors: [_fleuveBleu, _or]), color: rate ? Colors.white.withValues(alpha: .22) : null))),
                      if (deux > 0 && trois > 0)
                        for (final (i, seuil) in [(2, deux), (3, trois)])
                          Positioned(left: w * seuil / max - rc / 2, top: 0, width: rc, child: Column(children: [
                            Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
                              Container(
                                width: rc, height: rc, alignment: Alignment.center,
                                decoration: BoxDecoration(shape: BoxShape.circle, color: score >= seuil && !rate ? const Color(0xFF2B2A1C) : K.table, border: Border.all(color: score >= seuil && !rate ? _or : Colors.white.withValues(alpha: .25), width: 1.5)),
                                child: _etoile(i == 2 ? '★★' : '★★★', score >= seuil && !rate, i == 2 ? (c ? 7.5 : 9.5) : (c ? 6 : 7.5), pop(i)),
                              ),
                              if (rayons(i)) CustomPaint(size: Size(rc, rc), painter: _Rayons((t - .35) / .9)),
                            ]),
                            if (!c) Text('$seuil', style: K.texte(9.5, couleur: K.muted, poids: FontWeight.w600)),
                          ])),
                    ]));
                  })),
                  const SizedBox(width: 6),
                  Text.rich(TextSpan(children: [TextSpan(text: '$score', style: K.texte(c ? 12 : 14, poids: FontWeight.w700)), TextSpan(text: ' pts', style: K.texte(10, couleur: K.muted, poids: FontWeight.w600))])),
                ]),
              ]),
            ),
          ),
        );
      });
}

/// La bulle (« ★★ 2e étoile ! ») et le « +4 qualifié 1er » sous la jauge, par-dessus la table.
class EffetsJaugeFleuve extends StatefulWidget {
  final EffetJauge? effet;
  const EffetsJaugeFleuve(this.effet, {super.key});
  @override
  State<EffetsJaugeFleuve> createState() => _EffetsJaugeFleuveEtat();
}

class _EffetsJaugeFleuveEtat extends State<EffetsJaugeFleuve> with SingleTickerProviderStateMixin, _HorlogeEffet {
  @override
  void initState() { super.initState(); suivre(widget.effet); }
  @override
  void didUpdateWidget(EffetsJaugeFleuve old) { super.didUpdateWidget(old); suivre(widget.effet); }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: horloge, builder: (context, _) {
        final e = widget.effet;
        if (e == null || horloge.value >= 1) return const SizedBox(width: 300);
        final fond = switch (e.ton) { 'bien' => K.good, 'alerte' => K.warn, 'echec' => K.bad, _ => _or };
        final ob = t < .2 ? t / .2 : t > 1.9 ? ((2.2 - t) / .3).clamp(0.0, 1.0) : 1.0;
        final op = t < .15 ? t / .15 : t > 1.0 ? ((1.4 - t) / .4).clamp(0.0, 1.0) : 1.0;
        return SizedBox(width: 300, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (e.bulle != null && t < 2.2)
            Opacity(opacity: ob, child: Center(child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(99), boxShadow: const [BoxShadow(color: Color(0x73000000), blurRadius: 16, offset: Offset(0, 6))]),
              child: Text(e.bulle!, style: K.texte(13, couleur: const Color(0xFF1A0E02), poids: FontWeight.w700)),
            )))
          else
            const SizedBox(height: 28),
          if (e.plus != null && t < 1.4)
            Transform.translate(offset: Offset(0, 6 - 20 * _ease(t / 1.4)), child: Opacity(opacity: op, child: Align(alignment: Alignment.centerRight, child: Container(
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 1),
              decoration: BoxDecoration(color: K.encre, borderRadius: BorderRadius.circular(99), border: Border.all(color: _or.withValues(alpha: .6))),
              child: Text.rich(TextSpan(children: [
                TextSpan(text: '+${e.plus}', style: K.texte(15, couleur: _or, poids: FontWeight.w800)),
                if (e.plusLabel.isNotEmpty) TextSpan(text: '  ${e.plusLabel}', style: K.texte(11, poids: FontWeight.w600)),
              ])),
            )))),
        ]));
      });
}

class _Anneau extends CustomPainter {
  final double v;
  final Color c;
  _Anneau(this.v, this.c);
  @override
  void paint(Canvas canvas, Size s) {
    final r = Rect.fromLTWH(1.5, 1.5, s.width - 3, s.height - 3);
    canvas.drawArc(r, 0, math.pi * 2, false, Paint()..style = PaintingStyle.stroke..strokeWidth = 2..color = Colors.white.withValues(alpha: .14));
    if (v > 0) canvas.drawArc(r, -math.pi / 2, math.pi * 2 * v.clamp(0.0, 1.0), false, Paint()..style = PaintingStyle.stroke..strokeWidth = 2..strokeCap = StrokeCap.round..color = c);
  }
  @override
  bool shouldRepaint(covariant _Anneau o) => o.v != v || o.c != c;
}

/// Les rayons d'une étoile qui s'allume (k : 0 → 1).
class _Rayons extends CustomPainter {
  final double k;
  _Rayons(this.k);
  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()..color = _or.withValues(alpha: (1 - k).clamp(0.0, 1.0))..strokeWidth = 3..strokeCap = StrokeCap.round;
    final c = s.center(Offset.zero), d = 10 + 22 * _ease(k);
    for (var i = 0; i < 10; i++) {
      final a = i * math.pi / 5, u = Offset(math.sin(a), -math.cos(a));
      canvas.drawLine(c + u * d, c + u * (d + 6), p);
    }
  }
  @override
  bool shouldRepaint(covariant _Rayons o) => o.k != k;
}

Widget _pagaies(Map p, {Key? key, bool perte = false}) {
  final max = _n(p['max']), reste = _n(p['restantes']);
  return Tooltip(
    key: key,
    message: '$reste pagaie${reste > 1 ? 's' : ''} sur $max',
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 0; i < max; i++)
        Padding(
          padding: const EdgeInsets.only(left: 3),
          // Étape ratée : la pagaie qu'on vient de perdre tremble puis se vide.
          child: perte && i == reste && !app.sansAnim
              ? TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1), duration: const Duration(milliseconds: 1500),
                  builder: (_, v, enfant) => Transform.rotate(angle: v < .8 ? math.sin(v / .8 * math.pi * 6) * .25 : 0, alignment: Alignment.topCenter, child: Opacity(opacity: v < .8 ? 1 : 1 - (v - .8) / .2 * .78, child: enfant)),
                  child: CustomPaint(size: const Size(12, 28), painter: _Pagaie()),
                )
              : Opacity(opacity: i < reste ? 1 : .22, child: CustomPaint(size: const Size(12, 28), painter: _Pagaie())),
        ),
    ]),
  );
}

class _Pagaie extends CustomPainter {
  @override
  void paint(Canvas c, Size s) {
    final bois = Paint()..color = const Color(0xFFC99A52);
    final trait = Paint()..color = const Color(0xFF6B4A1C)..style = PaintingStyle.stroke..strokeWidth = 1;
    final w = s.width, h = s.height;
    final manche = Rect.fromLTWH(w / 2 - 1, 1, 2, h * .5);
    final pelle = Path()..addOval(Rect.fromLTWH(1, h * .48, w - 2, h * .5));
    c.drawRect(manche, bois); c.drawRect(manche, trait);
    c.drawPath(pelle, bois); c.drawPath(pelle, trait);
  }
  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

// Ce qui se voit sur la carte, sans les comptes à rebours : on ne la redessine que si ça a changé.
Object? _sansChronos(Object? v) => v is Map
    ? {for (final x in v.entries) if (x.key != 'retourMs' && x.key != 'finMs') x.key.toString(): _sansChronos(x.value)}
    : v is List ? [for (final x in v) _sansChronos(x)] : v;
String _empreinte(Object? e) => jsonEncode(_sansChronos(e));

Future<void> ouvrirFleuve([String? cle]) async {
  // Déjà lu pour la carte de l'accueil : la carte s'ouvre tout de suite, puis se met à jour en silence.
  final deja = app.etatFleuve ?? (app.enLigne ? app.etatFleuveGarde() : null);
  if (app.etatFleuve == null && deja != null) app.etatFleuve = deja; // gardé du lancement d'avant
  if (deja != null && deja['ouvert'] == true && deja['google'] == true && app.enLigne && fleuvesOuverts().isNotEmpty) {
    _afficherCarte(cle != null && fleuvesOuverts().contains(cle) ? cle : fleuveDuJeu(app.jeu == 'inter8' ? 'inter8' : 'kopo'));
    app.lireEtatFleuve().then((nouveau) {
      final avant = app.etatFleuve;
      if (nouveau['ouvert'] != true || nouveau['google'] != true) return;
      // Un fleuve éteint entre-temps : on garde l'ancien état tant que sa carte est ouverte.
      final f = (nouveau['fleuves'] as Map?) ?? const {};
      if (!fleuvesOuverts().every(f.containsKey)) return;
      final change = _empreinte(nouveau) != _empreinte(avant);
      app.etatFleuve = nouveau;
      if (change) { app.reglerMissionsFleuve(); app.maj(); }
    }, onError: (_) {});
    return;
  }
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    app.etatFleuve = await app.lireEtatFleuve();
  } catch (x) { app.toast(messageErreur(x), Niv.echec); return; }
  final e = app.etatFleuve!;
  if (e['ouvert'] != true) { app.toast('Le Fleuve arrive bientôt.', Niv.alerte); return; }
  if (e['google'] != true) {
    fenetreGoogle('Le Fleuve', 'Remonte le Congo et le Niger, étape par étape, et gagne des étoiles. Connecte-toi avec Google pour jouer : ta progression te suit sur tous tes téléphones.');
    return;
  }
  if (fleuvesOuverts().isEmpty) { app.toast('Le Fleuve arrive bientôt.', Niv.alerte); return; }
  _afficherCarte(cle != null && fleuvesOuverts().contains(cle) ? cle : fleuveDuJeu(app.jeu == 'inter8' ? 'inter8' : 'kopo'));
}

void _afficherCarte(String cle) {
  app.ouvrirFenetre((context) => _CarteFleuve(cle), 'fleuve');
}

class _CarteFleuve extends StatefulWidget {
  final String cle;
  const _CarteFleuve(this.cle);
  @override
  State<_CarteFleuve> createState() => _CarteFleuveState();
}

class _CarteFleuveState extends State<_CarteFleuve> {
  late String cle = widget.cle;
  final kPagaies = GlobalKey(), kOnglets = GlobalKey();
  @override
  Widget build(BuildContext context) {
    final E = app.etatFleuve!, f = (E['fleuves'] as Map)[cle] as Map, F = _fleuves[cle]!;
    _retenir(cle);
    final p = E['pagaies'] as Map;
    if (_n(f['courante']) > 0) _prechargerEtape(cle, _n(f['courante'])); // l'étape qu'on va toucher : sa fenêtre s'ouvrira sans attente
    final etapes = ((f['etapes'] as List?) ?? []).cast<Map>();
    final enfants = <Widget>[
      Row(children: [Expanded(child: Text(_leMaj(F.nom), style: K.titre(36))), _pagaies(p, key: kPagaies)]),
      const Ecart(8),
      KeyedSubtree(key: kOnglets, child: Onglets([for (final k in fleuvesOuverts()) (k, '${_fleuves[k]!.nom} · ${_fleuves[k]!.jeuNom}')], cle, (k) => setState(() => cle = k))),
      const Ecart(8),
      Row(children: [
        Text('Étoiles ', style: K.texte(13, couleur: K.muted)),
        Text('★ ${f['etoiles']}', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700)),
        const Spacer(),
        Flexible(child: Muet(_n(p['restantes']) < _n(p['max']) ? 'Nouvelles pagaies dans ${dureeLisible(_n(p['retourMs']))}' : 'Une pagaie se perd à chaque échec', taille: 13, align: TextAlign.right)),
      ]),
      const Ecart(8),
    ];
    if (_n(f['publiees']) == 0) {
      enfants.add(Text('${_leMaj(F.nom)} ouvre bientôt. Reviens dans quelques jours !', style: K.texte(15)));
    } else {
      final biefMax = math.max(1, (etapes.length / _parBief).ceil());
      final bief = math.min(biefMax, _biefVu[cle] ?? _n(f['bief']));
      _biefVu[cle] = bief;
      final debut = (bief - 1) * _parBief + 1;
      final ici = etapes.where((e) => _n(e['n']) >= debut && _n(e['n']) < debut + _parBief).toList();
      final villes = ici.where((e) => e['escale'] == true).map((e) => e['ville'].toString()).toList();
      final course = ((f['course'] as Map?)?['lignes'] as List?)?.cast<Map>() ?? const <Map>[];
      final m = _marques(f['marques'] as Map?);
      enfants.addAll([
        Row(children: [
          Expanded(child: Btn(course.length > 1 ? '🏁 Course : ${course.first['moi'] == true ? 'tu mènes' : '${course.first['pseudo']} mène'}' : '🏁 Course de la semaine', onTap: () => _course(cle))),
          const SizedBox(width: 8),
          Expanded(child: Btn('Partager', onTap: () => _partager(cle))),
        ]),
        const Ecart(8),
        if (m != null) ...[m, const Ecart(8)],
        Row(children: [
          TextButton(onPressed: bief <= 1 ? null : () => setState(() => _biefVu[cle] = bief - 1), child: Text('‹ Avant', style: K.texte(13, couleur: bief <= 1 ? K.muted : K.brass))),
          Expanded(child: Text('Bief $bief${villes.isEmpty ? '' : ' · ${villes.first}${villes.length > 1 ? ' → ${villes.last}' : ''}'}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted))),
          TextButton(onPressed: bief >= biefMax ? null : () => setState(() => _biefVu[cle] = bief + 1), child: Text('Après ›', style: K.texte(13, couleur: bief >= biefMax ? K.muted : K.brass))),
        ]),
        _Carte(key: ValueKey('$cle:$bief'), cle: cle, f: f, etapes: ici, kPagaies: kPagaies, kOnglets: kOnglets),
      ]);
    }
    enfants.addAll([const Ecart(10), Btn('Fermer', large: true, onTap: () { app.fermerFenetre(); app.maj(); })]);
    return Fenetre(largeur: 460, enfants: enfants);
  }
}

/// La carte : le fleuve serpente de bas en haut (on le remonte depuis la mer), une étape tous les 74 px.
class _Carte extends StatefulWidget {
  final String cle;
  final Map f;
  final List<Map> etapes;
  final GlobalKey kPagaies, kOnglets;
  const _Carte({super.key, required this.cle, required this.f, required this.etapes, required this.kPagaies, required this.kOnglets});
  @override
  State<_Carte> createState() => _CarteState();
}

class _CarteState extends State<_Carte> with TickerProviderStateMixin {
  final defile = ScrollController();
  static const pas = 74.0, bas = 70.0;
  bool place = false;
  final kCourante = GlobalKey(), kEscale = GlobalKey();
  int? glisseDe, brume, cadenasAvant;
  late final AnimationController glisse, leve;
  @override
  void initState() {
    super.initState();
    glisseDe = _glisse.remove(widget.cle);
    brume = _brume.remove(widget.cle);
    glisse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
    leve = AnimationController(vsync: this, duration: const Duration(milliseconds: 3000));
    if (app.sansAnim) { glisseDe = null; brume = null; }
    if (glisseDe != null) Future.delayed(const Duration(milliseconds: 350), () { if (mounted) glisse.forward(); });
    if (brume != null) leve.forward();
  }
  @override
  void dispose() { glisse.dispose(); leve.dispose(); defile.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final f = widget.f, etapes = widget.etapes, courante = f['courante'];
    final hautVue = math.min(MediaQuery.of(context).size.height * .55, 520.0);
    final suite = f['suiteBientot'] == true && etapes.isNotEmpty && _n(etapes.last['n']) == _n(f['publiees']);
    final haut = suite ? 110.0 : 60.0;
    return LayoutBuilder(builder: (context, c) {
      final L = math.min(380.0, c.maxWidth);
      final H = bas + haut + pas * math.max(0, etapes.length - 1);
      Offset pos(num i) => Offset(L / 2 + (L / 2 - 52) * math.sin(i * .72), H - bas - i * pas);
      final pts = [for (var i = 0; i < etapes.length; i++) pos(i)];
      final iCour = etapes.indexWhere((e) => e['n'] == courante);
      if (!place) {
        place = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!defile.hasClients) return;
          final cible = iCour >= 0 ? pts[iCour].dy - hautVue / 2 : H;
          defile.jumpTo(cible.clamp(0.0, defile.position.maxScrollExtent));
          _guide(context, widget.cle, kCourante: kCourante, kEscale: kEscale, kPagaies: widget.kPagaies, kOnglets: widget.kOnglets);
        });
      }
      final enfants = <Widget>[Positioned.fill(child: CustomPaint(painter: _Lit(pts, L, H)))];
      for (var i = 0; i < etapes.length; i++) {
        final e = etapes[i], p = pts[i];
        final n = _n(e['n']), et = _n(e['etoiles']), escale = e['escale'] == true;
        final cour = e['n'] == courante, ferme = et == 0 && !cour;
        final t = escale ? 54.0 : 40.0;
        if (escale) {
          final droite = p.dx > L / 2;
          enfants.add(Positioned(
            top: p.dy - 12, left: droite ? null : p.dx + 36, right: droite ? L - p.dx + 36 : null,
            child: IgnorePointer(child: Text(e['ville'].toString().toUpperCase(), style: K.titre(20, couleur: const Color(0xFFFFF3D0)).copyWith(shadows: const [Shadow(color: Color(0x99000000), blurRadius: 4, offset: Offset(0, 2))]))),
          ));
        }
        final premiereEscale = escale && et == 0 && !etapes.take(i).any((x) => x['escale'] == true && _n(x['etoiles']) == 0);
        enfants.add(Positioned(
          key: cour ? kCourante : premiereEscale ? kEscale : null,
          left: p.dx - t / 2, top: p.dy - t / 2, width: t, height: t + 14,
          child: Semantics(
            button: true,
            label: 'Étape $n${escale ? ', ${e['ville']}' : ''}${et > 0 ? ', $et étoile${et > 1 ? 's' : ''}' : ferme ? ', fermée' : ''}',
            child: GestureDetector(
              onTap: () => ouvrirEtapeFleuve(widget.cle, n),
              child: Column(children: [
                Container(
                  width: t, height: t, alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: cour ? Colors.white : et > 0 ? K.brass : ferme ? const Color(0xFF3A4A58) : const Color(0xFF2B5E86),
                    borderRadius: BorderRadius.circular(escale ? 14 : t / 2),
                    border: Border.all(color: cour ? K.brass : ferme ? const Color(0xFF6C7A88) : et > 0 ? const Color(0xFFFFF3D0) : const Color(0xFFF3E7C9), width: 3),
                    boxShadow: ferme ? null : const [BoxShadow(color: Color(0x59000000), offset: Offset(0, 3))],
                  ),
                  child: Text('$n', style: K.texte(escale ? 16 : 14, poids: FontWeight.w700, couleur: cour || et > 0 ? K.encre : ferme ? const Color(0xFF8A9AAB) : Colors.white)),
                ),
                if (et > 0) Text(_etoiles(et), style: const TextStyle(fontSize: 10, color: _or, height: 1.2, shadows: [Shadow(color: Colors.black, blurRadius: 2)])),
              ]),
            ),
          ),
        ));
        if (cour) {
          // Étape réussie : la pirogue glisse sur le fleuve depuis l'étape d'avant.
          final j0 = glisseDe == null ? -1 : etapes.indexWhere((x) => _n(x['n']) == glisseDe);
          enfants.add(AnimatedBuilder(
            animation: glisse,
            builder: (_, enfant) {
              final q = j0 >= 0 && j0 < i && glisse.value < 1 ? pos(j0 + (i - j0) * Curves.easeInOut.transform(glisse.value)) : p;
              return Positioned(left: q.dx - 13, top: q.dy - t / 2 - 30, child: enfant!);
            },
            child: const IgnorePointer(child: Text('🛶', style: TextStyle(fontSize: 24))),
          ));
          // Ville fermée : le cadenas et le compteur d'étoiles de la ville ; il monte étoile par étoile.
          final seuil = _n(app.etatFleuve?['etoilesVille'] ?? 20), v = e['villeEtoiles'];
          if (escale && v != null && _n(v) < seuil) {
            final cleCad = '${widget.cle}$n', avant = _cadenasVu[cleCad];
            _cadenasVu[cleCad] = _n(v);
            enfants.add(Positioned(
              left: p.dx - 50, width: 100, top: p.dy + t / 2 + 4,
              child: IgnorePointer(child: Center(child: TweenAnimationBuilder<double>(
                tween: Tween(begin: (avant != null && avant < _n(v) && !app.sansAnim ? avant : _n(v)).toDouble(), end: _n(v).toDouble()),
                duration: Duration(milliseconds: 350 * (avant != null && avant < _n(v) ? _n(v) - avant : 0)),
                builder: (_, x, _) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFF1D1606), borderRadius: BorderRadius.circular(99), border: Border.all(color: const Color(0x80FFD86B))),
                  child: Text('🔒 ${x.round()} / $seuil ★', style: K.texte(12, couleur: _or, poids: FontWeight.w700)),
                ),
              ))),
            ));
          }
        }
        if (escale && et > 0) enfants.add(Positioned(left: p.dx + t / 2 - 10, top: p.dy - t / 2 - 10, child: const IgnorePointer(child: Text('🪙', style: TextStyle(fontSize: 16))))); // coffre ouvert
        // Mes amis posés sur leur étape (ceux qui ont tout fini : sur la dernière). Touchés : leur fiche.
        final amisIci = ((f['amis'] as List?) ?? const []).cast<Map>().where((a) => (a['n'] == null ? _n(f['publiees']) : _n(a['n'])) == n).toList();
        if (amisIci.isNotEmpty) {
          final droite = p.dx > L / 2;
          final vus = amisIci.take(3).toList();
          enfants.add(Positioned(
            top: p.dy - t / 2 - 22, left: droite ? null : p.dx + 16, right: droite ? L - p.dx + 16 : null, // à côté de la pirogue, pas dessus
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              for (var k = 0; k < vus.length; k++)
                Transform.translate(
                  offset: Offset(-8.0 * k, 0),
                  child: Semantics(button: true, label: '${vus[k]['pseudo']}', child: GestureDetector(
                    onTap: () => _ficheAmi(widget.cle, vus[k]),
                    child: Container(decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFFFF3D0), width: 2), boxShadow: const [BoxShadow(color: Color(0x73000000), blurRadius: 3, offset: Offset(0, 2))]), child: _avatar(vus[k], 26)),
                  )),
                ),
              if (amisIci.length > 3)
                Transform.translate(offset: Offset(-8.0 * vus.length, 0), child: GestureDetector(
                  onTap: () => _ficheAmi(widget.cle, amisIci[3]),
                  child: Container(width: 30, height: 30, alignment: Alignment.center, decoration: BoxDecoration(shape: BoxShape.circle, color: const Color(0xFF1D1606), border: Border.all(color: const Color(0xFFFFF3D0), width: 2)), child: Text('+${amisIci.length - 3}', style: K.texte(11, couleur: const Color(0xFFFFF3D0)))),
                )),
            ]),
          ));
        }
      }
      if (suite) enfants.add(Positioned(top: 24, left: 0, right: 0, child: Text('La suite du fleuve arrive bientôt…', textAlign: TextAlign.center, style: K.texte(13, couleur: const Color(0xFFFFF3D0)))));
      return Container(
        height: hautVue,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: K.line),
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: _decors[widget.cle] ?? _decors['congo']!),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(children: [
          SingleChildScrollView(
            controller: defile,
            child: Center(child: SizedBox(width: L, height: H, child: Stack(clipBehavior: Clip.none, children: enfants))),
          ),
          // Fin d'un bief : la brume qui cachait la suite se lève, avec le bandeau.
          if (brume != null) AnimatedBuilder(
            animation: leve,
            builder: (_, _) {
              final v = leve.value;
              if (v >= 1) return const SizedBox.shrink();
              final b = v < .3 ? 1.0 : 1 - (v - .3) / .6;
              final s = v < .12 ? Curves.easeOutBack.transform(v / .12) : 1.0;
              final o = v < .05 ? v / .05 : v > .85 ? (1 - v) / .15 : 1.0;
              return IgnorePointer(child: Stack(children: [
                Positioned.fill(child: Transform.translate(offset: Offset(0, -hautVue * .4 * (1 - b.clamp(0.0, 1.0))), child: Opacity(opacity: b.clamp(0.0, 1.0), child: const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xF7DCE8EE), Color(0xD9DCE8EE), Color(0x00DCE8EE)], stops: [0, .7, 1])))))),
                Align(alignment: const Alignment(0, -.2), child: Opacity(opacity: o.clamp(0.0, 1.0), child: Transform.scale(scale: s, child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(color: K.brass, borderRadius: BorderRadius.circular(14), boxShadow: const [BoxShadow(color: Color(0x73000000), blurRadius: 20, offset: Offset(0, 8))]),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text('Bief ${brume! - 1} terminé !', style: K.titre(22, couleur: K.encre)),
                    Text("Le bief $brume s'ouvre", style: K.texte(13, couleur: K.encre, poids: FontWeight.w600)),
                  ]),
                )))),
              ]));
            },
          ),
        ]),
      );
    });
  }
}

/// Le lit du fleuve : une courbe douce qui passe par chaque étape, prolongée vers la mer et vers l'amont.
class _Lit extends CustomPainter {
  final List<Offset> pts;
  final double L, H;
  _Lit(this.pts, this.L, this.H);
  @override
  void paint(Canvas c, Size s) {
    final tous = [Offset(pts.isEmpty ? L / 2 : pts.first.dx, H + 20), ...pts, Offset(pts.isEmpty ? L / 2 : pts.last.dx, -20)];
    final p = Path()..moveTo(tous.first.dx, tous.first.dy);
    for (var i = 1; i < tous.length; i++) {
      final a = tous[i - 1], b = tous[i], my = (a.dy + b.dy) / 2;
      p.cubicTo(a.dx, my, b.dx, my, b.dx, b.dy);
    }
    c.drawPath(p, Paint()..color = const Color(0xFF2F7FB4)..style = PaintingStyle.stroke..strokeWidth = 30..strokeCap = StrokeCap.round..strokeJoin = StrokeJoin.round);
    c.drawPath(p, Paint()..color = const Color(0x8C5AA9D8)..style = PaintingStyle.stroke..strokeWidth = 14..strokeCap = StrokeCap.round);
  }
  @override
  bool shouldRepaint(covariant _Lit old) => old.pts != pts || old.L != L || old.H != H;
}

Widget _ligneEtoiles(int n, {double taille = 34}) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      for (var i = 0; i < 3; i++) Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: Text('★', style: TextStyle(fontSize: taille, height: 1, color: i < n ? _or : const Color(0x2EFFFFFF)))),
    ]);

/// « Du premier coup » (fleuve.md), comme sur le site : avant l'étape, la part des joueurs qui l'ont réussie à
/// leur premier essai ; à la fin d'un premier essai ([r]), ta place parmi eux. pct null : étape toute neuve.
Widget? preuveFleuve(Map pc, {Map? r}) {
  final pct = pc['pct'] == null ? null : _n(pc['pct']), joueurs = _n(pc['joueurs']);
  final reussi = r != null && r['reussi'] == true;
  String grand, texte;
  String? petit;
  if (r == null) {
    if (pct == null) { grand = '🌱'; texte = joueurs > 0 ? "Étape toute neuve : encore peu de joueurs l'ont tentée." : "Étape toute neuve : personne ne l'a encore tentée."; petit = 'Sois parmi les premiers à la réussir.'; }
    else { grand = '$pct %'; texte = "des pagayeurs l'ont réussie du premier coup."; petit = "Sur $joueurs joueurs qui l'ont tentée."; }
  } else if (reussi) {
    grand = '🎯';
    if (pct == null) { texte = 'Du premier coup ! Tu es parmi les premiers à passer cette étape.'; }
    else if (pct < 50) { texte = 'Du premier coup ! Seuls $pct % des pagayeurs y arrivent.'; petit = 'Tu fais partie des meilleurs sur cette étape.'; }
    else { texte = 'Du premier coup ! Comme $pct % des pagayeurs.'; }
  } else {
    if (pct == null) return null;
    grand = '${100 - pct} %'; texte = 'des pagayeurs ont aussi raté leur premier essai.'; petit = 'Pas de honte : retente ta chance.';
  }
  final teinte = reussi ? _or : _fleuveBleu;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(color: teinte.withValues(alpha: .12), borderRadius: BorderRadius.circular(12), border: Border.all(color: teinte.withValues(alpha: .4))),
    child: Row(children: [
      Text(grand, style: K.titre(26, couleur: reussi ? _or : const Color(0xFF9FD8F2))),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(texte, style: K.texte(13.5)),
        if (petit != null) Text(petit, style: K.texte(11.5, couleur: K.muted)),
      ])),
    ]),
  );
}

/// Détail de l'étape courante lu d'avance pendant que la carte s'affiche (servi une fois, frais d'une minute au plus).
final _etapesLues = <String, (DateTime, Future<dynamic>)>{};
bool _frais(DateTime quand) => DateTime.now().difference(quand).inSeconds < 60;
void _prechargerEtape(String cle, int n) {
  final k = '$cle/$n', d = _etapesLues[k];
  if (d != null && _frais(d.$1)) return;
  final lecture = Api.get('/fleuve/$k');
  lecture.then((_) {}, onError: (_) {});
  _etapesLues[k] = (DateTime.now(), lecture);
}
Future<dynamic> _lireEtape(String cle, int n) async {
  final k = '$cle/$n', d = _etapesLues.remove(k);
  if (d != null && _frais(d.$1)) { try { return await d.$2; } catch (_) {} }
  return Api.get('/fleuve/$k');
}

Future<void> ouvrirEtapeFleuve(String cle, int n) async {
  Map e;
  try { e = await _lireEtape(cle, n) as Map; } catch (x) { app.toast(messageErreur(x), Niv.echec); return; }
  final F = _fleuves[cle]!;
  final adv = _n(e['joueurs']) - 1, et = _n(e['etoiles']);
  final seuils = (e['seuils'] as Map?) ?? {};
  final p = (e['pagaies'] as Map?) ?? {};
  final pieges = ((e['pieges'] as List?) ?? []).cast<Map>();
  // La première fois qu'on bute sur une ville : l'astuce du guide.
  var astuce = false;
  if (e['escale'] == true && e['villeEtoiles'] != null && _n(e['villeEtoiles']) < _n(e['etoilesVille']) && et == 0) {
    final vu = Map<String, dynamic>.from((Stock.lire('kopo-fleuve-guide') as Map?) ?? const {});
    if (vu['ville'] != true) { astuce = true; vu['ville'] = true; Stock.ecrire('kopo-fleuve-guide', vu); }
  }
  Widget ligne(String etoiles, String t) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 48, child: Text(etoiles, style: K.texte(13, couleur: _or))), Expanded(child: Text(t, style: K.texte(13)))]),
      );
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('${F.nom} · étape ${e['numero']}${e['escale'] == true ? ' · boss de ${e['ville']}' : ' · vers ${e['ville']}'}'.toUpperCase(), textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 1)),
        if (et > 0) ...[const Ecart(6), _ligneEtoiles(et)],
        const Ecart(8),
        Text('${e['texte']}', textAlign: TextAlign.center, style: K.texte(19, poids: FontWeight.w700)),
        const Ecart(6),
        Muet('${F.jeuNom} contre $adv robot${adv > 1 ? 's' : ''} ${_robotsNoms[e['robots']] ?? ''}${e['robots'] == 'forts' && _n(e['force']) >= 15 ? ' (très forts)' : ''}.', taille: 15, align: TextAlign.center),
        for (final x in pieges) Padding(padding: const EdgeInsets.only(top: 4), child: Text('⚠ ${x['texte']}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.warn))),
        if (e['premierCoup'] is Map) ...[const Ecart(10), ?preuveFleuve(e['premierCoup'] as Map)],
        const Ecart(10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0x0DFFFFFF), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ligne('★', "Réussis l'objectif"),
            if (_n(seuils['trois']) > _n(seuils['deux'])) ligne('★★', 'Réussis avec un score de ${seuils['deux']} ou plus'),
            ligne('★★★', 'Réussis avec un score de ${seuils['trois']} ou plus${_n(seuils['trois']) > _n(seuils['deux']) ? '' : ' (2e et 3e étoiles)'}'),
            Muet('Score : à chaque manche, quand tu sors, 1 point par adversaire encore en jeu ; +10 si tu gagnes la partie.${F.jeu == 'inter8' ? ' Et 1 point toutes les 2 cartes que tu fais piocher.' : ''}', taille: 12),
          ]),
        ),
        if (e['escale'] == true && e['villeEtoiles'] != null && et == 0) ...[const Ecart(8), Text('Pour affronter le boss de ${e['ville']}, il te faut ${e['etoilesVille']} étoiles dans la ville : tu en as ${e['villeEtoiles']}.', textAlign: TextAlign.center, style: K.texte(14, couleur: K.muted))],
        if (astuce) ...[const Ecart(8), Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(color: const Color(0xFFFFF3D0), borderRadius: BorderRadius.circular(12)),
          child: Text('💡 Rejoue une étape où il te manque des étoiles : chaque étoile gagnée compte pour la ville.', style: K.texte(13.5, couleur: K.encre)),
        )],
        const Ecart(10),
        if (e['refus'] != null) Text('${e['refus']}', textAlign: TextAlign.center, style: K.texte(14, couleur: K.warn))
        else if (_n(p['restantes']) <= 0) ...[
          Text('Ta pirogue se repose. Nouvelles pagaies dans ${dureeLisible(_n((app.etatFleuve?['pagaies'] as Map?)?['retourMs']))}.', textAlign: TextAlign.center, style: K.texte(14, couleur: K.warn)),
          if (p['prix'] != null) ...[const Ecart(10), _boutonPagaie(p, () => ouvrirEtapeFleuve(cle, _n(e['numero'])))],
        ]
        else ...[
          Muet("Si tu échoues, tu perds une pagaie (il t'en reste ${p['restantes']}).", align: TextAlign.center),
          const Ecart(10),
          Btn.principal(et > 0 ? (et < 3 ? "Rejouer pour plus d'étoiles" : 'Rejouer') : 'Jouer', large: true, onTap: () => app.jouerEtapeFleuve(cle, _n(e['numero']))),
        ],
        const Ecart(8),
        Btn('Retour à la carte', large: true, onTap: () => _afficherCarte(cle)),
      ]));
}

/// Plus de pagaies : en acheter une avec ses pièces (prix du tableau de bord, qui monte à chaque achat du jour).
/// Ces pièces sont détruites. À n'afficher que si `p['prix']` n'est pas null.
Widget _boutonPagaie(Map p, VoidCallback apres) {
  var occupe = false;
  return StatefulBuilder(builder: (context, maj) => Btn.principal(
        'Acheter une pagaie · ${App.formatPieces(_n(p['prix']))} pièces',
        large: true,
        onTap: occupe ? null : () async {
          final prix = _n(p['prix']);
          if (app.solde < prix) { fenetreManquePieces(prix - app.solde, 'pour cette pagaie'); return; }
          maj(() => occupe = true);
          try {
            final r = await Api.post('/fleuve/pagaie') as Map;
            app.soldeServeur(r['solde']);
            try { app.etatFleuve = await app.lireEtatFleuve(neuf: true); } catch (_) {}
            app.toast('Nouvelle pagaie : −${App.formatPieces(_n(r['paye']))} pièces', Niv.succes);
            app.maj();
            apres();
          } catch (x) {
            if (context.mounted) maj(() => occupe = false);
            app.toast(messageErreur(x), Niv.echec);
          }
        },
      ));
}

/// Fin d'une étape : étoiles, pièces, pagaies, et la suite.
Future<void> resultatFleuve(Map r) async {
  final cle = '${r['fleuve']}';
  final F = _fleuves[cle] ?? _fleuves['congo']!;
  final reussi = r['reussi'] == true, et = _n(r['etoiles']);
  final seuils = (r['seuils'] as Map?) ?? {};
  final reste = _n((r['pagaies'] as Map?)?['restantes']);
  if (r['solde'] != null) app.soldeServeur(r['solde']);
  try { app.etatFleuve = await app.lireEtatFleuve(neuf: true); } catch (_) {}
  final f = (app.etatFleuve?['fleuves'] as Map?)?[cle] as Map?;
  final achat = (app.etatFleuve?['pagaies'] as Map?) ?? (r['pagaies'] as Map?) ?? const {};
  final depasses = ((r['depasses'] as List?) ?? const []).map((x) => '$x').toList();
  final suivante = reussi && f != null && f['courante'] != null && f['courante'] != r['numero'] ? _n(f['courante']) : null;
  // La carte, au prochain affichage : la pirogue glisse, et la brume se lève si le bief est fini.
  if (reussi && f != null && f['courante'] != null && _n(f['courante']) > _n(r['numero'])) { _glisse[cle] = _n(r['numero']); _biefVu[cle] = _n(f['bief']); }
  if (reussi && r['biefTermine'] == true && f != null) _brume[cle] = _n(f['bief']);
  // Missions du jour qui visent le Fleuve.
  LigneMission? mission;
  try {
    final p = app.lireProfil(), ms = R.compterFleuve(p, cle, reussi, _n(r['nouvelles']), app.jourLocal());
    if (ms.isNotEmpty) {
      app.ecrireProfil(p); app.sauvegarderProfil();
      mission = ms.firstWhere((m) => m.finie && m.avant < m.cible, orElse: () => ms.first);
    }
  } catch (_) {}
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('${F.nom} · étape ${r['numero']}${r['escale'] == true ? ' · ${r['ville']}' : ''}'.toUpperCase(), textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 1)),
        const Ecart(6),
        if (reussi && r['escale'] == true && r['premiereFois'] == true) const Center(child: _Coffre()),
        Text(reussi ? (r['escale'] == true && r['premiereFois'] == true ? '${r['ville']} est passée !' : 'Étape réussie !') : r['parti'] == true ? 'Étape abandonnée' : 'Pas cette fois…', textAlign: TextAlign.center, style: K.titre(36)),
        const Ecart(8),
        TweenAnimationBuilder<double>(
          tween: Tween(begin: app.sansAnim ? 3 : 0, end: 3), duration: const Duration(milliseconds: 1200),
          builder: (_, v, _) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 0; i < 3; i++)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: Transform.scale(
                  scale: i < et ? Curves.easeOutBack.transform(((v - i) * 1.5).clamp(0.0, 1.0)) : 1,
                  child: Text('★', style: TextStyle(fontSize: 38, height: 1, color: i < et ? _or : const Color(0x2EFFFFFF))),
                ),
              ),
          ]),
        ),
        if (r['premierEssai'] == true && r['premierCoup'] is Map && r['parti'] != true) ...[const Ecart(10), ?preuveFleuve(r['premierCoup'] as Map, r: r)],
        const Ecart(8),
        Text('${r['texte']}${reussi ? ' : réussi.' : ' : raté.'}', textAlign: TextAlign.center, style: K.texte(15)),
        if (reussi) ...[
          Muet('Score ${r['score']} · ★★ à ${seuils['deux']} · ★★★ à ${seuils['trois']}', align: TextAlign.center, taille: 12),
          if (_n(r['pieces']) > 0) Text('+${App.formatPieces(_n(r['pieces']))} pièces${r['double'] == true ? ' (doublées : première étape réussie du jour)' : ''}${r['piecesEscale'] != null ? ', dont ${App.formatPieces(_n(r['piecesEscale']))} pour la ville' : ''}', textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted)),
          if (r['biefTermine'] == true) Text("Bief terminé : un nouveau morceau du fleuve t'attend.", textAlign: TextAlign.center, style: K.texte(14)),
          if (depasses.isNotEmpty) ...[const Ecart(6), TweenAnimationBuilder<double>(
            tween: Tween(begin: app.sansAnim ? 1 : .6, end: 1), duration: const Duration(milliseconds: 500), curve: Curves.easeOutBack,
            builder: (_, v, enfant) => Transform.scale(scale: v, child: enfant),
            child: Text('Tu passes ${depasses.take(2).join(' et ')}${depasses.length > 2 ? ' et ${depasses.length - 2} autre${depasses.length > 3 ? 's' : ''}' : ''} !', textAlign: TextAlign.center, style: K.titre(24, couleur: _or)),
          )],
          if (r['premierA'] != null) ...[const Ecart(6), Text('⛵ Premier de tes amis à ${r['premierA']} : la marque « 1er à ${r['premierA']} » est à toi.', textAlign: TextAlign.center, style: K.texte(13, couleur: _or))],
        ] else ...[
          Center(child: _pagaies((r['pagaies'] as Map?) ?? const {}, perte: true)),
          const Ecart(4),
          Muet("Une pagaie perdue. Il t'en reste $reste.", align: TextAlign.center),
        ],
        if (mission != null) ...[
          const Ecart(6),
          mission.finie && mission.avant < mission.cible
              ? Text('✓ Mission finie : ${mission.texte} (+${mission.pieces} pièces à encaisser)', textAlign: TextAlign.center, style: K.texte(13, couleur: _or))
              : Muet('Mission : ${mission.texte} · ${mission.apres} / ${mission.cible}', align: TextAlign.center, taille: 12),
        ],
        const Ecart(12),
        if (suivante != null) ...[Btn.principal('Étape $suivante', large: true, onTap: () => ouvrirEtapeFleuve(cle, suivante)), const Ecart(8)],
        if (reste > 0 && (!reussi || et < 3)) ...[
          reussi ? Btn("Rejouer pour plus d'étoiles", large: true, onTap: () => ouvrirEtapeFleuve(cle, _n(r['numero']))) : Btn.principal('Réessayer', large: true, onTap: () => ouvrirEtapeFleuve(cle, _n(r['numero']))),
          const Ecart(8),
        ],
        if (!reussi && reste <= 0 && achat['prix'] != null) ...[_boutonPagaie(achat, () => ouvrirEtapeFleuve(cle, _n(r['numero']))), const Ecart(8)],
        Btn('Voir la carte', large: true, onTap: () => app.etatFleuve != null ? _afficherCarte(cle) : ouvrirFleuve(cle)),
      ]));
  app.maj();
}

// ---------------------------------------------------------------- Le guide (une fois par appareil)
/// Trois bulles posées sur la carte, chacune pointe ce dont elle parle ; plus celle du Niger la première fois.
void _guide(BuildContext context, String cle, {required GlobalKey kCourante, required GlobalKey kEscale, required GlobalKey kPagaies, required GlobalKey kOnglets}) {
  final vu = Map<String, dynamic>.from((Stock.lire('kopo-fleuve-guide') as Map?) ?? const {});
  final liste = <(GlobalKey?, String, String)>[];
  if (vu['base'] != true) {
    final n = _n(app.etatFleuve?['etoilesVille'] ?? 20);
    liste.addAll([
      (kCourante, 'Chaque étape a un objectif.', "Réussis-le pour avancer. Jusqu'à 3 étoiles par étape."),
      (kPagaies, '5 pagaies par jour.', 'Réussir ne coûte rien, rater coûte 1 pagaie. Elles reviennent à minuit.'),
      (kEscale.currentContext != null ? kEscale : kCourante, 'Les villes', '$n étoiles sur 27 pour passer chaque ville. La dernière étape de la ville est la plus dure.'),
    ]);
    vu['base'] = true;
  }
  if (_fleuves[cle]?.jeu == 'inter8' && vu['niger'] != true) {
    liste.add((kOnglets, "Ici, on joue à l'Inter (8).", "Sur ${_le(_fleuves[cle]!.nom)}, chaque étape est une partie d'Inter (8) contre des robots. Le Congo se joue au Kopo."));
    vu['niger'] = true;
  }
  if (liste.isEmpty) return;
  Stock.ecrire('kopo-fleuve-guide', vu);
  final overlay = Overlay.of(context, rootOverlay: true);
  late OverlayEntry entree;
  entree = OverlayEntry(builder: (_) => _Bulles(liste, () => entree.remove()));
  Future.delayed(Duration(milliseconds: app.sansAnim ? 0 : 500), () => overlay.insert(entree));
}

class _Bulles extends StatefulWidget {
  final List<(GlobalKey?, String, String)> liste;
  final VoidCallback fin;
  const _Bulles(this.liste, this.fin);
  @override
  State<_Bulles> createState() => _BullesState();
}

class _BullesState extends State<_Bulles> {
  int i = 0;
  Rect? r;
  @override
  void initState() { super.initState(); _viser(); }
  void _viser() {
    final c = widget.liste[i].$1?.currentContext;
    if (c != null) Scrollable.ensureVisible(c, alignment: .5);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final o = widget.liste[i].$1?.currentContext?.findRenderObject();
      setState(() => r = o is RenderBox && o.attached ? o.localToGlobal(Offset.zero) & o.size : null);
    });
  }
  void _suivant() { if (i + 1 >= widget.liste.length) { widget.fin(); return; } setState(() { i++; r = null; }); _viser(); }
  @override
  Widget build(BuildContext context) {
    final t = widget.liste[i], taille = MediaQuery.of(context).size;
    final cible = r ?? Rect.fromCenter(center: taille.center(Offset.zero), width: 0, height: 0);
    const larg = 300.0;
    final l = math.min(larg, taille.width - 32);
    final x = (cible.center.dx - l / 2).clamp(16.0, taille.width - l - 16);
    final dessous = cible.bottom + 150 < taille.height;
    final fleche = (cible.center.dx - x).clamp(18.0, l - 18);
    final bulle = Container(
      width: l,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
      decoration: BoxDecoration(color: const Color(0xFFFFF3D0), borderRadius: BorderRadius.circular(14), boxShadow: const [BoxShadow(color: Color(0x80000000), blurRadius: 28, offset: Offset(0, 10))]),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(t.$2, style: K.texte(15, couleur: K.encre, poids: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(t.$3, style: K.texte(14, couleur: K.encre).copyWith(height: 1.35)),
        const SizedBox(height: 8),
        Row(children: [
          Text(widget.liste.length > 1 ? '${i + 1} / ${widget.liste.length}' : '', style: K.texte(12, couleur: const Color(0xFF6B5A2E))),
          const Spacer(),
          GestureDetector(onTap: _suivant, child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(color: K.encre, borderRadius: BorderRadius.circular(99)),
            child: Text(i < widget.liste.length - 1 ? 'Suivant' : 'Compris !', style: K.texte(13, couleur: _or, poids: FontWeight.w700)),
          )),
        ]),
      ]),
    );
    final pointe = Transform.rotate(angle: math.pi / 4, child: Container(width: 14, height: 14, color: const Color(0xFFFFF3D0)));
    return Material(type: MaterialType.transparency, child: Stack(children: [
      Positioned.fill(child: GestureDetector(onTap: _suivant, child: CustomPaint(painter: _Trou(r?.inflate(6))))),
      Positioned(
        left: x, top: dessous ? cible.bottom + 12 : null, bottom: dessous ? null : taille.height - cible.top + 12,
        child: Stack(clipBehavior: Clip.none, children: [
          bulle,
          Positioned(left: fleche - 7, top: dessous ? -7 : null, bottom: dessous ? null : -7, child: pointe),
        ]),
      ),
    ]));
  }
}

/// Le voile sombre, percé autour de ce dont parle la bulle.
class _Trou extends CustomPainter {
  final Rect? r;
  _Trou(this.r);
  @override
  void paint(Canvas c, Size s) {
    final tout = Path()..addRect(Offset.zero & s);
    final trou = r == null ? null : RRect.fromRectAndRadius(r!, const Radius.circular(14));
    c.drawPath(trou == null ? tout : Path.combine(PathOperation.difference, tout, Path()..addRRect(trou)), Paint()..color = const Color(0x99040A12));
    if (trou != null) c.drawRRect(trou, Paint()..color = _or..style = PaintingStyle.stroke..strokeWidth = 4);
  }
  @override
  bool shouldRepaint(covariant _Trou old) => old.r != r;
}

/// Règles → Le Fleuve : le guide en texte.
void reglesFleuve() {
  final n = _n(app.etatFleuve?['etoilesVille'] ?? 20);
  // Les fleuves ouverts à ce joueur, rangés par jeu.
  final ouverts = fleuvesOuverts().isEmpty ? const ['congo', 'niger'] : fleuvesOuverts();
  String? liste(String jeu) {
    final l = [for (final k in ouverts) if (_fleuves[k]!.jeu == jeu) _le(_fleuves[k]!.nom)];
    return l.isEmpty ? null : l.length == 1 ? l.first : '${l.sublist(0, l.length - 1).join(', ')} et ${l.last}';
  }
  final kopo = liste('kopo'), inter = liste('inter8');
  Widget li(int k, String b, String t) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0x0DFFFFFF), borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 28, height: 28, alignment: Alignment.center, decoration: const BoxDecoration(color: K.brass, shape: BoxShape.circle), child: Text('$k', style: K.texte(14, couleur: K.encre, poids: FontWeight.w700))),
          const SizedBox(width: 10),
          Expanded(child: Text.rich(TextSpan(style: K.texte(14), children: [TextSpan(text: b, style: const TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: ' $t')]))),
        ]),
      );
  app.ouvrirFenetre((context) => Fenetre(titre: 'Le Fleuve', enfants: [
        li(1, 'Remonte le fleuve étape par étape.', "Chaque étape est une petite partie contre des robots, avec un objectif. Réussis-le pour avancer, jusqu'à 3 étoiles par étape."),
        li(2, ouverts.length > 2 ? '${ouverts.length} fleuves.' : 'Deux fleuves.', '${[if (kopo != null) '${kopo[0].toUpperCase()}${kopo.substring(1)} ${kopo.contains(' et ') ? 'se jouent' : 'se joue'} au Kopo', if (inter != null) "$inter à l'Inter (8)"].join(', ')}.'),
        li(3, '5 pagaies par jour.', 'Réussir ne coûte rien, rater coûte 1 pagaie. Elles reviennent à minuit.'),
        li(4, 'Les villes : $n étoiles sur 27.', "Il les faut pour affronter le boss de la ville, la dernière étape, la plus dure. Il te manque des étoiles ? Rejoue une étape où tu n'en as pas 3."),
        li(5, 'Tes amis rament avec toi.', "Vois où ils en sont et passe devant. Le plus d'étoiles de la semaine entre amis gagne la course."),
        const Ecart(4),
        Btn.principal('Compris !', large: true, onTap: app.fermerFenetre),
        const Ecart(8),
        Btn('Revoir le guide sur la carte', large: true, onTap: () { Stock.ecrire('kopo-fleuve-guide', <String, dynamic>{}); ouvrirFleuve(); }),
      ]));
}

/// Boss vaincu : le coffre de la ville s'ouvre.
class _Coffre extends StatefulWidget {
  const _Coffre();
  @override
  State<_Coffre> createState() => _CoffreState();
}

class _CoffreState extends State<_Coffre> {
  bool ouvert = app.sansAnim;
  @override
  void initState() { super.initState(); if (!ouvert) Future.delayed(const Duration(milliseconds: 850), () { if (mounted) setState(() => ouvert = true); }); }
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        key: ValueKey(ouvert),
        tween: Tween(begin: 0, end: 1), duration: Duration(milliseconds: app.sansAnim ? 1 : ouvert ? 400 : 800),
        builder: (_, v, enfant) => Transform.rotate(angle: ouvert ? 0 : math.sin(v * math.pi * 3) * .14, child: Transform.scale(scale: ouvert ? .7 + .3 * Curves.easeOutBack.transform(v) : .6 + .4 * v, child: enfant)),
        child: Text(ouvert ? '💰' : '🧰', style: const TextStyle(fontSize: 60, height: 1)),
      );
}
