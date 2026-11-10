// Amis, fiche d'un joueur (ami, blocage, signalement), parrainage, joueurs bloqués, notifications de l'accueil.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../commun/apparences.dart';
import '../commun/retention.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../ecrans/accueil.dart' show creer;
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';
import 'compet.dart';
import 'parametres.dart';

String messageErreur(Object e) => e is ErreurApi ? e.message : e.toString();

/// Charge des données une fois (et sur demande), puis les dessine. Garde son état tant que la fenêtre reste ouverte.
class Charge<T> extends StatefulWidget {
  final Future<T> Function() charger;
  final Widget Function(BuildContext context, T donnees, VoidCallback recharger) builder;
  final Widget? attente;
  const Charge({super.key, required this.charger, required this.builder, this.attente});
  @override
  State<Charge<T>> createState() => _ChargeState<T>();
}

class _ChargeState<T> extends State<Charge<T>> {
  T? _d;
  Object? _e;
  bool _fini = false;
  @override
  void initState() { super.initState(); _lire(); }
  Future<void> _lire() async {
    try { final d = await widget.charger(); if (mounted) setState(() { _d = d; _e = null; _fini = true; }); }
    catch (e) { if (mounted) setState(() { _e = e; _fini = true; }); }
  }
  @override
  Widget build(BuildContext context) {
    if (!_fini) return widget.attente ?? const Padding(padding: EdgeInsets.all(16), child: Center(child: Muet('Chargement…')));
    if (_e != null) return Padding(padding: const EdgeInsets.all(8), child: Text(messageErreur(_e!), style: K.texte(14, couleur: K.bad)));
    return widget.builder(context, _d as T, _lire);
  }
}

Widget ligneListe(List<Widget> enfants, {bool absent = false}) => Opacity(
      opacity: absent ? .65 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: 5),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(10), border: Border.all(color: K.line)),
        child: Row(children: enfants),
      ),
    );

// ---------------------------------------------------------------- fiche d'un joueur
const motifs = [('insultes', 'Insultes ou propos haineux'), ('pseudo', 'Pseudo inacceptable'), ('triche', 'Triche'), ('abandon', 'Quitte les parties'), ('autre', 'Autre')];

void toastAjoutAmi(Object? r, [String? nom]) {
  final m = r is Map ? r : const {};
  final n = (m['ami'] is Map ? m['ami']['pseudo'] : null) ?? nom ?? 'Ce joueur';
  app.toast(m['etat'] == 'ami' ? '$n est dans tes amis.' : "Demande envoyée à $n. Il doit l'accepter.");
}

void ficheJoueur(String id, String nom) {
  void retour() => app.fermerFenetre();
  app.ouvrirFenetre((context) {
    final avecCompte = app.enLigne && id.startsWith('c_');
    final bloque = app.bloques.contains(id);
    return Fenetre(titre: nom.isEmpty ? 'Joueur' : nom, enfants: [
      if (!avecCompte) Text('Amis, blocage et signalement arrivent avec les comptes en ligne.', style: K.texte(15))
      else ...[
        Btn.principal('Ajouter en ami', large: true, onTap: () async { try { toastAjoutAmi(await Api.post('/amis', {'cible': id}), nom); retour(); } catch (e) { app.toast(messageErreur(e)); } }),
        const Ecart(8),
        Btn(bloque ? 'Débloquer' : 'Bloquer', large: true, onTap: () async {
          try {
            if (bloque) { await Api.delete('/bloques/${Uri.encodeComponent(id)}'); app.bloques.remove(id); app.toast('Joueur débloqué.'); }
            else { await Api.post('/bloques', {'cible': id}); app.bloques.add(id); app.toast('Joueur bloqué : tu ne verras plus ses réactions.'); }
            Stock.ecrire('kopo-bloques', app.bloques.toList());
            retour();
          } catch (e) { app.toast(messageErreur(e)); }
        }),
        const Ecart(8),
        Btn('Signaler', large: true, onTap: () => _signaler(id, nom)),
      ],
      const Ecart(8),
      Btn('Fermer', large: true, onTap: retour),
    ]);
  }, 'fiche');
}

