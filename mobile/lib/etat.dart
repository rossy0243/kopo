// Le cœur de l'appli : compte, config du serveur, salle de jeu en cours, fenêtres, toasts et effets.
// Reprend la logique de la page du site (src/source.html) : afficher(v), entrerServeur(), quitter(), suivrePartie()…
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'commun/cartes.dart';
import 'commun/retention.dart';
import 'commun/sons.dart';
import 'commun/stock.dart';
import 'reseau/api.dart';
import 'reseau/salle.dart';

typedef Vue = Map<String, dynamic>;

/// Un effet du calque d'animations : bulle au-dessus d'un siège, tampon au milieu de l'écran.
class Effet {
  static int _n = 0;
  final int id = _n++;
  final String type; // bulle, tampon, reaction
  final String? joueur;
  final String texte;
  final String? icone;
  final String? sous;
  final String cls; // '', texte, ko
  final int delai, duree;
  final DateTime cree = DateTime.now();
  Effet(this.type, {this.joueur, this.texte = '', this.icone, this.sous, this.cls = '', this.delai = 0, this.duree = 1700});
}

class MessageChat {
  final String? code, nom, texte;
  final bool moi;
  final DateTime le = DateTime.now();
  MessageChat(this.code, this.nom, this.texte, this.moi);
}

class App extends ChangeNotifier {
  App._();
  static final App i = App._();

  static const lettresCode = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  static const reactions = ['👏', '😂', '😮', '🔥', '😡', '👍', '😭', '🙏', 'Bien joué !', 'Bravo !', 'Joli coup !', 'Belle carte !', 'Bien vu !', 'Trop fort !', 'Merci !', 'Désolé !', 'Oups !', 'Aïe !', 'Pas de chance !', 'Je ramasse…', 'Je t’ai eu !', 'Katapss !', 'Vite !', 'Prends ton temps', 'À toi !', 'Encore une !', 'Bonne chance !', 'Bonne partie !', 'GG !', 'Revanche ?', 'On en refait une ?', 'Je reviens', 'Salut tout le monde !', 'À la prochaine !'];
  static const prefsDefaut = {'vibrations': true, 'animations': 'normales', 'tri': 'couleur', 'confirmerToutPoser': false, 'quatreCouleurs': false, 'sonAutresCoupe': false, 'effetsSonores': true, 'musique': false};
  static const niveauxRobots = ['faciles', 'normaux', 'forts'];
  static const nomsNiveauxRobots = {'faciles': 'Facile', 'normaux': 'Normal', 'forts': 'Fort'};
  static const delaisKopo = [0, 3, 5, 10, 15], delaisInter = [0, 5, 10, 15, 20];
  static const maxInter = 8, maxKopo = 9;
  static const tailles = [9, 8, 7, 6, 5, 4, 3, 2];
  static const niveauxMise = [('bronze', 'Bronze'), ('argent', 'Argent'), ('or', 'Or'), ('diamant', 'Diamant')];
  static const nomsDivisions = {'bois': 'Bois', 'bronze': 'Bronze', 'argent': 'Argent', 'or': 'Or', 'diamant': 'Diamant', 'legende': 'Légende'};

  final navigateur = GlobalKey<NavigatorState>();
  final messager = GlobalKey<ScaffoldMessengerState>();

  // ---------------------------------------------------------------- état général
  String ecran = 'splash'; // splash, bienvenue, accueil, connexion, salon, partie
  String texteConnexion = '';
  double splash = 0;
  String splashEtat = 'Chargement…';
  bool splashAttente = false;
  Map<String, dynamic>? config;
  String? miseAJourStore; // 426 : l'appli doit être mise à jour
  Map<String, dynamic> prefs = Map.of(prefsDefaut);

  // Fenêtre (une à la fois, comme #voile sur le site) : un constructeur, relu à chaque changement.
  WidgetBuilder? fenetre;
  String fenetreType = '';
  String? toastTexte;
  Timer? _minuteurToast;
  String? bandeau;
  final effets = <Effet>[];
  final clesSieges = <String, GlobalKey>{};
  GlobalKey cleSiege(String id) => clesSieges.putIfAbsent(id, () => GlobalKey());

  // ---------------------------------------------------------------- partie en cours
  Vue? vue, vueAvant;
  Salle? _salle;
  Object? _client; // jeton de la connexion en cours : une ancienne salle ne touche plus à rien
  bool _depart = false;
  final _abonnements = <StreamSubscription>[];
  DateTime? finChrono;
  int totalChrono = 0;
  String? carteChoisie;
  List<String> choixInter = [];
  final cartesRecues = <String>{};
  bool etaitMonTour = false;
  DateTime retardFenetre = DateTime(2000);
  Timer? _minuteurFenetre;
  ({DateTime fin, Timer t})? suiteAuto;
  final historiqueChat = <MessageChat>[];
  final filChat = <MessageChat>[];
  int nonLus = 0;
  Map<String, dynamic>? suivi;
  ({DateTime recu, Map detail})? derniereLigue, dernierParcours;
  ({DateTime recu, Map x, bool gagne, String? taquinerie})? dernierDuel;
  final recapsAnimes = <String>{};
  bool robotsAComposer = false;
  List<String>? tableAComposer;
  String? amiAInviter;
  String? amiAInviterPseudo;
  DateTime? amiAInviterQuand;

  // ---------------------------------------------------------------- accueil
  int joueursEnLigne = 0;
  List<Map<String, dynamic>> sallesOuvertes = [];
  Map<String, dynamic>? etatJour, etatBandes;
  int amisEnLigne = 0, demandesAmi = 0;
  String? ligueResume;
  bool pointLigue = false, pointJour = false;
  Set<String> bloques = {};
  final _notifsVues = <String>{};
  Timer? _tNotifs, _tCompet, _tEnLigne, _tConfig, _tSauvegarde;

  // ---------------------------------------------------------------- utilitaires
  void maj() => notifyListeners();
  String jourLocal([DateTime? d]) => R.jourDe(d ?? DateTime.now());
  String get pseudo => (Stock.lire('kopo-pseudo') as String?) ?? '';
  Map<String, dynamic>? get compte => Api.compte?['compte'] is Map ? (Api.compte!['compte'] as Map).cast<String, dynamic>() : null;
  bool get enLigne => Api.jeton != null;
  bool get avecGoogle => compte?['google'] == true;
  int get solde => (compte?['solde'] as num?)?.toInt() ?? 0;
  bool get sansAnim => prefs['animations'] == 'reduites';
  static String formatPieces(num n) {
    final s = n.round().abs().toString();
    final b = StringBuffer();
    for (var i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(' '); b.write(s[i]); }
    return (n < 0 ? '-' : '') + b.toString();
  }
  String nomDe(Vue v, Object? id) {
    for (final j in (v['joueurs'] as List? ?? [])) { if (j['id'] == id) return (j['nom'] ?? '?').toString(); }
    return '?';
  }
  static String nettoyerPseudo(String p, [bool enCours = false]) {
    var t = p.replaceFirst(RegExp(r'^\s+'), '');
    if (!enCours) t = t.trim();
    return t.replaceAll(RegExp(r'\s+'), '_').replaceAll(RegExp(r'[^\p{L}\p{N}_.\-]', unicode: true), '');
  }
  String nouveauCode() { final r = math.Random(); return List.generate(4, (_) => lettresCode[r.nextInt(lettresCode.length)]).join(); }

  void toast(String t) {
    toastTexte = t;
    _minuteurToast?.cancel();
    _minuteurToast = Timer(const Duration(milliseconds: 3500), () { toastTexte = null; maj(); });
    maj();
  }
  void vibrer([int ms = 60]) { if (prefs['vibrations'] == true) { ms > 80 ? HapticFeedback.mediumImpact() : HapticFeedback.lightImpact(); } }

  void ouvrirFenetre(WidgetBuilder b, [String type = '']) { fenetre = b; fenetreType = type; maj(); }
  void fermerFenetre() { if (fenetre == null) return; fenetre = null; fenetreType = ''; maj(); }
  bool get chatOuvert => fenetre != null && fenetreType == 'chat';

