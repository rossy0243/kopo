// Fenêtres de l'accueil : style Inter (8), Rejoindre, En ligne (mises, salles), Contre les robots, Ma table,
// Règles, Partager (groupes), pièces (bonus du jour), cadeau de fondateur, remise à flot.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../commun/retention.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';
import 'compet.dart' show fenetreNouveaute;
import 'progres.dart';
import 'social.dart';

// ---------------------------------------------------------------- Inter (8) : quelle partie ?
void choisirStyleInter(String p) {
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) {
        Widget carte(String mode, String lettre, String titre, String texte, String puce) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Material(
                color: const Color(0x12FFFFFF),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0x59E2B04A))),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () {
                    if (Stock.lire('kopo-inter8-jretour') == null) app.ecrireJRetour(app.jRetourInter);
                    Stock.ecrire('kopo-inter8-style', mode);
                    app.fermerFenetre();
                    app.creerPartie(p, 'inter8', mode);
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      Container(width: 40, height: 56, alignment: Alignment.center, decoration: BoxDecoration(color: K.card, borderRadius: BorderRadius.circular(6)), child: Text(lettre, style: K.titre(30, couleur: K.cardInk))),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(titre, style: K.titre(26)),
                        Text(texte, style: K.texte(13)),
                        const SizedBox(height: 4),
                        Pastille(puce),
                      ])),
                    ]),
                  ),
                ),
              ),
            );
        return Fenetre(titre: 'Quelle partie ?', enfants: [
          const Muet("Inter (8), entre amis. Choisis le style avant d'inviter."),
          const Ecart(10),
          carte('simple', '8', 'Simple', 'Les règles de base, de 2 à 8 joueurs.', '1 paquet (54 cartes)'),
          carte('delire', 'J', 'Délire', 'Les mêmes règles avec deux paquets, de 2 à 8 joueurs. Le J retour (le valet change le sens du jeu) en option.', '2 paquets (108 cartes)'),
          const Muet('En délire :', taille: 12),
          const SizedBox(height: 4),
          Choix(const [(false, 'Sans J retour'), (true, 'Avec J retour')], app.jRetourInter, (v) { app.ecrireJRetour(v); setState(() {}); }),
          const Ecart(12),
          Btn('Annuler', large: true, onTap: app.fermerFenetre),
        ]);
      }), 'styleInter');
}

// ---------------------------------------------------------------- Rejoindre
void ouvrirRejoindre() {
  if (app.exigerGoogle()) return;
  final code = TextEditingController();
  void valider() {
    final c = code.text.trim().toUpperCase();
    if (!RegExp(r'^[A-Z]{4}$').hasMatch(c)) { app.toast('Le code fait 4 lettres.'); return; }
    app.rejoindreCode(c);
  }
  app.ouvrirFenetre((context) => Fenetre(titre: 'Rejoindre', enfants: [
        Text("Tape le code à 4 lettres affiché chez l'hôte, ou scanne son QR code avec l'appareil photo.", style: K.texte(15)),
        const Ecart(12),
        Champ(code, indice: 'ABCD', max: 4, majuscules: true, align: TextAlign.center, style: K.titre(44, couleur: Colors.white).copyWith(letterSpacing: 10), onValider: (_) => valider()),
        const Ecart(12),
        Btn.principal('Rejoindre', large: true, onTap: valider),
        const Ecart(8),
        Btn('Annuler', large: true, onTap: app.fermerFenetre),
      ]), 'rejoindre');
}

