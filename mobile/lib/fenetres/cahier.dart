// Inter (8), mode Cahier (comptage des points), comme sur le site : fin de donne (les points de chacun,
// les éliminés barrés), le cahier complet (une colonne par joueur, une ligne par donne, les totaux en bas)
// et le classement final à partager en image.
// Mise en page (16/11, comme le site) : le titre et les boutons restent toujours visibles, seule la page
// défile ; écran large (téléphone couché, tablette) : titre et boutons dans une colonne à gauche.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../commun/cartes.dart';
import '../commun/theme.dart';
import '../etat.dart';
import 'communes.dart';

// Couleurs du cahier d'écolier : papier, encre bleue, marge rouge.
const _papier = Color(0xFFF7F1DF), _encre = Color(0xFF1F3A6B), _marge = Color(0xFFD64541), _vert = Color(0xFF2A7A4B), _orange = Color(0xFFC76A00), _or = Color(0xFFB07D16);
const _surligne = Color(0x213A7BD5); // ta ligne, ta colonne

Map? cahierDe(Vue v) => v['cahier'] is Map ? v['cahier'] as Map : null;
String cleDonne(Vue v) {
  final c = cahierDe(v)!;
  return '${v['code']}|${(c['donnes'] as List).length}|${(c['scores'] as Map).keys.join(',')}';
}

/// Donnes dont le comptage a déjà été montré (fin de partie : on montre la dernière donne avant le résultat).
final donnesMontrees = <String>{};

/// Fin de donne. finDePartie : bouton « Résultat de la partie », et passage au résultat après 5 s.
void afficherFinDonne(Vue v0, {bool finDePartie = false, required void Function(Vue v) resultat}) {
  final c0 = cahierDe(v0);
  if (c0 == null) return;
  if ((c0['donnes'] as List).isEmpty) {
    if (finDePartie) resultat(v0);
    return;
  }
  final cle = cleDonne(v0);
  donnesMontrees.add(cle);
  app.ouvrirFenetre((context) {
    final v = app.vue ?? v0;
    final c = cahierDe(v);
    if (c == null) return const SizedBox();
    final donnes = (c['donnes'] as List).cast<Map>();
    final d = donnes.last;
    final total = (c['total'] as num).toInt();
    final scores = (c['scores'] as Map);
    final points = (d['points'] as Map), mains = (d['mains'] as Map? ?? {});
    final elimines = (d['elimines'] as List).cast<Object?>();
    final sorti = d['sorti'];
    final ids = [sorti, ...points.keys.where((id) => id != sorti)];
    final large = _ecranLarge(context);
    String qui(Object? id) => id == v['moi'] ? 'Toi' : app.nomDe(v, id);
    final page = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _TetePage('Donne ${d['numero']}', 'éliminé à $total'),
        for (final id in ids)
          _LigneDonne(
            nom: qui(id),
            moi: id == v['moi'],
            sorti: id == sorti,
            points: (points[id] as num?)?.toInt() ?? 0,
            apres: (scores[id] as num?)?.toInt() ?? 0,
            total: total,
            main: ((mains[id] as List?) ?? const []).cast<String>(),
            elimine: elimines.contains(id),
            uneLigne: large,
          ),
      ],
    );
    final actions = <Widget>[];
    if (finDePartie || v['etat'] == 'finPartie') {
      actions.add(Btn.principal('Résultat de la partie', large: true, onTap: () => resultat(app.vue ?? v)));
    } else {
      if (v['suite'] is Map) {
        actions.add(
          _Decompte(
            (s) => Text.rich(
              TextSpan(
                style: K.texte(15),
                children: [
                  const TextSpan(text: 'Donne suivante dans '),
                  TextSpan(
                    text: '$s',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: K.brass),
                  ),
                  const TextSpan(text: ' s.'),
                ],
              ),
              textAlign: large ? TextAlign.left : TextAlign.center,
            ),
          ),
        );
      }
      if (v['entreRobots'] == true) actions.add(Btn.principal('Passer à la fin', large: true, onTap: () => app.envoyer({'type': 'passerFin'})));
      if (v['hote'] == v['moi']) {
        actions.add(Btn('Donne suivante', style: v['entreRobots'] == true ? StyleBtn.normal : StyleBtn.principal, large: true, onTap: () => app.envoyer({'type': 'mancheSuivante'})));
      } else if (v['suite'] == null) {
        actions.add(Text("En attente de l'hôte pour la donne suivante…", style: K.texte(15, couleur: K.muted)));
      }
    }
    actions.add(Btn('Voir tout le cahier', large: true, onTap: () => ouvrirCahier(app.vue ?? v, retour: finDePartie ? resultat : null)));
    return _FenetreCahier(
      titre: sorti == v['moi'] ? 'Tu sors !' : '${app.nomDe(v, sorti)} sort !',
      tete: [
        if (elimines.isNotEmpty)
          Text(
            elimines.contains(v['moi'])
                ? 'Tu as atteint le total : tu es éliminé. Tu peux continuer à regarder.'
                : '${elimines.map(qui).join(', ')} ${elimines.length > 1 ? 'sont éliminés' : 'est éliminé'}.',
            style: K.texte(15, couleur: K.muted),
          ),
      ],
      page: _Page(child: SingleChildScrollView(child: page)),
      actions: actions,
      largeur: 920,
    );
  }, 'findonne');
  // Fin de partie : on passe tout seul au résultat une fois le comptage vu.
  if (finDePartie) {
    Timer(const Duration(seconds: 5), () {
      final w = app.vue;
      if (w != null && w['etat'] == 'finPartie' && app.fenetreType == 'findonne' && cahierDe(w) != null && cleDonne(w) == cle) resultat(w);
    });
  }
}

