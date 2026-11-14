// Inter (8), mode Cahier (comptage des points), comme sur le site : fin de donne (les points de chacun,
// les éliminés barrés) et le cahier complet (une colonne par joueur, une ligne par donne, les totaux en bas).
import 'dart:async';

import 'package:flutter/material.dart';

import '../commun/cartes.dart';
import '../commun/theme.dart';
import '../etat.dart';

// Couleurs du cahier d'écolier : papier, encre bleue, marge rouge.
const _papier = Color(0xFFF7F1DF), _encre = Color(0xFF1F3A6B), _marge = Color(0xFFD64541), _vert = Color(0xFF2A7A4B);

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
    String qui(Object? id) => id == v['moi'] ? 'Toi' : app.nomDe(v, id);
    final lignes = <Widget>[for (final id in ids) _LigneDonne(nom: qui(id), moi: id == v['moi'], sorti: id == sorti, points: (points[id] as num?)?.toInt() ?? 0, apres: (scores[id] as num?)?.toInt() ?? 0, total: total, main: ((mains[id] as List?) ?? const []).cast<String>(), elimine: elimines.contains(id))];
    final enfants = <Widget>[
      _Page(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('Donne ${d['numero']}', style: K.texte(13, couleur: _encre)),
                const Spacer(),
                Text('éliminé à $total', style: K.texte(13, couleur: _encre)),
              ],
            ),
            ...lignes,
          ],
        ),
      ),
      if (elimines.isNotEmpty) ...[const Ecart(8), Text(elimines.contains(v['moi']) ? 'Tu as atteint le total : tu es éliminé. Tu peux continuer à regarder.' : '${elimines.map(qui).join(', ')} ${elimines.length > 1 ? 'sont éliminés' : 'est éliminé'}.', style: K.texte(15))],
      const Ecart(10),
    ];
    if (finDePartie || v['etat'] == 'finPartie') {
      enfants.add(Btn.principal('Résultat de la partie', large: true, onTap: () => resultat(app.vue ?? v)));
    } else {
      if (v['suite'] is Map) {
        enfants.add(
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
            ),
          ),
        );
        enfants.add(const Ecart(8));
      }
      if (v['entreRobots'] == true) {
        enfants.addAll([
          Btn.principal('Passer à la fin', large: true, onTap: () => app.envoyer({'type': 'passerFin'})),
          const Ecart(6),
        ]);
      }
      if (v['hote'] == v['moi']) {
        enfants.add(Btn('Donne suivante', style: v['entreRobots'] == true ? StyleBtn.normal : StyleBtn.principal, large: true, onTap: () => app.envoyer({'type': 'mancheSuivante'})));
      } else if (v['suite'] == null) {
        enfants.add(Text("En attente de l'hôte pour la donne suivante…", style: K.texte(15, couleur: K.muted)));
      }
    }
    enfants.addAll([const Ecart(6), Btn('Voir tout le cahier', large: true, onTap: () => ouvrirCahier(app.vue ?? v, retour: finDePartie ? resultat : null))]);
    return Fenetre(titre: sorti == v['moi'] ? 'Tu sors !' : '${app.nomDe(v, sorti)} sort !', enfants: enfants);
  }, 'findonne');
  // Fin de partie : on passe tout seul au résultat une fois le comptage vu.
  if (finDePartie) {
    Timer(const Duration(seconds: 5), () {
      final w = app.vue;
      if (w != null && w['etat'] == 'finPartie' && app.fenetreType == 'findonne' && cahierDe(w) != null && cleDonne(w) == cle) resultat(w);
    });
  }
}

