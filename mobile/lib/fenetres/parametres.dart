// Paramètres : son et vibrations, jeu, affichage, notifications, compte (pseudo, Google, amis, bloqués), aide.
import 'package:flutter/material.dart';

import '../commun/sons.dart';
import '../commun/stock.dart';
import '../commun/theme.dart';
import '../etat.dart';
import '../reseau/api.dart';
import '../reseau/push.dart';
import 'communes.dart';
import 'progres.dart' show ouvrirTutoriel;
import 'social.dart';

List<String> _changementsPseudo() {
  final an = DateTime.now().subtract(const Duration(days: 365));
  return ((Stock.lire('kopo-pseudo-changements') as List?) ?? []).map((e) => e.toString()).where((d) => (DateTime.tryParse(d) ?? DateTime(2000)).isAfter(an)).toList()..sort();
}
Map<String, dynamic> _quotaLocal() {
  final l = _changementsPseudo();
  final r = (2 - l.length).clamp(0, 2);
  return {'restants': r, 'prochain': r > 0 ? null : DateTime.parse(l[l.length - 2]).add(const Duration(days: 365)).toIso8601String()};
}
const _mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

void ouvrirParametres() => app.ouvrirFenetre((context) => const _Parametres(), 'parametres');

class _Parametres extends StatefulWidget {
  const _Parametres();
  @override
  State<_Parametres> createState() => _ParametresState();
}

class _ParametresState extends State<_Parametres> {
  late final pseudo = TextEditingController(text: app.pseudo);
  Map<String, dynamic> quota = _quotaLocal();
  bool? lie;
  Map? etatPush;
  bool pushIci = Push.actif;
  final focus = FocusNode();

  @override
  void initState() {
    super.initState();
    if (app.enLigne) {
      Api.get('/moi').then((m) { if (!mounted) return; setState(() { if (m['quotaPseudo'] is Map) quota = (m['quotaPseudo'] as Map).cast<String, dynamic>(); lie = m['lie'] == true; }); }).catchError((_) => null);
      Api.get('/push').then((e) { if (mounted) setState(() => etatPush = e as Map); }).catchError((_) => null);
    }
    focus.addListener(() { if (!focus.hasFocus) _validerPseudo(); });
  }

  @override
  void dispose() { focus.dispose(); super.dispose(); }

  void _bascule(String cle, [VoidCallback? apres]) { app.prefs[cle] = !(app.prefs[cle] == true); app.enregistrerPrefs(); apres?.call(); setState(() {}); }

  void _validerPseudo() {
    final avant = app.pseudo;
    final p = App.nettoyerPseudo(pseudo.text);
    pseudo.text = p;
    if (p == avant) return;
    if (p.length < 3) { app.toast('Le pseudo fait au moins 3 caractères, en un seul mot.'); pseudo.text = avant; return; }
    final restants = quota['restants'] as int? ?? 2;
    demanderConfirmation('Ton pseudo deviendra « $p ». ${restants > 1 ? 'Il te restera 1 changement cette année.' : 'Ce sera ton dernier changement pour un an.'}', () async {
      final c = Api.compte;
      if (c != null) {
        try {
          final j = await Api.patch('/moi', {'pseudo': p});
          c['compte'] = j['compte'];
          Stock.ecrire('kopo-compte-serveur', c);
        } catch (e) { app.toast(messageErreur(e)); ouvrirParametres(); return; }
      }
      Stock.ecrire('kopo-pseudo-changements', [..._changementsPseudo(), DateTime.now().toIso8601String()]);
      Stock.ecrire('kopo-pseudo', p);
      app.toast('Pseudo enregistré.');
      ouvrirParametres();
    }, titre: 'Changer de pseudo ?', oui: 'Changer', annuler: ouvrirParametres);
  }

