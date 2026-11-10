// Accueil (hub) : logo, bourse, amis, profil ; choix du jeu ; cartes des modes ; barre du bas.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../commun/apparences.dart';
import '../commun/retention.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/accueil_fenetres.dart';
import '../fenetres/communes.dart';
import '../fenetres/compet.dart';
import '../fenetres/parametres.dart';
import '../fenetres/progres.dart';
import '../fenetres/social.dart';

class Accueil extends StatelessWidget {
  const Accueil({super.key});

  @override
  Widget build(BuildContext context) {
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;
    final inter = app.jeu == 'inter8';
    final modes = _modes(context, inter);
    return SafeArea(
      child: Container(
        decoration: const BoxDecoration(gradient: RadialGradient(center: Alignment(0, .1), radius: .8, colors: [Color(0x1FE2B04A), Color(0x00E2B04A)])),
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
        child: Column(children: [
          const _Haut(),
          const SizedBox(height: 10),
          if (app.jeuxVisibles.length > 1) const _ChoixJeu(),
          const SizedBox(height: 10),
          Expanded(
            child: paysage
                ? Center(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                        for (final m in modes) Padding(padding: const EdgeInsets.symmetric(horizontal: 7), child: SizedBox(height: math.min(m.creer ? 188 : 168, MediaQuery.of(context).size.height * (m.creer ? .5 : .44)), child: AspectRatio(aspectRatio: 5 / 7, child: m))),
                      ]),
                    ),
                  )
                : Center(
                    child: SingleChildScrollView(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 360),
                        child: LayoutBuilder(builder: (context, c) {
                          final w = (c.maxWidth - 10) / 2;
                          return Wrap(spacing: 10, runSpacing: 10, children: [
                            for (final m in modes) SizedBox(width: m.creer ? c.maxWidth : w, height: m.creer ? 112 : w * 3.6 / 4, child: m),
                          ]);
                        }),
                      ),
                    ),
                  ),
          ),
          const _BarreBas(),
        ]),
      ),
    );
  }

  List<CarteMode> _modes(BuildContext context, bool inter) {
    final enMaint = app.etatJeu(app.jeu) == 'maintenance';
    VoidCallback garde(VoidCallback f, {bool ouvertInter = false}) => () {
          if (enMaint) { app.toast('${inter ? 'Inter (8)' : 'Kopo'} est en maintenance. On revient très vite !'); return; }
          if (inter && !ouvertInter) { app.toast('Ce mode arrive très bientôt pour Inter (8). En attendant : entre amis, en ligne ou contre les robots !'); return; }
          f();
        };
    final ej = app.etatJour;
    final mj = ej?['moi'] is Map && ej!['moi']['fini'] == true ? ej['moi'] as Map : null;
    String? resumeJour;
    if (ej != null) resumeJour = ej['actif'] != true ? 'En pause' : mj != null ? '${mj['score']} / 100 · ${ej['rang']}e sur ${ej['joueurs']}' : 'Un seul essai · encore ${dureeLisible((ej['resteMs'] as num).toInt())}';
    final eb = app.etatBandes;
    String? resumeBande;
    if (eb != null) {
      final l = (eb['bandes'] as List?) ?? [];
      final x = l.cast<Map>().where((y) => y['inscrit'] == true).firstOrNull ?? (l.isEmpty ? null : l.first as Map);
      resumeBande = x == null ? 'Défie tes amis' : x['inscrit'] == true ? "${x['jeSuisChef'] == true ? '👑 ' : ''}${x['nom']} · ${x['rang']}e" : x['nom'].toString();
    }
    final creerSous = inter ? 'Entre amis, de 2 à 8 · simple ou délire' : 'Entre amis, de 2 à 9';
    return [
      CarteMode('creer', 'Créer une partie', creerSous, coin: '♠', creer: true, amis: app.amisEnLigne, onTap: garde(() => creer(), ouvertInter: true)),
      CarteMode('jour', 'Match du jour', resumeJour ?? 'La même partie pour tous', coin: '♦', point: app.pointJour, onTap: garde(ouvrirMatchJour)),
      CarteMode('bande', 'La Bande', resumeBande ?? 'Défie tes amis', coin: '♥', onTap: garde(() => ouvrirBande())),
      CarteMode('enligne', 'En ligne', 'Avec des inconnus', coin: '♦', enLigne: app.nbEnLigne, onTap: garde(ouvrirEnLigne, ouvertInter: true)),
      CarteMode('rejoindre', 'Rejoindre', 'Avec un code', coin: '♥', onTap: garde(ouvrirRejoindre, ouvertInter: true)),
      CarteMode('robots', 'Contre les robots', inter ? 'Pour apprendre Inter (8)' : 'Partie rapide · niveau ${(App.nomsNiveauxRobots[app.niveauRobots] ?? 'Normal').toLowerCase()}', coin: '♣', onTap: garde(ouvrirRobots, ouvertInter: true)),
      CarteMode('couronne', 'Ligue', app.ligueResume ?? 'Saison classée', coin: '♠', point: app.pointLigue, onTap: garde(ouvrirLigue)),
    ];
  }
}

