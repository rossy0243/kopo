// Petits morceaux partagés par les fenêtres : confirmation, Google, partage, pièce, listes.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../commun/apparences.dart';
import '../commun/cartes.dart';
import '../commun/retention.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../reseau/google.dart';

const lienSite = 'https://kopo-d655.onrender.com/';
String get lienJeu => (app.config?['liens'] is Map ? app.config!['liens']['site'] as String? : null) ?? lienSite;
String lienPartie(String code) => '${lienJeu.replaceAll(RegExp(r'#.*$'), '')}#$code';

const nomsPartage = {
  'kopo': (nom: 'Kopo', au: 'au Kopo', de: 'de Kopo'),
  'inter8': (nom: 'Inter (8)', au: 'à Inter (8)', de: "d'Inter (8)"),
};
({String nom, String au, String de}) jeuPartage(String? jeu) => nomsPartage[jeu] ?? nomsPartage['kopo']!;

Future<void> ouvrirWhatsApp(String texte) async {
  final u = Uri.parse('https://wa.me/?text=${Uri.encodeComponent(texte)}');
  if (!await launchUrl(u, mode: LaunchMode.externalApplication)) {
    await SharePlus.instance.share(ShareParams(text: texte));
  }
}
Future<void> ouvrirLien(String url) => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
Future<void> copier(String texte, [String message = 'Copié.']) async {
  await Clipboard.setData(ClipboardData(text: texte));
  app.toast(message);
}

void connecterGoogle([String? supabase]) {
  final s = supabase ?? app.config?['google'] as String?;
  if (s == null) { app.toast('La connexion Google arrive très bientôt.'); return; }
  Google.connecter(s);
}

/// Bouton « Continuer avec Google », comme sur le site.
class BoutonGoogle extends StatelessWidget {
  final VoidCallback onTap;
  final String texte;
  const BoutonGoogle({super.key, required this.onTap, this.texte = 'Continuer avec Google'});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              SvgPicture.string('<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>', width: 20, height: 20),
              const SizedBox(width: 10),
              Text(texte, style: K.texte(15, couleur: const Color(0xFF1F1F1F), poids: FontWeight.w600)),
            ]),
          ),
        ),
      );
}

/// Pièce « M » dorée.
class Piece extends StatelessWidget {
  final double taille;
  const Piece({super.key, this.taille = 30});
  @override
  Widget build(BuildContext context) => Container(
        width: taille,
        height: taille,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(center: Alignment(-.3, -.4), radius: .8, colors: [Color(0xFFF8E3A6), K.brass, Color(0xFFA87B26)], stops: [0, .55, 1]),
          boxShadow: [BoxShadow(color: Color(0x66000000), blurRadius: 5, offset: Offset(0, 2))],
        ),
        child: Text('M', style: TextStyle(fontFamily: K.display, fontSize: taille * .57, height: 1, color: const Color(0xFF6B4F12))),
      );
}

Widget recompense(int n, {double taille = 15}) => Row(mainAxisSize: MainAxisSize.min, children: [
      Text('+$n', style: K.texte(taille, couleur: K.brass, poids: FontWeight.w700)),
      const SizedBox(width: 4),
      Piece(taille: taille + 3),
    ]);

/// Aperçu d'un objet de la collection (avatar, cadre ou dos).
Widget apercuObjet(String id, {double taille = 36}) {
  final o = R.objets[id];
  if (o?['type'] == 'dos') return DosCarte(l: taille * .72, h: taille * 1.05, dos: id, rayon: 4);
  return Avatar(app.pseudo.isEmpty ? '?' : app.pseudo, avatar: o?['type'] == 'cadre' ? 'av-laiton' : id, cadre: o?['type'] == 'cadre' ? id : null, taille: taille);
}

/// Fenêtre « Oui / Annuler ».
void demanderConfirmation(String texte, VoidCallback ok, {String titre = 'Quitter ?', String oui = 'Oui, quitter', VoidCallback? annuler}) {
  app.ouvrirFenetre((context) => Fenetre(titre: titre, enfants: [
        Text(texte, style: K.texte(16)),
        const Ecart(16),
        Btn.principal(oui, large: true, onTap: () { app.fermerFenetre(); ok(); }),
        const Ecart(8),
        Btn('Annuler', large: true, onTap: () { app.fermerFenetre(); annuler?.call(); }),
      ]), 'confirmation');
}