  void bulle(String? joueur, String texte, {String? icone, String cls = '', int delai = 0, int duree = 1700}) {
    if (sansAnim || joueur == null) return;
    _ajouterEffet(Effet('bulle', joueur: joueur, texte: texte, icone: icone, cls: cls, delai: delai, duree: duree));
  }
  void tampon(String texte, [String? sous]) {
    if (sansAnim) return;
    _ajouterEffet(Effet('tampon', texte: texte, sous: sous, duree: 1900));
  }
  void _ajouterEffet(Effet e) {
    effets.add(e);
    Timer(Duration(milliseconds: e.delai + e.duree + 100), () { effets.remove(e); maj(); });
    maj();
  }

  // ---------------------------------------------------------------- réglages
  void chargerPrefs() {
    final p = Stock.lire('kopo-prefs');
    prefs = Map.of(prefsDefaut);
    if (p is Map) prefs.addAll(p.cast<String, dynamic>());
    appliquerPrefs();
  }
  void enregistrerPrefs() { Stock.ecrire('kopo-prefs', prefs); appliquerPrefs(); maj(); }
  void appliquerPrefs() {
    Couleurs4.actif = prefs['quatreCouleurs'] == true;
    Sons.regler(effets: prefs['effetsSonores'] == true, musique: prefs['musique'] == true);
  }

  // ---------------------------------------------------------------- profil (XP, missions…) sur le téléphone
  Profil lireProfil() {
    final p = Stock.lire('kopo-profil');
    if (p is! Map) return {'version': 1, 'bareme': R.bareme};
    final q = p.cast<String, dynamic>();
    if (R.convertirXp(q)) Stock.ecrire('kopo-profil', q);
    return q;
  }
  void ecrireProfil(Profil p) { Stock.ecrire('kopo-profil', p); appliquerCollection(p); }
  void appliquerCollection([Profil? p]) {
    p ??= lireProfil();
    final c = R.collection(p);
    final eq = (c['equipes'] as Map?) ?? {};
    DosActuel.id = (eq['dos'] as String?) ?? 'dos-laiton';
    maj();
  }
  String get avatarEquipe => ((R.collection(lireProfil())['equipes'] as Map?)?['avatar'] as String?) ?? 'av-laiton';
  String? get cadreEquipe => (R.collection(lireProfil())['equipes'] as Map?)?['cadre'] as String?;
  bool get pointMissions {
    final p = lireProfil(), j = jourLocal();
    return !(p['missions'] is Map && p['missions']['vuLe'] == j) || R.aEncaisser(p, j) > 0;
  }
  void sauvegarderProfil() {
    if (!enLigne) return;
    _tSauvegarde?.cancel();
    _tSauvegarde = Timer(const Duration(milliseconds: 1500), () {
      final p = lireProfil();
      if ((p['xp'] ?? 0) == 0 && p['premierePartie'] == null) return;
      final copie = Map<String, dynamic>.of(p);
      final rv = p['rivaux'];
      if (rv is Map && rv.length > 150) {
        final ids = rv.keys.toList()..sort((a, b) => ((rv[b]['vuLe'] ?? '') as String).compareTo((rv[a]['vuLe'] ?? '') as String));
        copie['rivaux'] = {for (final id in ids.take(150)) id: rv[id]};
      }
      Api.put('/profil', {'profil': copie}).catchError((_) => null);
    });
  }
  Future<void> restaurerProfil() async {
    if (!enLigne) return;
    try {
      final r = await Api.get('/profil');
      final p = lireProfil();
      if (r is Map && r['profil'] != null && R.fusionnerProfils(p, r['profil'], 'max')) {
        ecrireProfil(p);
        toast('Ton niveau et tes statistiques ont été récupérés.');
      }
    } catch (_) {}
    sauvegarderProfil();
  }
  void crediterEnLigne(String motif, int montant, String ref) {
    if (!enLigne || montant <= 0) return;
    Api.post('/recompense', {'motif': motif, 'montant': montant, 'ref': ref}).then((r) { if (r is Map && r['ok'] == true) soldeServeur(r['solde']); }).catchError((_) => null);
  }
  void soldeServeur(Object? n) {
    if (n is! num) return;
    final c = Api.compte; if (c == null) return;
    c['compte'] = {...?(c['compte'] as Map?)?.cast<String, dynamic>(), 'solde': n};
    Stock.ecrire('kopo-compte-serveur', c);
    maj();
  }

  // ---------------------------------------------------------------- compte
  Future<Map<String, dynamic>> compteServeur(String nom) async {
    var c = Api.compte;
    if (c == null) {
      final j = await Api.appel('/invite', methode: 'POST', corps: {'pseudo': nom}, sansJeton: true);
      c = {'serveur': Api.serveur, 'jeton': j['jeton'], 'compte': j['compte']};
      Stock.ecrire('kopo-compte-serveur', c);
      adopterPseudo(j['compte']?['pseudo'] as String?, true);
      relireConfig();
    } else {
      adopterPseudo(c['compte']?['pseudo'] as String?, false);
    }
    return c;
  }
  void adopterPseudo(String? p, bool aLaCreation) {
    if (p == null || p == Stock.lire('kopo-pseudo')) return;
    final avant = Stock.lire('kopo-pseudo') as String?;
    Stock.ecrire('kopo-pseudo', p);
    if (avant != null && avant.toLowerCase() != p.toLowerCase()) toast(aLaCreation ? '« $avant » était déjà pris : ton pseudo est $p.' : 'Ton pseudo en ligne est $p.');
    maj();
  }
  Future<Map<String, dynamic>?>? _compteEnCours;
  Future<Map<String, dynamic>?> assurerCompte() {
    return _compteEnCours ??= () async {
      try {
        if (!enLigne) { if (pseudo.isEmpty) return null; await compteServeur(pseudo); }
        final j = await Api.get('/moi');
        final c = Api.compte;
        if (c != null) { c['compte'] = j['compte']; Stock.ecrire('kopo-compte-serveur', c); adopterPseudo(j['compte']?['pseudo'] as String?, false); }
        maj();
        return Api.compte;
      } on ErreurApi catch (e) {
        if (e.statut == 401) { Stock.effacer('kopo-compte-serveur'); }
        return Api.compte;
      } catch (_) {
        return Api.compte;
      } finally {
        Timer.run(() => _compteEnCours = null);
      }
    }();
  }
  Future<bool> compteEnLigneOuCreer() async { if (!enLigne) { if (pseudo.isEmpty) return false; await compteServeur(pseudo); } return true; }

  /// Le pseudo choisi, ou null (avec un message) s'il n'y en a pas encore.
  String? lirePseudo() {
    final p = nettoyerPseudo(pseudo);
    if (p.length >= 3) return p;
    toast("Choisis d'abord ton pseudo.");
    return null;
  }

  // ---------------------------------------------------------------- config du serveur
  Future<Map<String, dynamic>?> lireConfig() async {
    if (config != null) return config;
    await relireConfig();
    return config;
  }
  Future<void> relireConfig() async {
    try {
      final c = await Api.appel('/config', sansJeton: true, delai: const Duration(seconds: 70));
      if (c is Map) { config = c.cast<String, dynamic>(); messagesServeur(); }
    } catch (_) {}
  }
  bool annonceOuverte = false;
  void messagesServeur() {
    final cfg = config; if (cfg == null) return;
    if (cfg['miseAJour'] == true) {
      final m = cfg['mobile'];
      miseAJourStore = m is Map && m[Api.plateforme] is Map ? m[Api.plateforme]['store'] as String? : null;
      miseAJourStore ??= '';
    }
    final maint = cfg['maintenance'];
    if (maint is String && maint.trim().isNotEmpty) { _tConfig ??= Timer.periodic(const Duration(seconds: 30), (_) => relireConfig()); }
    else { _tConfig?.cancel(); _tConfig = null; }
    final annonce = cfg['annonce'] is String ? (cfg['annonce'] as String).trim() : '';
    if (annonce.isNotEmpty && Stock.lire('kopo-annonce-vue') != annonce) annonceOuverte = true;
    maj();
  }
  String? get maintenance { final m = config?['maintenance']; return m is String && m.trim().isNotEmpty ? m : null; }
  List<String> get messagesChat { final m = config?['messages']; return m is List && m.isNotEmpty ? m.map((e) => e.toString()).toList() : reactions; }

