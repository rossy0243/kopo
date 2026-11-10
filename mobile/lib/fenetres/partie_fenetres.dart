// Fenêtres de la partie : chat, choix du 8 et de la couleur (Inter), fin de manche, récap de fin de partie.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../commun/cartes.dart';
import '../commun/retention.dart';
import '../commun/theme.dart';
import '../etat.dart';
import 'communes.dart';

// ---------------------------------------------------------------- chat
void ouvrirChat() {
  app.nonLus = 0;
  app.ouvrirFenetre((context) {
    final code = app.vue?['code'];
    final anciens = app.historiqueChat.where((m) => m.code == code).toList();
    final msgs = app.messagesChat;
    final emojis = msgs.where((r) => !App.estPhrase(r)).toList(), phrases = msgs.where(App.estPhrase).toList();
    void envoyer(String r) { app.fermerFenetre(); app.reagir(r); }
    return Fenetre(titre: 'Chat', onFermer: app.fermerFenetre, enfants: [
      if (anciens.isNotEmpty)
        Container(
          constraints: const BoxConstraints(maxHeight: 180),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: const Color(0x40000000), borderRadius: BorderRadius.circular(10)),
          child: SingleChildScrollView(
            reverse: true,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final m in anciens) ligneChat(m)]),
          ),
        ),
      const Ecart(10),
      if (emojis.isNotEmpty)
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final e in emojis) SizedBox(width: 48, height: 48, child: Btn(null, enfant: Text(e, style: const TextStyle(fontSize: 24)), marge: EdgeInsets.zero, onTap: () => envoyer(e))),
        ]),
      const Ecart(10),
      if (phrases.isNotEmpty)
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final p in phrases) Btn(p, taille: 13, marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), onTap: () => envoyer(p)),
        ]),
      const Ecart(12),
      Btn('Fermer', large: true, onTap: app.fermerFenetre),
    ]);
  }, 'chat');
}

Widget ligneChat(MessageChat m) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Text.rich(TextSpan(style: K.texte(14), children: [
        TextSpan(text: '${m.moi ? 'Moi' : m.nom} ', style: TextStyle(fontWeight: FontWeight.w700, color: m.moi ? K.brass : K.ink)),
        TextSpan(text: m.texte, style: App.estPhrase(m.texte ?? '') ? null : const TextStyle(fontSize: 20)),
      ])),
    );

// ---------------------------------------------------------------- Inter (8) : poser, choisir la demande ou la couleur
String _couleurFinale(Map a) { final l = (a['cartes'] as List); return InterCartes.couleur(l.last as String); }

void poserInter(List<Map> coups) {
  if (coups.isEmpty) return;
  final demandes = <String>{for (final a in coups) if (a['demande'] != null) a['demande'].toString()}.toList();
  void envoyerCoup(Map a) { app.choixInter = []; app.action({'type': 'jouer', 'cartes': a['cartes'], 'demande': a['demande']}); }
  final couleurs = <String>{for (final a in coups) _couleurFinale(a)}.toList();
  final premier = (coups[0]['cartes'] as List).cast<String>();
  if (demandes.isEmpty && premier.length > 2 && couleurs.length > 1 && InterCartes.valeur(premier[0]) != '8') {
    final presentes = InterCartes.couleurs.where((k) => premier.any((c) => InterCartes.couleur(c) == k)).toList();
    app.ouvrirFenetre((context) => Fenetre(titre: 'Quelle couleur ensuite ?', enfants: [
          const Muet("Ta dernière carte donne la nouvelle couleur. Celle du centre n'est pas permise."),
          const Ecart(12),
          Row(children: [
            for (final k in presentes)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: Builder(builder: (_) {
                    final coup = coups.where((a) => _couleurFinale(a) == k).firstOrNull;
                    return Btn(null,
                        enfant: Text(KopoCartes.symboles[k]!, style: TextStyle(fontSize: 30, color: k == 'C' || k == 'K' ? const Color(0xFFFF6B60) : K.ink)),
                        onTap: coup == null ? null : () { app.fermerFenetre(); envoyerCoup(coup); });
                  }),
                ),
              ),
          ]),
          const Ecart(10),
          Btn('Annuler', large: true, onTap: app.fermerFenetre),
        ]), 'couleur8');
    return;
  }
  if (demandes.isEmpty) { envoyerCoup(coups[0]); return; }
  app.ouvrirFenetre((context) => Fenetre(titre: 'Quelle valeur demandes-tu ?', enfants: [
        const Muet('Le joueur suivant doit poser cette valeur, un 8 ou un joker. Sinon il pioche.'),
        const Ecart(12),
        GridView.count(
          crossAxisCount: 4, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 6, crossAxisSpacing: 6, childAspectRatio: 1.6,
          children: [
            for (final d in demandes) Btn(InterCartes.nomValeur(d), marge: EdgeInsets.zero, onTap: () { app.fermerFenetre(); envoyerCoup(coups.firstWhere((a) => a['demande'] == d)); }),
          ],
        ),
        const Ecart(10),
        Btn('Annuler', large: true, onTap: app.fermerFenetre),
      ]), 'demande8');
}

