// Progression : missions, défi, collection, profil, boutique, cadeaux de bienvenue (7 jours), tutoriel.
import 'dart:async';

import 'package:flutter/material.dart';

import '../commun/apparences.dart';
import '../commun/cartes.dart';
import '../commun/retention.dart';
import '../commun/sons.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../reseau/api.dart';
import 'accueil_fenetres.dart' show montrerRegles;
import 'communes.dart';
import 'compet.dart';
import 'parametres.dart';
import 'social.dart';

Widget ligneXp(Niveau n) => Row(children: [
      Container(width: 38, height: 38, alignment: Alignment.center, decoration: BoxDecoration(shape: BoxShape.circle, color: K.brass, border: Border.all(color: const Color(0xFFF3D48A), width: 2)), child: Text('${n.niveau}', style: K.titre(22, couleur: K.encre))),
      const SizedBox(width: 10),
      Expanded(child: TweenAnimationBuilder<double>(tween: Tween(begin: 0, end: n.fraction), duration: Duration(milliseconds: app.sansAnim ? 0 : 700), builder: (_, f, __) => Barre(f, hauteur: 8))),
      const SizedBox(width: 10),
      Muet('${n.dansNiveau}/${n.pourSuivant} XP', taille: 12),
    ]);

// ---------------------------------------------------------------- missions
void encaisserMission(String id) {
  final q = app.lireProfil(), jour = app.jourLocal();
  final r = R.encaisserMission(q, jour, id);
  if (r == null) return;
  app.ecrireProfil(q);
  app.sauvegarderProfil();
  final texte = r['texte'] as String;
  app.crediterEnLigne('mission', r['pieces'] as int, '${texte.length > 60 ? texte.substring(0, 60) : texte}:${r['finieLe']}');
  app.vibrer(30);
  if ((r['niveauApres'] as Niveau).niveau > (r['niveauAvant'] as Niveau).niveau) app.tampon('NIVEAU ${(r['niveauApres'] as Niveau).niveau}');
  app.toast('+${r['pieces']} pièces · +${r['xp']} XP');
  ouvrirMissions();
}

