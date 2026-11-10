// Compétition : Ligue (classements, fin de saison, parcours), Match du jour, la Bande, la fenêtre « Nouveau ».
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../commun/retention.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../ecrans/accueil.dart' show dureeLisible, lienBandeVu;
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';
import 'social.dart';

const pays = [('CD', 'RD Congo'), ('CG', 'Congo-Brazzaville'), ('CI', "Côte d'Ivoire"), ('SN', 'Sénégal'), ('CM', 'Cameroun'), ('GA', 'Gabon'), ('BJ', 'Bénin'), ('TG', 'Togo'), ('BF', 'Burkina Faso'), ('ML', 'Mali'), ('NE', 'Niger'), ('GN', 'Guinée'), ('RW', 'Rwanda'), ('BI', 'Burundi'), ('MG', 'Madagascar'), ('TD', 'Tchad'), ('CF', 'Centrafrique'), ('AO', 'Angola'), ('KE', 'Kenya'), ('TZ', 'Tanzanie'), ('UG', 'Ouganda'), ('NG', 'Nigeria'), ('GH', 'Ghana'), ('ZA', 'Afrique du Sud'), ('MA', 'Maroc'), ('DZ', 'Algérie'), ('TN', 'Tunisie'), ('HT', 'Haïti'), ('FR', 'France'), ('BE', 'Belgique'), ('CH', 'Suisse'), ('CA', 'Canada'), ('US', 'États-Unis'), ('GB', 'Royaume-Uni')];
String nomPays(Object? c) => pays.where((p) => p.$1 == c).firstOrNull?.$2 ?? '$c';
String nomDiv(Object? d) => App.nomsDivisions[d] ?? '$d';
Color couleurDiv(Object? d) => K.divisions[d] ?? K.brass;
String? get monCompteId => (Api.compte?['compte'] as Map?)?['id'] as String?;
String _p(Object? n) => App.formatPieces((n as num?) ?? 0);

Widget blason(Object? division, {double taille = 64}) => Container(
      width: taille, height: taille, alignment: Alignment.center,
      decoration: BoxDecoration(shape: BoxShape.circle, color: couleurDiv(division).withValues(alpha: .2), border: Border.all(color: couleurDiv(division), width: 3)),
      child: Text(nomDiv(division).characters.first, style: K.titre(taille * .55, couleur: couleurDiv(division))),
    );

// ---------------------------------------------------------------- Ligue
Future<void> ouvrirLigue() async {
  Map L;
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    L = await Api.get('/ligue') as Map;
  } catch (e) { app.toast(messageErreur(e)); return; }
  app.pointLigue = false;
  app.majOngletLigue();
  if (L['recompense'] is Map) { fenetreFinSaison(L['recompense'] as Map, ouvrirLigue); return; }
  app.ouvrirFenetre((context) => _Ligue(L), 'ligue');
}

class _Ligue extends StatefulWidget {
  final Map L;
  const _Ligue(this.L);
  @override
  State<_Ligue> createState() => _LigueState();
}

class _LigueState extends State<_Ligue> {
  String type = 'amis';
  Map? c;
  String? erreur;
  bool choixPays = false;
  String? paysChoisi;
  int? rangPays;
  @override
  void initState() { super.initState(); _charger('amis'); }
  Future<void> _charger(String t) async {
    setState(() { type = t; c = null; erreur = null; choixPays = false; });
    final m = widget.L['moi'] as Map;
    if (t == 'pays' && m['pays'] == null) { setState(() => choixPays = true); return; }
    try {
      final r = await Api.get('/classement?type=$t') as Map;
      if (!mounted || type != t) return;
      setState(() { c = r; if (t == 'pays' && r['moi'] is Map) rangPays = (r['moi']['rang'] as num?)?.toInt(); });
    } catch (e) { if (mounted) setState(() => erreur = messageErreur(e)); }
  }