// ---------------------------------------------------------------- fin de manche
void afficherFinManche(Vue v0) {
  app.ouvrirFenetre((context) {
    final v = app.vue ?? v0;
    if (v['etat'] != 'finManche') return const SizedBox();
    final m = v['manche'] as Map;
    final q = (m['qualifies'] as List).cast<Map>();
    final suivants = (v['restants'] as List).length;
    final lignes = <Widget>[
      for (var i = 0; i < q.length; i++) _LigneBilan('${i + 1}. ${app.nomDe(v, q[i]['joueur'])}', Pastille(q[i]['raison'] == 'Katapss' ? 'Katapss' : 'qualifié', type: TypePastille.ok)),
      _LigneBilan(app.nomDe(v, m['elimine']), const Pastille('éliminé', type: TypePastille.ko)),
    ];
    return Fenetre(titre: 'Fin de la manche ${v['numeroManche']}', enfants: [
      Text(m['elimine'] == v['moi'] ? 'Tu es éliminé. Tu peux continuer à regarder la partie.' : '${app.nomDe(v, m['elimine'])} est éliminé.', style: K.texte(16)),
      const Ecart(10),
      _DeuxColonnes(lignes, deux: q.length >= 4),
      if (v['suite'] != null) ...[
        const Ecart(10),
        _Decompte((s) => Text.rich(TextSpan(style: K.texte(15), children: [
              TextSpan(text: suivants == 2 ? 'La finale démarre dans ' : 'La manche suivante démarre dans '),
              TextSpan(text: '$s', style: const TextStyle(fontWeight: FontWeight.w700, color: K.brass)),
              const TextSpan(text: ' s.'),
            ]))),
      ],
      if (v['entreRobots'] == true) ...[const Ecart(10), Btn.principal('Passer à la fin', large: true, onTap: () => app.envoyer({'type': 'passerFin'}))],
      const Ecart(10),
      if (v['hote'] == v['moi'])
        Btn('Lancer maintenant${suivants == 2 ? ' la finale' : ''}', style: v['entreRobots'] == true ? StyleBtn.normal : StyleBtn.principal, large: true, onTap: () => app.envoyer({'type': 'mancheSuivante'}))
      else if (v['suite'] == null)
        Text("En attente de l'hôte pour la manche suivante…", style: K.texte(15, couleur: K.muted)),
    ]);
  }, 'finManche');
}

/// Secondes restantes du chrono de l'appli, rafraîchies.
class _Decompte extends StatefulWidget {
  final Widget Function(int secondes) builder;
  final DateTime? fin;
  const _Decompte(this.builder, {this.fin});
  @override
  State<_Decompte> createState() => _DecompteState();
}

class _DecompteState extends State<_Decompte> {
  late final Timer _t = Timer.periodic(const Duration(milliseconds: 250), (_) { if (mounted) setState(() {}); });
  @override
  void dispose() { _t.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    _t.isActive;
    final ms = widget.fin != null ? math.max(0, widget.fin!.difference(DateTime.now()).inMilliseconds) : app.resteChrono;
    return widget.builder((ms / 1000).ceil());
  }
}

class _LigneBilan extends StatelessWidget {
  final String texte;
  final Widget pastille;
  final bool moi;
  const _LigneBilan(this.texte, this.pastille, {this.moi = false});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(color: moi ? const Color(0x2EE2B04A) : const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [Expanded(child: Text(texte, overflow: TextOverflow.ellipsis, style: K.texte(14, poids: moi ? FontWeight.w700 : FontWeight.w400))), pastille]),
      );
}