void ouvrirMissions() {
  final p0 = app.lireProfil(), j0 = app.jourLocal();
  R.missionsDuJour(p0, j0);
  (p0['missions'] as Map)['vuLe'] = j0;
  app.ecrireProfil(p0);
  app.ouvrirFenetre((context) {
    final p = app.lireProfil(), jour = app.jourLocal();
    final ms = R.missionsDuJour(p, jour), d = R.defiSemaine(p, jour), b = R.bienvenue(p, jour);
    final n = R.niveauDe(p['xp'] as num? ?? 0);
    final peutChanger = R.peutChanger(p, jour);
    final c = R.collection(p);
    final possedes = (c['possedes'] as List);
    final eq = c['equipes'] as Map;
    final visibles = [
      for (final e in R.objets.entries)
        if (!(!possedes.contains(e.key) && e.value['ville'] == true) && !(!possedes.contains(e.key) && e.value['type'] == 'cadre' && e.key != d['cadre'])) {'id': e.key, ...e.value},
    ]..sort((x, y) => (possedes.contains(y['id']) ? 1 : 0) - (possedes.contains(x['id']) ? 1 : 0));
    Widget carte(String ico, String texte, String sous, double f, Widget droite, {bool finie = false}) => Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: finie ? const Color(0x1A3FBF7F) : const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.line)),
          child: Row(children: [
            Ico(ico, taille: 26),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(texte, style: K.texte(14, poids: FontWeight.w600)),
              const SizedBox(height: 4),
              TweenAnimationBuilder<double>(tween: Tween(begin: 0, end: f), duration: Duration(milliseconds: app.sansAnim ? 0 : 600), builder: (_, x, __) => Barre(x, hauteur: 5, couleur: finie ? K.good : K.brass)),
              const SizedBox(height: 3),
              Muet(sous, taille: 11),
            ])),
            const SizedBox(width: 8),
            droite,
          ]),
        );
    return Fenetre(titre: 'Missions', onFermer: app.fermerFenetre, enfants: [
      ligneXp(n),
      const Titre3('Missions du jour', sous: 'gardées 2 jours'),
      for (final m in ms)
        carte('missions', m.texte, '${m.avance}/${m.cible}${m.hier ? " · d'hier" : ''} · ${m.xp} XP', m.avance / m.cible, Column(mainAxisSize: MainAxisSize.min, children: [
          if (m.aEncaisser) Btn.principal(null, marge: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), onTap: () => encaisserMission(m.id), enfant: Row(mainAxisSize: MainAxisSize.min, children: [Text('Encaisser ', style: K.texte(13, couleur: K.encre, poids: FontWeight.w700)), recompense(m.pieces, taille: 13)]))
          else if (m.finie) const Muet('Fait', taille: 12)
          else recompense(m.pieces, taille: 13),
          if (peutChanger && !m.finie && m.avance == 0) Padding(padding: const EdgeInsets.only(top: 4), child: Btn('Changer', taille: 12, marge: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), onTap: () { final q = app.lireProfil(); if (R.changerMission(q, jour, m.id)) { app.ecrireProfil(q); } })),
        ]), finie: m.finie),
      Titre3('Défi de la semaine', sous: (d['joursRestants'] as int) > 1 ? 'encore ${d['joursRestants']} jours' : 'dernier jour'),
      carte('couronne', d['texte'] as String, '${d['avance']}/${d['cible']} · cadre ${d['nomCadre']} · ${d['xp']} XP', (d['avance'] as int) / (d['cible'] as int), Column(mainAxisSize: MainAxisSize.min, children: [
        d['finie'] == true ? const Muet('Fait', taille: 12) : recompense(d['pieces'] as int, taille: 13),
        const SizedBox(height: 4),
        apercuObjet(d['cadre'] as String, taille: 30),
      ]), finie: d['finie'] == true),
      if (b['termine'] != true) ...[
        Titre3('Bienvenue', sous: '${b['recus']}/7 cadeaux'),
        RangeeBienvenue(b),
      ],
      const Titre3('Ta collection', sous: 'touche pour équiper'),
      for (final cat in R.parCategorie(visibles)) ...[
        Padding(padding: const EdgeInsets.only(top: 6, bottom: 4), child: Text('${cat.nom} · ${cat.objets.where((o) => possedes.contains(o['id'])).length}', style: K.texte(13, couleur: K.muted, poids: FontWeight.w600))),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final o in cat.objets)
            _Objet(o, possede: possedes.contains(o['id']), equipe: eq[o['type']] == o['id'], bas: possedes.contains(o['id']) ? (eq[o['type']] == o['id'] ? 'Équipé' : 'À toi') : '${o['d'] ?? ''}', onTap: possedes.contains(o['id']) ? () {
              final q = app.lireProfil();
              if (R.equiper(q, o['id'] as String)) { app.ecrireProfil(q); app.synchroEquiper(o['id'] as String); }
            } : null),
        ]),
      ],
      const Ecart(12),
      if (app.enLigne || app.pseudo.isNotEmpty) ...[Btn("Plus d'apparences : la Boutique", large: true, onTap: ouvrirBoutique), const Ecart(8)],
      Btn.principal('Fermer', large: true, onTap: app.fermerFenetre),
    ]);
  }, 'missions');
}

class _Objet extends StatelessWidget {
  final Map o;
  final bool possede, equipe, tropCher;
  final String bas;
  final Widget? basWidget;
  final VoidCallback? onTap;
  const _Objet(this.o, {required this.possede, required this.equipe, required this.bas, this.onTap, this.basWidget, this.tropCher = false});
  @override
  Widget build(BuildContext context) => Opacity(
        opacity: possede || onTap != null ? (tropCher ? .6 : 1) : .5,
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            width: 92,
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: equipe ? K.brass : K.line, width: equipe ? 2 : 1)),
            child: Column(children: [
              SizedBox(height: 44, child: Center(child: apercuObjet(o['id'] as String, taille: 40))),
              const SizedBox(height: 4),
              Text('${o['nom']}', textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(12, poids: FontWeight.w600)),
              basWidget ?? Text(bas, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: K.texte(10, couleur: K.muted)),
            ]),
          ),
        ),
      );
}

// ---------------------------------------------------------------- cadeaux de bienvenue
class RangeeBienvenue extends StatelessWidget {
  final Map b;
  final int? sautille;
  const RangeeBienvenue(this.b, {super.key, this.sautille});
  @override
  Widget build(BuildContext context) {
    final cadeaux = (b['cadeaux'] as List).cast<Map>();
    final recus = b['recus'] as int;
    return Row(children: [
      for (var i = 0; i < cadeaux.length; i++)
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: _Sautille(
              actif: sautille == i && !app.sansAnim,
              child: AspectRatio(
                aspectRatio: .72,
                child: Container(
                  decoration: BoxDecoration(
                    color: i < recus ? const Color(0x263FBF7F) : K.table,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: i < recus ? K.good : sautille == i ? K.brass : K.line, width: sautille == i ? 2 : 1),
                  ),
                  child: i < recus
                      ? Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          if (cadeaux[i]['pieces'] != null) ...[const Piece(taille: 16), Text('${cadeaux[i]['pieces']}', style: K.texte(10, poids: FontWeight.w700))]
                          else ...[const Ico('cadeau', taille: 16), Text('${cadeaux[i]['nom']}', textAlign: TextAlign.center, maxLines: 2, style: K.texte(8))],
                        ])
                      : Center(child: Text('J${i + 1}', style: K.titre(18))),
                ),
              ),
            ),
          ),
        ),
    ]);
  }
}

