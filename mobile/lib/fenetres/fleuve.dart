// Le Fleuve (fleuve.md) : deux cartes à remonter étape par étape, le Congo (Kopo) et le Niger (Inter (8)).
// Chaque étape : une petite partie contre des robots avec un objectif, 1 à 3 étoiles. 5 pagaies par jour :
// une se perd à chaque échec. Une escale (une vraie ville) toutes les 10 étapes. Le serveur décide de tout ;
// mêmes écrans que sur le site (src/source.html, « Le Fleuve »).
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../commun/apparences.dart';
import '../commun/theme.dart';
import '../ecrans/accueil.dart' show dureeLisible;
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';
import 'social.dart' show messageErreur;

const _fleuves = {
  'congo': (nom: 'Congo', jeu: 'kopo', jeuNom: 'Kopo'),
  'niger': (nom: 'Niger', jeu: 'inter8', jeuNom: 'Inter (8)'),
};
const _robotsNoms = {'faciles': 'Faciles', 'normaux': 'Normaux', 'forts': 'Forts'};
const _parBief = 50;
final Map<String, int> _biefVu = {};
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
        Muet(a['n'] == null ? "A fini tout le ${F.nom} ouvert pour l'instant." : 'Étape ${a['n']} du ${F.nom} · ★ ${a['etoiles']}', align: TextAlign.center, taille: 15),
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
  final ou = f['courante'] != null ? 'je suis à ${f['ville']}, étape ${f['courante']}' : "j'ai fini tout le ${f['nom']} ouvert";
  ouvrirWhatsApp('Masano · Le Fleuve : $ou, ${f['etoiles']} étoiles. Tu me rattrapes ?\n$lienJeu');
}

/// L'objectif de l'étape, rappelé pendant la partie.
class PastilleFleuve extends StatelessWidget {
  final String texte;
  const PastilleFleuve(this.texte, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(color: const Color(0xEB10233A), borderRadius: BorderRadius.circular(99), border: Border.all(color: const Color(0xFF7FC4E8))),
        child: Text('🛶 $texte', maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(12.5)),
      );
}