// ---------------------------------------------------------------- En ligne
void ouvrirEnLigne() {
  if (app.lirePseudo() == null || app.exigerGoogle()) return;
  app.lireEnLigneServeur();
  app.ouvrirFenetre((context) {
    final inter = app.jeu == 'inter8';
    final t = !inter ? app.tablesMise : null;
    final active = app.miseActive;
    final grande = inter ? App.maxInter : App.maxKopo;
    final n = app.nbEnLigne;
    Widget salle(int taille, {bool principal = false, String? titre, String? sous}) {
      final m = app.ouvertes(taille).firstOrNull;
      final attente = m != null ? '${m['joueurs']}/$taille en attente' : null;
      void go() { final p = app.lirePseudo(); if (p == null) return; app.fermerFenetre(); app.chercherSalle(p, taille); }
      if (titre == null) {
        return Btn(null, onTap: go, marge: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), enfant: Column(children: [
          Text('Salle de $taille', style: K.texte(14, poids: FontWeight.w700)),
          Text(attente ?? 'nouvelle salle', style: K.texte(11, couleur: m != null ? K.good : K.muted)),
        ]));
      }
      return Btn(null, style: principal ? StyleBtn.principal : StyleBtn.normal, onTap: go, enfant: Row(children: [
        Text('$taille', style: K.titre(44, couleur: principal ? K.encre : K.brass)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titre, style: K.texte(16, couleur: principal ? K.encre : K.ink, poids: FontWeight.w700)),
          Text(attente ?? sous ?? '', style: K.texte(12, couleur: principal ? const Color(0xFF4A3A12) : m != null ? K.good : K.muted)),
        ])),
      ]));
    }
    final pot = (app.config?['pot'] as Map?) ?? {};
    String? aide;
    if (t != null) {
      if (active != null) {
        aide = 'Mise de ${App.formatPieces(t[active] as num)} pièces par partie. Le pot va au 1er (${pot['vainqueur']} %), au 2e (${pot['deuxieme']} %) et au 3e (${pot['troisieme']} %). Quitter en cours, c\'est perdre sa mise.';
      } else {
        final prochain = App.niveauxMise.where((x) => ((t[x.$1] as num?) ?? 0) > 0 && app.solde < app.seuilMise(x.$1)).firstOrNull;
        aide = 'Partie gratuite : tu gagnes des pièces à chaque manche.${prochain != null ? ' Table ${prochain.$2} dès ${App.formatPieces(app.seuilMise(prochain.$1))} pièces.' : ''}';
      }
    }
    Widget mise(String? v, String titre, String sous, bool ouvert) => Opacity(
          opacity: ouvert ? 1 : .5,
          child: GestureDetector(
            onTap: ouvert ? () { Stock.ecrire('kopo-mise', v); app.maj(); } : null,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(color: v == active ? K.brass : const Color(0x12FFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.line)),
              child: Column(children: [
                Text(titre, style: K.texte(13, couleur: v == active ? K.encre : K.ink, poids: FontWeight.w700)),
                Row(mainAxisSize: MainAxisSize.min, children: [if (!ouvert) const Padding(padding: EdgeInsets.only(right: 3), child: Ico('cadenas', taille: 12)), Text(sous, style: K.texte(11, couleur: v == active ? K.encre : K.muted))]),
              ]),
            ),
          ),
        );
    return Fenetre(titre: 'En ligne', enfants: [
      Row(children: [Container(width: 8, height: 8, decoration: const BoxDecoration(color: K.good, shape: BoxShape.circle)), const SizedBox(width: 6), Text('$n joueur${n > 1 ? 's' : ''} en ligne', style: K.texte(14, couleur: K.muted))]),
      if (t != null) ...[
        const Ecart(10),
        Wrap(spacing: 6, runSpacing: 6, children: [
          mise(null, 'Gratuit', 'sans mise', true),
          for (final (k, nom) in App.niveauxMise)
            if (((t[k] as num?) ?? 0) > 0) mise(k, nom, App.formatPieces(t[k] as num), app.solde >= app.seuilMise(k)),
        ]),
        const SizedBox(height: 4),
        Muet(aide!, taille: 12),
      ],
      const Ecart(12),
      salle(5, principal: true, titre: 'Table rapide', sous: '5 joueurs · 5 min environ'),
      const Ecart(8),
      salle(grande, titre: 'Grande table', sous: '$grande joueurs · partie longue'),
      const Ecart(10),
      const Muet('Autres tailles', taille: 12),
      const SizedBox(height: 4),
      Wrap(spacing: 6, runSpacing: 6, children: [for (final x in App.tailles) if (x != 5 && x < grande) salle(x)]),
      const Ecart(12),
      Btn('Annuler', large: true, onTap: app.fermerFenetre),
    ]);
  }, 'enligne');
}