class _DeuxColonnes extends StatelessWidget {
  final List<Widget> lignes;
  final bool deux;
  const _DeuxColonnes(this.lignes, {required this.deux});
  @override
  Widget build(BuildContext context) {
    if (!deux) return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: lignes);
    final n = (lignes.length / 2).ceil();
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: lignes.sublist(0, n))),
      const SizedBox(width: 6),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: lignes.sublist(n))),
    ]);
  }
}

// ---------------------------------------------------------------- fin de partie : le récap
String _cleRecap(Vue v) => '${v['code']}|${v['vainqueur']}|${(v['elimines'] as List).join(',')}';

void afficherFinPartie(Vue v0) {
  final cle = _cleRecap(v0);
  if (app.fenetreType == 'recap' && _recapCle == cle) { app.maj(); return; }
  final dejaVu = app.recapsAnimes.contains(cle);
  app.recapsAnimes.add(cle);
  _recapCle = cle;
  final anim = !dejaVu && !app.sansAnim;
  final r = app.suivi != null && app.suivi!['fini'] == true ? app.suivi!['recap'] as Recap? : null;
  if (r != null && r.niveauApres.niveau > r.niveauAvant.niveau && !dejaVu) {
    Timer(Duration(milliseconds: anim ? 950 : 0), () { app.tampon('NIVEAU ${r.niveauApres.niveau}'); app.vibrer(60); });
  }
  final revOui = v0['revanche'] is Map && ((v0['revanche']['oui'] as List?) ?? []).contains(v0['moi']);
  app.ouvrirFenetre((context) => _Recap(app.vue ?? v0, r, anim), 'recap');
  if (v0['publique'] == true && !revOui) app.lancerSuiteAuto(v0);
}
String? _recapCle;

class _Recap extends StatelessWidget {
  final Vue v;
  final Recap? r;
  final bool anim;
  const _Recap(this.v, this.r, this.anim);