/// Le cahier complet. retour : fin de partie, « Fermer » ramène au résultat.
void ouvrirCahier(Vue v0, {void Function(Vue v)? retour}) {
  if (cahierDe(v0) == null) return;
  app.ouvrirFenetre((context) {
    final v = app.vue ?? v0;
    final c = cahierDe(v);
    if (c == null) return const SizedBox();
    final scores = c['scores'] as Map;
    final ids = scores.keys.toList();
    final elimines = (v['elimines'] as List? ?? const []);
    final donnes = (c['donnes'] as List).cast<Map>();
    TextStyle st(Object? id, {double taille = 16, bool gras = false}) => K.texte(taille, couleur: elimines.contains(id) ? _marge : _encre, poids: gras ? FontWeight.w700 : FontWeight.w400).copyWith(decoration: elimines.contains(id) ? TextDecoration.lineThrough : null, decorationColor: _marge);
    Widget cell(Widget w) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      child: Center(child: w),
    );
    final table = Table(
      defaultColumnWidth: const IntrinsicColumnWidth(),
      defaultVerticalAlignment: TableCellVerticalAlignment.middle,
      children: [
        TableRow(
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _encre, width: 2)),
          ),
          children: [
            const SizedBox(),
            for (final id in ids)
              cell(
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 80),
                  child: Text(id == v['moi'] ? 'Toi' : app.nomDe(v, id), overflow: TextOverflow.ellipsis, style: st(id, taille: 13, gras: true)),
                ),
              ),
          ],
        ),
        if (donnes.isEmpty)
          TableRow(
            children: [
              cell(Text('Rien d\'écrit pour l\'instant.', style: K.texte(11, couleur: _encre))),
              for (final _ in ids) const SizedBox(),
            ],
          ),
        for (final d in donnes)
          TableRow(
            children: [
              cell(Text('D${d['numero']}', style: K.texte(11, couleur: _encre.withValues(alpha: .6)))),
              for (final id in ids)
                cell(
                  Builder(
                    builder: (_) {
                      final p = (d['points'] as Map)[id];
                      return Text(p == null ? '' : '$p', style: K.texte(16, couleur: p == 0 ? _vert : _encre));
                    },
                  ),
                ),
            ],
          ),
        TableRow(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: _encre, width: 2)),
          ),
          children: [
            cell(Text('Total', style: K.texte(11, couleur: _encre))),
            for (final id in ids) cell(Text('${scores[id]}', style: st(id, taille: 19, gras: true))),
          ],
        ),
      ],
    );
    return Fenetre(
      titre: 'Cahier',
      enfants: [
        Muet('Celui qui sort marque 0, les autres comptent leurs cartes. Éliminé à ${c['total']} points : le dernier qui reste gagne.', taille: 12),
        const Ecart(8),
        _Page(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * .5),
            child: SingleChildScrollView(
              reverse: true,
              child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: table),
            ),
          ),
        ),
        const Ecart(10),
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
    );
  }, 'cahier');
}

class _Page extends StatelessWidget {
  final Widget child;
  const _Page({required this.child});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(28, 8, 12, 10),
    decoration: BoxDecoration(
      color: _papier,
      borderRadius: BorderRadius.circular(6),
      border: const Border(left: BorderSide(color: _marge, width: 3)),
    ),
    child: child,
  );
}

class _LigneDonne extends StatelessWidget {
  final String nom;
  final bool moi, sorti, elimine;
  final int points, apres, total;
  final List<String> main;
  const _LigneDonne({required this.nom, required this.moi, required this.sorti, required this.points, required this.apres, required this.total, required this.main, required this.elimine});
  @override
  Widget build(BuildContext context) {
    final part = total > 0 ? (apres / total).clamp(0.0, 1.0) : 0.0;
    final barre = part >= .8
        ? _marge
        : part >= .6
        ? const Color(0xFFE08A1E)
        : const Color(0xFF3A7BD5);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 5),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0x2E1F3A6B))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  nom,
                  overflow: TextOverflow.ellipsis,
                  style: K.texte(16, couleur: elimine ? _marge : _encre, poids: FontWeight.w700).copyWith(decoration: elimine ? TextDecoration.lineThrough : (moi ? TextDecoration.underline : null), decorationColor: elimine ? _marge : _encre.withValues(alpha: .35)),
                ),
              ),
              Text(
                sorti ? 'sort ✓' : '+$points',
                style: K.texte(sorti ? 13 : 16, couleur: sorti ? _vert : _marge, poids: FontWeight.w700),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 48,
                child: Text(
                  '$apres',
                  textAlign: TextAlign.right,
                  style: K.texte(22, couleur: _encre, poids: FontWeight.w700),
                ),
              ),
            ],
          ),
          if (main.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Wrap(
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
              ),
            ),
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