String dureeLisible(int ms) {
  final h = ms ~/ 3600000, m = (ms % 3600000) ~/ 60000;
  return h > 0 ? '$h h ${m.toString().padLeft(2, '0')}' : '${math.max(1, m)} min';
}

class CarteMode extends StatelessWidget {
  final String icone, titre, sous, coin;
  final bool creer, point;
  final int amis;
  final int? enLigne;
  final VoidCallback onTap;
  const CarteMode(this.icone, this.titre, this.sous, {super.key, required this.coin, this.creer = false, this.point = false, this.amis = 0, this.enLigne, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final encre = creer ? K.encre : K.brass;
    final coinCouleur = creer ? const Color(0x8C1D1606) : const Color(0xB3E2B04A);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            gradient: creer
                ? const RadialGradient(center: Alignment(0, -.5), radius: 1, colors: [Color(0xFFF1CD7C), K.brass], stops: [0, .7])
                : const RadialGradient(center: Alignment(0, -.4), radius: 1, colors: [K.table2, K.table], stops: [0, .8]),
            border: Border.all(color: creer ? const Color(0xFFF3D48A) : const Color(0x99E2B04A), width: 1.5),
            boxShadow: const [BoxShadow(color: Color(0x73000000), blurRadius: 18, offset: Offset(0, 8))],
          ),
          child: Container(
            margin: const EdgeInsets.all(4),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: creer ? const Color(0x401D1606) : const Color(0x38E2B04A))),
            child: Stack(children: [
              Positioned(top: 5, left: 6, child: Text(coin, style: TextStyle(fontSize: 13, color: coinCouleur))),
              Positioned(bottom: 5, right: 6, child: Transform.rotate(angle: math.pi, child: Text(coin, style: TextStyle(fontSize: 13, color: coinCouleur)))),
              Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Stack(clipBehavior: Clip.none, children: [
                      Ico(icone, taille: creer ? 40 : 38, couleur: creer ? K.encre : null),
                      if (point) Positioned(top: -2, right: -6, child: Container(width: 9, height: 9, decoration: BoxDecoration(color: K.red, shape: BoxShape.circle, border: Border.all(color: K.table, width: 2)))),
                    ]),
                    const SizedBox(height: 6),
                    FittedBox(fit: BoxFit.scaleDown, child: Text(titre, style: TextStyle(fontFamily: K.display, fontSize: creer ? 24 : 19, letterSpacing: 1.2, height: 1, color: encre))),
                    const SizedBox(height: 4),
                    Text(sous, textAlign: TextAlign.center, maxLines: 3, overflow: TextOverflow.ellipsis, style: K.texte(11, couleur: creer ? const Color(0xFF4A3A12) : K.muted).copyWith(height: 1.2)),
                    if (creer && amis > 0) _pointEnLigne('$amis ami${amis > 1 ? 's' : ''} en ligne', const Color(0xFF4A3A12)),
                    if (enLigne != null) _pointEnLigne('$enLigne joueur${enLigne! > 1 ? 's' : ''} en ligne', K.muted),
                  ]),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _pointEnLigne(String t, Color c) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 7, height: 7, decoration: const BoxDecoration(color: K.good, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Flexible(child: Text(t, style: K.texte(11, couleur: c))),
        ]),
      );
}