class _Sautille extends StatefulWidget {
  final bool actif;
  final Widget child;
  const _Sautille({required this.actif, required this.child});
  @override
  State<_Sautille> createState() => _SautilleState();
}

class _SautilleState extends State<_Sautille> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));
  @override
  void initState() { super.initState(); if (widget.actif) _a.repeat(); }
  @override
  void didUpdateWidget(_Sautille o) { super.didUpdateWidget(o); if (widget.actif && !_a.isAnimating) { _a.repeat(); } else if (!widget.actif) { _a.stop(); _a.value = 0; } }
  @override
  void dispose() { _a.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: _a, builder: (_, c) => Transform.translate(offset: Offset(0, -6 * (1 - (2 * _a.value - 1).abs())), child: c), child: widget.child);
}

bool proposerBienvenue7() {
  final p = app.lireProfil(), jour = app.jourLocal(), b = R.bienvenue(p, jour);
  if (b['aRecevoir'] != true) return false;
  Map? recu;
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) {
        final b2 = recu == null ? b : R.bienvenue(app.lireProfil(), jour);
        return Fenetre(titre: 'Bienvenue sur Masano', enfants: [
          Text('Un cadeau chaque jour où tu joues, pendant ta première semaine.', style: K.texte(15)),
          const Ecart(12),
          RangeeBienvenue(b2, sautille: recu == null ? b['recus'] as int : null),
          const Ecart(12),
          if (recu != null)
            Center(child: TweenAnimationBuilder<double>(
              tween: Tween(begin: app.sansAnim ? 1 : .3, end: 1), duration: const Duration(milliseconds: 500), curve: Curves.easeOutBack,
              builder: (_, s, child) => Transform.scale(scale: s, child: child),
              child: recu!['pieces'] != null ? recompense(recu!['pieces'] as int, taille: 30) : apercuObjet(recu!['objet'] as String, taille: 56),
            )),
          if (recu != null && recu!['objet'] != null)
            Padding(padding: const EdgeInsets.only(top: 6), child: Text('${R.objets[recu!['objet']]?['type'] == 'avatar' ? 'Nouvel avatar ' : 'Nouveau dos de cartes '}${R.objets[recu!['objet']]?['nom']}, déjà équipé.', textAlign: TextAlign.center, style: K.texte(14))),
          const Ecart(12),
          if (recu == null)
            Btn.principal('Ouvrir le cadeau du jour ${b['jour']}', large: true, onTap: () {
              final q = app.lireProfil();
              final c = R.recevoirBienvenue(q, jour);
              if (c == null) { app.fermerFenetre(); return; }
              app.ecrireProfil(q);
              if (c['pieces'] != null) app.crediterEnLigne('bienvenue', c['pieces'] as int, 'j${c['jour']}');
              app.vibrer(40);
              setState(() => recu = c);
            })
          else
            Btn.principal((recu!['jour'] as int) < 7 ? 'À demain pour le jour ${(recu!['jour'] as int) + 1}' : 'Super !', large: true, onTap: app.fermerFenetre),
        ]);
      }), 'bienvenue7');
  return true;
}

// ---------------------------------------------------------------- profil
const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
String drapeauPays(Object? code) {
  final c = code?.toString() ?? '';
  if (!RegExp(r'^[A-Z]{2}$').hasMatch(c)) return '';
  return String.fromCharCodes(c.codeUnits.map((u) => 0x1F1E6 + u - 65));
}

void ouvrirProfil() => app.ouvrirFenetre((context) => const _Profil(), 'profil');

class _Profil extends StatefulWidget {
  const _Profil();
  @override
  State<_Profil> createState() => _ProfilState();
}

