// Salon d'avant-partie : code, QR, réglages de l'hôte (chrono, style Inter), joueurs, robots, prêt, lancer.
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/communes.dart';
import '../fenetres/parametres.dart';
import 'partie.dart' show BoutonTete;
import '../fenetres/partie_fenetres.dart';
import '../fenetres/social.dart';
import '../fenetres/vocal_ui.dart';

class Salon extends StatelessWidget {
  const Salon({super.key});

  @override
  Widget build(BuildContext context) {
    final v = app.vue!;
    final inter = v['jeu'] == 'inter8';
    final publique = v['publique'] == true;
    final hote = v['hote'] == v['moi'];
    final joueurs = (v['joueurs'] as List).cast<Map>();
    final maxJoueurs = inter ? App.maxInter : App.maxKopo;
    final invites = joueurs.where((j) => j['id'] != v['hote'] && j['robot'] != true).toList();
    final prets = invites.where((j) => j['pret'] == true).length;
    final moi = joueurs.firstWhere((j) => j['id'] == v['moi'], orElse: () => {});
    final code = v['code'].toString();
    final lien = lienPartie(code, v['jeu'] as String?);
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;
    final bas = MediaQuery.of(context).size.height <= 330;
    final maxJ = publique ? v['taille'] : maxJoueurs;

    // Colonne de gauche (comme sur le site) : code, QR, invitations.
    final codeTexte = Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text((publique ? 'Code pour tes amis' : 'Code de la partie').toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(paysage ? 11 : 12, couleur: K.muted).copyWith(letterSpacing: paysage ? .5 : 1)),
      const SizedBox(height: 2),
      Text(code, style: TextStyle(fontFamily: K.display, fontSize: paysage ? (bas ? 28 : 36) : 44, letterSpacing: 8, height: 1, color: K.ink)),
    ]);
    final qr = Container(
      padding: EdgeInsets.all(bas ? 3 : 5),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
      child: QrImageView(data: lien, size: bas ? 58 : 82, padding: EdgeInsets.zero, backgroundColor: Colors.white),
    );
    final colCode = Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (publique) Text('Salle de ${v['taille']}', style: K.titre(34).copyWith(letterSpacing: 2)),
      if (publique) ...[
        const SizedBox(height: 6),
        Text.rich(TextSpan(style: K.texte(14, couleur: K.muted), children: [
          const TextSpan(text: 'En attente de joueurs : '),
          TextSpan(text: '${joueurs.length}/${v['taille']}', style: const TextStyle(fontWeight: FontWeight.w700, color: K.brass)),
          TextSpan(text: '. La partie démarre dès que la salle est pleine. ${app.nbEnLigne} en ligne.'),
        ])),
        const SizedBox(height: 10),
      ],
      Row(children: [
        Expanded(child: codeTexte),
        const SizedBox(width: 12),
        if (paysage) qr else _BoutonQr(lien),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _BoutonWhatsApp(paysage ? 'WhatsApp' : 'Inviter sur WhatsApp', () => ouvrirWhatsApp(texteTable(v['jeu'] as String?, code, lien)))),
        const SizedBox(width: 8),
        if (paysage) Expanded(child: Btn('Copier', large: true, marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 11), onTap: () => copier(lien, 'Lien copié.')))
        else Btn('Copier', marge: const EdgeInsets.symmetric(horizontal: 14, vertical: 11), onTap: () => copier(lien, 'Lien copié.')),
        if (app.enLigne && !publique) ...[const SizedBox(width: 8), Btn('Amis', marge: EdgeInsets.symmetric(horizontal: paysage ? 12 : 14, vertical: paysage ? 8 : 11), onTap: () => inviterDepuisSalon(code))],
      ]),
    ]);

    // Colonne de droite : réglages, joueurs, puis en bas Chat, Prêt / + Robot, Lancer.
    final haut = Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (!publique) ..._reglages(v, inter, hote),
      Text('Joueurs (${joueurs.length}/$maxJ)${invites.isNotEmpty && !publique ? ' · $prets/${invites.length} prêt${prets > 1 ? 's' : ''}' : ''}', style: K.texte(14, poids: FontWeight.w700)),
      const SizedBox(height: 10),
      _Grille([for (final j in joueurs) _LigneJoueur(v, j, hote && !publique, paysage: paysage)], colonnes: paysage ? 3 : 2),
      if (!hote && !publique) ...[
        const SizedBox(height: 10),
        Text(moi['pret'] == true ? "Tu es prêt. La partie part dès que l'hôte lance." : "L'hôte peut lancer à tout moment.", textAlign: TextAlign.center, style: K.texte(13, couleur: moi['pret'] == true ? K.good : K.muted)),
      ],
    ]);
    final margeBas = EdgeInsets.symmetric(horizontal: 10, vertical: bas ? 8 : paysage ? 11 : 13);
    final basSalon = Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const _BoutonChat(),
      if (!hote && !publique) ...[
        const SizedBox(width: 8),
        Expanded(
          child: moi['pret'] == true
              ? _BoutonPret(margeBas)
              : Btn.principal('Je suis prêt', large: true, marge: margeBas, onTap: () => app.envoyer({'type': 'pret', 'pret': true})),
        ),
      ],
      if (hote && joueurs.length < maxJoueurs && !publique) ...[
        const SizedBox(width: 8),
        Btn('+ Robot', icone: 'robots', marge: EdgeInsets.symmetric(horizontal: 14, vertical: margeBas.top), onTap: () {
          final n = Stock.lire('kopo-niveau-dernier-robot');
          envoyerRobot(App.niveauxRobots.contains(n) ? n as String : app.niveauRobots);
        }),
      ],
      if (hote && !publique) ...[
        const SizedBox(width: 8),
        Expanded(child: Btn.principal(joueurs.length < 2 ? "En attente d'au moins 2 joueurs" : 'Lancer · ${joueurs.length} joueurs', large: true, marge: margeBas, onTap: joueurs.length < 2 ? null : () => app.envoyer({'type': 'lancer'}))),
      ],
    ]);

    final panneau = Container(
      padding: EdgeInsets.symmetric(horizontal: paysage ? 12 : 12, vertical: bas ? 6 : paysage ? 10 : 12),
      decoration: BoxDecoration(color: const Color(0x38000000), borderRadius: BorderRadius.circular(16), border: Border.all(color: K.line)),
      child: paysage
          ? Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(flex: 80, child: SingleChildScrollView(child: colCode)),
              const SizedBox(width: 16),
              Expanded(
                flex: 145,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Expanded(child: SingleChildScrollView(child: haut)),
                  const SizedBox(height: 10),
                  IntrinsicHeight(child: basSalon),
                ]),
              ),
            ])
          : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [colCode, const SizedBox(height: 10), haut]))),
              const SizedBox(height: 10),
              IntrinsicHeight(child: basSalon),
            ]),
    );

    return SafeArea(
      child: Stack(children: [
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: paysage ? 900 : 720),
            child: Padding(
              padding: EdgeInsets.fromLTRB(paysage ? 12 : 12, bas ? 4 : 6, paysage ? 12 : 12, bas ? 4 : paysage ? 8 : 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                _EnTete(publique ? 'Salle publique · $code' : 'Salon · $code', v, paysage: paysage),
                SizedBox(height: paysage ? 6 : 10),
                Expanded(child: panneau),
              ]),
            ),
          ),
        ),
        // Qui parle (abonnés Kopo+ en vocal), sous l'en-tête.
        Positioned(top: 50, left: 0, right: 0, child: IgnorePointer(child: BandeauParleurs(v))),
      ]),
    );
  }

  /// Réglages de l'hôte, une ligne chacun (« .reglage » du site) : le titre, puis des boutons qui se partagent la largeur.
  List<Widget> _reglages(Vue v, bool inter, bool hote) {
    Widget ligne<T>(String titre, List<(T, String)> options, T actuel, ValueChanged<T> choisir, String lu) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(children: [
            Padding(padding: const EdgeInsets.only(right: 8), child: Text(titre, style: K.texte(13, couleur: K.muted))),
            if (hote)
              for (final (i, (val, lib)) in options.indexed) ...[
                if (i > 0) const SizedBox(width: 4),
                Expanded(
                  child: Btn(lib, style: val == actuel ? StyleBtn.principal : StyleBtn.normal, taille: 13, marge: const EdgeInsets.symmetric(vertical: 7), large: true, onTap: () => choisir(val)),
                ),
              ]
            else
              Expanded(child: Text(lu, style: K.texte(13, poids: FontWeight.w700))),
          ]),
        );
    final delais = inter ? App.delaisInter : App.delaisKopo;
    final delai = (v['delai'] as num?)?.toInt() ?? 0;
    final formule = v['formule'] == 'cahier' ? '${v['totalCahier'] ?? 500}' : 'normale';
    return [
      ligne('Chrono', [for (final d in delais) (d, d == 0 ? 'sans' : '$d s')], delai, (d) => app.envoyer({'type': 'reglages', 'delai': d}), delai == 0 ? 'sans chrono' : '$delai secondes par joueur'),
      if (inter)
        ligne('Style', const [('simple', 'Simple · 1 paquet'), ('delire', 'Délire · 2 paquets')], v['mode'] == 'delire' ? 'delire' : 'simple', (m) {
          Stock.ecrire('kopo-inter8-style', m);
          app.envoyer({'type': 'reglages', ...app.reglagesStyleInter(m)});
        }, v['mode'] == 'delire' ? 'Délire · 2 paquets' : 'Simple · 1 paquet'),
      if (inter)
        ligne('J retour', const [(false, 'Non'), (true, 'Oui')], v['jRetour'] == true, (o) {
          app.ecrireJRetour(o);
          app.envoyer({'type': 'reglages', 'jRetour': o});
        }, v['jRetour'] == true ? 'Oui' : 'Non'),
      // Mode Cahier : partie normale, ou comptage des points jusqu'au petit ou au grand montant (Pilotage). Pas en salle publique.
      if (inter && v['publique'] != true)
        ligne('Formule', [for (final (c, l) in app.formulesInter(v['totauxCahier'])) (c, c == 'normale' ? 'Normale' : l)], formule, (f) {
          app.choisirFormule(f);
          app.envoyer(f == 'normale' ? {'type': 'reglages', 'formule': 'normale'} : {'type': 'reglages', 'formule': 'cahier', 'total': int.parse(f)});
        }, formule == 'normale' ? 'Partie normale' : 'Cahier · éliminé à $formule points'),
    ];
  }
}