void _signaler(String id, String nom) {
  String? motif;
  final details = TextEditingController();
  app.ouvrirFenetre((context) => StatefulBuilder(builder: (context, setState) => Fenetre(titre: 'Signaler', enfants: [
        Text('Pourquoi signales-tu ${nom.isEmpty ? 'ce joueur' : nom} ?', style: K.texte(15)),
        const Ecart(10),
        for (final (v, t) in motifs) Padding(padding: const EdgeInsets.only(bottom: 6), child: Btn(t, style: motif == v ? StyleBtn.principal : StyleBtn.normal, large: true, onTap: () => setState(() => motif = v))),
        Champ(details, indice: 'Détails (facultatif)', max: 300),
        const Ecart(10),
        Btn.principal('Envoyer le signalement', large: true, onTap: () async {
          if (motif == null) { app.toast('Choisis un motif.'); return; }
          try {
            await Api.post('/signaler', {'cible': id, 'motif': motif, 'details': details.text, 'partie': app.vue?['code']});
            app.toast('Merci, ton signalement a été envoyé.');
            app.fermerFenetre();
          } catch (e) { app.toast(messageErreur(e)); }
        }),
        const Ecart(8),
        Btn('Annuler', large: true, onTap: app.fermerFenetre),
      ])), 'fiche');
}

// ---------------------------------------------------------------- inviter un ami depuis le salon
void inviterDepuisSalon(String code) {
  app.ouvrirFenetre((context) => Fenetre(titre: 'Inviter un ami', enfants: [
        Charge<List>(
          charger: () async => (await Api.get('/amis') as List)..sort((x, y) => (y['en_ligne'] == true ? 1 : 0) - (x['en_ligne'] == true ? 1 : 0)),
          builder: (context, amis, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (amis.isEmpty) Text("Pas encore d'amis. Ajoute-les dans Paramètres → Mes amis.", style: K.texte(14)),
            for (final a in amis) _LigneInviter(a as Map, code),
          ]),
        ),
        const Ecart(8),
        Btn('Fermer', large: true, onTap: app.fermerFenetre),
      ]));
}

class _LigneInviter extends StatefulWidget {
  final Map a;
  final String code;
  const _LigneInviter(this.a, this.code);
  @override
  State<_LigneInviter> createState() => _LigneInviterState();
}

class _LigneInviterState extends State<_LigneInviter> {
  bool invite = false;
  @override
  Widget build(BuildContext context) => ligneListe([
        Expanded(child: Text.rich(TextSpan(style: K.texte(15), children: [
          TextSpan(text: '${widget.a['pseudo']} '),
          if (widget.a['en_ligne'] == true) const TextSpan(text: '● en ligne', style: TextStyle(color: K.good, fontSize: 12)),
        ]))),
        Btn(invite ? 'Invité' : 'Inviter', onTap: invite ? null : () async {
          try { await Api.post('/amis/${Uri.encodeComponent(widget.a['id'].toString())}/inviter', {'code': widget.code}); setState(() => invite = true); } catch (e) { app.toast(messageErreur(e)); }
        }),
      ]);
}

// ---------------------------------------------------------------- fenêtre Amis
String depuisQuand(Object? d) {
  if (d == null) return '';
  final t = DateTime.tryParse(d.toString());
  if (t == null) return '';
  final m = (DateTime.now().difference(t).inSeconds / 60).round();
  if (m < 0) return '';
  if (m < 60) return 'Vu il y a ${math.max(m, 2)} min';
  final h = (m / 60).round();
  if (h < 24) return 'Vu il y a $h h';
  final j = (h / 24).round();
  return j <= 1 ? 'Vu hier' : j < 30 ? 'Vu il y a $j jours' : 'Vu il y a longtemps';
}

int niveauAmi(Map a) {
  final p = <String, dynamic>{'xp': (a['xp'] as num?) ?? 0, 'bareme': a['bareme']};
  if ((p['xp'] as num) == 0) return 0;
  R.convertirXp(p);
  return R.niveauDe(p['xp'] as num).niveau;
}