class _ProfilState extends State<_Profil> {
  Map? ligue, srv;
  int? nbAmis;
  @override
  void initState() {
    super.initState();
    if (app.enLigne) {
      Api.get('/ligue').then((L) { if (mounted) setState(() => ligue = L as Map); }).catchError((_) => null);
      Api.get('/amis').then((a) { if (mounted) setState(() => nbAmis = (a as List).length); }).catchError((_) => null);
      Api.get('/statistiques').then((s) { if (mounted) setState(() => srv = s as Map); }).catchError((_) => null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = app.lireProfil();
    var s = <String, dynamic>{...R.stats0, ...?(p['stats'] as Map?)?.cast<String, dynamic>()};
    var en = <String, dynamic>{'parties': 0, 'victoires': 0, ...?(p['entrainement'] as Map?)?.cast<String, dynamic>()};
    final rv = <String, Map>{for (final e in ((p['rivaux'] as Map?) ?? {}).entries) e.key.toString(): Map.of(e.value as Map)};
    if (srv?['stats'] is Map) {
      Map<String, dynamic> plus(Map<String, dynamic> a, Map b) => {for (final k in a.keys) k: ((a[k] as num?) ?? 0) > ((b[k] as num?) ?? 0) ? a[k] : b[k] ?? a[k]};
      s = plus(s, srv!['stats'] as Map);
      en = plus(en, (srv!['entrainement'] as Map?) ?? {});
      for (final x in ((srv!['rivaux'] as List?) ?? []).cast<Map>()) {
        final r = rv.putIfAbsent(x['id'].toString(), () => {'pseudo': x['pseudo'], 'gagnes': 0, 'perdus': 0});
        r['pseudo'] = x['pseudo']; r['gagnes'] = x['moi'] ?? 0; r['perdus'] = x['lui'] ?? 0;
      }
    }
    final c = app.compte;
    final pseudo = app.pseudo.isEmpty ? 'Joueur' : app.pseudo;
    final n = R.niveauDe(p['xp'] as num? ?? 0);
    final titre = R.titre(p);
    final d = RegExp(r'^(\d{4})-(\d{2})').firstMatch((p['premierePartie'] ?? '').toString());
    final depuis = [d != null ? 'Joue depuis ${mois[int.parse(d.group(2)!) - 1]} ${d.group(1)}' : 'Nouveau joueur', if (nbAmis != null) nbAmis! > 1 ? '$nbAmis amis' : '$nbAmis ami'].join(' · ');
    final m = ligue?['moi'] as Map?;
    final drapeau = drapeauPays(c?['pays'] ?? m?['pays']);
    String taux(num v, num t) => '${t == 0 ? 0 : (100 * v / t).round()} %';
    final cadeau = R.objetsNiveau[n.niveau + 1];
    final victime = (rv.values.where((r) => ((r['gagnes'] as num?) ?? 0) > 0).toList()..sort((a, b) => (b['gagnes'] as num).compareTo(a['gagnes'] as num))).firstOrNull;
    final bete = (rv.values.where((r) => ((r['perdus'] as num?) ?? 0) > 0).toList()..sort((a, b) => (b['perdus'] as num).compareTo(a['perdus'] as num))).firstOrNull;
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;

    Widget cle(Object v, String t) => Expanded(child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3), padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
          child: Column(children: [Text('$v', style: K.titre(26, couleur: Colors.white)), Muet(t, taille: 11)]),
        ));
    Widget ligneT(String a, Object b) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Expanded(child: Text(a, style: K.texte(14, couleur: K.muted))), Text('$b', style: K.texte(14, poids: FontWeight.w700))]));
    Widget caseR(String t1, Map? r, String t2) => Expanded(child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3), padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
          child: Column(children: [Muet(t1, taille: 11), Text(r == null ? '–' : '${r['pseudo']}', overflow: TextOverflow.ellipsis, style: K.texte(15, poids: FontWeight.w700)), Text(r == null ? '' : t2, style: K.texte(12, couleur: K.muted).copyWith(fontStyle: FontStyle.italic))]),
        ));

    final col1 = <Widget>[
      Row(children: [
        Avatar(pseudo, avatar: app.avatarEquipe, cadre: app.cadreEquipe, taille: 64, niveau: n.niveau),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text.rich(TextSpan(children: [
            TextSpan(text: '$pseudo ', style: K.texte(20, poids: FontWeight.w700)),
            if (c?['numero'] != null) TextSpan(text: '#${c!['numero']} ', style: K.texte(13, couleur: K.muted)),
            TextSpan(text: drapeau),
          ])),
          Text(titre ?? 'Petit nouveau', style: K.texte(14, couleur: K.brass).copyWith(fontStyle: FontStyle.italic)),
          Muet(depuis, taille: 12),
        ])),
        IconButton(onPressed: app.fermerFenetre, icon: const Icon(Icons.close, color: K.muted)),
      ]),
      const Ecart(12),
      ligneXp(n),
      const Ecart(4),
      Text.rich(TextSpan(style: K.texte(13, couleur: K.muted), children: [
        const TextSpan(text: 'Encore '),
        TextSpan(text: '${n.pourSuivant - n.dansNiveau} XP', style: const TextStyle(fontWeight: FontWeight.w700, color: K.ink)),
        TextSpan(text: ' pour le niveau ${n.niveau + 1}${cadeau != null && R.objets[cadeau] != null ? ' · avatar ${R.objets[cadeau]!['nom']} à la clé' : ''}'),
      ])),
      const Ecart(12),
      Row(children: [cle(s['victoires'] ?? 0, 'Victoires'), cle(taux(s['victoires'] ?? 0, s['parties'] ?? 0), 'Réussite'), cle(s['katapss'] ?? 0, 'Katapss'), cle(s['battus'] ?? 0, 'Battus')]),
      if (m != null) ...[
        const Ecart(10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10), border: Border.all(color: couleurDiv(m['division']))),
          child: Row(children: [
            Ico('couronne', taille: 26, couleur: couleurDiv(m['division'])),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(nomDiv(m['division']), style: K.texte(15, couleur: couleurDiv(m['division']), poids: FontWeight.w700)),
              Text.rich(TextSpan(style: K.texte(12, couleur: K.muted), children: [TextSpan(text: ligue?['saison'] is Map ? '${ligue!['saison']['nom']} · ' : ''), TextSpan(text: '${m['points']} pts', style: const TextStyle(fontWeight: FontWeight.w700, color: K.ink))])),
            ])),
            Column(children: [Text(m['rangMondial'] != null ? '#${m['rangMondial']}' : '–', style: K.texte(15, poids: FontWeight.w700)), const Muet('au monde', taille: 11)]),
            if (m['pays'] != null) ...[const SizedBox(width: 12), Column(children: [Text(m['rangPays'] != null ? '#${m['rangPays']}' : '–', style: K.texte(15, poids: FontWeight.w700)), Muet('${drapeauPays(m['pays'])} ${nomPays(m['pays'])}', taille: 11)])],
          ]),
        ),
      ],
    ];
    final col2 = <Widget>[
      const Titre3('Statistiques'),
      if ((s['parties'] as num? ?? 0) > 0) ...[
        ligneT('Parties jouées', s['parties']), ligneT('Finales atteintes', s['finales']), ligneT('Manches survécues', s['manchesSurvecues']), ligneT('Éliminé en premier', s['eliminePremier']),
      ],
      ligneT('Entraînement (robots)', (en['parties'] as num) > 0 ? '${en['parties']} partie${(en['parties'] as num) > 1 ? 's' : ''} · ${taux(en['victoires'] as num, en['parties'] as num)}' : 'aucune partie'),
      if ((s['parties'] as num? ?? 0) == 0) const Muet("Joue une partie avec d'autres joueurs pour remplir tes statistiques.", taille: 12),
      const Titre3('Rivaux'),
      if (victime == null && bete == null) const Muet("Affronte d'autres joueurs en duel pour voir tes rivaux ici.", taille: 12)
      else Row(children: [caseR('Ta victime', victime, victime != null ? 'battu ${victime['gagnes']} fois' : ''), caseR('Ta bête noire', bete, bete != null ? "t'a battu ${bete['perdus']} fois" : '')]),
    ];
    return Fenetre(largeur: paysage ? 860 : 460, enfants: [
      if (paysage)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: col1)), const SizedBox(width: 18), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: col2))])
      else ...[...col1, ...col2],
      const Ecart(14),
      Row(children: [
        if (app.enLigne) ...[Expanded(child: Btn('Mes amis', onTap: () => ouvrirAmis(retour: ouvrirProfil))), const SizedBox(width: 6)],
        Expanded(child: Btn('Missions', onTap: ouvrirMissions)),
        const SizedBox(width: 6),
        Expanded(child: Btn('Pseudo', onTap: ouvrirParametres)),
      ]),
    ]);
  }
}