// ---------------------------------------------------------------- Contre les robots
const aidesNiveauRobots = {'faciles': 'Ils font des erreurs.', 'normaux': 'Ils jouent simplement.', 'forts': 'Ils comptent les cartes déjà sorties, comme un bon joueur. Ils ne voient jamais ta main.'};

void ouvrirRobots() {
  if (app.lirePseudo() == null) return;
  app.ouvrirFenetre((context) {
    final inter = app.jeu == 'inter8';
    final delire = app.styleInter == 'delire';
    final n = app.niveauRobots;
    final guidee = app.lireProfil()['premierePartie'] == null && !inter;
    final max = inter ? App.maxInter - 1 : 8;
    return Fenetre(titre: 'Contre les robots', enfants: [
      if (inter) ...[
        Text('Quel style ?', style: K.texte(15)),
        const SizedBox(height: 6),
        Choix(const [('simple', 'Simple'), ('delire', 'Délire')], app.styleInter, (v) { if (Stock.lire('kopo-inter8-jretour') == null) app.ecrireJRetour(app.jRetourInter); Stock.ecrire('kopo-inter8-style', v); app.maj(); }),
        const SizedBox(height: 4),
        Muet(delire ? '2 paquets (108 cartes). Le J retour fait changer le sens du jeu.' : '1 paquet (54 cartes), les règles de base.', taille: 12),
        if (delire) ...[const SizedBox(height: 6), Choix(const [(false, 'Sans J retour'), (true, 'Avec J retour')], app.jRetourInter, (v) { app.ecrireJRetour(v); app.maj(); })],
        const Ecart(10),
      ],
      Text('Quel niveau ?', style: K.texte(15)),
      const SizedBox(height: 6),
      Choix(const [('faciles', 'Facile'), ('normaux', 'Normal'), ('forts', 'Fort')], n, (v) { Stock.ecrire('kopo-niveau-robots', v); app.maj(); }),
      const SizedBox(height: 4),
      Muet('${aidesNiveauRobots[n]} Ils deviennent un peu plus forts à chaque niveau que tu gagnes (tu es niveau ${app.monNiveau}).', taille: 12),
      const Ecart(12),
      Text('Combien de robots autour de la table ?', style: K.texte(15)),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 6, children: [
        for (var k = 1; k <= max; k++) SizedBox(width: 48, height: 48, child: Btn('$k', marge: EdgeInsets.zero, taille: 18, onTap: () { app.fermerFenetre(); app.partieRobots(k); })),
      ]),
      const Ecart(8),
      Center(child: TextButton(onPressed: composerTable, child: Text('Composer ma table robot par robot', style: K.texte(14, couleur: K.brass).copyWith(decoration: TextDecoration.underline, decorationColor: K.brass)))),
      if (guidee) ...[const Ecart(4), Btn.principal('Première partie guidée (2 robots gentils)', large: true, onTap: app.partieGuidee)],
      const Ecart(8),
      Btn('Annuler', large: true, onTap: app.fermerFenetre),
    ]);
  }, 'robots');
}

String _cleTable(bool inter) => inter ? 'kopo-inter8-table-robots' : 'kopo-table-robots';
List<String> lireTableRobots(bool inter) {
  final max = inter ? App.maxInter - 1 : 8;
  final t = Stock.lire(_cleTable(inter));
  final l = t is List ? t.map((e) => e.toString()).where(App.niveauxRobots.contains).take(max).toList() : <String>[];
  return l.isNotEmpty ? l : [app.niveauRobots, app.niveauRobots, app.niveauRobots];
}