void envoyerRobot(String niveau) => app.envoyer({'type': 'ajouterRobot', 'niveau': niveau});

/// En-tête du site : logo du jeu, « Salon · CODE », micro, Paramètres et Quitter.
class _EnTete extends StatelessWidget {
  final String info;
  final Map v;
  final bool paysage;
  const _EnTete(this.info, this.v, {required this.paysage});
  @override
  Widget build(BuildContext context) {
    final inter = v['jeu'] == 'inter8';
    final taille = paysage ? 26.0 : 28.0;
    return Row(children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(taille * .23),
        child: SvgPicture.asset(inter ? 'assets/img/masano-logo.svg' : 'assets/img/kopo-logo.svg', width: taille * 1.05, height: taille * 1.05),
      ),
      SizedBox(width: taille * .22),
      Text(inter ? 'INTER (8)' : 'KOPO', style: TextStyle(fontFamily: K.display, fontSize: taille * (inter ? .8 : 1), letterSpacing: 2, color: K.brass, height: 1)),
      const SizedBox(width: 10),
      Expanded(child: Text(info, maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(14, couleur: K.muted))),
      BoutonsMicro(v),
      const SizedBox(width: 6),
      BoutonTete(icone: 'reglages', aide: 'Paramètres', onTap: ouvrirParametres),
      const SizedBox(width: 6),
      BoutonTete(texte: 'Quitter', aide: 'Quitter', onTap: demanderQuitter),
    ]);
  }
}