// ---------------------------------------------------------------- boutique
Future<void> ouvrirBoutique() async {
  Map B;
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    B = await Api.get('/boutique') as Map;
  } catch (e) { app.toast(messageErreur(e)); return; }
  app.soldeServeur(B['solde']);
  for (final o in (B['objets'] as List)) { app.objetDuServeur(o as Map); }
  final possedes = {...((B['possedes'] as List?) ?? []).map((e) => e.toString()), 'av-laiton', 'dos-laiton'};
  final eq = (B['equipes'] as Map?) ?? {};
  final solde = (B['solde'] as num?)?.toInt() ?? 0;
  final enVente = ((B['objets'] as List).cast<Map>().where((o) => o['prix'] != null && o['ville'] != true).map((o) => o.cast<String, dynamic>()).toList())
    ..sort((a, b) { final d = (a['prix'] as num).compareTo(b['prix'] as num); return d != 0 ? d : a['nom'].toString().compareTo(b['nom'].toString()); });
  app.ouvrirFenetre((context) => Fenetre(titre: 'Boutique', enfants: [
        Row(children: [const Piece(taille: 26), const SizedBox(width: 8), Text(App.formatPieces(solde), style: K.titre(30))]),
        const Muet("Des apparences seulement : rien n'aide à gagner. Les pièces se gagnent en jouant.", taille: 12),
        for (final cat in R.parCategorie(enVente)) ...[
          Titre3(cat.nom),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final o in cat.objets)
              Builder(builder: (_) {
                final a = possedes.contains(o['id']);
                return _Objet(o, possede: a, equipe: eq[o['type']] == o['id'], tropCher: !a && (o['prix'] as num) > solde, bas: '',
                    basWidget: a ? Muet(eq[o['type']] == o['id'] ? 'Équipé' : 'À toi', taille: 10) : Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text(App.formatPieces(o['prix'] as num), style: K.texte(11, couleur: K.brass, poids: FontWeight.w700)), const SizedBox(width: 3), const Piece(taille: 12)]),
                    onTap: () => a ? _equiperDepuisBoutique(o['id'] as String) : _confirmerAchat(o, solde));
              }),
          ]),
        ],
        const Ecart(12),
        Btn.principal('Fermer', large: true, onTap: app.fermerFenetre),
      ]), 'boutique');
}