class _Haut extends StatelessWidget {
  const _Haut();
  @override
  Widget build(BuildContext context) {
    final etroit = MediaQuery.of(context).size.width < 420;
    final p = app.lireProfil();
    final n = R.niveauDe(p['xp'] as num? ?? 0);
    final pseudo = app.pseudo;
    return Row(children: [
      Row(children: [
        ClipRRect(borderRadius: BorderRadius.circular(8), child: SvgPicture.asset('assets/img/masano-logo.svg', width: etroit ? 30 : 36, height: etroit ? 30 : 36)),
        const SizedBox(width: 7),
        Text('MASANO', style: K.titre(etroit ? 28 : 36).copyWith(letterSpacing: 3)),
      ]),
      const Spacer(),
      // Bourse
      GestureDetector(
        onTap: () => fenetrePieces(null),
        child: Container(
          padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
          decoration: BoxDecoration(color: const Color(0x4D000000), borderRadius: BorderRadius.circular(99), border: Border.all(color: const Color(0x73E2B04A))),
          child: Row(children: [
            const Piece(),
            const SizedBox(width: 7),
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(App.formatPieces(app.solde), style: K.titre(21).copyWith(height: 1)),
              if (!etroit) Text('pièces', style: K.texte(10, couleur: K.muted)),
            ]),
          ]),
        ),
      ),
      const SizedBox(width: 6),
      // Amis
      GestureDetector(
        onTap: boutonAmis,
        child: Stack(clipBehavior: Clip.none, children: [
          Container(
            width: 40, height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: const Color(0x4D000000), shape: BoxShape.circle, border: Border.all(color: K.line)),
            child: const Ico('amis', taille: 24),
          ),
          if (app.demandesAmi > 0)
            Positioned(top: -5, right: -5, child: Container(
              constraints: const BoxConstraints(minWidth: 18), height: 18, padding: const EdgeInsets.symmetric(horizontal: 5),
              decoration: BoxDecoration(color: K.bad, borderRadius: BorderRadius.circular(9)),
              alignment: Alignment.center,
              child: Text(app.demandesAmi > 9 ? '9+' : '${app.demandesAmi}', style: K.texte(11, couleur: Colors.white, poids: FontWeight.w700).copyWith(height: 1)),
            )),
        ]),
      ),
      const SizedBox(width: 6),
      // Profil
      Flexible(
        child: GestureDetector(
          onTap: ouvrirProfil,
          child: Container(
            padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
            decoration: BoxDecoration(color: const Color(0x4D000000), borderRadius: BorderRadius.circular(99), border: Border.all(color: K.line)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Avatar(pseudo.isEmpty ? '?' : pseudo, avatar: app.avatarEquipe, cadre: app.cadreEquipe, taille: 36, niveau: (p['xp'] ?? 0) == 0 ? null : n.niveau),
              const SizedBox(width: 8),
              Flexible(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  if (!etroit) Text('Ton pseudo', style: K.texte(11, couleur: K.muted)),
                  ConstrainedBox(constraints: BoxConstraints(maxWidth: etroit ? 96 : 130), child: Text(pseudo.isEmpty ? '—' : pseudo, overflow: TextOverflow.ellipsis, style: K.texte(16, poids: FontWeight.w700))),
                  if ((p['xp'] ?? 0) != 0) SizedBox(width: etroit ? 80 : 110, child: Padding(padding: const EdgeInsets.only(top: 3), child: Barre(n.dansNiveau / n.pourSuivant, hauteur: 4))),
                ]),
              ),
            ]),
          ),
        ),
      ),
    ]);
  }
}