void composerTable() {
  final inter = app.jeu == 'inter8';
  final table = lireTableRobots(inter);
  final max = inter ? App.maxInter - 1 : 8;
  void garder() => Stock.ecrire(_cleTable(inter), table);
  const couleurs = {'faciles': K.good, 'normaux': K.brass, 'forts': K.bad};
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: 'Ma table', enfants: [
        if (inter) Muet('Inter (8) · ${app.styleInter == 'delire' ? 'Délire${app.jRetourInter ? ' avec J retour' : ' sans J retour'}' : 'Simple'}', taille: 12),
        const Muet('Touche un robot pour changer son niveau, + pour en ajouter.'),
        const Ecart(10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (var i = 0; i < table.length; i++)
            GestureDetector(
              onTap: () => setState(() {
                final k = App.niveauxRobots.indexOf(table[i]);
                if (k < 2) { table[i] = App.niveauxRobots[k + 1]; } else if (table.length > 1) { table.removeAt(i); } else { table[i] = 'faciles'; }
                garder();
              }),
              child: Container(
                width: 76, padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(color: (couleurs[table[i]] ?? K.brass).withValues(alpha: .15), borderRadius: BorderRadius.circular(12), border: Border.all(color: couleurs[table[i]] ?? K.brass)),
                child: Column(children: [Ico('robots', taille: 28, couleur: couleurs[table[i]]), const SizedBox(height: 4), Text(App.nomsNiveauxRobots[table[i]]!, style: K.texte(13, couleur: couleurs[table[i]] ?? K.ink, poids: FontWeight.w700))]),
              ),
            ),
          if (table.length < max)
            GestureDetector(
              onTap: () => setState(() { table.add(app.niveauRobots); garder(); }),
              child: Container(width: 76, height: 72, alignment: Alignment.center, decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: K.line)), child: Text('+', style: K.titre(40))),
            ),
        ]),
        const Ecart(8),
        const Muet('Facile → Normal → Fort → retiré. Ta table est gardée pour la prochaine fois.', taille: 12),
        const Ecart(12),
        Btn.principal('Jouer · ${table.length} robot${table.length > 1 ? 's' : ''}', large: true, onTap: () { garder(); app.fermerFenetre(); app.partieComposee(table); }),
        const Ecart(8),
        Btn('Retour', large: true, onTap: ouvrirRobots),
      ])));
}