  @override
  Widget build(BuildContext context) {
    final L = widget.L, m = L['moi'] as Map;
    final divs = ((L['divisions'] as List?) ?? []).cast<Map>();
    final seuil = ((divs.where((d) => d['id'] == m['division']).firstOrNull?['seuil']) as num?) ?? 0;
    final pro = m['prochaine'] as Map?;
    final frac = pro != null ? ((m['points'] as num) - seuil) / (((pro['seuil'] as num?) ?? 1) - seuil) : 1.0;
    final pts = L['points'] as Map? ?? {};
    Widget tuile(Object? v, String t) => Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            margin: const EdgeInsets.symmetric(horizontal: 3),
            decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
            child: Column(children: [Text(v == null ? '—' : '$v', style: K.titre(26, couleur: Colors.white)), Muet(t, taille: 11, align: TextAlign.center)]),
          ),
        );
    final liste = <Widget>[];
    if (choixPays) {
      liste.add(const Muet('Pour le classement de ton pays.'));
      liste.add(Row(children: [
        Expanded(
          child: DropdownButton<String>(
            isExpanded: true, dropdownColor: K.table2, value: paysChoisi ?? m['pays'] as String?,
            hint: Text('Choisis ton pays', style: K.texte(15, couleur: K.muted)),
            items: [for (final (c, n) in pays) DropdownMenuItem(value: c, child: Text(n, style: K.texte(15)))],
            onChanged: (v) => setState(() => paysChoisi = v),
          ),
        ),
        const SizedBox(width: 8),
        Btn.principal('OK', onTap: () async {
          final v = paysChoisi; if (v == null) return;
          try { await Api.patch('/moi', {'pays': v}); m['pays'] = v; _charger('pays'); } catch (e) { app.toast(messageErreur(e)); }
        }),
      ]));
    } else if (erreur != null) {
      liste.add(Muet(erreur!));
    } else if (c == null) {
      liste.add(const Muet('Chargement…'));
    } else {
      final l = ((c!['liste'] as List?) ?? []).cast<Map>();
      final moi = c!['moi'] as Map?;
      Widget ligne(Map j) => LigneClassement('${j['rang']}', '${j['pseudo']}', '${j['points']}', moi: j['id'] == monCompteId, couleur: couleurDiv(j['division']));
      for (final j in l) { liste.add(ligne(j)); }
      if (moi != null && !l.any((j) => j['id'] == moi['id'])) { liste.add(const Center(child: Muet('…'))); liste.add(ligne(moi)); }
      if (l.isEmpty) liste.add(Muet(type == 'amis' ? 'Ajoute des amis pour vous comparer.' : "Personne n'est encore classé cette saison. Sois le premier !"));
      if (type == 'amis') liste.add(Padding(padding: const EdgeInsets.only(top: 6), child: Btn('Ajouter un ami', onTap: () => ouvrirAmis())));
      if (type == 'pays') liste.add(Padding(padding: const EdgeInsets.only(top: 6), child: Btn('Changer de pays (${nomPays(m['pays'])})', onTap: () => setState(() => choixPays = true))));
    }
    return Fenetre(titre: 'Ligue', enfants: [
      if (L['saison'] is Map)
        Row(children: [Expanded(child: Text('${L['saison']['titre']}', style: K.texte(15, poids: FontWeight.w700))), Muet(App.resteSaison(L['saison']['fin'].toString()))]),
      const Ecart(10),
      Row(children: [
        blason(m['division']),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(nomDiv(m['division']), style: K.titre(32, couleur: couleurDiv(m['division']))),
            const SizedBox(height: 4),
            TweenAnimationBuilder<double>(tween: Tween(begin: 0, end: frac.toDouble()), duration: const Duration(milliseconds: 700), builder: (_, f, __) => Barre(f, couleur: couleurDiv(m['division']))),
            const SizedBox(height: 4),
            Muet(pro != null ? '${m['points']} pts · encore ${pro['manque']} pour ${nomDiv(pro['division'])}' : '${m['points']} pts · tout en haut !', taille: 12),
          ]),
        ),
      ]),
      if ((m['protection'] as num? ?? 0) > 0) Padding(padding: const EdgeInsets.only(top: 6), child: Muet('Protégé : tu ne peux pas redescendre pendant encore ${m['protection']} partie${(m['protection'] as num) > 1 ? 's' : ''}.', taille: 12)),
      const Ecart(10),
      Row(children: [tuile(m['rangMondial'], 'au monde'), tuile(rangPays ?? m['rangPays'], m['pays'] != null ? nomPays(m['pays']) : 'pays'), tuile(m['parties'], 'parties classées')]),
      const Ecart(10),
      Onglets(const [('amis', 'Amis'), ('pays', 'Pays'), ('mondial', 'Monde')], type, _charger),
      const Ecart(8),
      ...liste,
      const Ecart(10),
      Btn('Parcours de saison', large: true, onTap: ouvrirParcours),
      const Ecart(8),
      Muet('Parties classées : seulement « En ligne », avec des inconnus. 1er +${pts['premier']}, 2e +${pts['deuxieme']}, 3e +${pts['troisieme']}, dernier ${pts['dernier']}. Fin de saison : un titre et des pièces selon la division atteinte.', taille: 12),
      const Ecart(10),
      Btn.principal('Fermer', large: true, onTap: app.fermerFenetre),
    ]);
  }
}

void fenetreFinSaison(Map r, [VoidCallback? suite]) {
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Muet('Saison ${r['saison']} : ${r['nom']} terminée', align: TextAlign.center),
        const Ecart(10),
        Center(child: TweenAnimationBuilder<double>(tween: Tween(begin: app.sansAnim ? 1 : .3, end: 1), duration: const Duration(milliseconds: 800), curve: Curves.elasticOut, builder: (_, s, child) => Transform.scale(scale: s, child: child), child: blason(r['meilleure'], taille: 90))),
        const Ecart(10),
        Text('${r['titre']}', textAlign: TextAlign.center, style: K.titre(34)),
        if (r['rang'] != null) Text('Classement final : ${r['rang']}e', textAlign: TextAlign.center, style: K.texte(15)),
        if ((r['pieces'] as num? ?? 0) > 0) ...[const Ecart(8), Center(child: recompense((r['pieces'] as num).toInt(), taille: 24))],
        const Ecart(8),
        const Muet('Une nouvelle saison commence : tu repars un peu plus bas. À toi de remonter !', align: TextAlign.center),
        const Ecart(12),
        Btn.principal('Super !', large: true, onTap: () { Api.post('/ligue/vu').catchError((_) => null); app.fermerFenetre(); suite?.call(); }),
      ]));
}