class _ChoixJeu extends StatelessWidget {
  const _ChoixJeu();
  @override
  Widget build(BuildContext context) {
    final jeu = app.jeu;
    Widget bouton(String id, String lettre, String nom) {
      final actif = jeu == id;
      final e = app.etatJeu(id);
      return Expanded(
        child: GestureDetector(
          onTap: () => app.jeu = id,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              gradient: actif ? const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFF3D48A), K.brass]) : null,
              boxShadow: actif ? const [BoxShadow(color: Color(0x59000000), blurRadius: 10, offset: Offset(0, 3))] : null,
            ),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Container(
                width: 22, height: 30, alignment: Alignment.center,
                decoration: BoxDecoration(color: actif ? K.encre : null, borderRadius: BorderRadius.circular(4), border: Border.all(color: actif ? K.encre : K.muted, width: 2)),
                child: Text(lettre, style: TextStyle(fontFamily: K.display, fontSize: 16, color: actif ? const Color(0xFFF3D48A) : K.muted)),
              ),
              const SizedBox(width: 8),
              Flexible(child: Text(nom, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: K.display, fontSize: 20, letterSpacing: 1.5, color: actif ? K.encre : K.muted))),
              if (e == 'test' || e == 'maintenance') ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(color: e == 'maintenance' ? K.bad : K.brass, borderRadius: BorderRadius.circular(6)),
                  child: Text(e.toUpperCase(), style: K.texte(10, couleur: e == 'maintenance' ? Colors.white : K.encre, poids: FontWeight.w700)),
                ),
              ],
            ]),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: const Color(0x47000000), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0x59E2B04A))),
      child: Row(children: [
        if (app.jeuxVisibles.contains('kopo')) bouton('kopo', 'K', 'KOPO'),
        const SizedBox(width: 4),
        if (app.jeuxVisibles.contains('inter8')) bouton('inter8', '8', 'INTER (8)'),
      ]),
    );
  }
}

class _BarreBas extends StatelessWidget {
  const _BarreBas();
  @override
  Widget build(BuildContext context) {
    Widget onglet(String ico, String t, VoidCallback f, {bool point = false, int demandes = 0}) => InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: f,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Stack(clipBehavior: Clip.none, children: [
                Ico(ico, taille: 24),
                if (point) Positioned(top: -2, right: -5, child: Container(width: 9, height: 9, decoration: BoxDecoration(color: K.red, shape: BoxShape.circle, border: Border.all(color: K.table, width: 2)))),
                if (demandes > 0) Positioned(top: -6, right: -8, child: Container(padding: const EdgeInsets.symmetric(horizontal: 5), height: 16, decoration: BoxDecoration(color: K.bad, borderRadius: BorderRadius.circular(8)), child: Text('$demandes', style: K.texte(10, couleur: Colors.white, poids: FontWeight.w700)))),
              ]),
              const SizedBox(height: 2),
              Text(t, style: K.texte(12, couleur: K.muted, poids: FontWeight.w600)),
            ]),
          ),
        );
    final inter = app.jeu == 'inter8';
    return Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      onglet('missions', 'Missions', ouvrirMissions, point: app.pointMissions),
      onglet('partager', 'Partager', partagerAccueil),
      onglet('regles', inter ? 'Règles Inter' : 'Règles', () {
        if (inter) { app.toast('Ce mode arrive très bientôt pour Inter (8). En attendant : entre amis, en ligne ou contre les robots !'); return; }
        montrerRegles();
      }),
      onglet('reglages', 'Paramètres', ouvrirParametres, demandes: app.demandesAmi),
    ]);
  }
}

/// Bouton Amis de l'accueil : avec Google, la fenêtre Amis ; sinon on explique pourquoi se connecter.
void boutonAmis() {
  final cfg = app.config;
  if (app.avecGoogle || (app.enLigne && cfg?['google'] == null)) { ouvrirAmis(); return; }
  fenetreGoogle('Amis', 'Connecte-toi pour ajouter tes amis, voir qui est en ligne et les inviter à ta table. Ta progression et tes pièces sont gardées.',
      extra: (_) => [Btn('Inviter sur WhatsApp', large: true, onTap: () => ouvrirWhatsApp('Viens jouer avec moi sur Masano (Kopo et Inter (8)) !\n$lienJeu'))]);
}

void creer() {
  final p = app.lirePseudo(); if (p == null) return;
  if (app.exigerGoogle()) return;
  if (app.jeu == 'inter8') { choisirStyleInter(p); } else { app.creerPartie(p, 'kopo'); }
}

// Gardé pour l'écran : la Bande vue depuis un lien (?bande=) une fois l'accueil prêt.
bool lienBandeVu = false;
void proposerLienBande() {
  final l = Stock.lire('kopo-bande-lien');
  if (l is! Map || lienBandeVu || app.fenetre != null || app.ecran != 'accueil') return;
  ouvrirLienBande(l);
}
