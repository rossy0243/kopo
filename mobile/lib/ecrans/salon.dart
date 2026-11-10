// Salon d'avant-partie : code, QR, réglages de l'hôte (chrono, style Inter), joueurs, robots, prêt, lancer.
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../fenetres/communes.dart';
import '../fenetres/partie_fenetres.dart';
import '../fenetres/social.dart';

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
    final lien = lienPartie(code);
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;

    final colCode = Colonne([
      if (publique) Text('Salle de ${v['taille']}', style: K.titre(30)),
      if (publique)
        Text.rich(TextSpan(style: K.texte(14), children: [
          const TextSpan(text: 'En attente de joueurs : '),
          TextSpan(text: '${joueurs.length}/${v['taille']}', style: const TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(text: '. La partie démarre dès que la salle est pleine. ${app.nbEnLigne} en ligne.'),
        ])),
      Text(publique ? 'Code pour tes amis' : 'Code de la partie', style: K.texte(13, couleur: K.muted)),
      Row(children: [
        Expanded(child: Text(code, style: K.titre(54).copyWith(letterSpacing: 8))),
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
          child: QrImageView(data: lien, size: 86, padding: EdgeInsets.zero, backgroundColor: Colors.white),
        ),
      ]),
      Row(children: [
        Expanded(child: Btn('WhatsApp', icone: 'partager', onTap: () => ouvrirWhatsApp('Viens jouer ${jeuPartage(v['jeu'] as String?).au} avec moi sur Masano ! Code de la partie : $code\n$lien'))),
        const SizedBox(width: 8),
        Btn('Copier', onTap: () => copier(lien, 'Lien copié.')),
        if (app.enLigne && !publique) ...[const SizedBox(width: 8), Btn('Amis', icone: 'amis', onTap: () => inviterDepuisSalon(code))],
      ]),
      if (!publique) ..._reglages(v, inter, hote),
    ]);

    final colJoueurs = Colonne([
      Row(children: [
        Expanded(child: Titre3('Joueurs (${joueurs.length}/${publique ? v['taille'] : maxJoueurs})${invites.isNotEmpty && !publique ? ' · $prets/${invites.length} prêt${prets > 1 ? 's' : ''}' : ''}')),
        _BoutonChat(),
      ]),
      for (final j in joueurs) _LigneJoueur(v, j, hote && !publique),
      if (hote && joueurs.length < maxJoueurs && !publique)
        Btn('+ Robot', icone: 'robots', large: true, onTap: () {
          final n = Stock.lire('kopo-niveau-dernier-robot');
          envoyerRobot(App.niveauxRobots.contains(n) ? n as String : app.niveauRobots);
        }),
      if (hote && !publique)
        Btn.principal(joueurs.length < 2 ? "En attente d'au moins 2 joueurs" : 'Lancer · ${joueurs.length} joueurs', large: true, onTap: joueurs.length < 2 ? null : () => app.envoyer({'type': 'lancer'})),
      if (!hote && !publique) ...[
        Btn(moi['pret'] == true ? '✓ Prêt' : 'Je suis prêt', style: moi['pret'] == true ? StyleBtn.normal : StyleBtn.principal, large: true, onTap: () => app.envoyer({'type': 'pret', 'pret': moi['pret'] != true})),
        Text(moi['pret'] == true ? "Tu es prêt. La partie part dès que l'hôte lance." : "L'hôte peut lancer à tout moment.", textAlign: TextAlign.center, style: K.texte(13, couleur: moi['pret'] == true ? K.good : K.muted)),
      ],
    ]);

    return SafeArea(
      child: Column(children: [
        _EnTete(publique ? 'Salle publique · $code' : 'Salon · $code'),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(14, 6, 14, 20),
            child: Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: paysage ? 900 : 480),
                child: paysage
                    ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: colCode), const SizedBox(width: 20), Expanded(child: colJoueurs)])
                    : Colonne([colCode, const SizedBox(height: 6), colJoueurs], ecart: 10),
              ),
            ),
          ),
        ),
      ]),
    );
  }

  List<Widget> _reglages(Vue v, bool inter, bool hote) {
    Widget ligne(String titre, Widget w) => Row(children: [SizedBox(width: 74, child: Text(titre, style: K.texte(14, couleur: K.muted))), Expanded(child: w)]);
    final delais = inter ? App.delaisInter : App.delaisKopo;
    final delai = (v['delai'] as num?)?.toInt() ?? 0;
    return [
      const SizedBox(height: 4),
      ligne('Chrono', hote
          ? Choix([for (final d in delais) (d, d == 0 ? 'sans' : '$d s')], delai, (d) => app.envoyer({'type': 'reglages', 'delai': d}))
          : Text(delai == 0 ? 'sans chrono' : '$delai secondes par joueur', style: K.texte(15, poids: FontWeight.w700))),
      if (inter)
        ligne('Style', hote
            ? Choix(const [('simple', 'Simple · 1 paquet'), ('delire', 'Délire · 2 paquets')], v['mode'] == 'delire' ? 'delire' : 'simple', (m) {
                Stock.ecrire('kopo-inter8-style', m);
                app.envoyer({'type': 'reglages', ...app.reglagesStyleInter(m)});
              })
            : Text(v['mode'] == 'delire' ? 'Délire · 2 paquets' : 'Simple · 1 paquet', style: K.texte(15, poids: FontWeight.w700))),
      if (inter && v['mode'] == 'delire')
        ligne('J retour', hote
            ? Choix(const [(false, 'Non'), (true, 'Oui')], v['jRetour'] == true, (o) {
                app.ecrireJRetour(o);
                app.envoyer({'type': 'reglages', 'jRetour': o});
              })
            : Text(v['jRetour'] == true ? 'Oui' : 'Non', style: K.texte(15, poids: FontWeight.w700))),
    ];
  }
}