// ---------------------------------------------------------------- Parcours de saison
Future<void> ouvrirParcours() async {
  Map P;
  try { await app.chargerCatalogue(); P = await Api.get('/parcours') as Map; } catch (e) { app.toast(messageErreur(e)); return; }
  Future<void> recuperer(int n, String voie) async {
    try {
      final r = await Api.post('/parcours/recuperer', {'palier': n, 'voie': voie}) as Map;
      if (r['objet'] is Map) {
        final o = r['objet'] as Map;
        final q = app.lireProfil();
        R.objets.putIfAbsent(o['id'] as String, () => {'type': o['type'], 'nom': o['nom'], 'd': 'Parcours de saison'});
        R.donnerObjet(q, o['id'] as String);
        app.ecrireProfil(q);
        app.synchroEquiper(o['id'] as String);
        app.toast('Nouveau : ${o['nom']} (équipé)');
      } else {
        app.toast('+${r['pieces']} pièces');
      }
      app.soldeServeur(r['solde']);
      ouvrirParcours();
    } catch (e) { app.toast(messageErreur(e)); }
  }
  final fini = (P['palier'] as num) >= (P['paliersMax'] as num);
  final xp = (P['xp'] as num).toInt(), xpPalier = (P['xpPalier'] as num).toInt();
  final plus = P['kopoPlus'] == true;
  Widget caseRec(Map? r, int n, String voie, bool atteint) {
    if (r == null) return const SizedBox();
    final fait = r['recupere'] == true;
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(color: fait ? const Color(0x263FBF7F) : voie == 'plus' ? const Color(0x1AE2B04A) : const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        r['pieces'] != null && r['pieces'] != 0 ? const Piece(taille: 24) : apercuObjet((r['objet'] ?? '').toString(), taille: 26),
        const SizedBox(width: 6),
        Expanded(child: Text(r['pieces'] != null && r['pieces'] != 0 ? '${r['pieces']}' : '${r['nom'] ?? ''}', overflow: TextOverflow.ellipsis, style: K.texte(12, poids: FontWeight.w600))),
        if (fait) const Text('✓', style: TextStyle(color: K.good))
        else if (voie == 'plus' && !plus) const Ico('cadenas', taille: 16)
        else if (atteint) Btn.principal('Prendre', taille: 12, marge: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), onTap: () => recuperer(n, voie)),
      ]),
    );
  }
  app.ouvrirFenetre((context) => Fenetre(titre: 'Parcours de saison', enfants: [
        Muet('${P['saison'] is Map ? '${P['saison']['titre']} · ${App.resteSaison(P['saison']['fin'].toString())}' : ''} · XP en jouant avec d\'autres joueurs (pas contre les robots).', taille: 12),
        const Ecart(8),
        Row(children: [
          Container(width: 40, height: 40, alignment: Alignment.center, decoration: const BoxDecoration(shape: BoxShape.circle, color: K.brass), child: Text('${P['palier']}', style: K.titre(24, couleur: K.encre))),
          const SizedBox(width: 10),
          Expanded(child: Barre(fini ? 1 : (xp % xpPalier) / xpPalier)),
          const SizedBox(width: 10),
          Muet(fini ? 'Terminé !' : '${xp % xpPalier}/$xpPalier XP', taille: 12),
        ]),
        const Ecart(10),
        Row(children: [const SizedBox(width: 30), Expanded(child: Center(child: Muet('Gratuit'))), const SizedBox(width: 6), Expanded(child: Center(child: Muet(plus ? 'Kopo+ ✓' : 'Kopo+')))]),
        const Ecart(4),
        for (final x in ((P['paliers'] as List).cast<Map>()))
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: Opacity(
              opacity: x['atteint'] == true ? 1 : .6,
              child: Row(children: [
                SizedBox(width: 30, child: Text('${x['n']}', style: K.texte(14, couleur: x['atteint'] == true ? K.brass : K.muted, poids: FontWeight.w700))),
                Expanded(child: caseRec(x['gratuit'] as Map?, (x['n'] as num).toInt(), 'gratuit', x['atteint'] == true)),
                const SizedBox(width: 6),
                Expanded(child: caseRec(x['plus'] as Map?, (x['n'] as num).toInt(), 'plus', x['atteint'] == true)),
              ]),
            ),
          ),
        if (!plus) const Muet('Kopo+ (bientôt) : des apparences en plus sur le parcours. Jamais rien qui aide à gagner.', taille: 12),
        const Ecart(10),
        Btn.principal('Fermer', large: true, onTap: app.fermerFenetre),
      ]), 'ligue');
}

// ---------------------------------------------------------------- Match du jour
String casesMatch(Map r) => '🟩' * math.min(7, ((r['manches'] as num?) ?? 0).toInt()) + (r['victoire'] == true ? '🏆' : r['parti'] == true ? '⬜' : '🟥');
void partagerMatchJour(Map r) => ouvrirWhatsApp('Masano · Kopo, Match du jour n°${r['numero']}\n${casesMatch(r)} ${r['score']} / 100\nTu fais mieux ? 👉 $lienJeu');
String _rangTexte(Object? r) => r == 1 ? '1er' : '${r}e';

void expliquerMatchJour([VoidCallback? suite]) {
  Widget li(int n, String b, String t) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 26, height: 26, alignment: Alignment.center, decoration: const BoxDecoration(shape: BoxShape.circle, color: K.brass), child: Text('$n', style: K.texte(14, couleur: K.encre, poids: FontWeight.w700))),
          const SizedBox(width: 10),
          Expanded(child: Text.rich(TextSpan(style: K.texte(15), children: [TextSpan(text: b, style: const TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: ' $t')]))),
        ]),
      );
  app.ouvrirFenetre((context) => Fenetre(titre: 'Match du jour', enfants: [
        li(1, 'Chaque jour, un Match,', 'le même pour tous les joueurs, contre 8 robots de niveau Fort. Un seul essai.'),
        li(2, '+10 par manche passée, +30 si tu gagnes.', 'Ton score est sur 100.'),
        li(3, "Mise tes pièces dans une Bande d'amis.", 'Après 7 Matchs, le meilleur devient le Chef 👑 et gagne le pot.'),
        const Ecart(6),
        Btn.principal('Compris !', large: true, onTap: () { Stock.ecrire('kopo-jour-explique', true); app.fermerFenetre(); suite?.call(); }),
      ]));
}

Future<void> ouvrirMatchJour() async {
  Map e;
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    e = await Api.get('/match-jour') as Map;
    app.etatJour = e.cast<String, dynamic>();
  } catch (x) { app.toast(messageErreur(x)); return; }
  if (e['google'] != true) {
    fenetreGoogle('Match du jour', "Chaque jour, la même partie pour tous les joueurs, contre 8 robots Forts. Connecte-toi avec Google pour jouer : c'est ce qui garantit un seul essai par personne.");
    return;
  }
  if (Stock.lire('kopo-jour-explique') == null) { expliquerMatchJour(ouvrirMatchJour); return; }
  app.pointJour = false;
  app.maj();
  final m = e['moi'] is Map && e['moi']['fini'] == true ? e['moi'] as Map : null;
  final h = e['hier'] as Map?;
  final regles = (e['regles'] as Map?) ?? {};
  app.ouvrirFenetre((context) => Fenetre(titre: 'Match du jour', enfants: [
        Text('Match du jour n°${e['numero']}', style: K.texte(15, couleur: K.brass, poids: FontWeight.w700)),
        if (h != null) Muet('Hier (n°${h['numero']}) : ${h['victoire'] == true ? '🏆 ' : ''}${h['score']} / 100 · ${_rangTexte(h['rang'])} sur ${h['joueurs']} dans le monde', taille: 12),
        const Ecart(8),
        if (e['actif'] != true) Text('Le Match du jour est en pause. Reviens bientôt !', style: K.texte(15))
        else if (m != null) ...[
          Center(child: Text.rich(TextSpan(children: [TextSpan(text: '${m['score']}', style: K.titre(72, couleur: Colors.white)), TextSpan(text: ' / 100', style: K.texte(18, couleur: K.muted))]))),
          Center(child: Text(casesMatch(m), style: const TextStyle(fontSize: 22))),
          const Ecart(6),
          Text("Tu es ${_rangTexte(e['rang'])} sur ${e['joueurs']} joueurs aujourd'hui.", textAlign: TextAlign.center, style: K.texte(15)),
          Muet('Nouveau match dans ${dureeLisible((e['resteMs'] as num).toInt())}.', align: TextAlign.center),
          const Ecart(10),
          Btn.principal('Partager', large: true, onTap: () => partagerMatchJour({...m, 'numero': e['numero']})),
          const Ecart(8),
          Btn("S'entraîner (ne compte pas)", large: true, onTap: app.jouerMatchJour),
          const Ecart(10),
          const _ClassementJour(),
        ] else ...[
          Text('La même partie pour tout le monde. Un seul essai.', style: K.texte(15)),
          Muet('+${regles['parManche']} par manche passée, +${regles['victoire']} si tu gagnes · 8 robots de niveau Fort · nouveau match dans ${dureeLisible((e['resteMs'] as num).toInt())}', taille: 12),
          if (e['moi'] is Map && e['moi']['fini'] != true) const Muet('Ton essai est en cours sur un autre appareil.', taille: 12),
          const Ecart(10),
          Btn.principal('Jouer', large: true, onTap: app.jouerMatchJour),
        ],
        const Ecart(8),
        Btn('La Bande', large: true, onTap: () => ouvrirBande()),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ]), 'ligue');
}