/// Le cahier complet : toi d'abord, une ligne par donne ; les noms (en haut) et les totaux (en bas) restent
/// visibles quand le tableau défile. retour : fin de partie, « Fermer » ramène au résultat.
void ouvrirCahier(Vue v0, {void Function(Vue v)? retour}) {
  if (cahierDe(v0) == null) return;
  app.ouvrirFenetre((context) {
    final v = app.vue ?? v0;
    final c = cahierDe(v);
    if (c == null) return const SizedBox();
    final scores = c['scores'] as Map;
    final total = (c['total'] as num).toInt();
    final ids = [...scores.keys.where((id) => id == v['moi']), ...scores.keys.where((id) => id != v['moi'])];
    final elimines = (v['elimines'] as List? ?? const []);
    final donnes = (c['donnes'] as List).cast<Map>();
    const lCol = 64.0, lDonne = 40.0;
    TextStyle st(Object? id, {double taille = 16, bool gras = false, Color? couleur}) => K
        .texte(taille, couleur: elimines.contains(id) ? _marge : couleur ?? _encre, poids: gras ? FontWeight.w700 : FontWeight.w400)
        .copyWith(decoration: elimines.contains(id) ? TextDecoration.lineThrough : null, decorationColor: _marge);
    Widget cell(Object? id, Widget w, {double hauteur = 28}) =>
        Container(width: lCol, height: hauteur, alignment: Alignment.center, color: id == v['moi'] ? _surligne : null, padding: const EdgeInsets.symmetric(horizontal: 3), child: w);
    Widget gauche(String t, {double hauteur = 28}) => Container(
      width: lDonne,
      height: hauteur,
      alignment: Alignment.centerLeft,
      child: Text(t, style: K.texte(11, couleur: _encre.withValues(alpha: .6))),
    );
    final entete = Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _encre, width: 2)),
      ),
      child: Row(
        children: [
          gauche(''),
          for (final id in ids) cell(id, Text(id == v['moi'] ? 'Toi' : app.nomDe(v, id), overflow: TextOverflow.ellipsis, maxLines: 1, style: st(id, taille: 13, gras: true))),
        ],
      ),
    );
    final lignes = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (donnes.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text("Rien d'écrit pour l'instant : première donne en cours.", style: K.texte(12, couleur: _encre)),
          ),
        for (final d in donnes)
          Container(
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Color(0x383A6EBE))),
            ),
            child: Row(
              children: [
                gauche('D${d['numero']}'),
                for (final id in ids)
                  cell(
                    id,
                    Builder(
                      builder: (_) {
                        final p = (d['points'] as Map)[id];
                        return Text(p == null ? '' : '$p', style: K.texte(16, couleur: p == 0 ? _vert : _encre));
                      },
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
    final pied = Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: _encre, width: 2)),
      ),
      child: Row(
        children: [
          gauche('Total', hauteur: 42),
          for (final id in ids)
            Builder(
              builder: (_) {
                final t = (scores[id] as num).toInt(), dehors = elimines.contains(id);
                final couleur = dehors
                    ? null
                    : t >= total * .8
                    ? _marge
                    : t >= total * .6
                    ? _orange
                    : null;
                return cell(
                  id,
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('$t', style: st(id, taille: 19, gras: true, couleur: couleur)),
                        Text(dehors ? 'éliminé' : 'reste ${(total - t).clamp(0, total)}', style: K.texte(10, couleur: couleur ?? _encre.withValues(alpha: .7))),
                      ],
                    ),
                  ),
                  hauteur: 42,
                );
              },
            ),
        ],
      ),
    );
    // Défilement horizontal pour tout le tableau ; seul le milieu (les donnes) défile verticalement.
    final tableau = SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          entete,
          Flexible(child: SingleChildScrollView(reverse: true, child: lignes)),
          pied,
        ],
      ),
    );
    final finie = v['etat'] == 'finPartie';
    return _FenetreCahier(
      titre: 'Cahier',
      tete: [Muet('Celui qui sort marque 0, les autres comptent leurs cartes. Éliminé à $total points : le dernier qui reste gagne.', taille: 12)],
      page: _Page(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _TetePage(donnes.isEmpty ? 'Première donne en cours' : '${donnes.length} donne${donnes.length > 1 ? 's' : ''}', 'éliminé à $total'),
            Flexible(child: tableau),
          ],
        ),
      ),
      actions: [
        if (finie) Btn('Classement final', large: true, onTap: () => ouvrirClassementCahier(app.vue ?? v, retour: retour)),
        Btn.principal(
          'Fermer',
          large: true,
          onTap: () {
            final w = app.vue;
            if (retour != null && w != null && w['etat'] == 'finPartie') {
              retour(w);
            } else {
              app.fermerFenetre();
            }
          },
        ),
      ],
      largeur: 1000,
    );
  }, 'cahier');
}