Future<void> _equiperDepuisBoutique(String id) async {
  final q = app.lireProfil();
  R.donnerObjet(q, id);
  if (R.equiper(q, id)) app.ecrireProfil(q);
  await Api.post('/collection/equiper', {'objet': id}).catchError((_) => null);
  ouvrirBoutique();
}

void _confirmerAchat(Map o, int solde) {
  final nomType = o['type'] == 'avatar' ? "l'avatar" : o['type'] == 'dos' ? 'le dos de cartes' : 'le cadre';
  final prix = (o['prix'] as num).toInt();
  var enCours = false;
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(enfants: [
        Text('${o['nom']}', textAlign: TextAlign.center, style: K.titre(34)),
        const Ecart(8),
        Center(child: apercuObjet(o['id'] as String, taille: 64)),
        const Ecart(10),
        if (prix > solde) ...[
          Text('Il te manque ${App.formatPieces(prix - solde)} pièces pour $nomType ${o['nom']}. Missions, bonus du jour et parties en ligne en rapportent.', textAlign: TextAlign.center, style: K.texte(15)),
          const Ecart(12),
          Btn.principal('Retour', large: true, onTap: ouvrirBoutique),
        ] else ...[
          Text('Acheter $nomType ${o['nom']} pour ${App.formatPieces(prix)} pièces ? Il te restera ${App.formatPieces(solde - prix)} pièces.', textAlign: TextAlign.center, style: K.texte(15)),
          const Ecart(12),
          Btn.principal('Acheter', large: true, onTap: enCours ? null : () async {
            setState(() => enCours = true);
            try {
              final r = await Api.post('/boutique/acheter', {'objet': o['id']});
              app.soldeServeur(r['solde']);
              final q = app.lireProfil(); R.donnerObjet(q, o['id'] as String); R.equiper(q, o['id'] as String); app.ecrireProfil(q);
              await Api.post('/collection/equiper', {'objet': o['id']}).catchError((_) => null);
              app.vibrer(40);
              app.toast('${o['nom']} est à toi (équipé)');
              ouvrirBoutique();
            } catch (e) { app.toast(messageErreur(e)); setState(() => enCours = false); }
          }),
          const Ecart(8),
          Btn('Retour', large: true, onTap: ouvrirBoutique),
        ],
      ])), 'boutique');
}

// ---------------------------------------------------------------- tutoriel (7 écrans)
class _Etape {
  final String titre, texte;
  final List<String>? main;
  final List<(String, String)>? table;
  final bool libre, ramasse, katapss;
  final String? bouton, ok, interdite;
  final List<(String, bool)>? choix;
  final (bool, String) Function(String c)? carte;
  const _Etape(this.titre, this.texte, {this.main, this.table, this.libre = false, this.ramasse = false, this.katapss = false, this.bouton, this.ok, this.interdite, this.choix, this.carte});
}