// ---------------------------------------------------------------- Règles du Kopo
void montrerRegles() {
  Widget titre(String t) => Padding(padding: const EdgeInsets.only(top: 12, bottom: 4), child: Text(t.toUpperCase(), style: K.texte(13, couleur: K.brass, poids: FontWeight.w700).copyWith(letterSpacing: 1.5)));
  Widget li(String puce, List<Object> m) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 22, child: Text(puce, style: K.texte(14, couleur: K.brass, poids: FontWeight.w700))),
          Expanded(child: Text.rich(TextSpan(style: K.texte(14), children: [for (final x in m) x is List ? TextSpan(text: x[0] as String, style: const TextStyle(fontWeight: FontWeight.w700, color: K.brass)) : TextSpan(text: x as String)]))),
        ]),
      );
  app.ouvrirFenetre((context) => Fenetre(titre: 'Règles', enfants: [
        titre('Le but'),
        li('•', ['Chacun reçoit 4 cartes. Débarrasse-toi de toutes tes cartes : tu es ', ['qualifié'], '.']),
        li('•', ['Le dernier joueur qui garde des cartes est ', ['éliminé'], ". On rejoue une manche sans lui, jusqu'à la finale à deux. Le gagnant de la finale gagne la partie."]),
        titre('Un tour de table'),
        li('1.', ['Un joueur ', ['ouvre'], ' : il pose la carte de son choix. Sa couleur devient la ', ['couleur du tour'], '.']),
        li('2.', ['Les autres, chacun à son tour, ', ['suivent'], ' : ils jouent une carte de cette couleur.']),
        li('3.', ["Tu n'as pas la couleur ? Tu dois ", ['ramasser'], " la plus forte carte de la table. Elle va dans ta main et le tour s'arrête net. Tu peux aussi ramasser exprès en ayant la couleur, pour bluffer."]),
        titre('Après le tour'),
        li('•', ['Les cartes jouées ', ['quittent la partie'], " : c'est comme ça qu'on se débarrasse de ses cartes."]),
        li('•', ['Celui qui a posé la plus forte carte ', ['relance'], ' (même si elle a été ramassée) : il ouvre le tour suivant, mais ', ['dans une autre couleur'], '.']),
        titre('Sortir plus vite'),
        li('•', ['Il ne te reste que des cartes de la couleur du tour (ou une seule couleur quand tu ouvres) ? Touche ', ['Tout poser'], " : tu les poses toutes d'un coup et tu es qualifié."]),
        li('•', ['Les cartes avec lesquelles on sort ne comptent pas : personne ne peut les ramasser.']),
        li('•', [['Katapss'], ' : tu reçois 4 cartes de la même couleur, ou ta plus forte carte est un 4 ? Annonce-le avant de jouer ou de ramasser : qualifié tout de suite. En duel et en finale, seules les 4 cartes de la même couleur comptent : une main dont la plus forte carte est un 4 est montrée à tous et on redistribue.']),
        const Ecart(6),
        const Muet("36 cartes, du 2 au 10 dans les 4 couleurs. Le 10 est la plus forte. On tourne dans le sens des aiguilles d'une montre.", taille: 12),
        const Ecart(14),
        Btn.principal("C'est compris", large: true, onTap: app.fermerFenetre),
        const Ecart(8),
        Btn('Apprendre en jouant (1 min)', large: true, onTap: ouvrirTutoriel),
        const Ecart(8),
        Btn('Match du jour et Bande', large: true, onTap: () => fenetreNouveaute(0)),
      ]), 'regles');
}

// ---------------------------------------------------------------- Partager
const reseaux = {
  'whatsapp': ('WhatsApp', Color(0xFF1F7A4D), 'W'), 'telegram': ('Telegram', Color(0xFF1F86C4), 'T'), 'facebook': ('Facebook', Color(0xFF1B5FD1), 'f'),
  'instagram': ('Instagram', Color(0xFFB8336A), 'I'), 'tiktok': ('TikTok', Color(0xFF202024), '♪'), 'youtube': ('YouTube', Color(0xFFC4302B), '▶'),
  'x': ('X', Color(0xFF202024), 'X'), 'discord': ('Discord', Color(0xFF5865F2), 'D'), 'autre': ('Lien', Color(0xFF5A4A2A), '↗'),
};

Future<void> partagerJeu() async {
  var url = lienJeu.replaceAll(RegExp(r'#.*$'), '');
  if (app.enLigne) { try { final P = await Api.get('/parrainage'); if (P['code'] != null) url = lienParrain(P['code'].toString()); } catch (_) {} }
  try {
    await SharePlus.instance.share(ShareParams(title: 'Masano', text: 'Viens jouer ${jeuPartage(app.jeu).au} avec moi sur Masano ! $url'));
  } catch (_) {
    await copier(url, 'Lien du jeu copié.');
  }
}

