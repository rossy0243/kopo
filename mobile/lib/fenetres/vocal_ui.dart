// Micro des abonnés Kopo+ dans l'appli : boutons de l'en-tête, qui parle (pseudo ou initiale), couronne dorée,
// et la fenêtre « Le micro en partie » (prix en francs congolais). Comme sur le site (src/source.html).
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../commun/icones_data.dart';
import '../commun/theme.dart';
import '../commun/vocal.dart';
import '../etat.dart';
import '../reseau/api.dart';
import 'communes.dart';

/// Couronne dorée des abonnés Kopo+ (pleine, pour la distinguer des icônes au trait).
class CouronnePlus extends StatelessWidget {
  final double taille;
  final Color couleur;
  const CouronnePlus({super.key, this.taille = 14, this.couleur = K.brass});
  @override
  Widget build(BuildContext context) {
    final c = '#${(couleur.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    final svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="$c" stroke="$c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${iconesSvg['couronne']}</svg>';
    return Semantics(label: 'Abonné Kopo+', child: SvgPicture.string(svg, width: taille, height: taille));
  }
}

/// Boutons du micro dans l'en-tête (salon et partie). Un non-abonné voit le micro avec un « + » :
/// le toucher ouvre l'invitation à s'abonner (réponse du serveur).
class BoutonsMicro extends StatelessWidget {
  final Map v;
  const BoutonsMicro(this.v, {super.key});
  @override
  Widget build(BuildContext context) {
    if (!app.microDispo) return const SizedBox.shrink();
    final vo = app.vocal;
    final moi = (v['joueurs'] as List).cast<Map>().firstWhere((j) => j['id'] == v['moi'], orElse: () => {});
    if (!vo.actif) {
      final plus = moi['plus'] == true;
      return IconButton(
        onPressed: vo.demande ? null : vo.activer,
        tooltip: plus ? 'Activer le micro pour parler avec les abonnés de la table' : 'Micro réservé aux abonnés Kopo+',
        icon: Opacity(opacity: plus ? 1 : .75, child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Ico('micro', taille: 22),
          if (!plus) Text('+', style: K.texte(15, couleur: K.brass, poids: FontWeight.w800)),
        ])),
      );
    }
    final n = (v['joueurs'] as List).cast<Map>().where((j) => j['voix'] == true && j['id'] != v['moi']).length;
    final enVocal = n > 0 ? ' ($n autre${n > 1 ? 's' : ''} abonné${n > 1 ? 's' : ''} en vocal)' : ' (aucun autre abonné en vocal)';
    final etroit = MediaQuery.of(context).size.width < 380;
    Widget rond(String icone, Color c, String aide, VoidCallback f) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Tooltip(message: aide, child: Semantics(button: true, label: aide, child: InkWell(
            onTap: f,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(color: c.withValues(alpha: .16), border: Border.all(color: c), borderRadius: BorderRadius.circular(10)),
              child: Ico(icone, taille: 20, couleur: c),
            ),
          ))),
        );
    return Row(mainAxisSize: MainAxisSize.min, children: [
      rond(vo.muet ? 'micro-coupe' : 'micro', vo.muet ? K.bad : K.good,
          (!vo.parler ? 'Micro coupé par la modération' : vo.muet ? 'Micro coupé, toucher pour parler' : 'Micro ouvert, toucher pour couper') + enVocal, vo.basculerMicro),
      // Téléphone étroit : le son des autres se coupe dans les Paramètres, pour garder la place.
      if (!etroit) rond(vo.sonCoupe ? 'son-coupe' : 'son', vo.sonCoupe ? K.bad : K.brass, vo.sonCoupe ? 'Son des autres coupé, toucher pour le remettre' : 'Couper le son des autres', vo.basculerSon),
    ]);
  }
}