  @override
  Widget build(BuildContext context) {
    final pr = app.prefs;
    Widget choix(String texte, String? aide, List<(String, String)> options, String actuel, ValueChanged<String> f) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(texte, style: K.texte(15)),
            if (aide != null) Muet(aide, taille: 12),
            const SizedBox(height: 6),
            Choix(options, actuel, f),
          ]),
        );
    final c = app.compte;
    final restants = quota['restants'] as int? ?? 2;
    final prochain = quota['prochain'] != null ? DateTime.tryParse(quota['prochain'].toString()) : null;
    final g = app.config?['google'] as String?;
    final prefsPush = (etatPush?['prefs'] as Map?) ?? {};
    return Fenetre(titre: 'Paramètres', onFermer: app.fermerFenetre, enfants: [
      const Titre3('Son et vibrations'),
      Bascule('Effets sonores', pr['effetsSonores'] == true, (_) => _bascule('effetsSonores', () => Sons.jouer('essai')), aide: 'Cartes, tour, Katapss, chat'),
      Bascule("Musique d'ambiance", pr['musique'] == true, (_) => _bascule('musique'), aide: 'Douce, en fond'),
      Bascule('Vibrations', pr['vibrations'] == true, (_) => _bascule('vibrations', () => app.vibrer(60)), aide: "Quand c'est à toi de jouer"),
      const Titre3('Jeu'),
      choix('Ranger ma main', null, const [('couleur', 'Par couleur'), ('valeur', 'Par valeur')], pr['tri'] == 'valeur' ? 'valeur' : 'couleur', (v) { pr['tri'] = v; app.enregistrerPrefs(); setState(() {}); }),
      Bascule('Confirmer avant « Tout poser »', pr['confirmerToutPoser'] == true, (_) => _bascule('confirmerToutPoser'), aide: 'Évite de sortir par erreur'),
      const Titre3('Affichage'),
      choix('Animations', 'Réduites : plus rapide, moins de batterie', const [('normales', 'Normales'), ('reduites', 'Réduites')], pr['animations'] == 'reduites' ? 'reduites' : 'normales', (v) { pr['animations'] = v; app.enregistrerPrefs(); setState(() {}); }),
      Bascule('Cartes à 4 couleurs', pr['quatreCouleurs'] == true, (_) => _bascule('quatreCouleurs'), aide: 'Pique noir, cœur rouge, carreau bleu, trèfle vert'),
      if (app.enLigne) ...[
        const Titre3('Notifications'),
        if (!app.avecGoogle) const Muet('Connecte-toi avec Google pour être prévenu des invitations de tes amis.')
        else if (etatPush == null) const Muet('Chargement…')
        else if (etatPush!['actif'] != true) const Muet('Bientôt disponibles.')
        else ...[
          Bascule('Sur ce téléphone', pushIci, (v) async {
            try { v ? await Push.activer() : await Push.couper(); setState(() => pushIci = v); } catch (e) { app.toast(e.toString().replaceFirst('Exception: ', '')); }
          }, aide: 'Même quand Masano est fermé'),
          for (final (t, texte, aide) in const [('invitation', 'Invitations', "Un ami t'invite à sa table"), ('ami', "Demandes d'ami", 'Reçues et acceptées'), ('match', 'Rappel du Match du jour', "À 19 h, si tu ne l'as pas joué"), ('annonce', 'Annonces de Masano', 'Tournois, nouveautés')])
            Bascule(texte, prefsPush[t] != false, (v) async {
              try { final r = await Api.patch('/push/prefs', {t: v}); setState(() => etatPush = {...etatPush!, 'prefs': r['prefs']}); } catch (e) { app.toast(messageErreur(e)); }
            }, aide: aide),
        ],
      ],
      const Titre3('Compte'),
      Text('Pseudo', style: K.texte(15)),
      const SizedBox(height: 4),
      Focus(
        focusNode: focus,
        child: TextField(
          controller: pseudo,
          enabled: restants > 0,
          maxLength: 16,
          style: K.texte(16),
          onChanged: (v) { final n = App.nettoyerPseudo(v, true); if (n != v) pseudo.value = TextEditingValue(text: n, selection: TextSelection.collapsed(offset: n.length)); },
          onSubmitted: (_) => _validerPseudo(),
          decoration: InputDecoration(
            hintText: 'Ex. As_de_Pique', counterText: '', filled: true, fillColor: const Color(0x590B1828),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: K.line)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: K.brass)),
          ),
        ),
      ),
      Muet(restants > 0 ? 'Tu peux encore le changer $restants fois cette année.' : 'Déjà changé 2 fois cette année. Prochain changement le ${prochain != null ? '${prochain.day} ${_mois[prochain.month - 1]} ${prochain.year}' : '?'}.', taille: 12),
      if (c != null) ...[
        const Ecart(10),
        Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Ton identifiant', style: K.texte(15)), const Muet('À donner à tes amis', taille: 12)])),
          Text('${c['pseudo']}#${c['numero']}', style: K.texte(15, poids: FontWeight.w700)),
        ]),
        const Ecart(8),
        Row(children: [
          Expanded(child: Btn(app.demandesAmi > 0 ? 'Mes amis (${app.demandesAmi})' : 'Mes amis', onTap: () => ouvrirAmis(retour: ouvrirParametres))),
          const SizedBox(width: 8),
          Expanded(child: Btn('Joueurs bloqués', onTap: ouvrirBloques)),
        ]),
      ],
      const Ecart(10),
      if (g == null)
        Opacity(opacity: .6, child: Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Connexion Google', style: K.texte(15)), const Muet('Bientôt : pour garder tes pièces sur tous tes téléphones', taille: 12)])), const Ico('cadenas', taille: 22)]))
      else if (lie == true || app.avecGoogle)
        Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Connecté avec Google', style: K.texte(15)), const Muet('Ton compte te suit sur tous tes téléphones', taille: 12)])), Text('✓', style: K.texte(18, couleur: K.good, poids: FontWeight.w700))])
      else
        Row(children: [Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Connexion Google', style: K.texte(15)), const Muet('Garde ton compte et tes pièces si tu changes de téléphone', taille: 12)])), Btn.principal('Se connecter', onTap: () => connecterGoogle(g))]),
      const Ecart(10),
      Btn('Supprimer mon compte', large: true, onTap: () => demanderConfirmation("Ton pseudo, tes pièces d'essai, tes statistiques et tes réglages seront effacés de ce téléphone. C'est définitif.", () async {
            if (app.enLigne) await Api.delete('/moi').catchError((_) => null);
            await Stock.toutEffacer();
            app.quitter(false);
            app.ecran = 'splash';
            app.demarrer();
          }, titre: 'Supprimer ?', oui: 'Oui, tout supprimer')),
      const Titre3('Aide'),
      Btn('Apprendre à jouer', large: true, onTap: ouvrirTutoriel),
      const Ecart(8),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        TextButton(onPressed: () => ouvrirLien('${lienJeu.replaceAll(RegExp(r'#.*$'), '')}legal/conditions.html'), child: Text("Conditions d'utilisation", style: K.texte(13, couleur: K.brass))),
        Text('·', style: K.texte(13, couleur: K.muted)),
        TextButton(onPressed: () => ouvrirLien('${lienJeu.replaceAll(RegExp(r'#.*$'), '')}legal/confidentialite.html'), child: Text('Confidentialité', style: K.texte(13, couleur: K.brass))),
      ]),
      Btn('Remettre les réglages par défaut', large: true, onTap: () { app.prefs = Map.of(App.prefsDefaut); app.enregistrerPrefs(); setState(() {}); }),
      const Ecart(6),
      Muet('Masano · version ${Api.version}', align: TextAlign.center, taille: 12),
      const Ecart(10),
      Btn.principal('Fermer', large: true, onTap: app.fermerFenetre),
    ]);
  }
}