class _ClassementJour extends StatefulWidget {
  const _ClassementJour();
  @override
  State<_ClassementJour> createState() => _ClassementJourState();
}

class _ClassementJourState extends State<_ClassementJour> {
  String type = 'amis';
  Map? c;
  String? erreur;
  @override
  void initState() { super.initState(); _charger('amis'); }
  Future<void> _charger(String t) async {
    setState(() { type = t; c = null; erreur = null; });
    try { final r = await Api.get('/match-jour/classement?type=$t') as Map; if (mounted && type == t) setState(() => c = r); }
    catch (e) { if (mounted) setState(() => erreur = messageErreur(e)); }
  }
  @override
  Widget build(BuildContext context) {
    final l = ((c?['liste'] as List?) ?? []).cast<Map>();
    final moi = c?['moi'] as Map?;
    Widget ligne(Map j) => LigneClassement('${j['rang']}', '${j['victoire'] == true ? '🏆 ' : ''}${j['pseudo']}', '${j['score']}', moi: moi != null && j['id'] == moi['id']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Onglets(const [('amis', 'Amis'), ('mondial', 'Monde')], type, _charger),
      const Ecart(6),
      if (erreur != null) Muet(erreur!)
      else if (c == null) const Muet('Chargement…')
      else ...[
        for (final j in l) ligne(j),
        if (moi != null && !l.any((j) => j['id'] == moi['id'])) ...[const Center(child: Muet('…')), ligne(moi)],
        if (l.isEmpty) Muet(type == 'amis' ? "Aucun ami n'a encore joué aujourd'hui." : "Personne n'a encore fini le Match du jour."),
      ],
    ]);
  }
}

void resultatMatchJour(Map r) {
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('Match du jour n°${r['numero']}${r['officiel'] == true ? '' : ' · entraînement'}', textAlign: TextAlign.center, style: K.texte(15, couleur: K.brass, poids: FontWeight.w700)),
        Center(child: TweenAnimationBuilder<double>(
          tween: Tween(begin: app.sansAnim ? 1 : .4, end: 1), duration: const Duration(milliseconds: 600), curve: Curves.easeOutBack,
          builder: (_, s, child) => Transform.scale(scale: s, child: child),
          child: Text.rich(TextSpan(children: [TextSpan(text: '${r['score']}', style: K.titre(80, couleur: Colors.white)), TextSpan(text: ' / 100', style: K.texte(18, couleur: K.muted))])),
        )),
        Center(child: Text(casesMatch(r), style: const TextStyle(fontSize: 22))),
        const Ecart(8),
        Text(r['victoire'] == true ? 'Tu as gagné la finale contre les robots Forts !' : r['parti'] == true ? "Tu as quitté : ton score s'arrête là." : 'Éliminé à la manche ${((r['manches'] as num?) ?? 0) + 1}.', textAlign: TextAlign.center, style: K.texte(15)),
        if (r['officiel'] != true) const Muet('Entraînement : ce score ne compte pas.', align: TextAlign.center),
        const Ecart(12),
        if (r['officiel'] == true) ...[Btn.principal('Partager', large: true, onTap: () => partagerMatchJour(r)), const Ecart(8)],
        Btn('Voir ma Bande', large: true, onTap: () => ouvrirBande()),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: () { app.fermerFenetre(); app.majCartesCompetition(); }),
      ]));
  app.majCartesCompetition();
}

// ---------------------------------------------------------------- La Bande
const joursCourts = ['L', 'M', 'Me', 'J', 'V', 'S', 'D'];
({int jour, int heure}) momentKinshasa() { final d = DateTime.now().toUtc().add(const Duration(hours: 1)); return (jour: d.weekday % 7, heure: d.hour); }
String periodeInscription() {
  final m = momentKinshasa();
  if (m.jour == 0 || (m.jour == 1 && m.heure < 23)) return 'normal';
  if (m.jour == 1 || m.jour == 2 || (m.jour == 3 && m.heure < 23)) return 'retard';
  return 'ferme';
}

Future<void> ouvrirBande({bool creer = false, String? id}) async {
  Map b;
  try {
    if (!await app.compteEnLigneOuCreer()) { app.lirePseudo(); return; }
    b = await Api.get('/bandes') as Map;
    app.etatBandes = b.cast<String, dynamic>();
  } catch (x) { app.toast(messageErreur(x)); return; }
  if (b['google'] != true) { fenetreGoogle('La Bande', 'Défie tes amis chaque semaine : chacun mise, et le meilleur après 7 Matchs du jour gagne le pot. Connecte-toi avec Google pour créer ou rejoindre une Bande.'); return; }
  if (b['actif'] != true) { app.toast('Les Bandes sont en pause. Reviens bientôt !'); return; }
  if (id != null) { ouvrirUneBande(id); return; }
  final bandes = ((b['bandes'] as List?) ?? []).cast<Map>();
  if (creer || bandes.isEmpty) { fenetreNouvelleBande(b); return; }
  if (bandes.length == 1) { ouvrirUneBande(bandes[0]['id'].toString()); return; }
  app.ouvrirFenetre((context) => Fenetre(titre: 'Mes Bandes', enfants: [
        for (final x in bandes)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Btn(null, large: true, onTap: () => ouvrirUneBande(x['id'].toString()), enfant: Row(children: [
              Expanded(child: Text('${x['jeSuisChef'] == true ? '👑 ' : ''}${x['nom']}', style: K.texte(15, poids: FontWeight.w600))),
              Muet(x['inscrit'] == true ? '${x['rang']}e · ${x['total']} pts' : '${x['membres']} membres', taille: 12),
            ])),
          ),
        if (bandes.length < ((b['max'] as num?) ?? 3)) ...[Btn('Créer ou rejoindre une autre Bande', large: true, onTap: () => fenetreNouvelleBande(b)), const Ecart(8)],
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ]));
}