// ---------------------------------------------------------------- classement final (16/11)
/// Ordre : le vainqueur, puis les éliminés du dernier au premier (même ordre que le bilan).
List<({Object? id, int rang, String nom, int points, int sorties})> classementCahier(Vue v) {
  final c = cahierDe(v)!;
  final scores = c['scores'] as Map;
  final donnes = (c['donnes'] as List).cast<Map>();
  final ids = <Object?>[
    for (final id in [v['vainqueur'], ...((v['elimines'] as List?) ?? const []).reversed])
      if (id != null && scores.containsKey(id)) id,
  ];
  for (final id in scores.keys) {
    if (!ids.contains(id)) ids.add(id);
  }
  return [
    for (var i = 0; i < ids.length; i++) (id: ids[i], rang: i + 1, nom: app.nomDe(v, ids[i]), points: (scores[ids[i]] as num).toInt(), sorties: donnes.where((d) => d['sorti'] == ids[i]).length),
  ];
}

const _medailles = ['🥇', '🥈', '🥉'];
String _rang(int r) => r <= 3 ? _medailles[r - 1] : '$r';

/// Texte partagé avec l'image (même texte que le site).
String texteCahier(Vue v) {
  final c = cahierDe(v)!;
  final n = (c['donnes'] as List).length;
  final lignes = classementCahier(v).map((l) => '${l.rang <= 3 ? _medailles[l.rang - 1] : '${l.rang}.'} ${l.nom} · ${l.points} pts');
  return '📒 Cahier ${jeuPartage(v['jeu'] as String?).de} sur Masano (éliminé à ${c['total']}, $n donne${n > 1 ? 's' : ''})\n${lignes.join('\n')}\nQui veut la revanche ?\n${lienDuJeu(v['jeu'] as String?)}';
}