void envoyerRobot(String niveau) => app.envoyer({'type': 'ajouterRobot', 'niveau': niveau});

class _EnTete extends StatelessWidget {
  final String info;
  const _EnTete(this.info);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(6, 4, 6, 0),
        child: Row(children: [
          IconButton(onPressed: demanderQuitter, icon: const Icon(Icons.arrow_back, color: K.muted), tooltip: 'Quitter'),
          Expanded(child: Text(info, overflow: TextOverflow.ellipsis, style: K.texte(15, couleur: K.muted, poids: FontWeight.w600))),
        ]),
      );
}

class _BoutonChat extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Stack(clipBehavior: Clip.none, children: [
        IconButton(onPressed: ouvrirChat, icon: const Icon(Icons.chat_bubble_outline, color: K.brass), tooltip: 'Chat'),
        if (app.nonLus > 0)
          Positioned(top: 2, right: 2, child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5), height: 16,
            decoration: BoxDecoration(color: K.bad, borderRadius: BorderRadius.circular(8)),
            child: Text(app.nonLus > 9 ? '9+' : '${app.nonLus}', style: K.texte(10, couleur: Colors.white, poids: FontWeight.w700)),
          )),
      ]);
}

class _LigneJoueur extends StatelessWidget {
  final Vue v;
  final Map j;
  final bool gerer;
  const _LigneJoueur(this.v, this.j, this.gerer);
  @override
  Widget build(BuildContext context) {
    final robot = j['robot'] == true;
    final avecNiveau = robot && j['niveau'] != null && v['robots'] != 'gentils';
    final nom = (j['nom'] ?? '?').toString();
    return Container(
      key: app.cleSiege(j['id'].toString()),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.line)),
      child: Row(children: [
        if (robot) const Padding(padding: EdgeInsets.only(right: 6), child: Ico('robots', taille: 20)),
        Flexible(child: Text(avecNiveau ? nom.replaceFirst(RegExp(r'^Robot '), '') : nom, overflow: TextOverflow.ellipsis, style: K.texte(15, poids: FontWeight.w600))),
        const SizedBox(width: 6),
        Expanded(
          child: Wrap(spacing: 4, runSpacing: 4, children: [
            if (j['id'] == v['hote']) const Pastille('hôte', type: TypePastille.tour),
            if (j['id'] == v['moi']) const Pastille('toi'),
            if (j['connecte'] != true && !robot) const Pastille('déconnecté', type: TypePastille.ko)
            else if (j['pret'] == true && !robot && j['id'] != v['hote'] && v['publique'] != true) const Pastille('prêt', type: TypePastille.ok),
            if (avecNiveau) _NiveauRobot(j, gerer),
          ]),
        ),
        if (gerer && j['id'] != v['moi'])
          InkWell(
            onTap: () => app.envoyer({'type': 'retirer', 'cible': j['id']}),
            borderRadius: BorderRadius.circular(8),
            child: const Padding(padding: EdgeInsets.all(6), child: Text('✕', style: TextStyle(color: K.muted, fontSize: 16))),
          ),
      ]),
    );
  }
}

class _NiveauRobot extends StatelessWidget {
  final Map j;
  final bool modifiable;
  const _NiveauRobot(this.j, this.modifiable);
  static const couleurs = {'faciles': K.good, 'normaux': K.brass, 'forts': K.bad};
  @override
  Widget build(BuildContext context) {
    final n = j['niveau'].toString();
    final c = couleurs[n] ?? K.muted;
    final p = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: .18), borderRadius: BorderRadius.circular(99), border: Border.all(color: c.withValues(alpha: .6))),
      child: Text('${App.nomsNiveauxRobots[n] ?? n}${modifiable ? ' ⟳' : ''}', style: K.texte(12, couleur: c, poids: FontWeight.w700)),
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