Widget avatarAmi(Map a, [bool enLigne = false]) {
  final n = niveauAmi(a);
  return Stack(clipBehavior: Clip.none, children: [
    Avatar((a['pseudo'] ?? '?').toString(), avatar: (a['apparence'] as String?) ?? 'av-laiton', cadre: a['cadre'] as String?, taille: 38, niveau: n == 0 ? null : n),
    if (enLigne) Positioned(right: -1, bottom: -1, child: Container(width: 11, height: 11, decoration: BoxDecoration(color: K.good, shape: BoxShape.circle, border: Border.all(color: K.table2, width: 2)))),
  ]);
}

Future<void> repondreDemande(String id, bool accepter) async {
  await Api.post('/amis/demandes/${Uri.encodeComponent(id)}/${accepter ? 'accepter' : 'refuser'}');
  app.demandesAmi = math.max(0, app.demandesAmi - 1);
  app.maj();
}

String _ongletAmis = 'amis';

void ouvrirAmis({VoidCallback? retour, bool garderOnglet = false}) {
  final c = Api.compte;
  if (c == null) return;
  if (!garderOnglet) _ongletAmis = app.demandesAmi > 0 ? 'demandes' : 'amis';
  final champ = TextEditingController();
  app.ouvrirFenetre((context) => _Amis(retour ?? app.fermerFenetre, champ), 'amis');
}

class _Amis extends StatefulWidget {
  final VoidCallback retour;
  final TextEditingController champ;
  const _Amis(this.retour, this.champ);
  @override
  State<_Amis> createState() => _AmisState();
}

class _AmisState extends State<_Amis> {
  Map<String, dynamic>? d;
  String? erreur;
  bool ajout = false;
  @override
  void initState() { super.initState(); _dessiner(); }

  Future<void> _dessiner() async {
    try {
      final r = await Future.wait([
        Api.get('/amis'),
        Api.get('/rivaux').catchError((_) => []),
        Api.get('/amis/demandes').catchError((_) => {'recues': [], 'envoyees': []}),
        Api.get('/recents').catchError((_) => []),
      ]);
      final dm = r[2] as Map;
      app.demandesAmi = (dm['recues'] as List).length;
      app.maj();
      if (mounted) setState(() => d = {'amis': r[0], 'rivaux': r[1], 'dm': dm, 'recents': r[3]});
    } catch (e) { if (mounted) setState(() => erreur = messageErreur(e)); }
  }

  void _rouvrir() => ouvrirAmis(retour: widget.retour, garderOnglet: true);