/// Fenêtre « Classement » : rang, nom, sorties (donnes finies le premier) et points, avec « Partager ».
void ouvrirClassementCahier(Vue v0, {void Function(Vue v)? retour}) {
  if (cahierDe(v0) == null) return;
  app.ouvrirFenetre((context) {
    final v = app.vue ?? v0;
    final c = cahierDe(v);
    if (c == null) return const SizedBox();
    final lignes = classementCahier(v);
    final n = (c['donnes'] as List).length;
    final place = lignes.indexWhere((l) => l.id == v['moi']) + 1;
    return _FenetreCahier(
      titre: 'Classement',
      tete: [Muet('${place > 0 ? 'Tu finis $place${place == 1 ? 'er' : 'e'} sur ${lignes.length}. ' : ''}« Sorties » : les donnes où le joueur a fini le premier.', taille: 12)],
      page: _Page(
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _TetePage('$n donne${n > 1 ? 's' : ''} · éliminé à ${c['total']}', 'sorties · points'),
              for (final l in lignes) _LigneClassement(rang: _rang(l.rang), nom: l.id == v['moi'] ? 'Toi' : l.nom, sorties: l.sorties, points: l.points, moi: l.id == v['moi'], premier: l.rang == 1),
            ],
          ),
        ),
      ),
      actions: [
        Btn('Partager', icone: 'partager', large: true, onTap: () => partagerCahier(v)),
        Btn('Voir tout le cahier', large: true, onTap: () => ouvrirCahier(app.vue ?? v, retour: retour)),
        Btn.principal(
          'Fermer',
          large: true,
          onTap: () {
            final w = app.vue;
            if (retour != null && w != null && w['etat'] == 'finPartie') {
              retour(w);
            } else {
              app.fermerFenetre();
            }
          },
        ),
      ],
      largeur: 760,
    );
  }, 'cahier');
}

/// Partage : l'image du classement et le texte ; sans partage possible, le texte sur WhatsApp.
Future<void> partagerCahier(Vue v) async {
  final texte = texteCahier(v);
  try {
    final png = await imageCahier(v);
    await SharePlus.instance.share(
      ShareParams(
        text: texte,
        files: [XFile.fromData(png, mimeType: 'image/png', name: 'cahier-classement.png')],
        fileNameOverrides: ['cahier-classement.png'],
      ),
    );
  } catch (_) {
    try {
      await SharePlus.instance.share(ShareParams(text: texte));
    } catch (_) {
      await ouvrirWhatsApp(texte);
    }
  }
}