List<int> _mises(Map r) => [500, 1000, 2000, 5000, 10000].where((x) => x >= ((r['miseMin'] as num?) ?? 0) && x <= ((r['miseMax'] as num?) ?? 1e9)).toList();

void fenetreNouvelleBande(Map b) {
  final r = (b['regles'] as Map?) ?? {};
  final nom = TextEditingController();
  final mises = _mises(r);
  var mise = mises.isEmpty ? 500 : mises.first;
  var ouverte = false;
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: 'Créer ma Bande', enfants: [
        Text('Ta Bande, ce sont tes amis : chaque semaine, chacun mise, vous jouez vos 7 Matchs du jour, et le meilleur devient le Chef 👑 et gagne le pot.', style: K.texte(15)),
        const Ecart(10),
        const Muet('Nom de la Bande'),
        Champ(nom, indice: 'Ex. Les Lions de Matonge', max: 24),
        const Ecart(8),
        const Muet('Mise de chaque semaine (la même pour tous)'),
        Choix([for (final v in mises) (v, '${_p(v)} pièces')], mise, (v) => setState(() => mise = v)),
        const Ecart(6),
        Bascule('Bande ouverte', ouverte, (v) => setState(() => ouverte = v), aide: 'Les inconnus de ton pays peuvent demander à entrer. Sinon, seulement par ton lien.'),
        const Ecart(10),
        Btn.principal('Créer ma Bande', large: true, onTap: () async {
          try { final x = await Api.post('/bandes', {'nom': nom.text, 'mise': mise, 'ouverte': ouverte}) as Map; app.toast('Ta Bande est créée : invite tes amis !'); afficherBande(x); }
          catch (e) { app.toast(messageErreur(e)); }
        }),
        const Ecart(8),
        Btn('Trouver une Bande ouverte', large: true, onTap: fenetreBandesOuvertes),
        const Ecart(6),
        const Muet("Un ami t'a envoyé un lien ? Ouvre-le : tu entres directement dans sa Bande.", taille: 12),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ])));
}

Future<void> fenetreBandesOuvertes() async {
  Map l;
  try { l = await Api.get('/bandes/ouvertes') as Map; } catch (e) { app.toast(messageErreur(e)); return; }
  final liste = ((l['liste'] as List?) ?? []).cast<Map>();
  final demandees = <String>{for (final x in liste) if (x['demandee'] == true) x['id'].toString()};
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: 'Bandes ouvertes', enfants: [
        for (final x in liste)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Btn(null, large: true, onTap: demandees.contains(x['id'].toString()) ? null : () async {
              try { await Api.post('/bandes/${x['id']}/demander'); app.toast('Demande envoyée : le créateur de la Bande va te répondre.'); setState(() => demandees.add(x['id'].toString())); } catch (e) { app.toast(messageErreur(e)); }
            }, enfant: Row(children: [
              Expanded(child: Text('${x['nom']}', style: K.texte(15, poids: FontWeight.w600))),
              Muet('${x['membres']} membres · mise ${_p(x['mise'])}${demandees.contains(x['id'].toString()) ? ' · demandé' : ''}', taille: 12),
            ])),
          ),
        if (liste.isEmpty) Muet(l['pays'] != null ? 'Pas encore de Bande ouverte en ${nomPays(l['pays'])}. Crée la tienne !' : 'Pas encore de Bande ouverte. Crée la tienne !'),
        const Ecart(8),
        Btn('Retour', large: true, onTap: () => ouvrirBande(creer: true)),
      ])));
}

Future<void> ouvrirUneBande(String id) async {
  Map x;
  try { x = await Api.get('/bandes/$id') as Map; } catch (e) { app.toast(messageErreur(e)); return; }
  final t = x['titres'] as Map?;
  if (t != null && t['semaine'] != null && Stock.lire('kopo-bande-vu-$id') != t['semaine'] && ((t['classement'] as List?) ?? []).any((l) => l['id'] == monCompteId)) {
    Stock.ecrire('kopo-bande-vu-$id', t['semaine']);
    finDeSemaineBande(x, () => afficherBande(x));
    return;
  }
  afficherBande(x);
}

String _noms(List l) => l.map((c) => c['pseudo']).join(' et ');

void finDeSemaineBande(Map x, VoidCallback suite) {
  final t = x['titres'] as Map;
  final cl = (t['classement'] as List).cast<Map>();
  final moi = cl.where((l) => l['id'] == monCompteId).firstOrNull;
  final chefs = (t['chefs'] as List?) ?? [], losers = (t['losers'] as List?) ?? [];
  Api.get('/moi').then((m) => app.soldeServeur(m['compte']['solde'])).catchError((_) => null);
  app.ouvrirFenetre((context) => Fenetre(titre: 'Semaine terminée !', enfants: [
        Text('👑 ${_noms(chefs)} ${chefs.length > 1 ? 'sont les Chefs' : 'est le Chef'} de « ${x['nom']} »', style: K.texte(15)),
        const Ecart(8),
        for (final l in cl.take(5)) LigneClassement('${l['rang']}', '${l['pseudo']}${l['enRegle'] == true ? '' : ' (hors course)'}', l['gain'] != null && l['gain'] != 0 ? '+${_p(l['gain'])}' : '${l['total']}', moi: l['id'] == monCompteId),
        if (losers.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text('🤡 ${_noms(losers)} ${losers.length > 1 ? 'sont les Losers' : 'est le Loser'} de la semaine', style: K.texte(15))),
        if (moi != null && moi['gain'] != null && moi['gain'] != 0) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Tu reçois ${_p(moi['gain'])} pièces.', style: K.texte(15, poids: FontWeight.w700))),
        const Muet('Nouvelle semaine : mise avant lundi 23 h.', taille: 12),
        const Ecart(10),
        Btn.principal('Voir la Bande', large: true, onTap: suite),
      ]));
}