final _etapes = [
  const _Etape('Le but', "Chaque joueur reçoit 4 cartes. Débarrasse-toi des tiennes pour te qualifier : chaque carte que tu joues quitte la partie. À chaque manche, le dernier qui a encore des cartes est éliminé, jusqu'à la finale à deux.", main: ['3C', '9P', '5K', '9C'], libre: true),
  _Etape('Suivre la couleur', 'Kevin a ouvert le tour : il a posé le 7♥, donc la couleur du tour est cœur. Chacun doit suivre cette couleur. À toi : joue un cœur.', table: const [('7C', 'Kevin')], main: const ['3C', '9P', '5K', '9C'],
      carte: (c) => KopoCartes.couleur(c) == 'C' ? (true, 'Bien joué : tu as suivi la couleur. Une carte de moins dans ta main !') : (false, 'Il faut jouer un cœur ♥.')),
  _Etape('Ramasser', "Kevin a ouvert avec le 8♣. Tu n'as aucun trèfle : tu dois ramasser la plus forte carte de la table. Ramasser arrête le tour aussitôt.", table: const [('8T', 'Kevin')], main: const ['2C', '6P', '4K'], bouton: 'Ramasser le 8♣', ramasse: true,
      ok: "Le 8♣ va dans ta main : une carte de plus pour toi. Kevin, qui l'avait posé, relance. Astuce : on peut aussi ramasser exprès en ayant la couleur, pour bluffer.", carte: (_) => (false, "Tu n'as pas de trèfle : ramasse.")),
  const _Etape('Qui relance ?', "Tout le monde a suivi à pique, personne n'a ramassé. Celui qui a posé la plus forte carte relance. Qui relance ?", table: [('4P', 'Toi'), ('10P', 'Kevin'), ('7P', 'Nadia')], choix: [('Toi', false), ('Kevin', true), ('Nadia', false)],
      ok: 'Oui : le 10♠ est la plus forte, Kevin relance. Les 3 cartes quittent la partie. Kevin doit changer de couleur : pas de pique.'),
  _Etape('Relancer', 'Au tour précédent, joué à carreau, ta carte était la plus forte. Tu relances : joue une carte, mais pas de carreau.', main: const ['5K', '8K', '3T', '9C'], interdite: 'K',
      carte: (c) => KopoCartes.couleur(c) != 'K' ? (true, 'Parfait : on change toujours de couleur en relançant.') : (false, "Pas de carreau : c'était la couleur du tour précédent.")),
  _Etape('Sortir', "Nadia a ouvert à trèfle et il ne te reste que des trèfles. Tu peux tout poser d'un coup et te qualifier.", table: const [('6T', 'Nadia')], main: const ['2T', '9T'], bouton: 'Tout poser (2 cartes) et sortir',
      ok: 'Qualifié ! Les cartes avec lesquelles tu sors ne comptent pas pour la plus forte.', carte: (_) => (false, "Utilise « Tout poser » pour sortir d'un coup.")),
  _Etape('Katapss !', 'À la distribution, tu reçois 4 cartes de la même couleur (ou ta plus forte carte est un 4, sauf en duel et en finale). Annonce KATAPSS avant de jouer : tu es qualifié tout de suite.', main: const ['2P', '5P', '7P', '10P'], bouton: 'KATAPSS', katapss: true,
      ok: "Qualifié d'office ! Attention : dès que tu as joué ou ramassé, c'est trop tard.", carte: (_) => (false, 'Annonce plutôt KATAPSS !')),
];

void ouvrirTutoriel() => app.ouvrirFenetre((context) => const _Tutoriel(), 'tutoriel');

class _Tutoriel extends StatefulWidget {
  const _Tutoriel();
  @override
  State<_Tutoriel> createState() => _TutorielState();
}

class _TutorielState extends State<_Tutoriel> {
  int i = 0;
  String? retour;
  bool ok = false, boutonFait = false, forteVue = false;
  final cachees = <String>{};
  String? ramassee, secoue;

  void _etape(int n) => setState(() { i = n; retour = null; ok = false; boutonFait = false; forteVue = false; cachees.clear(); ramassee = null; });
  void _reussi(String t) { setState(() { retour = t; ok = true; }); app.vibrer(40); }
  void _rate(String t, [String? cible]) { setState(() { retour = t; secoue = cible; }); Timer(const Duration(milliseconds: 260), () { if (mounted) setState(() => secoue = null); }); }

  void _fin() {
    Stock.ecrire('kopo-tuto', 'fini');
    app.ouvrirFenetre((context) => Fenetre(titre: 'Prêt !', enfants: [
          Text("Tu connais l'essentiel. Le mieux pour apprendre : une première partie contre deux robots gentils, sans chrono, avec des bulles d'aide.", style: K.texte(15)),
          const Ecart(12),
          Btn.principal('Jouer ma première partie', large: true, onTap: app.partieGuidee),
          const Ecart(8),
          Btn('Lire les règles complètes', large: true, onTap: () { app.fermerFenetre(); montrerRegles(); }),
          const Ecart(8),
          Btn('Fermer', large: true, onTap: app.fermerFenetre),
        ]));
  }