  @override
  Widget build(BuildContext context) {
    final c = Api.compte!['compte'] as Map;
    final ident = '${c['pseudo']}#${c['numero']}';
    final amis = (d?['amis'] as List?)?.cast<Map>() ?? [];
    final dm = d?['dm'] as Map?;
    final recues = (dm?['recues'] as List?)?.cast<Map>() ?? [];
    final envoyees = (dm?['envoyees'] as List?)?.cast<Map>() ?? [];
    final rivaux = (d?['rivaux'] as List?)?.cast<Map>() ?? [];
    final recents = (d?['recents'] as List?)?.cast<Map>();
    final liste = <Widget>[];
    Widget vide(String t) => Padding(padding: const EdgeInsets.all(10), child: Muet(t, align: TextAlign.center));
    if (d == null) {
      liste.add(vide(erreur ?? 'Chargement…'));
    } else if (_ongletAmis == 'amis') {
      if (amis.isEmpty) liste.add(vide("Pas encore d'amis. Ajoute-les avec leur pseudo#numéro, ou invite-les sur WhatsApp."));
      final tries = [...amis]..sort((x, y) => (y['en_ligne'] == true ? 1 : 0) - (x['en_ligne'] == true ? 1 : 0));
      for (final a in tries) {
        final rv = rivaux.where((r) => r['id'] == a['id']).firstOrNull;
        final score = rv != null ? 'Toi ${rv['moi']} – ${rv['lui']} ${a['pseudo']}' : null;
        final enLigne = a['en_ligne'] == true;
        liste.add(ligneListe([
          avatarAmi(a, enLigne),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(TextSpan(children: [TextSpan(text: '${a['pseudo']} ', style: K.texte(15, poids: FontWeight.w700)), TextSpan(text: '#${a['numero']}', style: K.texte(12, couleur: K.muted))])),
              if (enLigne) Text('● En ligne', style: K.texte(12, couleur: K.good)),
              if (enLigne && score != null) Text(score, style: K.texte(12, couleur: K.muted).copyWith(fontStyle: FontStyle.italic)),
              if (!enLigne) Muet([depuisQuand(a['vu_le']), if (score != null) score].where((s) => s.isNotEmpty).join(' · '), taille: 12),
            ]),
          ),
          if (enLigne) Btn.principal('Inviter', marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), onTap: () { app.inviterAmi(a['id'].toString(), a['pseudo'].toString()); app.fermerFenetre(); creer(); }),
          IconButton(icon: const Icon(Icons.more_horiz, color: K.muted), onPressed: () => _plus(a)),
        ], absent: !enLigne));
      }
    } else if (_ongletAmis == 'recents') {
      if (recents == null) liste.add(vide('Chargement…'));
      else if (recents.isEmpty) liste.add(vide("Joue contre d'autres joueurs : ils apparaîtront ici pour que tu puisses les ajouter."));
      for (final p in recents ?? <Map>[]) {
        final res = p['place'] == 1 ? 'Gagné' : p['place'] != null ? '${p['place']}e sur ${p['nbJoueurs']}' : 'Partie quittée';
        liste.add(Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 4),
          child: Row(children: [Expanded(child: Muet('${p['jeu'] == 'inter8' ? 'Inter (8)' : 'Kopo'} · ${depuisQuand(p['fin']).replaceFirst(RegExp('^Vu '), '')}')), Text(res, style: K.texte(13, poids: FontWeight.w700))]),
        ));
        for (final j in (p['joueurs'] as List).cast<Map>()) {
          final score = j['moi'] != null ? 'Toi ${j['moi']} – ${j['lui']} ${j['pseudo']}' : null;
          liste.add(ligneListe([
            avatarAmi(j),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(children: [TextSpan(text: '${j['pseudo']} ', style: K.texte(15, poids: FontWeight.w700)), TextSpan(text: '#${j['numero']}', style: K.texte(12, couleur: K.muted))])),
                Muet(j['ami'] == true ? 'Déjà ton ami' : j['recue'] == true ? 'Veut être ton ami' : score ?? (j['place'] == 1 ? 'A gagné la partie' : ''), taille: 12),
              ]),
            ),
            if (j['ami'] == true) Text('✓ Ami', style: K.texte(13, couleur: K.good, poids: FontWeight.w700))
            else if (j['envoyee'] == true) const Muet('Demande envoyée', taille: 12)
            else Btn.principal(j['recue'] == true ? 'Accepter' : 'Ajouter', marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), onTap: () async {
              try {
                final r = await Api.post('/amis', {'cible': j['id']});
                toastAjoutAmi(r, j['pseudo'] as String?);
                for (final x in recents!) { for (final y in (x['joueurs'] as List).cast<Map>()) { if (y['id'] == j['id']) { if (r is Map && r['etat'] == 'ami') { y['ami'] = true; } else { y['envoyee'] = true; } } } }
                if (r is Map && r['etat'] == 'ami' && j['recue'] == true) { app.demandesAmi = math.max(0, app.demandesAmi - 1); app.maj(); }
                setState(() {});
              } catch (e) { app.toast(messageErreur(e)); }
            }),
          ]));
        }
      }
    } else {
      if (recues.isEmpty && envoyees.isEmpty) liste.add(vide('Aucune demande en attente.'));
      for (final x in recues) {
        liste.add(ligneListe([
          avatarAmi(x),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text.rich(TextSpan(children: [TextSpan(text: '${x['pseudo']} ', style: K.texte(15, poids: FontWeight.w700)), TextSpan(text: '#${x['numero']}', style: K.texte(12, couleur: K.muted))])),
            const Muet('veut être ton ami', taille: 12),
          ])),
          Btn.principal('Accepter', marge: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), onTap: () async { try { await repondreDemande(x['id'].toString(), true); app.toast('${x['pseudo']} est dans tes amis.'); } catch (e) { app.toast(messageErreur(e)); } _dessiner(); }),
          IconButton(icon: const Icon(Icons.close, color: K.muted), tooltip: 'Refuser', onPressed: () async { try { await repondreDemande(x['id'].toString(), false); } catch (e) { app.toast(messageErreur(e)); } _dessiner(); }),
        ]));
      }
      for (final x in envoyees) {
        liste.add(ligneListe([
          avatarAmi(x),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text.rich(TextSpan(children: [TextSpan(text: '${x['pseudo']} ', style: K.texte(15, poids: FontWeight.w700)), TextSpan(text: '#${x['numero']}', style: K.texte(12, couleur: K.muted))])),
            const Muet('Demande envoyée', taille: 12),
          ])),
          IconButton(icon: const Icon(Icons.close, color: K.muted), tooltip: 'Annuler la demande', onPressed: () async { try { await Api.delete('/amis/demandes/${Uri.encodeComponent(x['id'].toString())}'); } catch (e) { app.toast(messageErreur(e)); } _dessiner(); }),
        ], absent: true));
      }
    }

    return Fenetre(titre: 'Amis', onFermer: widget.retour, enfants: [
      Onglets([('amis', amis.isNotEmpty ? 'Amis · ${amis.length}' : 'Amis'), ('demandes', recues.isNotEmpty ? 'Demandes · ${recues.length}' : 'Demandes'), ('recents', 'Récents')], _ongletAmis, (o) => setState(() => _ongletAmis = o)),
      const Ecart(10),
      ...liste,
      if (_ongletAmis == 'recents') const Muet('Les joueurs de tes 5 dernières parties. Les robots ne sont pas affichés.', taille: 12),
      if (ajout) ...[
        const Ecart(8),
        Row(children: [
          Expanded(child: Champ(widget.champ, indice: 'Pseudo#1234', onValider: (_) => _ajouter())),
          const SizedBox(width: 8),
          Btn.principal('Ajouter', onTap: _ajouter),
        ]),
      ],
      const Ecart(10),
      Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0x26000000), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Muet('Ton identifiant', taille: 12), Text(ident, style: K.texte(16, poids: FontWeight.w700))])),
          Btn('Copier', onTap: () => copier(ident, 'Identifiant copié.')),
        ]),
      ),
      const Ecart(8),
      Row(children: [
        Expanded(child: Btn.principal('Ajouter un ami', onTap: () => setState(() => ajout = !ajout))),
        const SizedBox(width: 8),
        Expanded(child: Btn('WhatsApp', icone: 'partager', onTap: () => ouvrirWhatsApp('Viens jouer avec moi sur Masano (Kopo et Inter (8)) ! Ajoute-moi : $ident\n$lienJeu'))),
      ]),
      const Ecart(8),
      Btn('Inviter et gagner des pièces', style: StyleBtn.discret, icone: 'cadeau', large: true, onTap: () => ouvrirParrainage(retour: _rouvrir)),
    ]);
  }

  Future<void> _ajouter() async {
    final v = widget.champ.text.trim();
    if (v.isEmpty) return;
    try { toastAjoutAmi(await Api.post('/amis', {'cible': v})); widget.champ.clear(); setState(() => ajout = false); _dessiner(); } catch (e) { app.toast(messageErreur(e)); }
  }

  void _plus(Map a) {
    app.ouvrirFenetre((context) => Fenetre(titre: a['pseudo'].toString(), enfants: [
          Text('${a['pseudo']}#${a['numero']}', style: K.texte(15)),
          const Ecart(12),
          Btn('Retirer de mes amis', large: true, onTap: () => demanderConfirmation('${a['pseudo']} ne sera plus dans tes amis.', () async {
                try { await Api.delete('/amis/${Uri.encodeComponent(a['id'].toString())}'); } catch (e) { app.toast(messageErreur(e)); }
                _rouvrir();
              }, titre: 'Retirer ${a['pseudo']} ?', oui: 'Retirer', annuler: _rouvrir)),
          const Ecart(8),
          Btn.principal('Retour', large: true, onTap: _rouvrir),
        ]));
  }
}