  String etatJeu(String jeu) => ((config?['jeux'] as Map?)?[jeu] as String?) ?? 'ouvert';
  List<String> get jeuxVisibles { final l = ['kopo', 'inter8'].where((j) => etatJeu(j) != 'ferme').toList(); return l.isEmpty ? ['kopo'] : l; }
  String get jeu { final l = jeuxVisibles, j = Stock.lire('kopo-jeu'); return l.contains(j) ? j as String : l.first; }
  set jeu(String j) { Stock.ecrire('kopo-jeu', j); maj(); }

  // Tables à mise
  Map? get tablesMise => config?['tables'] is Map ? config!['tables'] as Map : null;
  int seuilMise(String n) => (((tablesMise?[n] as num?) ?? 0) * ((config?['deblocage'] as num?) ?? 10)).toInt();
  String? get miseActive {
    if (jeu != 'kopo') return null;
    final t = tablesMise, n = Stock.lire('kopo-mise');
    return t != null && n is String && ((t[n] as num?) ?? 0) > 0 && solde >= seuilMise(n) ? n : null;
  }

  // Robots
  String get niveauRobots { final n = Stock.lire('kopo-niveau-robots'); return niveauxRobots.contains(n) ? n as String : 'normaux'; }
  int get monNiveau => R.niveauDe(lireProfil()['xp'] as num? ?? 0).niveau;
  String get styleInter => Stock.lire('kopo-inter8-style') == 'delire' ? 'delire' : 'simple';
  bool get jRetourInter { final j = Stock.lire('kopo-inter8-jretour'); return j != null ? j == 'oui' : styleInter == 'delire'; }
  void ecrireJRetour(bool oui) => Stock.ecrire('kopo-inter8-jretour', oui ? 'oui' : 'non');
  Map<String, dynamic> reglagesStyleInter(String mode) => {'mode': mode, 'jRetour': mode == 'delire' && jRetourInter};

  // ---------------------------------------------------------------- démarrage
  Future<void> demarrer() async {
    chargerPrefs();
    bloques = {...((Stock.lire('kopo-bloques') as List?) ?? []).map((e) => e.toString())};
    suivi = null;
    Api.surMiseAJour = (store) { miseAJourStore = store ?? ''; maj(); };
    _splash(74, 'Préparation de la table…');
    final debut = DateTime.now();
    final pret = Completer<bool>();
    relireConfig().then((_) { if (!pret.isCompleted) pret.complete(true); });
    _splash(82, 'Connexion au serveur…');
    var ok = await Future.any([pret.future, Future.delayed(const Duration(milliseconds: 2500), () => false)]);
    if (!ok && ecran == 'splash') {
      _splash(86, 'Réveil du serveur, un instant…');
      splashAttente = true; maj();
      ok = await Future.any([pret.future, Future.delayed(const Duration(milliseconds: 9500), () => false)]);
    }
    if (ecran != 'splash') return;
    _splash(100, 'Prêt !');
    final reste = 1300 - DateTime.now().difference(debut).inMilliseconds;
    await Future.delayed(Duration(milliseconds: math.max(400, reste)));
    finirSplash(!ok);
  }
  void _splash(double p, String t) { splash = p; splashEtat = t; maj(); }
  void finirSplash(bool reveil) {
    if (ecran != 'splash') return;
    if (reveil) toast('Le serveur se réveille encore : les parties en ligne seront prêtes dans un instant.');
    _apresSplash();
  }
  void _apresSplash() {
    _tEnLigne ??= Timer.periodic(const Duration(seconds: 8), (_) => lireEnLigneServeur());
    lireEnLigneServeur();
    _tNotifs ??= Timer.periodic(const Duration(seconds: 15), (_) => lireNotifications());
    Timer(const Duration(seconds: 6), lireNotifications);
    _tCompet ??= Timer.periodic(const Duration(seconds: 60), (_) { if (ecran == 'accueil') majCartesCompetition(); });
    Timer(const Duration(milliseconds: 1500), restaurerProfil);
    Timer(const Duration(milliseconds: 1500), majOngletLigue);
    Timer(const Duration(milliseconds: 2500), synchroCollection);
    majBloques();
    final s = Stock.lire('kopo-session');
    if (s is Map && s['role'] == 'serveur' && s['code'] != null) {
      entrerServeur((s['nom'] ?? pseudo).toString(), {'reconnexion': s['jetonReco'], 'code': s['code'], 'taille': s['taille']});
      return;
    }
    Stock.effacer('kopo-session');
    afficherAccueil(premiere: true);
  }

  bool get bienvenueAFaire => Stock.lire('kopo-entree') == null && Stock.lire('kopo-pseudo') == null;

  void afficherAccueil({bool premiere = false}) {
    ecran = 'accueil';
    maj();
    Timer(const Duration(milliseconds: 1500), verifierRemiseAFlot);
    if (Stock.lire('kopo-entree') == null) {
      if (Stock.lire('kopo-pseudo') != null) { Stock.ecrire('kopo-entree', 'invite'); }
      else { ecran = 'bienvenue'; maj(); return; }
    }
    assurerCompte();
    Timer(const Duration(milliseconds: 800), majCartesCompetition);
    if (premiere) Timer(const Duration(milliseconds: 1600), () { if (ecran != 'accueil' || fenetre != null) return; if (!bonusDuJourServeur()) suiteAccueil(); });
  }

  /// Après le bonus : la nouveauté, le tutoriel la toute première fois, sinon le cadeau de bienvenue du jour.
  void Function()? suiteAccueilUi; // branché par l'interface (fenêtres)
  void suiteAccueil() { if (ecran != 'accueil' || fenetre != null) return; suiteAccueilUi?.call(); }
  void Function(Map b)? fenetrePiecesUi;
  Future<void> Function()? cadeauFondateurUi;

  bool bonusDuJourServeur() {
    final auj = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    final info = (Stock.lire('kopo-bonus-serveur') as Map?) ?? {};
    if (info['jour'] == auj || pseudo.isEmpty) return false;
    () async {
      Map? b;
      try {
        if (await assurerCompte() != null) {
          await cadeauFondateurUi?.call();
          b = await Api.post('/bonus-du-jour') as Map?;
          Stock.ecrire('kopo-bonus-serveur', {'jour': auj, 'serie': b?['serie'] ?? 0, 'jokerLibre': b?['dejaPris'] == true ? info['jokerLibre'] != false : b?['jokerLibre'] != false});
        }
      } catch (_) { b = null; }
      if (ecran != 'accueil' || fenetre != null) return;
      if (b != null && b['dejaPris'] != true) { soldeServeur(b['solde']); fenetrePiecesUi?.call(b); }
      else { suiteAccueil(); }
    }();
    return true;
  }

  Future<void> verifierRemiseAFlot() async {
    final cfg = config;
    if (!enLigne || cfg == null || cfg['remiseAFlot'] is! num || solde >= (cfg['remiseAFlot'] as num)) return;
    if (ecran != 'accueil' || Stock.lire('kopo-remise-a-flot') == jourLocal()) return;
    try {
      final r = await Api.post('/remise-a-flot');
      Stock.ecrire('kopo-remise-a-flot', jourLocal());
      if (r is Map && r['ok'] == true) {
        soldeServeur(r['solde']);
        if (fenetre == null) { remiseAFlotUi?.call((r['solde'] as num).toInt()); } else { toast('Remise à flot : ${formatPieces(r['solde'] as num)} pièces.'); }
      }
    } catch (_) {}
  }
  void Function(int solde)? remiseAFlotUi;