/// L'image du classement (1080×1350, comme le site), dessinée sur le téléphone.
Future<Uint8List> imageCahier(Vue v) async {
  final lignes = classementCahier(v);
  final c = cahierDe(v)!;
  final n = (c['donnes'] as List).length;
  const W = 1080.0, H = 1350.0;
  final rec = ui.PictureRecorder();
  final g = Canvas(rec, const Rect.fromLTWH(0, 0, W, H));
  g.drawRect(const Rect.fromLTWH(0, 0, W, H), Paint()..shader = ui.Gradient.radial(const Offset(W / 2, H * .3), W * .9, const [Color(0xFF1F3D63), Color(0xFF0B1726)]));
  g.drawRRect(
    RRect.fromRectAndRadius(const Rect.fromLTWH(40, 40, W - 80, H - 80), const Radius.circular(40)),
    Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..color = K.brass,
  );
  void ecrire(String t, double x, double y, TextStyle s, {TextAlign align = TextAlign.center, double? max}) {
    final tp = TextPainter(
      text: TextSpan(text: t, style: s),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: max ?? W);
    final dx = align == TextAlign.center
        ? x - tp.width / 2
        : align == TextAlign.right
        ? x - tp.width
        : x;
    tp.paint(g, Offset(dx, y - tp.height / 2));
  }

  TextStyle outfit(double t, Color c, [FontWeight p = FontWeight.w500]) => TextStyle(fontFamily: K.body, fontSize: t, color: c, fontWeight: p);
  TextStyle bebas(double t, Color c) => TextStyle(fontFamily: K.display, fontSize: t, color: c, letterSpacing: 2);
  ecrire('${jeuPartage(v['jeu'] as String?).nom.toUpperCase()} · CAHIER ${c['total']}', W / 2, 130, bebas(64, K.brass));
  ecrire('CLASSEMENT FINAL', W / 2, 225, bebas(130, Colors.white));
  ecrire('$n donne${n > 1 ? 's' : ''} · éliminé à ${c['total']} points', W / 2, 310, outfit(38, K.muted));
  // La page du cahier : papier, marge rouge, une ligne par joueur.
  final pas = (700 / (lignes.isEmpty ? 1 : lignes.length)).clamp(0, 100).floorToDouble();
  const haut = 370.0, px = 100.0, pw = W - 200;
  final ph = pas * lignes.length + 90;
  final papier = RRect.fromRectAndRadius(Rect.fromLTWH(px, haut, pw, ph), const Radius.circular(22));
  g.drawShadow(Path()..addRRect(papier), Colors.black, 14, false);
  g.drawRRect(papier, Paint()..color = _papier);
  g.drawRect(Rect.fromLTWH(px + 70, haut, 3, ph), Paint()..color = _marge.withValues(alpha: .55));
  ecrire('Sorties', px + pw - 230, haut + 42, outfit(28, const Color(0xFF6A7D99), FontWeight.w600), align: TextAlign.right);
  ecrire('Points', px + pw - 40, haut + 42, outfit(28, const Color(0xFF6A7D99), FontWeight.w600), align: TextAlign.right);
  for (var i = 0; i < lignes.length; i++) {
    final l = lignes[i];
    final y = haut + 70 + pas * i + pas / 2;
    if (l.id == v['moi']) g.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(px + 12, y - pas / 2 + 4, pw - 24, pas - 8), const Radius.circular(12)), Paint()..color = _surligne);
    if (i > 0) {
      final trait = Paint()
        ..color = _encre.withValues(alpha: .18)
        ..strokeWidth = 2;
      for (var x = px + 20; x < px + pw - 20; x += 16) {
        g.drawLine(Offset(x, y - pas / 2), Offset(x + 8, y - pas / 2), trait);
      }
    }
    final taille = (pas * .5).clamp(0, 48).roundToDouble();
    final couleur = i == 0 ? _or : _encre;
    ecrire(_rang(l.rang), px + 38, y, outfit(taille, _encre, FontWeight.w700));
    ecrire('${l.nom}${l.id == v['moi'] ? ' (moi)' : ''}', px + 100, y, outfit(taille, couleur, i == 0 ? FontWeight.w700 : FontWeight.w600), align: TextAlign.left, max: pw - 400);
    ecrire(l.sorties > 0 ? '${l.sorties} ✓' : '–', px + pw - 230, y, outfit((taille * .8).roundToDouble(), _vert), align: TextAlign.right);
    ecrire('${l.points}', px + pw - 40, y, outfit(taille, couleur, FontWeight.w700), align: TextAlign.right);
  }
  ecrire('Viens jouer sur MASANO', W / 2, H - 150, outfit(44, K.brass, FontWeight.w600));
  ecrire(lienDuJeu(v['jeu'] as String?).replaceAll(RegExp(r'^https?://'), '').replaceAll(RegExp(r'/$'), ''), W / 2, H - 95, outfit(34, K.muted));
  final image = await rec.endRecording().toImage(W.toInt(), H.toInt());
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  return data!.buffer.asUint8List();
}