Widget _pagaies(Map p) {
  final max = _n(p['max']), reste = _n(p['restantes']);
  return Tooltip(
    message: '$reste pagaie${reste > 1 ? 's' : ''} sur $max',
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 0; i < max; i++)
        Padding(padding: const EdgeInsets.only(left: 3), child: Opacity(opacity: i < reste ? 1 : .22, child: CustomPaint(size: const Size(12, 28), painter: _Pagaie()))),
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

Future<void> ouvrirFleuve([String? cle]) async {
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    app.etatFleuve = (await Api.get('/fleuve') as Map).cast<String, dynamic>();
  } catch (x) { app.toast(messageErreur(x), Niv.echec); return; }
  final e = app.etatFleuve!;
  if (e['ouvert'] != true) { app.toast('Le Fleuve arrive bientôt.', Niv.alerte); return; }
  if (e['google'] != true) {
    fenetreGoogle('Le Fleuve', 'Remonte le Congo et le Niger, étape par étape, et gagne des étoiles. Connecte-toi avec Google pour jouer : ta progression te suit sur tous tes téléphones.');
    return;
  }
  _afficherCarte(cle ?? (app.jeu == 'inter8' ? 'niger' : 'congo'));
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
  @override
  Widget build(BuildContext context) {
    final E = app.etatFleuve!, f = (E['fleuves'] as Map)[cle] as Map, F = _fleuves[cle]!;
    final p = E['pagaies'] as Map;
    final etapes = ((f['etapes'] as List?) ?? []).cast<Map>();
    final enfants = <Widget>[
      Row(children: [Expanded(child: Text('Le ${F.nom}', style: K.titre(36))), _pagaies(p)]),
      const Ecart(8),
      Onglets([for (final k in _fleuves.keys) (k, '${_fleuves[k]!.nom} · ${_fleuves[k]!.jeuNom}')], cle, (k) => setState(() => cle = k)),
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
      enfants.add(Text('Le ${F.nom} ouvre bientôt. Reviens dans quelques jours !', style: K.texte(15)));
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
        _Carte(key: ValueKey('$cle:$bief'), cle: cle, f: f, etapes: ici),
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
  const _Carte({super.key, required this.cle, required this.f, required this.etapes});
  @override
  State<_Carte> createState() => _CarteState();
}

class _CarteState extends State<_Carte> {
  final defile = ScrollController();
  static const pas = 74.0, bas = 70.0;
  bool place = false;
  @override
  void dispose() { defile.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final f = widget.f, etapes = widget.etapes, courante = f['courante'];
    final hautVue = math.min(MediaQuery.of(context).size.height * .55, 520.0);
    final suite = f['suiteBientot'] == true && etapes.isNotEmpty && _n(etapes.last['n']) == _n(f['publiees']);
    final haut = suite ? 110.0 : 60.0;
    final niger = widget.cle == 'niger';
    return LayoutBuilder(builder: (context, c) {
      final L = math.min(380.0, c.maxWidth);
      final H = bas + haut + pas * math.max(0, etapes.length - 1);
      Offset pos(int i) => Offset(L / 2 + (L / 2 - 52) * math.sin(i * .72), H - bas - i * pas);
      final pts = [for (var i = 0; i < etapes.length; i++) pos(i)];
      final iCour = etapes.indexWhere((e) => e['n'] == courante);
      if (!place) {
        place = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!defile.hasClients) return;
          final cible = iCour >= 0 ? pts[iCour].dy - hautVue / 2 : H;
          defile.jumpTo(cible.clamp(0.0, defile.position.maxScrollExtent));
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
        enfants.add(Positioned(
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
        if (cour) enfants.add(Positioned(left: p.dx - 13, top: p.dy - t / 2 - 30, child: const IgnorePointer(child: Text('🛶', style: TextStyle(fontSize: 24)))));
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
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: niger ? const [Color(0xFF3B3220), Color(0xFF4A3D24), Color(0xFF3F3420)] : const [Color(0xFF1A3B2A), Color(0xFF224A33), Color(0xFF1D4130)]),
        ),
        clipBehavior: Clip.antiAlias,
        child: SingleChildScrollView(
          controller: defile,
          child: Center(child: SizedBox(width: L, height: H, child: Stack(clipBehavior: Clip.none, children: enfants))),
        ),
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

Future<void> ouvrirEtapeFleuve(String cle, int n) async {
  Map e;
  try { e = await Api.get('/fleuve/$cle/$n') as Map; } catch (x) { app.toast(messageErreur(x), Niv.echec); return; }
  final F = _fleuves[cle]!;
  final adv = _n(e['joueurs']) - 1, et = _n(e['etoiles']);
  final seuils = (e['seuils'] as Map?) ?? {};
  final p = (e['pagaies'] as Map?) ?? {};
  final pieges = ((e['pieges'] as List?) ?? []).cast<Map>();
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
        const Ecart(10),
        if (e['refus'] != null) Text('${e['refus']}', textAlign: TextAlign.center, style: K.texte(14, couleur: K.warn))
        else if (_n(p['restantes']) <= 0) Text('Ta pirogue se repose. Nouvelles pagaies dans ${dureeLisible(_n((app.etatFleuve?['pagaies'] as Map?)?['retourMs']))}.', textAlign: TextAlign.center, style: K.texte(14, couleur: K.warn))
        else ...[
          Muet("Si tu échoues, tu perds une pagaie (il t'en reste ${p['restantes']}).", align: TextAlign.center),
          const Ecart(10),
          Btn.principal(et > 0 ? (et < 3 ? "Rejouer pour plus d'étoiles" : 'Rejouer') : 'Jouer', large: true, onTap: () => app.jouerEtapeFleuve(cle, _n(e['numero']))),
        ],
        const Ecart(8),
        Btn('Retour à la carte', large: true, onTap: () => _afficherCarte(cle)),
      ]));
}

/// Fin d'une étape : étoiles, pièces, pagaies, et la suite.
Future<void> resultatFleuve(Map r) async {
  final cle = '${r['fleuve']}';
  final F = _fleuves[cle] ?? _fleuves['congo']!;
  final reussi = r['reussi'] == true, et = _n(r['etoiles']);
  final seuils = (r['seuils'] as Map?) ?? {};
  final reste = _n((r['pagaies'] as Map?)?['restantes']);
  if (r['solde'] != null) app.soldeServeur(r['solde']);
  try { app.etatFleuve = (await Api.get('/fleuve') as Map).cast<String, dynamic>(); } catch (_) {}
  final f = (app.etatFleuve?['fleuves'] as Map?)?[cle] as Map?;
  final depasses = ((r['depasses'] as List?) ?? const []).map((x) => '$x').toList();
  final suivante = reussi && f != null && f['courante'] != null && f['courante'] != r['numero'] ? _n(f['courante']) : null;
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('${F.nom} · étape ${r['numero']}${r['escale'] == true ? ' · ${r['ville']}' : ''}'.toUpperCase(), textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(letterSpacing: 1)),
        const Ecart(6),
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
        ] else
          Muet("Une pagaie perdue. Il t'en reste $reste.", align: TextAlign.center),
        const Ecart(12),
        if (suivante != null) ...[Btn.principal('Étape $suivante', large: true, onTap: () => ouvrirEtapeFleuve(cle, suivante)), const Ecart(8)],
        if (reste > 0 && (!reussi || et < 3)) ...[
          reussi ? Btn("Rejouer pour plus d'étoiles", large: true, onTap: () => ouvrirEtapeFleuve(cle, _n(r['numero']))) : Btn.principal('Réessayer', large: true, onTap: () => ouvrirEtapeFleuve(cle, _n(r['numero']))),
          const Ecart(8),
        ],
        Btn('Voir la carte', large: true, onTap: () => app.etatFleuve != null ? _afficherCarte(cle) : ouvrirFleuve(cle)),
      ]));
  app.maj();
}