/// Le chat du salon : un carré, avec le nombre de messages non lus.
class _BoutonChat extends StatelessWidget {
  const _BoutonChat();
  @override
  Widget build(BuildContext context) => Stack(clipBehavior: Clip.none, children: [
        Material(
          color: const Color(0x12FFFFFF),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: K.line)),
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: ouvrirChat,
            child: const Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Center(widthFactor: 1, child: Ico('reactions', taille: 26))),
          ),
        ),
        if (app.nonLus > 0)
          Positioned(
            top: -6, right: -6,
            child: Container(
              constraints: const BoxConstraints(minWidth: 20), height: 20, padding: const EdgeInsets.symmetric(horizontal: 5), alignment: Alignment.center,
              decoration: BoxDecoration(color: K.red, borderRadius: BorderRadius.circular(99)),
              child: Text(app.nonLus > 9 ? '9+' : '${app.nonLus}', style: K.texte(12, couleur: Colors.white)),
            ),
          ),
      ]);
}

/// « Montrer le QR code » (portrait) : le QR en grand, par-dessus l'écran.
class _BoutonQr extends StatelessWidget {
  final String lien;
  const _BoutonQr(this.lien);
  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0x12FFFFFF),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: K.line)),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => showDialog<void>(
            context: context,
            barrierColor: const Color(0xCC000000),
            builder: (c) => GestureDetector(
              onTap: () => Navigator.of(c).pop(),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
                  child: QrImageView(data: lien, size: 244, padding: EdgeInsets.zero, backgroundColor: Colors.white),
                ),
              ),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              SvgPicture.string('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9fb2c8" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/></svg>', width: 28, height: 28),
              const SizedBox(height: 2),
              Text('QR', style: K.texte(11, couleur: K.muted)),
            ]),
          ),
        ),
      );
}