// ---------------------------------------------------------------- parrainage
String lienParrain(String code) => '${lienJeu.replaceAll(RegExp(r'#.*$'), '')}?parrain=$code';
String _fr(num n) => App.formatPieces(n);

void ouvrirParrainage({VoidCallback? retour}) {
  final champ = TextEditingController();
  app.ouvrirFenetre((context) => Fenetre(titre: 'Inviter des amis', enfants: [
        Charge<Map>(
          charger: () async => (await Api.get('/parrainage') as Map),
          builder: (context, P, recharger) {
            final R0 = P['regles'] as Map;
            final paliers = ((P['paliers'] as List?) ?? []).cast<Map>();
            final prochain = paliers.where((x) => x['atteint'] != true).firstOrNull;
            final filleuls = ((P['filleuls'] as List?) ?? []).cast<Map>();
            String quoi(Map x, String sep) => [if (x['pieces'] != null && x['pieces'] != 0) '${_fr(x['pieces'] as num)} pièces', if (x['objet'] != null) sep == ', ' ? 'une apparence exclusive' : 'apparence', if (x['titre'] != null) sep == ', ' ? 'le titre « ${x['titre']} »' : '« ${x['titre']} »'].join(sep);
            final g = app.config?['google'] as String?;
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (P['actif'] != true) const Muet('Le parrainage est en pause pour le moment.'),
              const Center(child: Ico('cadeau', taille: 40)),
              const Ecart(6),
              Text.rich(TextSpan(style: K.texte(15), children: [
                const TextSpan(text: 'Quand un ami crée son compte avec Google et joue '),
                TextSpan(text: '${R0['parties']} parties', style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(text: " contre d'autres joueurs, tu gagnes "),
                TextSpan(text: '${R0['piecesParrain']} pièces', style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(text: ' et lui '),
                TextSpan(text: '${R0['piecesFilleul']} pièces', style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(text: '.'),
              ])),
              const Ecart(10),
              if (P['lie'] != true) ...[
                const Muet("Connecte-toi avec Google pour avoir ton lien d'invitation."),
                if (g != null) ...[const Ecart(8), Btn.principal('Se connecter avec Google', large: true, onTap: () => connecterGoogle(g))],
              ] else ...[
                Builder(builder: (_) {
                  final lien = lienParrain(P['code'].toString());
                  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: SelectableText(lien, style: K.texte(13, couleur: K.muted))),
                      Btn('Copier', onTap: () => copier(lien, 'Lien copié.')),
                    ]),
                    const Ecart(8),
                    Btn('Inviter sur WhatsApp', icone: 'partager', large: true, onTap: () => ouvrirWhatsApp('Viens jouer avec moi sur Masano (Kopo et Inter (8)) ! Crée ton compte avec ce lien, on gagne des pièces tous les deux :\n$lien')),
                  ]);
                }),
                const Ecart(10),
                Text.rich(TextSpan(style: K.texte(15), children: [
                  TextSpan(text: '${P['amis']} ${(P['amis'] as num) > 1 ? 'amis venus jouer' : 'ami venu jouer'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (P['titre'] != null) ...[const TextSpan(text: ' · titre '), TextSpan(text: '« ${P['titre']} »', style: const TextStyle(fontWeight: FontWeight.w700))],
                ])),
                if (prochain != null) Muet('Prochain palier à ${prochain['n']} amis : ${quoi(prochain, ', ')}.', taille: 12),
                const Ecart(8),
                for (final x in paliers)
                  ligneListe([
                    SizedBox(width: 70, child: Text('${x['n']} amis', style: K.texte(14, poids: FontWeight.w700))),
                    Expanded(child: Text(quoi(x, ' · '), style: K.texte(13))),
                    Text(x['atteint'] == true ? '✓' : '', style: K.texte(14, couleur: K.good)),
                  ]),
                if (R0['parMois'] != null) Muet('Au plus ${R0['parMois']} amis récompensés en pièces par mois (ils comptent tous pour les paliers).', taille: 12),
                if (filleuls.isNotEmpty) ...[
                  const Titre3('Mes invités'),
                  for (final x in filleuls)
                    ligneListe([
                      Expanded(child: Text('${x['pseudo']}#${x['numero']}', style: K.texte(14))),
                      Muet(x['statut'] == 'valide' ? (x['pieces_parrain'] != null && x['pieces_parrain'] != 0 ? '✓ +${x['pieces_parrain']}' : '✓') : x['statut'] == 'expire' ? 'délai passé' : '${x['parties']} / ${R0['parties']} parties', taille: 12),
                    ]),
                ],
              ],
              if (P['parrain'] is Map)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Builder(builder: (_) {
                    final m = P['parrain'] as Map;
                    return Muet(m['statut'] == 'valide' ? 'Invité par ${m['pseudo']} : cadeau reçu.' : m['statut'] == 'expire' ? 'Invité par ${m['pseudo']} : le délai est passé.' : 'Invité par ${m['pseudo']} : ${m['parties']} / ${R0['parties']} parties jouées.');
                  }),
                )
              else if (P['peutEtreParraine'] == true && filleuls.isEmpty) ...[
                const Titre3("Un ami t'a invité ?"),
                Row(children: [
                  Expanded(child: Champ(champ, indice: 'Code de ton ami', max: 6, majuscules: true)),
                  const SizedBox(width: 8),
                  Btn('Valider', onTap: () async {
                    try { final r = await Api.post('/parrainage', {'code': champ.text.trim()}); app.toast("${r['parrain']} t'a invité : joue tes premières parties pour gagner ton cadeau !"); recharger(); } catch (e) { app.toast(messageErreur(e)); }
                  }),
                ]),
              ],
              const Ecart(10),
              const Muet("Les parties contre des robots, abandonnées ou jouées seul avec ton parrain ne comptent pas. Un compte Google ne peut être invité qu'une fois, même après une suppression.", taille: 12),
            ]);
          },
        ),
        const Ecart(10),
        Btn('Fermer', large: true, onTap: retour ?? app.fermerFenetre),
      ]));
}