String lienBande(Map x) => '${lienJeu.replaceAll(RegExp(r'#.*$'), '')}?bande=${x['code']}';
Future<void> inviterBande(Map x) async {
  String? parrain;
  try { parrain = (await Api.get('/parrainage'))['code'] as String?; } catch (_) {}
  final lien = lienBande(x) + (parrain != null ? '&parrain=$parrain' : '');
  ouvrirWhatsApp('Rejoins ma Bande « ${x['nom']} » sur Masano (Kopo) ! Chaque jour un Match, chaque semaine on mise, et le meilleur rafle le pot 👑 $lien');
}

void afficherBande(Map x) {
  final s = x['semaine'] as Map;
  final t = (x['titres'] as Map?) ?? {};
  final chefs = {for (final c in (t['chefs'] as List?) ?? []) c['id']};
  final losers = {for (final c in (t['losers'] as List?) ?? []) c['id']};
  final membres = ((x['membres'] as List?) ?? []).cast<Map>();
  final cl = ((s['classement'] as List?) ?? []).cast<Map>();
  final regles = (x['regles'] as Map?) ?? {};
  final moi = (x['moi'] as Map?) ?? {};
  var auto = moi['auto'] == true;
  final retardAffiche = cl.any((l) => ((l['jours'] as List?) ?? []).any((j) => j['type'] == 'retard'));
  final pasInscrits = membres.where((m) => m['inscrit'] != true).toList();
  final ej = app.etatJour;
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: '${x['nom']}', enfants: [
        Muet('${membres.length} membre${membres.length > 1 ? 's' : ''}${x['ouverte'] == true ? ' · Bande ouverte' : ''}', taille: 12),
        if ((t['chefs'] as List?)?.isNotEmpty == true) Text("👑 Chef : ${_noms(t['chefs'] as List)}${(t['serie'] as num? ?? 0) > 1 ? ' (${t['serie']}e semaine d\'affilée)' : ''}", style: K.texte(15, poids: FontWeight.w700)),
        const Ecart(8),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0x59E2B04A))),
          child: Row(children: [
            Expanded(child: Text.rich(TextSpan(style: K.texte(15), children: [const TextSpan(text: 'À gagner : '), TextSpan(text: s['lancee'] == true ? _p(s['aGagner']) : '—', style: const TextStyle(fontWeight: FontWeight.w700, color: K.brass))]))),
            Muet('mise ${_p(s['mise'])} · fin dimanche minuit', taille: 12),
          ]),
        ),
        if (s['lancee'] != true) Padding(padding: const EdgeInsets.only(top: 4), child: Muet((s['inscrits'] as num? ?? 0) > 0 ? 'En attente : encore ${2 - (s['inscrits'] as num)} ami à inscrire pour lancer la semaine.' : "Personne n'a encore misé cette semaine.", taille: 12)),
        const Ecart(8),
        for (final l in cl)
          Container(
            margin: const EdgeInsets.only(bottom: 4),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: l['id'] == monCompteId ? const Color(0x2EE2B04A) : const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(8)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                SizedBox(width: 28, child: Text('${l['rang']}', style: K.texte(14, couleur: K.muted, poids: FontWeight.w700))),
                Expanded(child: Text.rich(TextSpan(style: K.texte(14), children: [
                  TextSpan(text: '${chefs.contains(l['id']) ? '👑 ' : losers.contains(l['id']) ? '🤡 ' : ''}${l['pseudo']}'),
                  if (((l['jours'] as List?) ?? []).any((j) => j['type'] == 'attente')) const TextSpan(text: " ⏳ pas encore joué aujourd'hui", style: TextStyle(color: K.muted, fontSize: 12)),
                  if (l['enRegle'] != true) const TextSpan(text: ' hors course', style: TextStyle(color: K.bad, fontSize: 12)),
                ]))),
                Text('${l['total']}', style: K.texte(14, couleur: K.brass, poids: FontWeight.w700)),
              ]),
              Muet([for (var i = 0; i < ((l['jours'] as List?) ?? []).length; i++) '${joursCourts[i]} ${(l['jours'] as List)[i]['score'] == null ? '—' : '${(l['jours'] as List)[i]['score']}${(l['jours'] as List)[i]['type'] == 'retard' ? '*' : ''}'}'].join(' · '), taille: 11),
            ]),
          ),
        if (cl.isEmpty) const Muet('Le classement apparaît dès la première mise.'),
        Muet('Chaque Match compte. Un Match raté = 0. Moins de ${regles['matchsMin']} Matchs joués sur 7 = ta mise est perdue.${retardAffiche ? " * jour avant l'inscription : pire note du jour − ${regles['penaliteRetard']}." : ''}', taille: 12),
        if (moi['inscrit'] != true) ...[
          const Ecart(8),
          if (s['inscriptionOuverte'] == true) ...[
            Text('Mise : ${_p(s['mise'])} pièces · ${s['inscrits']} inscrit${(s['inscrits'] as num? ?? 0) > 1 ? 's' : ''}', style: K.texte(15, poids: FontWeight.w700)),
            Muet('${regles['maison']} % des mises sont retirés du jeu. Le 2e récupère sa mise (dès 3 joueurs).', taille: 12),
            if (s['lundi'] != null && DateTime.now().isAfter(DateTime.parse('${s['lundi']}T23:00:00Z'))) Muet('Tu arrives en retard : les jours passés comptent comme la pire note du jour − ${regles['penaliteRetard']}, et tu dois jouer tous les jours qui restent.', taille: 12),
            if (moi['peutMiser'] != true) Muet('Pour miser, il te faut : ${((moi['manque'] as List?) ?? []).join(', ')}.', taille: 12),
            const Ecart(6),
            Btn.principal('Miser ${_p(s['mise'])}', large: true, onTap: moi['peutMiser'] != true ? null : () => demanderConfirmation(
                  'Tu mises ${_p(s['mise'])} pièces pour cette semaine. Le meilleur après 7 Matchs gagne le pot ; le dernier est Loser de la semaine.',
                  () async {
                    try { final y = await Api.post('/bandes/${x['id']}/miser') as Map; Api.get('/moi').then((mm) => app.soldeServeur(mm['compte']['solde'])).catchError((_) => null); app.toast('Mise payée : bonne semaine !'); afficherBande(y); app.majCartesCompetition(); }
                    catch (e) { app.toast(messageErreur(e)); afficherBande(x); }
                  },
                  titre: 'Miser ?', oui: 'Miser ${_p(s['mise'])}', annuler: () => afficherBande(x),
                )),
          ] else
            const Muet('Les inscriptions sont fermées depuis mercredi 23 h. Rendez-vous lundi !'),
        ],
        Bascule('Remiser automatiquement chaque semaine', auto, (v) async {
          setState(() => auto = v);
          try { await Api.post('/bandes/${x['id']}/auto', {'auto': v}); app.toast(v ? 'Tu mises automatiquement chaque lundi.' : 'Mise automatique coupée.'); }
          catch (e) { app.toast(messageErreur(e)); setState(() => auto = !v); }
        }),
        for (final d in ((x['demandes'] as List?) ?? []).cast<Map>())
          Row(children: [
            Expanded(child: Text('${d['pseudo']}#${d['numero']} veut entrer', style: K.texte(14))),
            Btn.principal('Accepter', taille: 13, marge: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), onTap: () async { try { afficherBande(await Api.post('/bandes/${x['id']}/demandes/${d['id']}', {'accepter': true}) as Map); } catch (e) { app.toast(messageErreur(e)); } }),
            const SizedBox(width: 6),
            Btn('Refuser', taille: 13, marge: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), onTap: () async { try { afficherBande(await Api.post('/bandes/${x['id']}/demandes/${d['id']}', {'accepter': false}) as Map); } catch (e) { app.toast(messageErreur(e)); } }),
          ]),
        if (pasInscrits.isNotEmpty) Muet('Pas encore inscrits : ${pasInscrits.map((m) => m['pseudo']).join(', ')}', taille: 12),
        const Ecart(10),
        if (ej != null && !(ej['moi'] is Map && ej['moi']['fini'] == true)) ...[Btn.principal('Jouer mon Match du jour', large: true, onTap: ouvrirMatchJour), const Ecart(8)],
        Btn('Inviter des amis', icone: 'partager', large: true, onTap: () => inviterBande(x)),
        if (x['createur'] == true) ...[const Ecart(8), Btn('Réglages de la Bande', large: true, onTap: () => reglagesBande(x))],
        const Ecart(8),
        Btn('Quitter la Bande', large: true, onTap: () => demanderConfirmation(moi['inscrit'] == true ? 'Ta mise de cette semaine reste dans le pot.' : "Tu pourras revenir avec le lien d'un ami.", () async {
              try { await Api.post('/bandes/${x['id']}/quitter'); app.toast('Tu as quitté la Bande.'); app.majCartesCompetition(); } catch (e) { app.toast(messageErreur(e)); }
            }, titre: 'Quitter la Bande ?', oui: 'Quitter', annuler: () => afficherBande(x))),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ])), 'ligue');
}