/// Qui parle : le pseudo s'il tient sur la largeur, sinon l'initiale dans une pastille verte.
class BandeauParleurs extends StatelessWidget {
  final Map v;
  const BandeauParleurs(this.v, {super.key});
  @override
  Widget build(BuildContext context) {
    final joueurs = (v['joueurs'] as List).cast<Map>();
    final ids = app.vocal.parleurs.where((id) => joueurs.any((j) => j['id'] == id)).toList();
    if (ids.isEmpty) return const SizedBox.shrink();
    String nom(String id) => id == v['moi'] ? 'Toi' : (joueurs.firstWhere((j) => j['id'] == id)['nom'] ?? '?').toString();
    final style = K.texte(13, poids: FontWeight.w600);
    return LayoutBuilder(builder: (context, c) {
      final max = (c.maxWidth.isFinite ? c.maxWidth : MediaQuery.of(context).size.width) - 32;
      final texte = ids.map(nom).join('  ·  ');
      final tp = TextPainter(text: TextSpan(text: texte, style: style), textDirection: TextDirection.ltr, maxLines: 1)..layout();
      final court = tp.width + 40 > max; // pas la place : les initiales
      return Center(child: Semantics(
        liveRegion: true,
        label: ids.map(nom).join(', ') + (ids.length > 1 ? ' parlent' : ' parle'),
        child: Container(
          constraints: BoxConstraints(maxWidth: max),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(color: const Color(0xF00F1928), border: Border.all(color: K.good), borderRadius: BorderRadius.circular(99)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Ico('micro', taille: 15, couleur: K.good),
            const SizedBox(width: 6),
            if (!court) Flexible(child: Text(texte, style: style, maxLines: 1, overflow: TextOverflow.ellipsis))
            else for (final id in ids) Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Container(
                width: 22, height: 22, alignment: Alignment.center,
                decoration: const BoxDecoration(color: K.good, shape: BoxShape.circle),
                child: Text(initiale(nom(id)), style: K.texte(12, couleur: const Color(0xFF10251A), poids: FontWeight.w800)),
              ),
            ),
          ]),
        ),
      ));
    });
  }
}

/// Pseudo d'un siège : entier s'il tient, sinon son initiale (le pseudo entier reste lu par le lecteur d'écran).
class NomOuInitiale extends StatelessWidget {
  final String nom;
  final TextStyle style;
  const NomOuInitiale(this.nom, {super.key, required this.style});
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final tp = TextPainter(text: TextSpan(text: nom, style: style), textDirection: TextDirection.ltr, maxLines: 1)..layout();
        final court = c.maxWidth.isFinite && tp.width > c.maxWidth && c.maxWidth < style.fontSize! * 3.6; // « Ma… » ne dit rien : « M »
        return Semantics(label: nom, excludeSemantics: true, child: Text(court ? initiale(nom) : nom, maxLines: 1, overflow: TextOverflow.ellipsis, style: style));
      });
}

// ------------------------------------------------------------------ abonnement Kopo+

const _offreParDefaut = {
  'actif': false, 'paiement': false,
  'formules': [
    {'id': 'mois', 'nom': '1 mois', 'francs': 2500, 'jours': 30, 'note': null},
    {'id': 'an', 'nom': '1 an', 'francs': 25000, 'jours': 365, 'note': '2 mois offerts'},
  ],
  'avantages': ['Parle et entends les autres abonnés de ta table', 'Couronne dorée à côté de ton pseudo', 'Voie Kopo+ du parcours de saison (apparences en plus)'],
};

/// Ouvre la fenêtre Kopo+ : l'offre reçue de la salle (non-abonné qui touche le micro), sinon celle du serveur.
/// annonce : « Nouveau : le micro en partie », à l'entrée d'une table (voir App.annoncerMicro).
Future<void> ouvrirAbonnement([Map? offre, bool annonce = false]) async {
  Map A = offre ?? _offreParDefaut;
  if (offre == null || !offre.containsKey('actif')) {
    try { if (app.enLigne) A = await Api.get('/abonnement') as Map; } catch (_) {}
  }
  if (annonce && (app.vue == null || app.fenetre != null)) return;
  app.ouvrirFenetre((context) => fenetreAbonnement(A, annonce: annonce), annonce ? 'annonce-micro' : 'boutique');
}

bool _essaiEnvoi = false;
/// Essai de bienvenue : 7 jours de Kopo+, une fois par compte Google. Le micro s'ouvre tout de suite si on est à une table.
Future<void> lancerEssai() async {
  if (_essaiEnvoi) return;
  _essaiEnvoi = true;
  try {
    final r = await Api.post('/abonnement/essai') as Map;
    app.fermerFenetre();
    app.toast("Essai Kopo+ lancé : micro et couronne jusqu'au ${_date(r['jusqu'].toString(), annee: false)}.", Niv.succes);
    if (app.microDispo) Future.delayed(const Duration(milliseconds: 600), app.vocal.activer);
  } catch (e) {
    app.toast(e is ErreurApi ? e.message : 'Essai impossible pour l\'instant.', Niv.echec);
  } finally {
    _essaiEnvoi = false;
  }
}

String _date(String iso, {bool annee = true}) {
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  final d = DateTime.tryParse(iso)?.toLocal();
  return d == null ? '' : '${d.day} ${mois[d.month - 1]}${annee ? ' ${d.year}' : ''}';
}