// ---------------------------------------------------------------- joueurs bloqués
void ouvrirBloques() {
  app.ouvrirFenetre((context) => Fenetre(titre: 'Joueurs bloqués', enfants: [
        Charge<List>(
          charger: () async => await Api.get('/bloques') as List,
          builder: (context, l, recharger) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (l.isEmpty) Text('Personne.', style: K.texte(15)),
            for (final b in l.cast<Map>())
              ligneListe([
                Expanded(child: Text('${b['pseudo']}#${b['numero']}', style: K.texte(15))),
                Btn('Débloquer', onTap: () async {
                  await Api.delete('/bloques/${Uri.encodeComponent(b['id'].toString())}').catchError((_) => null);
                  app.bloques.remove(b['id'].toString());
                  Stock.ecrire('kopo-bloques', app.bloques.toList());
                  recharger();
                }),
              ]),
          ]),
        ),
        const Ecart(10),
        Btn('Fermer', large: true, onTap: ouvrirParametres),
      ]));
}

// ---------------------------------------------------------------- notifications de l'accueil
void montrerNotification(Map a) {
  final d = (a['donnees'] as Map?) ?? const {};
  void suite() { app.fermerFenetre(); Future.delayed(const Duration(milliseconds: 400), app.lireNotifications); }
  Widget fermer([String t = 'OK']) => Btn(t, large: true, onTap: suite);
  Future<void> couper(String cle, String message) async {
    try { await Api.patch('/moi', {'notifs': {cle: false}}); app.toast(message); } catch (e) { app.toast(messageErreur(e)); }
    app.fermerFenetre();
  }
  void relireSolde() => Api.get('/moi').then((m) => app.soldeServeur(m['compte']['solde'])).catchError((_) => null);
  String icone;
  final contenu = <Widget>[];
  final boutons = <Widget>[];
  Widget titre(String t) => Text(t, textAlign: TextAlign.center, style: K.titre(30));
  switch (a['type']) {
    case 'invitation':
      icone = 'rejoindre';
      contenu.addAll([titre(a['texte'].toString()), Text('${d['code']}', textAlign: TextAlign.center, style: K.titre(64, couleur: Colors.white).copyWith(letterSpacing: 10))]);
      boutons.addAll([Btn.principal('Rejoindre', large: true, onTap: () => app.rejoindreCode(d['code'].toString())), fermer('Pas maintenant')]);
    case 'rivalite':
      icone = 'revanche';
      contenu.addAll([
        titre('Rivalité'),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text('Toi', style: K.texte(15)), const SizedBox(width: 10), Text('${d['toi']} – ${d['lui']}', style: K.titre(30, couleur: Colors.white)), const SizedBox(width: 10), Text('${d['pseudo'] ?? '?'}', style: K.texte(15))]),
        Text(a['texte'].toString(), textAlign: TextAlign.center, style: K.texte(15)),
        const Muet("Retrouve-le en ligne pour reprendre l'avantage !", align: TextAlign.center),
      ]);
      boutons.addAll([fermer('À moi de jouer !'), Btn('Ne plus recevoir les rivalités', large: true, onTap: () => couper('rivalite', 'Notifications de rivalité coupées.'))]);
    case 'parrainage':
      icone = 'cadeau';
      contenu.addAll([titre('Parrainage'), Text(a['texte'].toString(), textAlign: TextAlign.center, style: K.texte(15)), if (d['titre'] != null) Text('« ${d['titre']} »', textAlign: TextAlign.center, style: K.texte(16, couleur: K.brass, poids: FontWeight.w700))]);
      relireSolde();
      boutons.addAll([Btn.principal("Inviter d'autres amis", large: true, onTap: () => ouvrirParrainage()), fermer()]);
    case 'bande':
      icone = 'bande';
      contenu.addAll([titre('La Bande'), Text(a['texte'].toString(), textAlign: TextAlign.center, style: K.texte(15))]);
      if (d['rappel'] == true) {
        boutons.addAll([
          Btn.principal('Jouer mon Match du jour', large: true, onTap: () { app.fermerFenetre(); ouvrirMatchJour(); }),
          fermer('Plus tard'),
          Btn('Ne plus recevoir ces rappels', large: true, onTap: () => couper('bande', 'Rappels coupés.')),
        ]);
      } else {
        relireSolde();
        if (d['bande'] != null) boutons.add(Btn.principal('Voir la Bande', large: true, onTap: () { app.fermerFenetre(); ouvrirBande(id: d['bande'].toString()); }));
        boutons.add(fermer());
      }
    case 'ami':
      icone = 'creer';
      contenu.add(titre(a['texte'].toString()));
      if (d['demande'] != null && d['demande'] != false) {
        contenu.addAll([Text('${d['pseudo']}#${d['numero']}', textAlign: TextAlign.center, style: K.texte(15)), const Muet('Vous pourrez vous inviter à vos tables et vous comparer dans la ligue.', align: TextAlign.center)]);
        boutons.addAll([
          Btn.principal('Accepter', large: true, onTap: () async { try { await repondreDemande(d['de'].toString(), true); app.toast('${d['pseudo']} est dans tes amis.'); } catch (e) { app.toast(messageErreur(e)); } suite(); }),
          Btn('Refuser', large: true, onTap: () async { try { await repondreDemande(d['de'].toString(), false); app.toast('Demande refusée.'); } catch (e) { app.toast(messageErreur(e)); } suite(); }),
          fermer('Plus tard'),
        ]);
      } else if (d['accepte'] != null && d['accepte'] != false) {
        contenu.add(const Muet("Invite-le à ta table depuis le salon d'une partie.", align: TextAlign.center));
        boutons.add(fermer());
      } else {
        boutons.addAll([
          Btn.principal("L'ajouter aussi", large: true, onTap: () async { try { toastAjoutAmi(await Api.post('/amis', {'cible': '${d['pseudo']}#${d['numero']}'}), d['pseudo'] as String?); } catch (e) { app.toast(messageErreur(e)); } suite(); }),
          fermer('Plus tard'),
        ]);
      }
    default:
      return;
  }
  app.ouvrirFenetre((context) => Fenetre(enfants: [
        Center(child: Ico(icone, taille: 44)),
        const Ecart(8),
        ...contenu.expand((w) => [w, const Ecart(6)]),
        const Ecart(8),
        ...boutons.expand((w) => [w, const Ecart(8)]),
      ]), 'notification');
}