  @override
  Widget build(BuildContext context) {
    if (v['etat'] != 'finPartie') return const SizedBox();
    final r = this.r;
    final e = r?.bilan;
    final gagne = v['vainqueur'] == v['moi'];
    final classement = [v['vainqueur'], ...(v['elimines'] as List).reversed];
    final place = classement.indexOf(v['moi']) + 1;
    final paysage = MediaQuery.of(context).orientation == Orientation.landscape;

    final gauche = <Widget>[
      Row(children: [
        if (gagne) const Ico('couronne', taille: 48)
        else if (place > 0) Text(place == 1 ? '1er' : '${place}e', style: K.titre(46)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(gagne ? 'Tu as gagné !' : '${app.nomDe(v, v['vainqueur'])} gagne !', style: K.titre(34, couleur: gagne ? K.brass : K.ink)),
            if (place > 0) Muet('$place${place == 1 ? 'er' : 'e'} sur ${classement.length}${e != null ? ' · ${e.manches} manche${e.manches > 1 ? 's' : ''} survécue${e.manches > 1 ? 's' : ''}' : ''}'),
          ]),
        ),
      ]),
      if (r != null) ..._progres(r, e),
      ..._extras(),
    ];

    final rv = v['revanche'] as Map?;
    final oui = ((rv?['oui'] as List?) ?? []);
    final non = ((rv?['non'] as List?) ?? []);
    final moiOui = oui.contains(v['moi']);
    if (moiOui && app.suiteAuto != null) app.arreterSuiteAuto();
    final droite = <Widget>[
      Stack(children: [
        Btn.principal(moiOui ? 'Revanche acceptée, on attend les autres…' : oui.isNotEmpty ? 'Revanche ! (${oui.length} prêt${oui.length > 1 ? 's' : ''})' : 'Revanche',
            icone: 'revanche', large: true, onTap: moiOui ? null : () { app.arreterSuiteAuto(); app.envoyer({'type': 'revanche'}); }),
        if (rv != null && rv['resteMs'] is num && rv['totalMs'] is num)
          Positioned(left: 0, right: 0, bottom: 0, child: _Jauge(key: ValueKey('${rv['resteMs']}'), reste: (rv['resteMs'] as num).toInt(), total: (rv['totalMs'] as num).toInt())),
      ]),
      if (rv != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Wrap(spacing: 4, runSpacing: 4, children: [
            for (final j in (v['joueurs'] as List).cast<Map>())
              if (j['robot'] != true && j['id'] != v['moi'])
                Pastille((j['nom'] ?? '?').toString(), type: oui.contains(j['id']) ? TypePastille.ok : non.contains(j['id']) || j['connecte'] != true ? TypePastille.ko : TypePastille.neutre),
          ]),
        ),
      if (v['revancheRatee'] == true) const Padding(padding: EdgeInsets.only(top: 6), child: Muet("Pas assez de joueurs pour la revanche. Tu peux relancer l'appel.")),
      if (v['publique'] == true) ...[
        const Ecart(8),
        if (app.suiteAuto != null)
          Row(children: [
            Expanded(child: _Decompte((s) => Text.rich(TextSpan(style: K.texte(15), children: [const TextSpan(text: 'Prochaine partie dans '), TextSpan(text: '$s', style: const TextStyle(color: K.brass, fontWeight: FontWeight.w700)), const TextSpan(text: ' s')])), fin: app.suiteAuto!.fin)),
            Btn('Arrêter là', onTap: () { app.arreterSuiteAuto(); app.maj(); }),
          ])
        else
          Btn('Nouvelle partie (salle de ${v['taille']})', large: true, onTap: () => app.partieSuivante((v['taille'] as num).toInt(), v['jeu'] as String?)),
      ],
      const Ecart(8),
      Row(children: [
        if (gagne || r?.titre != null) ...[Expanded(child: Btn('Partager', icone: 'partager', onTap: () => partagerVictoire(v, r))), const SizedBox(width: 6)],
        if (v['hote'] == v['moi'] && v['publique'] != true) ...[Expanded(child: Btn('Changer', onTap: () { app.arreterSuiteAuto(); app.envoyer({'type': 'rejouer'}); })), const SizedBox(width: 6)],
        Expanded(child: Btn('Quitter', onTap: () { app.arreterSuiteAuto(); app.quitter(); })),
      ]),
      const Ecart(10),
      _DeuxColonnes([
        for (var i = 0; i < classement.length; i++)
          _LigneBilan('${i + 1}. ${app.nomDe(v, classement[i])}', Pastille(i == 0 ? 'vainqueur' : '${classement.length >= 5 ? '' : 'éliminé '}manche ${(v['elimines'] as List).length - i + 1}', type: i == 0 ? TypePastille.ok : TypePastille.neutre), moi: classement[i] == v['moi']),
      ], deux: classement.length >= 5),
    ];

    return Fenetre(largeur: paysage ? 860 : 460, enfants: [
      if (paysage)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: gauche)),
          const SizedBox(width: 18),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: droite)),
        ])
      else ...[...gauche, const Ecart(12), ...droite],
    ]);
  }

  List<Widget> _progres(Recap r, Bilan? e) {
    final fA = r.niveauAvant.fraction, fB = r.niveauApres.fraction;
    final monte = r.niveauApres.niveau > r.niveauAvant.niveau;
    final lignes = [...r.missions, if (r.defi != null) r.defi!];
    return [
      const Ecart(12),
      Row(children: [
        _RondNiveau(r.niveauAvant.niveau, r.niveauApres.niveau, anim),
        const SizedBox(width: 10),
        Expanded(child: _BarreAnimee(monte ? 0 : fA, fB, anim, debut: monte ? 950 : 300)),
        const SizedBox(width: 10),
        _Compteur(r.xpPartie + r.xpMissions, anim),
      ]),
      for (var i = 0; i < lignes.length; i++) ...[
        const Ecart(8),
        Row(children: [
          Expanded(child: Text('${lignes[i].defi ? 'Défi : ' : ''}${lignes[i].texte}', style: K.texte(13, poids: FontWeight.w600, couleur: lignes[i].finie ? K.good : K.ink))),
          if (lignes[i].finie)
            lignes[i].aEncaisser ? Text('À encaisser', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700)) : recompense(lignes[i].pieces, taille: 13)
          else
            Text('${lignes[i].apres}/${lignes[i].cible}', style: K.texte(13, couleur: K.muted)),
        ]),
        const SizedBox(height: 3),
        _BarreAnimee(lignes[i].avant / lignes[i].cible, lignes[i].apres / lignes[i].cible, anim, debut: 700 + 250 * i, hauteur: 4, couleur: lignes[i].finie ? K.good : K.brass),
      ],
      if (r.faceAFace != null) ...[
        const Ecart(10),
        _FaceAFace(r.faceAFace!.gagnes, r.faceAFace!.perdus, r.faceAFace!.nom),
        if (r.faceAFace!.taquinerie != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(r.faceAFace!.taquinerie!, textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(fontStyle: FontStyle.italic))),
      ],
      for (final id in r.objets)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(children: [
            Expanded(child: Text('Nouveau : ${R.objets[id]?['type'] == 'avatar' ? 'avatar' : R.objets[id]?['type'] == 'dos' ? 'dos de cartes' : 'cadre'} ${R.objets[id]?['nom'] ?? id}', style: K.texte(13, couleur: K.good, poids: FontWeight.w600))),
            Text('équipé', style: K.texte(12, couleur: K.muted)),
          ]),
        ),
      if (r.titre != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text('« ${r.titre} »', textAlign: TextAlign.center, style: K.texte(15, couleur: K.brass, poids: FontWeight.w700).copyWith(fontStyle: FontStyle.italic))),
      if (e != null && e.avecRobots && !e.guidee) const Padding(padding: EdgeInsets.only(top: 8), child: Muet("Partie d'entraînement (avec des robots) : XP divisée par deux.", taille: 12)),
    ];
  }

  List<Widget> _extras() {
    final out = <Widget>[];
    final now = DateTime.now();
    final L = app.derniereLigue;
    if (L != null && now.difference(L.recu).inSeconds <= 60) {
      final d = L.detail;
      final delta = (d['delta'] as num?)?.toInt() ?? 0;
      final div = d['division']?.toString() ?? '';
      final nomDiv = App.nomsDivisions[div] ?? div;
      final pro = d['prochaine'] as Map?;
      out.add(Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.divisions[div] ?? K.brass)),
        child: Row(children: [
          Text('${delta > 0 ? '+' : ''}$delta', style: K.titre(34, couleur: delta < 0 ? K.bad : delta == 0 ? K.muted : K.good)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Ligue · $nomDiv · ${d['points']} pts', style: K.texte(14, poids: FontWeight.w700)),
              if (d['promu'] == true) Text('Montée en $nomDiv !', style: K.texte(13, couleur: K.good, poids: FontWeight.w700))
              else if (d['relegue'] == true) Muet('Retour en $nomDiv.', taille: 12)
              else if (pro != null) Muet('Encore ${pro['manque']} pts pour ${App.nomsDivisions[pro['division']] ?? pro['division']}', taille: 12),
              if ((d['protection'] as num? ?? 0) > 0 && d['promu'] == true) Muet('${d['protection']} parties protégées : pas de descente', taille: 12),
            ]),
          ),
        ]),
      ));
    }
    final P = app.dernierParcours;
    if (P != null && now.difference(P.recu).inSeconds <= 60) {
      final d = P.detail;
      final palier = (d['palier'] as num?)?.toInt() ?? 0, paliers = (d['paliers'] as num?)?.toInt() ?? 1;
      final xpPalier = (d['xpPalier'] as num?)?.toDouble() ?? 1, total = (d['total'] as num?)?.toDouble() ?? 0, xp = (d['xp'] as num?)?.toDouble() ?? 0;
      final dans = palier >= paliers ? 1.0 : (total % xpPalier) / xpPalier;
      out.add(Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Text('+${d['xp']} XP', style: K.texte(13, couleur: K.brass, poids: FontWeight.w700)),
            const SizedBox(width: 8),
            Expanded(child: Text(d['nouveaux'] != null && d['nouveaux'] != 0 && d['nouveaux'] != false ? 'Parcours de saison : palier $palier atteint !' : 'Parcours de saison · palier $palier/$paliers', style: K.texte(13))),
          ]),
          const SizedBox(height: 3),
          _BarreAnimee(math.max(0, dans - xp / xpPalier), dans, anim, hauteur: 4),
        ]),
      ));
    }
    final D = app.dernierDuel;
    if (D != null && now.difference(D.recu).inSeconds <= 60 && r?.faceAFace?.id != D.x['id']) {
      out.add(const Ecart(10));
      out.add(_FaceAFace((D.x['moi'] as num).toInt(), (D.x['lui'] as num).toInt(), D.x['pseudo'].toString()));
      if (D.taquinerie != null) out.add(Padding(padding: const EdgeInsets.only(top: 4), child: Text(D.taquinerie!, textAlign: TextAlign.center, style: K.texte(13, couleur: K.muted).copyWith(fontStyle: FontStyle.italic))));
    }
    return out;
  }
}