/// La fenêtre elle-même (séparée pour les captures d'écran).
Widget fenetreAbonnement(Map A, {bool annonce = false}) {
  final actif = A['actif'] == true;
  final formules = ((A['formules'] as List?) ?? const []).cast<Map>();
  final avantages = ((A['avantages'] as List?) ?? const []).map((e) => e.toString()).toList();
  final essai = !actif && A['essai'] is Map ? A['essai'] as Map : null;
  final jours = essai?['jours'] ?? 7;
  Widget formule(Map f) {
    final top = f['id'] == 'an';
    return Expanded(child: Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
      child: Semantics(
        button: true,
        label: 'Kopo+ ${f['nom']} : ${f['francs']} francs congolais',
        child: GestureDetector(
          onTap: () => app.toast('Kopo+ ${f['nom']} : le paiement mobile money arrive bientôt.', Niv.alerte),
          child: Stack(clipBehavior: Clip.none, alignment: Alignment.topCenter, children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(8, 14, 8, 10),
              decoration: BoxDecoration(color: top ? const Color(0x1AE2B04A) : const Color(0x0AFFFFFF), borderRadius: BorderRadius.circular(14), border: Border.all(color: top ? K.brass : K.line)),
              child: Column(children: [
                Text('${f['nom']}'.toUpperCase(), style: K.texte(11, couleur: K.muted).copyWith(letterSpacing: 1.2)),
                FittedBox(child: Text('${App.formatPieces(f['francs'] as num)} FC', style: K.titre(24))),
              ]),
            ),
            if (f['note'] != null)
              Positioned(top: -9, child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(color: K.brass, borderRadius: BorderRadius.circular(6)),
                child: Text('${f['note']}'.toUpperCase(), style: K.texte(10.5, couleur: K.encre, poids: FontWeight.w700)),
              )),
          ]),
        ),
      ),
    ));
  }
  const icones = ['micro', 'couronne', 'cadeau'];
  return Fenetre(titre: actif ? 'Ton abonnement' : annonce ? 'Nouveau : le micro en partie' : 'Le micro en partie', enfants: [
    Row(mainAxisAlignment: MainAxisAlignment.center, children: [const CouronnePlus(taille: 28), const SizedBox(width: 8), Text('KOPO+', style: K.titre(28))]),
    const Ecart(6),
    if (actif && A['jusqu'] != null)
      Text("${A['essai'] is Map && A['essai']['enCours'] == true ? 'Ton essai gratuit court' : 'Tu es abonné'} jusqu'au ${_date(A['jusqu'].toString())}.", textAlign: TextAlign.center, style: K.texte(14, couleur: K.good, poids: FontWeight.w600))
    else if (annonce)
      const Muet("Tu peux maintenant parler avec les autres joueurs de ta table pendant la partie. Le micro est réservé aux abonnés Kopo+ : seuls les abonnés parlent et s'entendent.", taille: 13)
    else
      const Muet("Le micro en partie est réservé aux abonnés : à la table, seuls les abonnés parlent et s'entendent.", taille: 13),
    const Ecart(8),
    for (final (i, a) in avantages.indexed)
      Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Ico(i < icones.length ? icones[i] : 'cadeau', taille: 18), const SizedBox(width: 8), Expanded(child: Text(a, style: K.texte(14)))])),
    if (essai != null && essai['possible'] == true) ...[
      const Ecart(6),
      Btn.principal('Essayer $jours jours gratuits', large: true, onTap: lancerEssai),
      const Ecart(4),
      Muet("Sans engagement : après $jours jours, le micro s'arrête tout seul. Ou abonne-toi :", taille: 12),
    ] else if (essai != null && essai['raison'] == 'google') ...[
      const Ecart(6),
      Muet('Essai gratuit de $jours jours avec un compte Google.', taille: 13),
      const Ecart(4),
      Btn('Se connecter avec Google', large: true, onTap: () { app.fermerFenetre(); connecterGoogle(); }),
    ],
    Row(children: [for (final f in formules) formule(f)]),
    const Ecart(10),
    Muet(A['paiement'] == true ? 'Paiement en francs congolais par mobile money.' : "Paiement en francs congolais (mobile money : M-Pesa, Orange Money, Airtel Money) : bientôt. Kopo+ ne donne jamais d'avantage pour gagner.", taille: 12),
    const Ecart(10),
    if (essai != null && essai['possible'] == true)
      Btn(annonce ? 'Plus tard' : 'Fermer', large: true, onTap: app.fermerFenetre)
    else
      Btn.principal(annonce ? 'Plus tard' : 'Fermer', large: true, onTap: app.fermerFenetre),
  ]);
}