/// Bouton WhatsApp vert du site.
class _BoutonWhatsApp extends StatelessWidget {
  final String texte;
  final VoidCallback onTap;
  const _BoutonWhatsApp(this.texte, this.onTap);
  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0xFF1F7A4D),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Color(0xFF2A9D63))),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Ico('partager', taille: 22, couleur: Colors.white),
              const SizedBox(width: 8),
              Flexible(child: Text(texte, maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(15, couleur: Colors.white, poids: FontWeight.w600))),
            ]),
          ),
        ),
      );
}

/// « ✓ Prêt » : vert pâle, comme sur le site.
class _BoutonPret extends StatelessWidget {
  final EdgeInsets marge;
  const _BoutonPret(this.marge);
  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0x2E3FBF7F),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: K.good)),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => app.envoyer({'type': 'pret', 'pret': false}),
          child: Padding(padding: marge, child: Center(child: Text('✓ Prêt', style: K.texte(15, couleur: K.good, poids: FontWeight.w600)))),
        ),
      );
}

/// Liste des joueurs en grille (2 colonnes, 3 en paysage), 6 px entre les cases.
class _Grille extends StatelessWidget {
  final List<Widget> enfants;
  final int colonnes;
  const _Grille(this.enfants, {required this.colonnes});
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < enfants.length; i += colonnes) ...[
          if (i > 0) const SizedBox(height: 6),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (var k = 0; k < colonnes; k++) ...[
              if (k > 0) const SizedBox(width: 6),
              Expanded(child: i + k < enfants.length ? enfants[i + k] : const SizedBox()),
            ],
          ]),
        ],
      ]);
}

class _LigneJoueur extends StatelessWidget {
  final Vue v;
  final Map j;
  final bool gerer;
  final bool paysage;
  const _LigneJoueur(this.v, this.j, this.gerer, {required this.paysage});
  // Seule la ligne se redessine quand quelqu'un se met à parler ou se tait (pas tout le salon).
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Set<String>>(valueListenable: app.vocal.quiParle, builder: (context, _, _) => _ligne(context));