class _FaceAFace extends StatelessWidget {
  final int g, p;
  final String nom;
  const _FaceAFace(this.g, this.p, this.nom);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('Toi', style: K.texte(14)),
          const SizedBox(width: 10),
          Text('$g – $p', style: K.titre(28, couleur: Colors.white)),
          const SizedBox(width: 10),
          Flexible(child: Text(nom, overflow: TextOverflow.ellipsis, style: K.texte(14))),
        ]),
      );
}

class _Jauge extends StatelessWidget {
  final int reste, total;
  const _Jauge({super.key, required this.reste, required this.total});
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: reste / math.max(1, total), end: 0),
        duration: Duration(milliseconds: math.max(1, reste)),
        builder: (_, f, __) => Align(alignment: Alignment.centerLeft, child: FractionallySizedBox(widthFactor: f, child: Container(height: 3, color: K.encre.withValues(alpha: .5)))),
      );
}

class _BarreAnimee extends StatefulWidget {
  final double de, a;
  final bool anim;
  final int debut;
  final double hauteur;
  final Color couleur;
  const _BarreAnimee(this.de, this.a, this.anim, {this.debut = 300, this.hauteur = 8, this.couleur = K.brass});
  @override
  State<_BarreAnimee> createState() => _BarreAnimeeState();
}