  @override
  Widget build(BuildContext context) {
    final e = _etapes[i];
    final peutSuivre = e.libre || ok;
    final table = e.table;
    String? forte;
    if (table != null) { forte = table.reduce((m, x) => KopoCartes.valeur(x.$1) > KopoCartes.valeur(m.$1) ? x : m).$1; }
    Widget secouer(String id, Widget w) => AnimatedSlide(offset: Offset(secoue == id ? .06 : 0, 0), duration: const Duration(milliseconds: 80), child: w);
    return Fenetre(titre: e.titre, enfants: [
      Row(children: [for (var k = 0; k < _etapes.length; k++) Expanded(child: Container(height: 4, margin: const EdgeInsets.symmetric(horizontal: 2), decoration: BoxDecoration(color: k <= i ? K.brass : K.line, borderRadius: BorderRadius.circular(2))))]),
      const Ecart(10),
      Text(e.texte, style: K.texte(15)),
      const Ecart(12),
      if (table != null)
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0xFF0F4430), borderRadius: BorderRadius.circular(14)),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (final (c, qui) in table)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Opacity(
                  opacity: ramassee == c ? 0 : 1,
                  child: Column(children: [CarteVue(c, l: 46, forte: forteVue && c == forte), const SizedBox(height: 3), Text(qui, style: K.texte(11, couleur: K.muted))]),
                ),
              ),
          ]),
        ),
      if (e.main != null) ...[
        const Ecart(8),
        const Muet('Ta main', taille: 12),
        const Ecart(4),
        Wrap(alignment: WrapAlignment.center, spacing: 6, runSpacing: 6, children: [
          for (final c in [...e.main!, ?ramassee])
            Opacity(
              opacity: cachees.contains(c) || (boutonFait && !e.ramasse) ? 0 : 1,
              child: secouer(c, GestureDetector(
                onTap: e.libre || ok ? null : () {
                  final (bon, t) = e.carte != null ? e.carte!(c) : (true, '');
                  if (bon) { cachees.add(c); _reussi(t); } else { _rate(t, c); }
                },
                child: Container(
                  decoration: ramassee == c ? BoxDecoration(borderRadius: BorderRadius.circular(8), boxShadow: const [BoxShadow(color: Color(0xAA3FBF7F), blurRadius: 10)]) : null,
                  child: CarteVue(c, l: 50, grisee: e.interdite != null && KopoCartes.couleur(c) == e.interdite),
                ),
              )),
            ),
        ]),
      ],
      if (e.bouton != null) ...[
        const Ecart(10),
        Btn(e.bouton, style: e.katapss ? StyleBtn.danger : StyleBtn.principal, large: true, onTap: boutonFait ? null : () {
          setState(() {
            boutonFait = true;
            if (e.ramasse) ramassee = e.table![0].$1;
          });
          if (e.katapss) { app.tampon('KATAPSS !', 'Qualifié'); Sons.jouer('katapss'); }
          _reussi(e.ok!);
        }),
      ],
      if (e.choix != null) ...[
        const Ecart(10),
        Row(children: [
          for (final (t, bon) in e.choix!)
            Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: secouer(t, Btn(t, onTap: () {
              if (!bon) { _rate('Non : regarde quelle carte est la plus forte (le 10 bat tout).', t); return; }
              setState(() => forteVue = true);
              _reussi(e.ok!);
            })))),
        ]),
      ],
      if (retour != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(retour!, textAlign: TextAlign.center, style: K.texte(14, couleur: ok ? K.good : K.bad, poids: FontWeight.w600))),
      const Ecart(12),
      Btn.principal(i == _etapes.length - 1 ? 'Terminer' : 'Suivant', large: true, onTap: peutSuivre ? () { if (i < _etapes.length - 1) { _etape(i + 1); } else { _fin(); } } : null),
      const Ecart(8),
      Btn('Passer le tutoriel', large: true, onTap: () { Stock.ecrire('kopo-tuto', 'fini'); app.fermerFenetre(); }),
    ]);
  }
}

bool proposerTutoriel() {
  if (Stock.lire('kopo-tuto') != null) return false;
  Stock.ecrire('kopo-tuto', 'propose');
  app.ouvrirFenetre((context) => Fenetre(titre: 'Bienvenue !', enfants: [
        Text('Nouveau au Kopo ? Apprends les règles en jouant quelques coups.', style: K.texte(15)),
        const Ecart(12),
        Btn.principal('Apprendre à jouer (1 min)', large: true, onTap: ouvrirTutoriel),
        const Ecart(8),
        Btn('Je connais déjà', large: true, onTap: () { app.fermerFenetre(); app.suiteAccueil(); }),
      ]));
  return true;
}