void reglagesBande(Map x) {
  final nom = TextEditingController(text: '${x['nom']}');
  final mises = _mises((x['regles'] as Map?) ?? {});
  var mise = (x['miseBande'] as num?)?.toInt() ?? (mises.isEmpty ? 500 : mises.first);
  var ouverte = x['ouverte'] == true;
  final membres = ((x['membres'] as List?) ?? []).cast<Map>().where((m) => m['id'] != monCompteId).toList();
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: 'Réglages de la Bande', enfants: [
        const Muet('Nom'),
        Champ(nom, max: 24),
        const Ecart(8),
        const Muet("Mise (vaut pour la prochaine semaine où personne n'a encore misé)"),
        Choix([for (final v in mises) (v, '${_p(v)} pièces')], mise, (v) => setState(() => mise = v)),
        Bascule('Bande ouverte aux inconnus (sur demande)', ouverte, (v) => setState(() => ouverte = v)),
        for (final m in membres)
          Row(children: [
            Expanded(child: Text('${m['pseudo']}', style: K.texte(15))),
            Btn('Retirer', onTap: () async { try { await Api.delete('/bandes/${x['id']}/membres/${m['id']}'); ouvrirUneBande(x['id'].toString()); } catch (e) { app.toast(messageErreur(e)); } }),
          ]),
        const Ecart(10),
        Btn.principal('Enregistrer', large: true, onTap: () async {
          try { afficherBande(await Api.patch('/bandes/${x['id']}', {'nom': nom.text, 'mise': mise, 'ouverte': ouverte}) as Map); app.toast('Bande mise à jour.'); } catch (e) { app.toast(messageErreur(e)); }
        }),
        const Ecart(8),
        Btn('Retour', large: true, onTap: () => afficherBande(x)),
      ])));
}

/// Lien ?bande=CODE reçu d'un ami : on propose d'entrer (avec Google).
Future<void> ouvrirLienBande(Map l) async {
  if (DateTime.now().millisecondsSinceEpoch - ((l['le'] as num?) ?? 0) > 7 * 864e5) { Stock.effacer('kopo-bande-lien'); return; }
  const texte = 'Chaque semaine, on mise sur nos Matchs du jour, et le meilleur rafle le pot. Connecte-toi avec Google pour entrer dans la Bande.';
  final eb = app.etatBandes;
  if (!app.enLigne || (eb != null && eb['google'] != true)) { lienBandeVu = true; fenetreGoogle("Un ami t'invite dans sa Bande", texte); return; }
  if (eb == null) return;
  lienBandeVu = true;
  try {
    final x = await Api.post('/bandes/rejoindre', {'code': l['code']}) as Map;
    Stock.effacer('kopo-bande-lien');
    app.toast('Bienvenue dans « ${x['nom']} » !');
    afficherBande(x);
    app.majCartesCompetition();
  } catch (e) {
    final m = messageErreur(e);
    app.toast(m);
    if (RegExp('inconnu|complète|maximum').hasMatch(m)) { Stock.effacer('kopo-bande-lien'); } else { lienBandeVu = false; }
  }
}

// ---------------------------------------------------------------- « Nouveau » : Match du jour et Bande (3 écrans, une fois)
const nouveaute = 'bande';
Map? lireNouveaute() { final v = Stock.lire('kopo-nouveaute-vue'); return v is Map && v['id'] == nouveaute ? v : null; }
void ecrireNouveaute(Map x) => Stock.ecrire('kopo-nouveaute-vue', {'id': nouveaute, 'le': DateTime.now().millisecondsSinceEpoch, ...?lireNouveaute(), ...x});