Future<void> partagerAccueil() async {
  await app.lireConfig();
  final c = app.config?['communautes'];
  final groupes = (c is List ? c : const []).whereType<Map>().where((g) => RegExp(r'^https://').hasMatch((g['url'] ?? '').toString())).toList();
  if (groupes.isEmpty) { partagerJeu(); return; }
  app.ouvrirFenetre((context) => Fenetre(titre: 'Partager', enfants: [
        Btn.principal('Inviter un ami à jouer', icone: 'partager', large: true, onTap: () { app.fermerFenetre(); partagerJeu(); }),
        const Ecart(14),
        Text('Rejoins nos groupes', style: K.texte(14, couleur: K.muted, poids: FontWeight.w600)),
        const Ecart(6),
        for (final g in groupes)
          Builder(builder: (_) {
            final r = reseaux[g['reseau']] ?? reseaux['autre']!;
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Btn(null, large: true, onTap: () => ouvrirLien(g['url'].toString()), enfant: Row(children: [
                Container(width: 34, height: 34, alignment: Alignment.center, decoration: BoxDecoration(color: r.$2, shape: BoxShape.circle), child: Text(r.$3, style: K.texte(16, couleur: Colors.white, poids: FontWeight.w700))),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${g['libelle'] ?? r.$1}', style: K.texte(15, poids: FontWeight.w600)),
                  Muet('Rejoindre sur ${r.$1}', taille: 12),
                ])),
              ])),
            );
          }),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ]), 'partager');
}

// ---------------------------------------------------------------- pièces : bonus du jour, bourse
void fenetrePieces(Map? b) {
  final info = (Stock.lire('kopo-bonus-serveur') as Map?) ?? {};
  final serie = ((b != null ? b['serie'] : info['serie']) as num? ?? 0).toInt();
  final jokerLibre = b != null ? b['jokerLibre'] != false : info['jokerLibre'] != false;
  final s7 = serie.clamp(0, 7);
  Widget barres() => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 1; i <= 7; i++)
          Container(width: 26, height: 8, margin: const EdgeInsets.symmetric(horizontal: 2), decoration: BoxDecoration(color: i <= s7 ? (b?['joker'] == true && i == s7 - 1 ? const Color(0xFF7FD3E6) : K.brass) : K.line, borderRadius: BorderRadius.circular(4))),
      ]);
  app.ouvrirFenetre((context) {
    final contenu = <Widget>[];
    if (b != null) {
      if (b['joker'] == true) {
        contenu.addAll([
          Center(child: TweenAnimationBuilder<double>(tween: Tween(begin: app.sansAnim ? 1 : .4, end: 1), duration: const Duration(milliseconds: 800), curve: Curves.easeOutBack, builder: (_, s, c) => Transform.scale(scale: s, child: c), child: Container(width: 60, height: 84, alignment: Alignment.center, decoration: BoxDecoration(color: K.card, borderRadius: BorderRadius.circular(8)), child: const Ico('joker', taille: 40, couleur: K.red)))),
          const Ecart(8),
          Text('Joker de série', textAlign: TextAlign.center, style: K.titre(34)),
          Text("Hier, tu n'es pas venu : ta série continue quand même.", textAlign: TextAlign.center, style: K.texte(15)),
        ]);
      } else {
        contenu.add(Text('Bonus du jour', textAlign: TextAlign.center, style: K.titre(36)));
      }
      contenu.addAll([
        const Ecart(10),
        const Center(child: Piece(taille: 56)),
        const Ecart(6),
        Text('+${b['gain']}', textAlign: TextAlign.center, style: K.titre(48)),
        Text("Jour $serie d'affilée · reviens demain pour +${b['prochain']}", textAlign: TextAlign.center, style: K.texte(14)),
        const Ecart(8),
        barres(),
      ]);
    } else {
      final sansCompte = !app.enLigne;
      final ligne = sansCompte
          ? "Choisis ton pseudo et joue : ta bourse s'ouvre avec un cadeau de bienvenue."
          : '${info['jour'] != DateTime.now().toUtc().toIso8601String().substring(0, 10) ? 'Série de ' : 'Bonus du jour déjà pris · série de '}$serie jour${serie > 1 ? 's' : ''}';
      contenu.addAll([
        Text('Tes pièces', textAlign: TextAlign.center, style: K.titre(36)),
        const Ecart(10),
        const Center(child: Piece(taille: 56)),
        const Ecart(6),
        Text(App.formatPieces(app.solde), textAlign: TextAlign.center, style: K.titre(48)),
        Text(ligne, textAlign: TextAlign.center, style: K.texte(14)),
        const Ecart(8),
        barres(),
      ]);
    }
    return Fenetre(enfants: [
      ...contenu,
      const Ecart(12),
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Opacity(opacity: jokerLibre ? 1 : .4, child: const Ico('joker', taille: 26)),
          const SizedBox(width: 8),
          Expanded(child: Text(jokerLibre ? 'Joker de série libre : un jour raté cette semaine ne casse pas ta série.' : 'Joker de série déjà utilisé cette semaine.', style: K.texte(13, couleur: jokerLibre ? K.ink : K.muted))),
        ]),
      ),
      const Ecart(12),
      Btn.principal(b != null ? 'Récupérer' : 'OK', large: true, onTap: () { app.fermerFenetre(); if (b != null) app.suiteAccueil(); }),
      if (b == null) ...[const Ecart(8), Btn('Boutique', large: true, onTap: ouvrirBoutique)],
    ]);
  }, 'pieces');
}