class _BarreAnimeeState extends State<_BarreAnimee> {
  bool _parti = false;
  @override
  void initState() {
    super.initState();
    if (widget.anim) { Future.delayed(Duration(milliseconds: widget.debut), () { if (mounted) setState(() => _parti = true); }); }
    else { _parti = true; }
  }
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: widget.de, end: _parti ? widget.a : widget.de),
        duration: Duration(milliseconds: widget.anim ? 650 : 0),
        curve: const Cubic(.3, .8, .4, 1),
        builder: (_, f, __) => Barre(f, hauteur: widget.hauteur, couleur: widget.couleur),
      );
}

class _RondNiveau extends StatefulWidget {
  final int avant, apres;
  final bool anim;
  const _RondNiveau(this.avant, this.apres, this.anim);
  @override
  State<_RondNiveau> createState() => _RondNiveauState();
}

class _RondNiveauState extends State<_RondNiveau> {
  late int n = widget.anim ? widget.avant : widget.apres;
  @override
  void initState() {
    super.initState();
    if (widget.anim && widget.apres != widget.avant) Future.delayed(const Duration(milliseconds: 950), () { if (mounted) setState(() => n = widget.apres); });
  }
  @override
  Widget build(BuildContext context) => AnimatedScale(
        scale: 1,
        duration: const Duration(milliseconds: 300),
        child: Container(
          width: 40, height: 40, alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, color: K.brass, border: Border.all(color: const Color(0xFFF3D48A), width: 2)),
          child: Text('$n', style: K.titre(24, couleur: K.encre)),
        ),
      );
}

class _Compteur extends StatelessWidget {
  final int fin;
  final bool anim;
  const _Compteur(this.fin, this.anim);
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: anim ? 0 : fin.toDouble(), end: fin.toDouble()),
        duration: Duration(milliseconds: anim ? 1000 : 0),
        curve: Curves.easeOutCubic,
        builder: (_, x, __) => Text('+${x.round()} XP', style: K.texte(15, couleur: K.brass, poids: FontWeight.w700)),
      );
}

Future<void> partagerVictoire(Vue v, Recap? r) async {
  final J = jeuPartage(v['jeu'] as String?);
  final texte = v['vainqueur'] == v['moi']
      ? 'Je viens de gagner une partie ${J.de} sur Masano ! Viens me battre :'
      : r?.titre != null ? 'Mon nouveau titre ${J.au} : « ${r!.titre} ». Viens jouer sur Masano :' : 'Viens jouer ${J.au} avec moi sur Masano :';
  try {
    await SharePlus.instance.share(ShareParams(text: '$texte $lienJeu'));
  } catch (_) {
    await ouvrirWhatsApp('$texte $lienJeu');
  }
}