  Future<void> lireEnLigneServeur() async {
    try {
      final j = await Api.appel('/en-ligne', sansJeton: true, delai: const Duration(seconds: 20));
      joueursEnLigne = (j['joueurs'] as num?)?.toInt() ?? 0;
      sallesOuvertes = ((j['sallesOuvertes'] as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).where((x) => tailles.contains(x['taille'])).toList();
      maj();
    } catch (_) {}
  }
  int get nbEnLigne => math.max(1, joueursEnLigne);
  List<Map<String, dynamic>> ouvertes(int taille) => sallesOuvertes
      .where((x) => (x['jeu'] ?? 'kopo') == jeu && x['taille'] == taille && (x['joueurs'] as num) < (x['taille'] as num) && (x['mise'] ?? null) == miseActive)
      .toList()
    ..sort((a, b) => (b['joueurs'] as num).compareTo(a['joueurs'] as num));

  Future<void> majCartesCompetition() async {
    if (!enLigne) return;
    try {
      final e = etatJour = (await Api.get('/match-jour') as Map).cast<String, dynamic>();
      pointJour = e['actif'] == true && !(e['moi'] is Map && e['moi']['fini'] == true);
    } catch (_) {}
    try { etatBandes = (await Api.get('/bandes') as Map).cast<String, dynamic>(); } catch (_) {}
    try { final a = await Api.get('/amis') as List; amisEnLigne = a.where((x) => x['en_ligne'] == true).length; } catch (_) {}
    maj();
  }
  Future<void> majOngletLigue() async {
    if (!enLigne) return;
    try {
      final L = await Api.get('/ligue');
      pointLigue = L['recompense'] != null;
      final m = L['moi'];
      ligueResume = ((m['parties'] ?? 0) > 0 ? '${nomsDivisions[m['division']]} · ${m['points']} pts' : 'Saison classée') + (L['saison'] != null ? ' · ${resteSaison(L['saison']['fin'].toString()).replaceFirst('fin dans ', 'encore ')}' : '');
      maj();
    } catch (_) {}
  }
  static String resteSaison(String fin) {
    final ms = DateTime.parse(fin).difference(DateTime.now()).inMilliseconds;
    if (ms <= 0) return 'se termine maintenant';
    final j = ms ~/ 86400000, h = (ms % 86400000) ~/ 3600000;
    return j >= 1 ? 'fin dans $j j $h h' : 'fin dans $h h ${(ms % 3600000) ~/ 60000} min';
  }
  Future<void> majBloques() async {
    if (!enLigne) return;
    try { bloques = {...(await Api.get('/bloques') as List).map((b) => b['id'].toString())}; Stock.ecrire('kopo-bloques', bloques.toList()); } catch (_) {}
  }
  Future<void> synchroCollection() async {
    if (!enLigne) return;
    try {
      await chargerCatalogue();
      final c = await Api.get('/collection');
      final p = lireProfil(), col = R.collection(p);
      var change = false;
      for (final id in (c['possedes'] as List? ?? [])) {
        final possedes = col['possedes'] as List;
        if (R.objets.containsKey(id) && !possedes.contains(id)) { possedes.add(id); change = true; }
      }
      if (change) ecrireProfil(p);
    } catch (_) {}
  }
  final objetsServeur = <String, Map>{};
  void objetDuServeur(Map o) {
    objetsServeur[o['id']] = o;
    final d = o['prix'] != null ? '${formatPieces(o['prix'] as num)} pièces' : o['collection'] == 'parrainage' ? 'Parrainage' : 'Parcours de saison';
    R.objets[o['id'] as String] = {'d': d, ...?R.objets[o['id']], 'type': o['type'], 'nom': o['nom'], if (o['ville'] == true) 'ville': true};
  }
  Future<void> chargerCatalogue() async {
    if (objetsServeur.isNotEmpty) return;
    try { final b = await Api.get('/boutique'); for (final o in (b['objets'] as List)) { objetDuServeur(o as Map); } } catch (_) {}
  }
  void synchroEquiper(String id) { if (enLigne) Api.post('/collection/equiper', {'objet': id}).catchError((_) => null); }

  // Notifications du jeu (invitation, rivalité, ami…) : montrées sur l'accueil, une à la fois.
  void Function(Map a)? notificationUi;
  Future<void> lireNotifications() async {
    if (!enLigne || ecran != 'accueil' || fenetre != null) return;
    Map n;
    try { n = await Api.get('/notifications') as Map; } catch (_) { return; }
    if (n['demandesAmi'] is num) { demandesAmi = (n['demandesAmi'] as num).toInt(); maj(); }
    final liste = ((n['liste'] as List?) ?? []).cast<Map>();
    final nonLues = liste.where((x) => x['lue'] != true && !_notifsVues.contains(x['id'].toString())).toList().reversed.toList();
    bool recente(Map x) => DateTime.now().difference(DateTime.parse(x['cree_le'].toString())).inMinutes < 10;
    Map? a;
    for (final x in nonLues) { if (x['type'] == 'invitation' && recente(x)) { a = x; break; } }
    a ??= nonLues.isEmpty ? null : nonLues.first;
    if (a == null || ecran != 'accueil' || fenetre != null) return;
    _notifsVues.add(a['id'].toString());
    Api.post('/notifications/lues', {'ids': [a['id']]}).catchError((_) => null);
    if (a['type'] == 'invitation' && !recente(a)) { lireNotifications(); return; }
    notificationUi?.call(a);
  }

  // ---------------------------------------------------------------- salles de jeu
  // Sur le web, le matchmaking Colyseus refuse les en-têtes personnalisés (CORS) : on ne l'envoie qu'en natif.
  MasanoServeur get _serveur => MasanoServeur(Api.serveur, entetes: kIsWeb ? const {} : Api.entetes);
  void Function()? exigerGoogleUi; // ouvre la fenêtre « Jouer en ligne : connecte-toi avec Google »
  bool exigerGoogle() {
    if (avecGoogle) return false;
    if (config?['google'] == null) return false;
    exigerGoogleUi?.call();
    return true;
  }

  /// facon : {creer, jeu, mode, jRetour} | {code} | {taille, mise, jeu} | {reconnexion, code, taille} | {matchJour} | {robots...}
  Future<void> entrerServeur(String nom, Map<String, dynamic> facon) async {
    if (facon['reconnexion'] == null && facon['matchJour'] == null && facon['robots'] == null && exigerGoogle()) return;
    final mises = {for (final m in niveauxMise) m.$1: m.$2};
    afficherConnexion(facon['matchJour'] != null
        ? 'Préparation du Match du jour…'
        : facon['robots'] != null
            ? 'Préparation de la table…'
            : facon['taille'] != null && facon['code'] == null
                ? "Recherche d'une ${facon['mise'] != null ? 'table ${mises[facon['mise']]}' : 'salle'} de ${facon['taille']}…"
                : facon['code'] != null
                    ? 'Connexion à la partie ${facon['code']}…'
                    : 'Ouverture de la partie…');
    final reveil = Timer(const Duration(seconds: 6), () { if (ecran == 'connexion') afficherConnexion("Réveil du serveur, ça peut prendre jusqu'à une minute…"); });
    final jeton = Object();
    _client = jeton;
    try {
      final c = await compteServeur(nom);
      final j = c['jeton'] as String;
      final srv = _serveur;
      Salle room;
      if (facon['reconnexion'] != null) {
        try {
          room = await srv.reconnecter(facon['reconnexion'] as String);
        } catch (_) {
          final r = facon['code'] != null ? await srv.reprendre(j, facon['code'] as String) : null;
          if (r == null) throw ErreurSalle(0, 'reconnexion');
          room = r;
        }
      } else if (facon['matchJour'] != null) {
        room = await srv.creer('kopo-jour', {'jeton': j});
      } else if (facon['robots'] != null) {
        room = await srv.creer('entrainement', {'jeton': j, ...(facon['robots'] as Map).cast<String, Object?>()});
      } else if (facon['creer'] != null) {
        final inter = facon['jeu'] == 'inter8';
        room = await srv.creer(inter ? 'inter8' : 'kopo', {'jeton': j, 'code': nouveauCode(), if (inter) 'mode': facon['mode'], if (inter) 'jRetour': facon['jRetour'] == true});
      } else if (facon['code'] != null) {
        final code = facon['code'] as String;
        final r = await srv.reprendre(j, code);
        if (r != null) {
          room = r;
        } else {
          try { room = await srv.rejoindre('kopo', {'jeton': j, 'code': code}); }
          catch (e) { try { room = await srv.rejoindre('inter8', {'jeton': j, 'code': code}); } catch (_) { rethrow; } }
        }
      } else if (facon['mise'] != null) {
        room = await srv.rejoindreOuCreer('kopo-mise', {'jeton': j, 'publique': true, 'taille': facon['taille'], 'mise': facon['mise']});
      } else {
        room = await srv.rejoindreOuCreer(facon['jeu'] == 'inter8' ? 'inter8' : 'kopo', {'jeton': j, 'publique': true, 'taille': facon['taille']});
      }
      reveil.cancel();
      if (_client != jeton) { room.abandonner(); return; }
      _brancher(room, nom, facon);
    } catch (e) {
      reveil.cancel();
      if (_client != jeton) return;
      if (facon['reconnexion'] != null && facon['code'] != null) { entrerServeur(nom, {'code': facon['code'], 'taille': facon['taille']}); return; }
      final m = e.toString();
      final texte = RegExp('no rooms found|not found', caseSensitive: false).hasMatch(m)
          ? 'Partie introuvable, ou elle a déjà commencé.'
          : m.contains('locked') ? 'La partie a déjà commencé.' : (m.isEmpty || m == 'reconnexion') ? 'Connexion impossible.' : m;
      if (m.contains('Connecte-toi avec Google')) { quitter(); exigerGoogleUi?.call(); return; }
      if (RegExp('Compte inconnu|Connexion requise').hasMatch(m)) {
        Stock.effacer('kopo-compte-serveur');
        if (facon['retente'] == null) { entrerServeur(nom, {...facon, 'retente': true}); return; }
      }
      quitter();
      toast(texte);
    }
  }

  void afficherConnexion(String t) { ecran = 'connexion'; texteConnexion = t; fenetre = null; maj(); }

  void _brancher(Salle room, String nom, Map<String, dynamic> facon) {
    for (final a in _abonnements) { a.cancel(); }
    _abonnements.clear();
    _salle = room;
    _depart = false;
    final moi = Object();
    _client = moi;
    void memoriser(String code) {
      Stock.ecrire('kopo-session', {'code': code, 'role': 'serveur', 'nom': nom, 'taille': facon['taille'], 'jetonReco': room.jetonReconnexion});
    }
    _abonnements.add(room.messages.listen((m) {
      if (_client != moi) return;
      final d = m.valeur;
      switch (m.type) {
        case 'vue':
          bandeau = null;
          final v = (d as Map).cast<String, dynamic>();
          memoriser(v['code'].toString());
          afficher(v);
        case 'erreur':
          toast(d.toString());
        case 'solde':
          if (d is Map) soldeServeur(d['solde']);
        case 'mise':
          if (d is Map) toast('Mise de ${formatPieces(d['mise'] as num)} pièces payée. Pot : ${formatPieces(d['pot'] as num)} pièces.');
        case 'pot':
          if (d is Map) toast((d['gain'] as num) > 0 ? 'Tu gagnes ${formatPieces(d['gain'] as num)} pièces du pot !' : 'Pas de part du pot cette fois (${formatPieces(d['pot'] as num)} pièces en jeu).');
        case 'classee':
          if (d is Map && d['classee'] == true) toast('Partie classée : tes points de ligue sont en jeu.');
        case 'ligue':
          if (d is Map) { derniereLigue = (recu: DateTime.now(), detail: d); maj(); }
        case 'parcours':
          if (d is Map) { dernierParcours = (recu: DateTime.now(), detail: d); maj(); }
        case 'faceAFace':
          _faceAFace(d);
        case 'reaction':
          if (d is Map) _reaction(d);
        case 'exclu':
          quitter();
          toast(d?.toString() ?? 'Tu as été exclu de la partie.');
        case 'matchJour':
          if (d is Map) {
            if (d['fin'] == true) { _depart = true; quitter(); Timer(const Duration(milliseconds: 250), () => resultatMatchJourUi?.call(d)); }
            else if (d['debut'] == true) { toast(d['officiel'] == true ? 'Match du jour n°${d['numero']} : un seul essai, bonne chance !' : 'Entraînement : ce Match ne compte pas.'); }
          }
      }
    }));
    room.fermee.then((code) {
      if (_client != moi || _depart) return;
      if (code == 4000 || code == 4001) { quitter(); toast(code == 4000 ? 'Ta partie est ouverte sur un autre appareil.' : 'Tu as été exclu de la partie.'); return; }
      bandeau = 'Connexion perdue. Reconnexion…';
      maj();
      Future<void> essayer(int n) async {
        try {
          Salle r;
          try { r = await _serveur.reconnecter(room.jetonReconnexion); }
          catch (_) {
            final s = Stock.lire('kopo-session');
            final code = s is Map ? s['code'] as String? : vue?['code'] as String?;
            if (code == null) rethrow;
            final c = await compteServeur(nom);
            final x = await _serveur.reprendre(c['jeton'] as String, code);
            if (x == null) throw ErreurSalle(0, 'reprendre');
            r = x;
          }
          if (_client == moi) { _brancher(r, nom, facon); } else { r.abandonner(); }
        } catch (_) {
          if (_client == moi && n < 40) { Timer(const Duration(seconds: 3), () => essayer(n + 1)); }
          else if (_client == moi) { quitter(); toast('Connexion au serveur perdue.'); }
        }
      }
      essayer(0);
    });
    room.envoyer('sync');
  }
  void Function(Map r)? resultatMatchJourUi;

  void envoyer(Map<String, dynamic> msg) => _salle?.envoyer(msg['type'] as String, msg);
  void action(Map<String, dynamic> a) => envoyer({'type': 'action', 'action': a});

  void quitter([bool versAccueil = true]) {
    arreterSuiteAuto();
    final s = _salle;
    _depart = true;
    _client = null;
    _salle = null;
    for (final a in _abonnements) { a.cancel(); }
    _abonnements.clear();
    if (s != null) { s.quitter().catchError((_) => 1000); }
    vue = vueAvant = null;
    _minuteurFenetre?.cancel();
    robotsAComposer = false;
    tableAComposer = null;
    Stock.effacer('kopo-session');
    fenetre = null;
    bandeau = null;
    effets.clear();
    if (versAccueil) { afficherAccueil(); } else { maj(); }
  }

  // ---------------------------------------------------------------- partie : nouvelle vue
  void Function(Vue v)? finMancheUi, finPartieUi;

  void afficher(Vue v) {
    final A = vue;
    vueAvant = A;
    vue = v;
    _demarrerChrono(v);
    if (A == null || A['etat'] != v['etat'] || A['numeroManche'] != v['numeroManche']) { carteChoisie = null; choixInter = []; cartesRecues.clear(); }
    if (v['jeu'] != 'inter8') suivrePartie(v);
    if (v['etat'] != 'finPartie') arreterSuiteAuto();
    if (v['etat'] == 'salon') {
      if (robotsAComposer) { _composerRobots(v); }
      if (!chatOuvert) fenetre = null;
      ecran = 'salon';
      if (amiAInviter != null) _inviterAmiAuSalon(v);
      maj();
      return;
    }
    final m = v['manche'] as Map?;
    if (v['etat'] == 'manche' && !(v['joueurs'] as List).any((j) => j['id'] == v['moi'])) { quitter(); toast('La revanche est partie sans toi.'); return; }
    ecran = 'partie';
    try { v['jeu'] == 'inter8' ? _animerInter(A, v) : _animer(A, v); } catch (_) {}
    try { v['jeu'] == 'inter8' ? _sonnerInter(A, v) : _sonner(A, v); } catch (_) {}
    final monTour = m != null && m['joueurCourant'] == v['moi'] && m['pause'] == null;
    if (monTour && !etaitMonTour) { vibrer(120); Sons.jouer('tour'); }
    etaitMonTour = monTour;
    if (v['etat'] == 'finManche' || v['etat'] == 'finPartie') {
      final attente = retardFenetre.difference(DateTime.now()).inMilliseconds;
      _minuteurFenetre?.cancel();
      if (attente > 0) {
        if (fenetreType != 'recap' && fenetreType != 'finManche') fenetre = null;
        _minuteurFenetre = Timer(Duration(milliseconds: attente), () {
          final w = vue;
          if (w != null && w['etat'] == 'finManche') { finMancheUi?.call(w); }
          else if (w != null && w['etat'] == 'finPartie') { finPartieUi?.call(w); }
        });
      } else if (v['etat'] == 'finManche') { finMancheUi?.call(v); }
      else { finPartieUi?.call(v); }
    } else {
      final aMoi = m != null && m['joueurCourant'] == v['moi'];
      final garder = (fenetreType == 'chat' && !aMoi) || ((fenetreType == 'demande8' || fenetreType == 'couleur8') && aMoi) || fenetreType == 'fiche' || fenetreType == 'parametres';
      if (!garder) fenetre = null;
    }
    maj();
  }

  void _demarrerChrono(Vue v) {
    final m = v['manche'] as Map?;
    final p = m?['pause'] as Map?;
    final c = p != null ? {'resteMs': p['resteMs'], 'totalMs': p['totalMs']} : v['etat'] == 'finManche' ? v['suite'] as Map? : v['chrono'] as Map?;
    finChrono = c != null && c['resteMs'] is num ? DateTime.now().add(Duration(milliseconds: (c['resteMs'] as num).toInt())) : null;
    totalChrono = c != null && c['totalMs'] is num ? (c['totalMs'] as num).toInt() : 0;
  }
  int get resteChrono => finChrono == null ? 0 : math.max(0, finChrono!.difference(DateTime.now()).inMilliseconds);

  // ---------------------------------------------------------------- animations et sons (comparaison des vues)
  bool _memeManche(Vue? A, Vue N) {
    final a = A?['manche'];
    return a != null && (A!['etat'] == 'manche' || A['etat'] == 'finManche') && A['numeroManche'] == N['numeroManche'];
  }
  static String _cle(Map p) => '${p['joueur']}:${(p['cartes'] as List).join(',')}';

  void _animer(Vue? A, Vue N) {
    final m = N['manche'] as Map?; if (m == null) return;
    final moi = N['moi'];
    final a = A?['manche'] as Map?;
    if (a == null) return;
    for (final j in (N['joueurs'] as List)) {
      final o = (A!['joueurs'] as List).firstWhere((x) => x['id'] == j['id'], orElse: () => null);
      if (o == null || j['robot'] == true) continue;
      if (o['remplace'] != true && j['remplace'] == true) { bulle(j['id'], '', icone: 'robots'); }
      else if (o['connecte'] == true && j['connecte'] != true) { bulle(j['id'], '', icone: 'horsligne'); }
      else if (o['connecte'] != true && j['connecte'] == true) { bulle(j['id'], '', icone: 'rejoindre'); }
    }
    if (!_memeManche(A, N)) return;
    final an = (m['pause'] as Map?)?['annonce'] as Map?;
    final ap = a['pause'] as Map?;
    if (an != null && ap?['annonce'] == null) {
      if (an['type'] == 'ramasse') {
        if (an['joueur'] == moi) cartesRecues.add(an['carte'] as String);
        bulle(an['joueur'], '', icone: 'ramasse', delai: 300);
      } else if (an['type'] == 'suivi') { bulle(an['gagnant'], '', icone: 'couronne', delai: 500, duree: 2200); }
      else if (an['type'] == 'sortie') { bulle(an['joueur'], '', icone: 'drapeau', delai: 400); }
      if (an['meneur'] != null) bulle(an['meneur'], '↻', delai: 1400, duree: 1500);
    }
    if (a['joueurCourant'] != null && a['joueurCourant'] != m['joueurCourant'] && A!['chrono'] != null && resteChrono < 350 && m['pause'] == null) {
      // chrono écoulé : le coup a été joué tout seul
    }
    final qa = (a['qualifies'] as List);
    final qs = (m['qualifies'] as List);
    for (var rang = 0; rang < qs.length; rang++) {
      final q = qs[rang];
      if (qa.any((x) => x['joueur'] == q['joueur'])) continue;
      if (q['raison'] == 'Katapss') {
        tampon('KATAPSS !', q['joueur'] == moi ? 'Toi' : nomDe(N, q['joueur']));
        bulle(q['joueur'], '✓', cls: 'texte', delai: 800);
        retardFenetre = DateTime.now().add(const Duration(milliseconds: 2000));
      } else {
        bulle(q['joueur'], rang == 0 ? '✓ 1er' : '✓ ${rang + 1}e', cls: 'texte', delai: 300);
      }
    }
    if (m['elimine'] != null && a['elimine'] == null) {
      bulle(m['elimine'], '✕', cls: 'ko', delai: 200, duree: 1800);
      final t = DateTime.now().add(const Duration(milliseconds: 1900));
      if (t.isAfter(retardFenetre)) retardFenetre = t;
    }
  }

  void _sonner(Vue? A, Vue N) {
    if (N['etat'] == 'finPartie' && A != null && A['etat'] != 'finPartie') Sons.jouer(N['vainqueur'] == N['moi'] ? 'victoire' : 'defaite', delai: 1300);
    final m = N['manche'] as Map?; if (m == null) return;
    final moi = N['moi'], a = A?['manche'] as Map?;
    final mm = _memeManche(A, N);
    if ((m['pause'] as Map?)?['type'] == 'depart' && !(mm && (a!['pause'] as Map?)?['type'] == 'depart')) Sons.jouer('distribution');
    if (!mm) return;
    final clesA = {for (final p in (a!['table'] as List)) _cle(p as Map)};
    var i = 0;
    for (final p in (m['table'] as List)) { if (!clesA.contains(_cle(p as Map))) Sons.jouer('carte', delai: 110 * i++); }
    final an = (m['pause'] as Map?)?['annonce'] as Map?;
    if (an != null && an['type'] == 'ramasse' && (a['pause'] as Map?)?['annonce'] == null) Sons.jouer('ramasse');
    for (final q in (m['qualifies'] as List)) {
      if ((a['qualifies'] as List).any((x) => x['joueur'] == q['joueur'])) continue;
      q['raison'] == 'Katapss' ? Sons.jouer('katapss') : Sons.jouer('qualifie', moi: q['joueur'] == moi, delai: 250);
    }
    if (m['elimine'] != null && a['elimine'] == null) Sons.jouer('elimine', moi: m['elimine'] == moi, delai: 200);
  }

  void _animerInter(Vue? A, Vue N) {
    final m = N['manche'] as Map?; if (m == null) return;
    final moi = N['moi'], a = A?['manche'] as Map?;
    if (!_memeManche(A, N) || m['pause'] != null) return;
    for (final id in (m['sieges'] as List)) {
      final plus = ((m['nbCartes'][id] ?? 0) as num) - ((a!['nbCartes'][id] ?? 0) as num);
      if (plus <= 0) continue;
      if (id == moi) { for (final c in (m['main'] as List)) { if (!(a['main'] as List).contains(c)) cartesRecues.add(c as String); } }
      if (plus > 1) bulle(id as String, '+$plus', cls: 'ko', delai: 200);
    }
    for (final id in (m['annonces'] as List)) {
      if ((a!['annonces'] as List).contains(id)) continue;
      tampon("J'ANNONCE !", id == moi ? 'Toi' : nomDe(N, id));
      retardFenetre = DateTime.now().add(const Duration(milliseconds: 1500));
    }
    final jn = (m['journal'] as List?) ?? [], ja = (a!['journal'] as List?) ?? [];
    final fil = jn.isEmpty ? '' : jn.last.toString();
    if (fil != (ja.isEmpty ? '' : ja.last.toString()) && fil.contains(' conteste : ')) {
      for (final id in ((a['contestables'] as List?) ?? [])) { if (!((m['contestables'] as List?) ?? []).contains(id)) bulle(id as String, '!', cls: 'ko', delai: 100); }
    }
    final pv = m['piocheVide'] as Map?, pva = a['piocheVide'] as Map?;
    if (pv != null && (pva == null || pva['n'] != pv['n'])) {
      final id = pv['joueur'];
      tampon('PIOCHE VIDE', id == moi ? 'Tu passes ton tour' : '${nomDe(N, id)} passe son tour');
      bulle(id as String?, '⏭', delai: 300);
    }
    if (m['sens'] != a['sens']) {
      tampon('J RETOUR', m['sens'] == 1 ? 'Le jeu tourne ↻' : 'Le jeu tourne ↺');
      if (m['dernier'] != null) bulle(m['dernier'] as String, m['sens'] == 1 ? '↻' : '↺', delai: 300);
    }
    final qa = (a['qualifies'] as List), qs = (m['qualifies'] as List);
    for (var rang = 0; rang < qs.length; rang++) {
      if (qa.any((x) => x['joueur'] == qs[rang]['joueur'])) continue;
      bulle(qs[rang]['joueur'], rang == 0 ? '✓ 1er' : '✓ ${rang + 1}e', cls: 'texte', delai: 300);
    }
    if (m['elimine'] != null && a['elimine'] == null) {
      bulle(m['elimine'], '✕', cls: 'ko', delai: 200, duree: 1800);
      retardFenetre = DateTime.now().add(const Duration(milliseconds: 1900));
    }
    final nouvelles = math.max(0, ((m['nbPosees'] ?? 0) as num).toInt() - ((a['nbPosees'] ?? 0) as num).toInt());
    if (nouvelles > 1) {
      final t = DateTime.now().add(Duration(milliseconds: 600 + nouvelles * 200));
      if (t.isAfter(retardFenetre)) retardFenetre = t;
    }
  }

  void _sonnerInter(Vue? A, Vue N) {
    if (N['etat'] == 'finPartie' && A != null && A['etat'] != 'finPartie') Sons.jouer(N['vainqueur'] == N['moi'] ? 'victoire' : 'defaite', delai: 1300);
    final m = N['manche'] as Map?; if (m == null) return;
    final moi = N['moi'], a = A?['manche'] as Map?;
    final mm = _memeManche(A, N);
    if ((m['pause'] as Map?)?['type'] == 'depart' && !(mm && (a!['pause'] as Map?)?['type'] == 'depart')) Sons.jouer('distribution8');
    if (!mm) return;
    final nouvelles = math.max(0, ((m['nbPosees'] ?? 0) as num).toInt() - ((a!['nbPosees'] ?? 0) as num).toInt());
    for (var i = 0; i < math.min(nouvelles, 4); i++) { Sons.jouer('carte', delai: i * 160); }
    if ((m['sieges'] as List).any((id) => ((m['nbCartes'][id] ?? 0) as num) > ((a['nbCartes'][id] ?? 0) as num))) Sons.jouer('ramasse', delai: nouvelles > 0 ? 350 : 0);
    if ((m['annonces'] as List).any((id) => !(a['annonces'] as List).contains(id))) Sons.jouer('katapss');
    for (final q in (m['qualifies'] as List)) { if (!(a['qualifies'] as List).any((x) => x['joueur'] == q['joueur'])) Sons.jouer('qualifie', moi: q['joueur'] == moi, delai: 250); }
    if (m['elimine'] != null && a['elimine'] == null) Sons.jouer('elimine', moi: m['elimine'] == moi, delai: 200);
  }

  // ---------------------------------------------------------------- chat et réactions
  void reagir(String texte) => envoyer({'type': 'reaction', 'emoji': texte});
  static bool estPhrase(String t) => RegExp(r'\p{L}', unicode: true).hasMatch(t);
  void _reaction(Map d) {
    final j = d['joueur']?.toString();
    if (j == null || bloques.contains(j)) return;
    var texte = (d['emoji'] ?? '').toString();
    if (texte.length > 40) texte = texte.substring(0, 40);
    if (texte.isEmpty) return;
    final v = vue;
    final m = MessageChat(v?['code'] as String?, v != null ? nomDe(v, j) : '?', texte, v != null && j == v['moi']);
    historiqueChat.add(m);
    if (historiqueChat.length > 30) historiqueChat.removeAt(0);
    if (!m.moi) Sons.jouer('chat');
    if (!m.moi && !chatOuvert && v?['etat'] == 'salon') nonLus++;
    filChat.add(m);
    final max = v?['etat'] == 'salon' ? 2 : 4;
    while (filChat.length > max) { filChat.removeAt(0); }
    Timer(const Duration(milliseconds: 6650), () { filChat.remove(m); maj(); });
    if (!estPhrase(texte) && !sansAnim) _ajouterEffet(Effet('reaction', joueur: j, texte: texte, duree: 2400));
    maj();
  }

  // ---------------------------------------------------------------- face-à-face (serveur)
  void _faceAFace(Object? d) {
    final duels = d is List ? d : const [];
    if (duels.isEmpty) return;
    final p = lireProfil();
    final rv = (p['rivaux'] as Map?)?.cast<String, dynamic>() ?? {};
    p['rivaux'] = rv;
    final w = vue;
    for (final x in duels) {
      final r = (rv[x['id']] as Map?)?.cast<String, dynamic>() ?? {'pseudo': x['pseudo'], 'gagnes': 0, 'perdus': 0};
      rv[x['id']] = r;
      r['pseudo'] = x['pseudo']; r['gagnes'] = x['moi']; r['perdus'] = x['lui']; r['vuLe'] = jourLocal();
      final f = (suivi?['recap'] as Recap?)?.faceAFace;
      final gagne = f != null && f.id == x['id'] ? f.gagne : (w != null && w['vainqueur'] != null && w['vainqueur'] == w['moi']);
      final tq = R.taquinerie(x['pseudo'] as String?, (x['moi'] as num).toInt(), (x['lui'] as num).toInt(), gagne);
      if (f != null && f.id == x['id']) { f.gagnes = (x['moi'] as num).toInt(); f.perdus = (x['lui'] as num).toInt(); f.taquinerie = tq; }
      dernierDuel = (recu: DateTime.now(), x: x as Map, gagne: gagne, taquinerie: tq);
    }
    Stock.ecrire('kopo-profil', p);
    sauvegarderProfil();
    maj();
  }

  // ---------------------------------------------------------------- suivi de la partie (XP, missions)
  void suivrePartie(Vue v) {
    final enJeu = (v['joueurs'] as List).any((j) => j['id'] == v['moi']);
    if (suivi == null && enJeu && v['etat'] != 'salon') {
      final s = Stock.lire('kopo-suivi');
      if (s is Map && s['code'] == v['code'] && s['fini'] != true && DateTime.now().millisecondsSinceEpoch - ((s['le'] as num?) ?? 0) < 3 * 3600e3) suivi = s.cast<String, dynamic>();
    }
    final nouvelle = v['etat'] == 'manche' && v['numeroManche'] == 1 && (suivi == null || suivi!['fini'] == true);
    final reprise = suivi == null && v['etat'] != 'salon' && v['etat'] != 'finPartie';
    if (enJeu && (nouvelle || reprise)) {
      suivi = {
        'code': v['code'], 'le': DateTime.now().millisecondsSinceEpoch,
        'avecRobots': (v['joueurs'] as List).any((j) => j['robot'] == true && j['remplace'] != true),
        'publique': v['publique'] == true, 'guidee': v['robots'] == 'gentils', 'katapss': 0, 'premierSorti': 0, 'manches': <String, dynamic>{},
      };
      Stock.ecrire('kopo-suivi', suivi);
    }
    final s = suivi;
    if (s == null || s['fini'] == true || v['manche'] == null) return;
    final nm = v['numeroManche'].toString();
    if ((v['etat'] == 'finManche' || v['etat'] == 'finPartie') && (s['manches'] as Map)[nm] == null) {
      (s['manches'] as Map)[nm] = true;
      final q = (v['manche']['qualifies'] as List);
      if (q.any((x) => x['joueur'] == v['moi'] && x['raison'] == 'Katapss')) s['katapss'] = (s['katapss'] as int) + 1;
      if (q.isNotEmpty && q[0]['joueur'] == v['moi']) s['premierSorti'] = (s['premierSorti'] as int) + 1;
      Stock.ecrire('kopo-suivi', s);
    }
    if (v['etat'] == 'finPartie') {
      s['fini'] = true;
      Stock.effacer('kopo-suivi');
      try {
        final p = lireProfil();
        final e = R.bilanPartie(v, s);
        final recap = R.enregistrerPartie(p, e, jourLocal());
        s['recap'] = recap;
        if (recap != null) {
          ecrireProfil(p);
          sauvegarderProfil();
          final d = recap.defi;
          if (d != null && d.finie && d.avant < d.cible) {
            crediterEnLigne('defi', d.pieces, '${d.texte.length > 60 ? d.texte.substring(0, 60) : d.texte}:${jourLocal()}');
          }
        }
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------- partie publique : la suivante dans 5 s
  void arreterSuiteAuto() { suiteAuto?.t.cancel(); suiteAuto = null; }
  void lancerSuiteAuto(Vue v) {
    if (suiteAuto != null) return;
    final fin = DateTime.now().add(Duration(milliseconds: 5000 + (sansAnim ? 0 : 1500)));
    suiteAuto = (fin: fin, t: Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (suiteAuto == null) return;
      if (fenetreType != 'recap') { arreterSuiteAuto(); return; }
      if (DateTime.now().isAfter(fin)) { partieSuivante(v['taille'] as int, v['jeu'] as String?); return; }
      maj();
    }));
  }
  void partieSuivante(int taille, String? j) {
    arreterSuiteAuto();
    final nom = pseudo;
    if (nom.isEmpty) { quitter(); return; }
    quitter(false);
    if (j != null) Stock.ecrire('kopo-jeu', j == 'inter8' ? 'inter8' : 'kopo');
    chercherSalle(nom, taille);
  }
  void chercherSalle(String nom, int taille) => entrerServeur(nom, {'taille': taille, 'mise': miseActive, 'jeu': jeu});

  // ---------------------------------------------------------------- créer, robots
  void creerPartie(String p, String j, [String? mode]) {
    entrerServeur(p, {'creer': true, 'jeu': j, if (j == 'inter8') ...reglagesStyleInter(mode ?? styleInter)});
  }
  void partieRobots(int n) {
    final p = lirePseudo(); if (p == null) return;
    final inter = jeu == 'inter8';
    entrerServeur(p, {'robots': {'jeu': inter ? 'inter8' : 'kopo', 'robots': n, 'niveau': niveauRobots, 'niveauJoueur': monNiveau, 'lancer': true, if (inter) ...reglagesStyleInter(styleInter)}});
  }
  void partieComposee(List<String> table) {
    final p = lirePseudo(); if (p == null) return;
    final inter = jeu == 'inter8';
    robotsAComposer = true;
    tableAComposer = List.of(table);
    entrerServeur(p, {'robots': {'jeu': inter ? 'inter8' : 'kopo', 'robots': table.length, 'niveau': niveauRobots, 'niveauJoueur': monNiveau, 'lancer': false, if (inter) ...reglagesStyleInter(styleInter)}});
  }
  void _composerRobots(Vue v) {
    final robots = (v['joueurs'] as List).where((j) => j['robot'] == true).toList();
    final t = tableAComposer ?? [];
    if (robots.length < t.length) return; // les robots arrivent
    robotsAComposer = false;
    for (var i = 0; i < t.length && i < robots.length; i++) {
      if (robots[i]['niveau'] != t[i]) envoyer({'type': 'niveauRobot', 'cible': robots[i]['id'], 'niveau': t[i]});
    }
    envoyer({'type': 'lancer'});
  }
  /// Première partie guidée : 2 robots gentils, sans chrono, avec des bulles d'aide.
  /// Inter (8) : en style simple (1 paquet, sans J retour).
  void partieGuidee({bool inter = false}) {
    final p = lirePseudo(); if (p == null) return;
    fermerFenetre();
    if (inter) Stock.ecrire('kopo-inter8-guidee', 'faite');
    entrerServeur(p, {'robots': {'jeu': inter ? 'inter8' : 'kopo', 'robots': 2, 'niveau': 'gentils', 'delai': 0, 'lancer': true, if (inter) 'mode': 'simple', if (inter) 'jRetour': false}});
  }
  void jouerMatchJour() { final p = lirePseudo(); if (p == null) return; fermerFenetre(); entrerServeur(p, {'matchJour': true}); }
  void rejoindreCode(String code) { final p = lirePseudo(); if (p == null) return; fermerFenetre(); entrerServeur(p, {'code': code}); }

  void inviterAmi(String id, String pseudoAmi) { amiAInviter = id; amiAInviterPseudo = pseudoAmi; amiAInviterQuand = DateTime.now(); }
  void _inviterAmiAuSalon(Vue v) {
    final id = amiAInviter, quand = amiAInviterQuand;
    if (id == null || v['publique'] == true || v['code'] == null) return;
    amiAInviter = null;
    if (quand == null || DateTime.now().difference(quand).inMinutes >= 3) return;
    final nom = amiAInviterPseudo;
    Api.post('/amis/${Uri.encodeComponent(id)}/inviter', {'code': v['code']}).then((_) => toast('Invitation envoyée à $nom.'), onError: (e) => toast(e.toString()));
  }

  // ---------------------------------------------------------------- Google (Supabase)
  /// Jeton Supabase reçu au retour de la connexion Google : on le donne au serveur (POST /connexion).
  Future<void> finirConnexionGoogle(String jetonSupabase) async {
    try {
      final invite = Api.compte;
      final parrain = Stock.lire('kopo-parrain');
      final j = await Api.appel('/connexion', methode: 'POST', sansJeton: true, corps: {
        'jetonSupabase': jetonSupabase, if (invite != null) 'jeton': invite['jeton'], if (pseudo.isNotEmpty) 'pseudo': pseudo, if (parrain is Map) 'parrain': parrain['code'],
      });
      Stock.ecrire('kopo-compte-serveur', {'serveur': Api.serveur, 'jeton': j['jeton'], 'compte': j['compte']});
      Stock.ecrire('kopo-entree', 'google');
      if (j['compte']?['pseudo'] != null) Stock.ecrire('kopo-pseudo', j['compte']['pseudo']);
      toast('Connecté avec Google : ${j['compte']['pseudo']}#${j['compte']['numero']}');
      majBloques();
      Timer(const Duration(seconds: 3), restaurerProfil);
      relireConfig();
      final pr = j['parrainage'];
      if (pr is Map) {
        Stock.effacer('kopo-parrain');
        Timer(const Duration(milliseconds: 3800), () => toast(pr['ok'] == true ? "${pr['parrain']} t'a invité : joue tes premières parties pour gagner ton cadeau !" : pr['erreur'].toString()));
      }
      if (ecran == 'bienvenue') afficherAccueil(premiere: true);
      maj();
      onConnecte?.call();
    } catch (e) {
      toast(e.toString());
    }
  }
  void Function()? onConnecte;

  // Liens reçus : ?parrain=CODE (gardé jusqu'à la connexion Google), ?bande=CODE (entrer dans la Bande d'un ami).
  void noterParrain(String code) {
    if (Stock.lire('kopo-parrain') == null) Stock.ecrire('kopo-parrain', {'code': code, 'le': DateTime.now().millisecondsSinceEpoch});
    Timer(const Duration(milliseconds: 2500), () => toast("Un ami t'invite : connecte-toi avec Google dans Paramètres et joue tes premières parties pour gagner des pièces !"));
  }
  void noterBande(String code) => Stock.ecrire('kopo-bande-lien', {'code': code, 'le': DateTime.now().millisecondsSinceEpoch});
}

final app = App.i;