// ---------------------------------------------------------------- morceaux communs
bool _ecranLarge(BuildContext context) {
  final t = MediaQuery.of(context).size;
  return t.width > t.height && t.width >= 700;
}

/// Fenêtre des écrans du cahier : seule la page défile, le titre et les boutons restent visibles.
/// Écran large : titre, texte et boutons dans une colonne à gauche, la page à droite.
class _FenetreCahier extends StatelessWidget {
  final String titre;
  final List<Widget> tete, actions;
  final Widget page;
  final double largeur;
  const _FenetreCahier({required this.titre, required this.tete, required this.page, required this.actions, this.largeur = 920});

  @override
  Widget build(BuildContext context) {
    final taille = MediaQuery.of(context).size;
    final large = _ecranLarge(context), court = taille.height < 500;
    final boutons = <Widget>[
      for (var i = 0; i < actions.length; i++) ...[if (i > 0) SizedBox(height: court ? 6 : 8), actions[i]],
    ];
    final titreW = Text(titre, style: K.titre(court ? 28 : 34));
    final Widget corps = large
        ? Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: court ? 190 : 210,
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      titreW,
                      for (final t in tete) Padding(padding: const EdgeInsets.only(top: 6), child: t),
                      const Ecart(14),
                      ...boutons,
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 18),
              Flexible(child: page),
            ],
          )
        : Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              titreW,
              for (final t in tete) Padding(padding: const EdgeInsets.only(top: 6), child: t),
              const Ecart(10),
              Flexible(child: page),
              const Ecart(10),
              ...boutons,
            ],
          );
    return Center(
      child: Padding(
        padding: EdgeInsets.all(court ? 8 : 14),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: large ? largeur : 460, maxHeight: taille.height * (court ? .96 : .92)),
          child: Material(
            color: K.table2,
            elevation: 24,
            shadowColor: Colors.black,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: K.line),
            ),
            child: Padding(padding: EdgeInsets.all(court ? 12 : 18), child: corps),
          ),
        ),
      ),
    );
  }
}

class _Page extends StatelessWidget {
  final Widget child;
  const _Page({required this.child});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(28, 8, 12, 10),
    decoration: BoxDecoration(
      color: _papier,
      borderRadius: BorderRadius.circular(8),
      border: const Border(left: BorderSide(color: _marge, width: 3)),
    ),
    child: child,
  );
}

class _TetePage extends StatelessWidget {
  final String gauche, droite;
  const _TetePage(this.gauche, this.droite);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Row(
      children: [
        Expanded(
          child: Text(gauche, style: K.texte(13, couleur: _encre.withValues(alpha: .75))),
        ),
        Text(droite, style: K.texte(13, couleur: _encre.withValues(alpha: .75))),
      ],
    ),
  );
}