void demanderQuitter() {
  final v = app.vue;
  if (app.ecran == 'connexion') { app.quitter(); return; }
  demanderConfirmation(v != null && v['etat'] == 'manche' ? 'Tu ne pourras pas revenir dans cette partie avec un autre code.' : 'Tu quittes la partie.', () => app.quitter());
}

/// Fenêtre Google : on explique pourquoi, et on propose de se connecter.
void fenetreGoogle(String titre, String texte, {List<Widget> Function(BuildContext)? extra}) {
  app.ouvrirFenetre((context) {
    final g = app.config?['google'] as String?;
    return Fenetre(enfants: [
      const Center(child: Ico('cadenas', taille: 40)),
      const Ecart(8),
      Text(titre, textAlign: TextAlign.center, style: K.titre(32)),
      const Ecart(8),
      Text(texte, textAlign: TextAlign.center, style: K.texte(15)),
      const Ecart(14),
      if (g != null) Btn.principal('Se connecter avec Google', large: true, onTap: () => connecterGoogle(g))
      else const Muet('La connexion Google arrive très bientôt.', align: TextAlign.center),
      const Ecart(8),
      ...?extra?.call(context).expand((w) => [w, const Ecart(8)]),
      Btn('Plus tard', large: true, onTap: app.fermerFenetre),
    ]);
  });
}

/// Liste en colonne avec des espaces réguliers.
class Colonne extends StatelessWidget {
  final List<Widget> enfants;
  final double ecart;
  const Colonne(this.enfants, {super.key, this.ecart = 8});
  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (var i = 0; i < enfants.length; i++) ...[if (i > 0) SizedBox(height: ecart), enfants[i]],
      ]);
}

/// Sous-titre de section (h3 du site).
class Titre3 extends StatelessWidget {
  final String texte;
  final String? sous;
  const Titre3(this.texte, {super.key, this.sous});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10, bottom: 4),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: texte.toUpperCase(), style: K.texte(13, couleur: K.brass, poids: FontWeight.w700).copyWith(letterSpacing: 1.5)),
          if (sous != null) TextSpan(text: '  $sous', style: K.texte(12, couleur: K.muted)),
        ])),
      );
}

/// Onglets (Amis / Pays / Monde…).
class Onglets extends StatelessWidget {
  final List<(String, String)> options;
  final String actif;
  final ValueChanged<String> onChange;
  const Onglets(this.options, this.actif, this.onChange, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: const Color(0x40000000), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          for (final (v, t) in options)
            Expanded(
              child: GestureDetector(
                onTap: () => onChange(v),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(color: v == actif ? K.brass : Colors.transparent, borderRadius: BorderRadius.circular(9)),
                  alignment: Alignment.center,
                  child: Text(t, style: K.texte(14, couleur: v == actif ? K.encre : K.muted, poids: FontWeight.w600)),
                ),
              ),
            ),
        ]),
      );
}

/// Ligne de classement (rang, nom, points).
class LigneClassement extends StatelessWidget {
  final String rang, nom, pts;
  final bool moi;
  final Color? couleur;
  const LigneClassement(this.rang, this.nom, this.pts, {super.key, this.moi = false, this.couleur});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(color: moi ? const Color(0x2EE2B04A) : const Color(0x0FFFFFFF), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          SizedBox(width: 30, child: Text(rang, style: K.texte(14, couleur: K.muted, poids: FontWeight.w700))),
          if (couleur != null) Container(width: 8, height: 8, margin: const EdgeInsets.only(right: 8), decoration: BoxDecoration(color: couleur, shape: BoxShape.circle)),
          Expanded(child: Text(nom, overflow: TextOverflow.ellipsis, style: K.texte(14, poids: moi ? FontWeight.w700 : FontWeight.w400))),
          Text(pts, style: K.texte(14, couleur: K.brass, poids: FontWeight.w700)),
        ]),
      );
}

String place(int n) => n == 1 ? '1er' : '${n}e';