/// Cadeau de fondateur : le dos « Les Fondateurs », une fois par appareil.
Future<void> cadeauFondateur() async {
  final p = app.lireProfil();
  if (p['fondateur'] != null) return;
  final pc = p['pieces'];
  final avaitEssai = pc is Map && ((pc['solde'] as num?) ?? 0) > 0;
  try {
    final r = await Api.post('/cadeau-fondateur') as Map;
    final q = app.lireProfil();
    q['fondateur'] = app.jourLocal();
    if (r['ok'] != true) { app.ecrireProfil(q); return; }
    R.objets.putIfAbsent('dos-fondateurs', () => {'type': 'dos', 'nom': 'Les Fondateurs', 'd': 'Cadeau de fondateur'});
    R.donnerObjet(q, 'dos-fondateurs');
    app.ecrireProfil(q);
    final fin = Completer<void>();
    app.ouvrirFenetre((context) => Fenetre(enfants: [
          Text('Merci, fondateur !', textAlign: TextAlign.center, style: K.titre(36)),
          const Ecart(10),
          Center(child: apercuObjet('dos-fondateurs', taille: 70)),
          const Ecart(10),
          Text('${avaitEssai ? "Masano passe aux vraies pièces : tes pièces d'essai s'arrêtent ici. Pour te remercier d'avoir été là dès le début, voici" : 'Masano passe aux vraies pièces. Pour fêter ça avec ceux qui sont là dès le début, voici'} le dos de cartes « Les Fondateurs ». Il ne sera plus distribué après le lancement.', textAlign: TextAlign.center, style: K.texte(15)),
          const Ecart(12),
          Btn.principal('Merci !', large: true, onTap: () { app.fermerFenetre(); if (!fin.isCompleted) fin.complete(); }),
        ]));
    await fin.future;
  } catch (_) {}
}

void fenetreRemiseAFlot(int solde) {
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Text('Remise à flot', textAlign: TextAlign.center, style: K.titre(36)),
        const Ecart(8),
        const Center(child: Piece(taille: 56)),
        const Ecart(8),
        Text("Tu étais presque à sec : ton solde remonte à ${App.formatPieces(solde)} pièces. C'est possible une fois par jour.", textAlign: TextAlign.center, style: K.texte(15)),
        const Ecart(12),
        Btn.principal('Merci !', large: true, onTap: app.fermerFenetre),
      ]));
}

/// « Jouer en ligne » sans Google : on explique, et on propose les robots.
void fenetreJouerEnLigne() {
  fenetreGoogle('Jouer en ligne', "Pour jouer en ligne ou entre amis, connecte-toi avec Google : c'est gratuit, et tes pièces et ton niveau te suivent sur tous tes téléphones. Sans compte, tu peux jouer contre les robots.",
      extra: (_) => [Btn('Jouer contre les robots', large: true, onTap: () { app.fermerFenetre(); ouvrirRobots(); })]);
}