  Widget _ligne(BuildContext context) {
    final robot = j['robot'] == true;
    final avecNiveau = robot && j['niveau'] != null && v['robots'] != 'gentils';
    final nom = (j['nom'] ?? '?').toString();
    final parle = app.vocal.parleurs.contains(j['id']);
    return Container(
      key: app.cleSiege(j['id'].toString()),
      constraints: BoxConstraints(minHeight: paysage ? 36 : 38),
      padding: EdgeInsets.fromLTRB(8, paysage ? 4 : 5, paysage ? 4 : 8, paysage ? 4 : 5),
      decoration: BoxDecoration(color: const Color(0x08FFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: parle ? K.good : K.line)),
      child: Row(children: [
        if (robot) Padding(padding: const EdgeInsets.only(right: 5), child: Ico('robots', taille: paysage ? 16 : 17, couleur: K.ink)),
        Expanded(child: Text(avecNiveau ? nom.replaceFirst(RegExp(r'^Robot '), '') : nom, maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(paysage ? 13 : 14))),
        if (j['plus'] == true) const Padding(padding: EdgeInsets.only(left: 5), child: CouronnePlus(taille: 15)),
        if (j['voix'] == true && j['id'] != v['moi'])
          // Toucher le micro d'un joueur : je ne l'entends plus (lui et les autres continuent de parler).
          Semantics(
            button: true,
            label: app.vocal.entendPas(j['id'].toString()) ? 'Réentendre $nom' : 'Ne plus entendre $nom',
            excludeSemantics: true,
            child: InkWell(
              onTap: () => app.vocal.sonCoupe ? app.vocal.basculerSon(false) : app.vocal.basculerJoueur(j['id'].toString(), nom),
              borderRadius: BorderRadius.circular(8),
              child: Padding(padding: const EdgeInsets.fromLTRB(7, 4, 4, 4), child: Ico(app.vocal.icone(j, v['moi'])!, taille: 18, couleur: app.vocal.entendPas(j['id'].toString()) ? K.bad : parle ? K.good : null)),
            ),
          )
        else if (j['voix'] == true) Padding(padding: const EdgeInsets.only(left: 5), child: Ico(j['muet'] == true ? 'micro-coupe' : 'micro', taille: 16, couleur: parle ? K.good : null)),
        const SizedBox(width: 5),
        if (j['id'] == v['hote']) const Padding(padding: EdgeInsets.only(right: 5), child: Pastille('hôte', type: TypePastille.tour, petite: true)),
        if (j['id'] == v['moi'] && !paysage) const Padding(padding: EdgeInsets.only(right: 5), child: Pastille('toi', petite: true)),
        if (j['connecte'] != true && !robot) const Padding(padding: EdgeInsets.only(right: 5), child: Pastille('déconnecté', type: TypePastille.ko, petite: true))
        else if (j['pret'] == true && !robot && j['id'] != v['hote'] && v['publique'] != true) const Padding(padding: EdgeInsets.only(right: 5), child: Pastille('prêt', type: TypePastille.ok, petite: true)),
        if (avecNiveau) Flexible(child: _NiveauRobot(j, gerer)),
        if (gerer && j['id'] != v['moi'])
          InkWell(
            onTap: () => app.envoyer({'type': 'retirer', 'cible': j['id']}),
            borderRadius: BorderRadius.circular(8),
            child: const Padding(padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2), child: Text('✕', style: TextStyle(color: K.ink, fontSize: 14))),
          ),
      ]),
    );
  }
}

class _NiveauRobot extends StatelessWidget {
  final Map j;
  final bool modifiable;
  const _NiveauRobot(this.j, this.modifiable);
  static const couleurs = {'faciles': Color(0xFF7FD1A6), 'forts': Color(0xFFEF8A6B)};
  @override
  Widget build(BuildContext context) {
    final n = j['niveau'].toString();
    // « .niveau-robot » du site : pastille claire, texte vert (facile) ou orangé (fort) ; filet quand on peut la toucher.
    final p = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: const Color(0x12FFFFFF), borderRadius: BorderRadius.circular(99), border: Border.all(color: modifiable ? K.line : Colors.transparent)),
      child: Text(App.nomsNiveauxRobots[n] ?? n, maxLines: 1, overflow: TextOverflow.ellipsis, style: K.texte(11, couleur: couleurs[n] ?? K.ink, poids: FontWeight.w700)),
    );
    if (!modifiable) return p;
    return GestureDetector(
      onTap: () {
        const o = App.niveauxRobots;
        final s = o[(o.indexOf(n) + 1) % 3];
        Stock.ecrire('kopo-niveau-dernier-robot', s);
        app.envoyer({'type': 'niveauRobot', 'cible': j['id'], 'niveau': s});
      },
      child: p,
    );
  }
}