class _LigneDonne extends StatelessWidget {
  final String nom;
  final bool moi, sorti, elimine, uneLigne;
  final int points, apres, total;
  final List<String> main;
  const _LigneDonne({
    required this.nom,
    required this.moi,
    required this.sorti,
    required this.points,
    required this.apres,
    required this.total,
    required this.main,
    required this.elimine,
    this.uneLigne = false,
  });
  @override
  Widget build(BuildContext context) {
    final part = total > 0 ? (apres / total).clamp(0.0, 1.0) : 0.0;
    final barre = part >= .8
        ? _marge
        : part >= .6
        ? const Color(0xFFE08A1E)
        : const Color(0xFF3A7BD5);
    final nomW = Text(
      nom,
      overflow: TextOverflow.ellipsis,
      maxLines: 1,
      style: K
          .texte(16, couleur: elimine ? _marge : _encre, poids: FontWeight.w700)
          .copyWith(decoration: elimine ? TextDecoration.lineThrough : (moi ? TextDecoration.underline : null), decorationColor: elimine ? _marge : _encre.withValues(alpha: .35)),
    );
    final ajout = Text(
      sorti ? 'sort ✓' : '+$points',
      style: K.texte(sorti ? 13 : 16, couleur: sorti ? _vert : _marge, poids: FontWeight.w700),
    );
    final totalW = SizedBox(
      width: 52,
      child: Text(
        '$apres',
        textAlign: TextAlign.right,
        style: K.texte(22, couleur: _encre, poids: FontWeight.w700),
      ),
    );
    final cartes = Wrap(
      spacing: 3,
      runSpacing: 3,
      children: [
        for (final carte in main)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: const Color(0xFFCFC6AB)),
            ),
            child: Text(
              InterCartes.afficher(carte),
              style: K.texte(12, couleur: InterCartes.rouge(carte) ? K.red : const Color(0xFF1B2533), poids: FontWeight.w700),
            ),
          ),
      ],
    );
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 5, 6, 5),
      decoration: BoxDecoration(
        color: moi ? _surligne : null,
        borderRadius: moi ? BorderRadius.circular(6) : null,
        border: const Border(top: BorderSide(color: Color(0x2E1F3A6B))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Écran large : nom, cartes, points et total sur une ligne. Sinon : les cartes en dessous.
          if (uneLigne)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 130, child: nomW),
                const SizedBox(width: 10),
                Expanded(
                  child: Padding(padding: const EdgeInsets.only(top: 2), child: cartes),
                ),
                const SizedBox(width: 10),
                ajout,
                const SizedBox(width: 10),
                totalW,
              ],
            )
          else ...[
            Row(
              children: [
                Expanded(child: nomW),
                ajout,
                const SizedBox(width: 10),
                totalW,
              ],
            ),
            if (main.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: cartes),
          ],
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(value: part, minHeight: 5, color: barre, backgroundColor: const Color(0x241F3A6B)),
          ),
          if (elimine)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  decoration: BoxDecoration(
                    border: Border.all(color: _marge, width: 2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    moi ? 'TU ES ÉLIMINÉ' : 'ÉLIMINÉ',
                    style: K.texte(12, couleur: _marge, poids: FontWeight.w700),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _LigneClassement extends StatelessWidget {
  final String rang, nom;
  final int sorties, points;
  final bool moi, premier;
  const _LigneClassement({required this.rang, required this.nom, required this.sorties, required this.points, required this.moi, required this.premier});
  @override
  Widget build(BuildContext context) {
    final couleur = premier ? _or : _encre;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      decoration: BoxDecoration(
        color: moi ? _surligne : null,
        borderRadius: moi ? BorderRadius.circular(6) : null,
        border: const Border(top: BorderSide(color: Color(0x2E1F3A6B))),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 34,
            child: Text(
              rang,
              textAlign: TextAlign.center,
              style: K.texte(18, couleur: _encre, poids: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              nom,
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
              style: K.texte(premier ? 18 : 16, couleur: couleur, poids: FontWeight.w700).copyWith(decoration: moi ? TextDecoration.underline : null, decorationColor: _encre.withValues(alpha: .35)),
            ),
          ),
          Text(sorties > 0 ? '$sorties ✓' : '–', style: K.texte(14, couleur: _vert)),
          const SizedBox(width: 12),
          SizedBox(
            width: 52,
            child: Text(
              '$points',
              textAlign: TextAlign.right,
              style: K.texte(22, couleur: couleur, poids: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Secondes avant la donne suivante (chrono de l'appli), rafraîchies.
class _Decompte extends StatefulWidget {
  final Widget Function(int secondes) builder;
  const _Decompte(this.builder);
  @override
  State<_Decompte> createState() => _DecompteState();
}

class _DecompteState extends State<_Decompte> {
  late final Timer _t = Timer.periodic(const Duration(milliseconds: 250), (_) {
    if (mounted) setState(() {});
  });
  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _t.isActive;
    return widget.builder((app.resteChrono / 1000).ceil());
  }
}