bool annonceNouveaute() {
  if (!(app.enLigne && app.config?['nouveaute'] == nouveaute) || lireNouveaute() != null) return false;
  if (Stock.lire('kopo-bande-lien') != null) { ecrireNouveaute({'saute': true}); return false; }
  ecrireNouveaute({});
  Stock.ecrire('kopo-jour-explique', true);
  fenetreNouveaute(0);
  return true;
}

void fenetreNouveaute(int etape) {
  void fermer() { app.fermerFenetre(); app.suiteAccueil(); }
  Widget points() => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < 3; i++) Container(width: 8, height: 8, margin: const EdgeInsets.all(3), decoration: BoxDecoration(shape: BoxShape.circle, color: i == etape ? K.brass : K.line)),
      ]);
  Widget badge() => Center(child: Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3), decoration: BoxDecoration(color: K.red, borderRadius: BorderRadius.circular(99)), child: Text('NOUVEAU', style: K.texte(12, couleur: Colors.white, poids: FontWeight.w700))));
  Widget p(List<Object> m) => Text.rich(TextSpan(style: K.texte(15), children: [for (final x in m) x is List ? TextSpan(text: x[0] as String, style: const TextStyle(fontWeight: FontWeight.w700)) : TextSpan(text: x as String)]), textAlign: TextAlign.center);
  Widget titre(String t) => Text(t, textAlign: TextAlign.center, style: K.titre(36));
  List<Widget> contenu;
  if (etape == 0) {
    contenu = [
      badge(), const Ecart(6), titre('Le Match du jour'),
      p([['Chaque jour, une partie contre 8 robots.'], ' La même pour tous les joueurs. ', ['Un seul essai.']]),
      const Ecart(8),
      const Center(child: Text('🟩🟩🟩🟩🟩🟩🟩🏆', style: TextStyle(fontSize: 22))),
      Center(child: Text.rich(TextSpan(children: [TextSpan(text: '100', style: K.titre(56, couleur: Colors.white)), TextSpan(text: ' / 100', style: K.texte(16, couleur: K.muted))]))),
      const Muet('+10 par manche passée · +30 si tu gagnes la finale', align: TextAlign.center, taille: 12),
      const Ecart(6),
      const Muet('Il change chaque nuit à minuit.', align: TextAlign.center, taille: 12),
    ];
  } else if (etape == 1) {
    Widget ligne(String e, String b, String t) => Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(children: [Text(e, style: const TextStyle(fontSize: 24)), const SizedBox(width: 10), Expanded(child: Text.rich(TextSpan(style: K.texte(14), children: [TextSpan(text: b, style: const TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: ' $t')])))]));
    contenu = [
      badge(), const Ecart(6), titre('La Bande'),
      p([['Forme une Bande avec tes amis'], " et misez vos pièces pour la semaine. Vos scores du Match du jour s'additionnent, du lundi au dimanche."]),
      const Ecart(8),
      ligne('👑', 'Le meilleur devient le Chef', 'et gagne le pot'),
      ligne('🥈', 'Le 2e', 'récupère sa mise (dès 3 joueurs)'),
      ligne('🤡', 'Le dernier', 'est Loser de la semaine'),
      Text.rich(TextSpan(style: K.texte(12, couleur: K.muted), children: const [TextSpan(text: 'Chaque jour compte', style: TextStyle(fontWeight: FontWeight.w700)), TextSpan(text: ' : un Match raté = 0.')]), textAlign: TextAlign.center),
    ];
  } else if (app.avecGoogle) {
    final per = periodeInscription();
    final mini = (app.etatBandes?['regles'] as Map?) ?? {};
    final n = app.etatJour?['numero'] != null ? ' n°${app.etatJour!['numero']}' : '';
    contenu = [
      titre('À toi de jouer'),
      p([["Le Match du jour$n t'attend."], ' Il disparaît à minuit.']),
      const Ecart(8),
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Première semaine', style: K.texte(14, poids: FontWeight.w700)),
          Muet(per == 'normal'
              ? 'Crée ou rejoins une Bande et mise avant lundi 23 h pour jouer les 7 Matchs. Mise à partir de ${_p(mini['miseMin'] ?? 500)} pièces.'
              : per == 'retard'
                  ? "Tu peux encore miser jusqu'à mercredi 23 h. Les jours manqués comptent comme la pire note de la Bande moins ${mini['penaliteRetard'] ?? 10}."
                  : 'Les inscriptions rouvrent dimanche à minuit. En attendant, entraîne-toi sur le Match du jour et invite tes amis.', taille: 13),
        ]),
      ),
      const Ecart(10),
      Btn.principal('Jouer le Match du jour', large: true, onTap: () { app.fermerFenetre(); ouvrirMatchJour(); }),
      const Ecart(8),
      Btn('Créer ma Bande', large: true, onTap: () { app.fermerFenetre(); ouvrirBande(creer: true); }),
      const Ecart(8), points(),
      Btn('Plus tard', style: StyleBtn.discret, large: true, onTap: fermer),
    ];
  } else {
    final g = app.config?['google'] as String?;
    contenu = [
      titre('À toi de jouer'),
      p(['Le Match du jour et la Bande se jouent ', ['avec un compte Google'], ". Une seule partie par jour et par joueur : c'est ce qui rend le classement juste."]),
      const Ecart(10),
      if (g != null) ...[Btn.principal('Se connecter avec Google', large: true, onTap: () => connecterGoogle(g)), const Muet('Tes pièces et ta collection te suivent sur ton compte.', align: TextAlign.center, taille: 12)]
      else const Muet('La connexion Google arrive très bientôt.', align: TextAlign.center, taille: 12),
      const Ecart(8), points(),
      Btn('Plus tard', style: StyleBtn.discret, large: true, onTap: fermer),
    ];
  }
  if (etape < 2) {
    contenu = [
      Align(alignment: Alignment.centerRight, child: Btn('Passer', style: StyleBtn.discret, onTap: fermer)),
      ...contenu,
      const Ecart(10), points(), const Ecart(8),
      Btn.principal('Suivant', large: true, onTap: () => fenetreNouveaute(etape + 1)),
    ];
  }
  app.ouvrirFenetre((context) => GestureDetector(
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if (v < -200 && etape < 2) { fenetreNouveaute(etape + 1); } else if (v > 200 && etape > 0) { fenetreNouveaute(etape - 1); }
        },
        child: Fenetre(enfants: contenu),
      ), 'nouveaute');
}
