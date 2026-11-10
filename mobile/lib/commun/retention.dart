// Tout ce qui donne envie de revenir, calculé sur le téléphone : la copie fidèle de src/kopo-retention.js.
// XP et niveau, stats, face-à-face, missions du jour, défi de la semaine, parcours de bienvenue,
// joker de série, objets de collection. Le profil est un objet JSON (clé « kopo-profil »), le même que sur
// le site : il part sur le serveur (PUT /profil) et revient sur un autre téléphone (GET /profil).
// ignore_for_file: avoid_dynamic_calls
import 'dart:math' as math;

typedef Profil = Map<String, dynamic>;

class R {
  // ------------------------------------------------------------------ dates
  static String deux(int n) => n.toString().padLeft(2, '0');
  static String jourDe(DateTime d) => '${d.year}-${deux(d.month)}-${deux(d.day)}';
  static DateTime dateDe(String jour) {
    final p = jour.split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2], 12);
  }
  static String decaler(String jour, int n) { final d = dateDe(jour); return jourDe(DateTime(d.year, d.month, d.day + n, 12)); }
  static int ecart(String a, String b) => (dateDe(b).difference(dateDe(a)).inHours / 24).round();
  static String semaineDe(String jour) {
    var d = dateDe(jour);
    final jd = d.weekday - 1; // lundi = 0
    d = DateTime(d.year, d.month, d.day - jd + 3, 12); // jeudi de la semaine
    final n = (((d.difference(DateTime(d.year, 1, 1, 12)).inHours / 24).round() + 1) / 7).ceil();
    return '${d.year}-W${deux(n)}';
  }

  static int _imul(int a, int b) {
    a &= 0xffffffff; b &= 0xffffffff;
    final ah = (a >> 16) & 0xffff, al = a & 0xffff, bh = (b >> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + ((((ah * bl) + (al * bh)) & 0xffff) << 16)) & 0xffffffff;
  }
  /// Petit hasard reproductible (missions tirées le même jour donnent les mêmes).
  static double Function() hasard(String graine) {
    var h = 2166136261;
    for (final c in graine.codeUnits) { h = _imul((h ^ c) & 0xffffffff, 16777619); }
    return () {
      h = _imul((h ^ (h >> 15)) & 0xffffffff, 2246822507);
      h = _imul((h ^ (h >> 13)) & 0xffffffff, 3266489909);
      h = (h ^ (h >> 16)) & 0xffffffff;
      return h / 4294967296;
    };
  }

  // ------------------------------------------------------------------ XP et niveau
  static const xpPartie = 2, xpManche = 2, xpKatapss = 5, xpFinale = 5, xpVictoire = 10, xpPremiere = 50;
  static const bareme = 2;
  static int xpPourNiveau(int n) => 100 + 50 * (n - 1);
  static int _ancienXpPourNiveau(int n) => 100 + 25 * (n - 1);
  static Niveau _niveauSelon(num xp, int Function(int) cout) {
    var n = 1;
    num reste = math.max(0, xp);
    while (reste >= cout(n)) { reste -= cout(n); n++; }
    return Niveau(n, reste.toInt(), cout(n));
  }
  static Niveau niveauDe(num? xp) => _niveauSelon(xp ?? 0, xpPourNiveau);
  static int debutNiveau(int n) { var t = 0; for (var i = 1; i < n; i++) { t += xpPourNiveau(i); } return t; }
  static bool convertirXp(Profil? p) {
    if (p == null || p['bareme'] == bareme) return false;
    final x = p['xp'];
    final xp = x is num && x > 0 ? x : 0;
    if (xp > 0) {
      final a = _niveauSelon(xp, _ancienXpPourNiveau);
      p['xp'] = debutNiveau(a.niveau) + ((a.dansNiveau / a.pourSuivant) * xpPourNiveau(a.niveau)).floor();
    }
    p['bareme'] = bareme;
    return true;
  }

  // ------------------------------------------------------------------ objets de collection
  static final Map<String, Map<String, dynamic>> objets = {
    'av-laiton': {'type': 'avatar', 'nom': 'Laiton', 'd': 'De base'},
    'av-nuit': {'type': 'avatar', 'nom': 'Nuit', 'd': 'Niveau 2'},
    'av-kinshasa': {'type': 'avatar', 'nom': 'RD Congo', 'd': 'Bienvenue, jour 3'},
    'av-fleuve': {'type': 'avatar', 'nom': 'Fleuve', 'd': 'Niveau 5'},
    'dos-laiton': {'type': 'dos', 'nom': 'Laiton', 'd': 'De base'},
    'dos-kinshasa': {'type': 'dos', 'nom': 'RD Congo', 'd': 'Bienvenue, jour 7'},
    'cadre-kinshasa': {'type': 'cadre', 'nom': 'RD Congo', 'd': 'Défi de la semaine'},
    'cadre-abidjan': {'type': 'cadre', 'nom': "Côte d'Ivoire", 'd': 'Défi de la semaine'},
    'cadre-dakar': {'type': 'cadre', 'nom': 'Sénégal', 'd': 'Défi de la semaine'},
    'cadre-douala': {'type': 'cadre', 'nom': 'Cameroun', 'd': 'Défi de la semaine'},
    'cadre-brazzaville': {'type': 'cadre', 'nom': 'Congo', 'd': 'Défi de la semaine'},
    'cadre-lubumbashi': {'type': 'cadre', 'nom': 'Lubumbashi', 'd': 'Ancien défi', 'ville': true},
  };
  static const categories = [
    {'type': 'avatar', 'nom': 'Avatars'},
    {'type': 'dos', 'nom': 'Dos de cartes'},
    {'type': 'cadre', 'nom': 'Cadres'},
  ];
  /// Range des objets ({id, type, …}) par catégorie ; les catégories vides sont omises.
  static List<({String nom, List<Map<String, dynamic>> objets})> parCategorie(List<Map<String, dynamic>> liste) => [
        for (final c in categories)
          if (liste.any((o) => o['type'] == c['type'])) (nom: c['nom']!, objets: liste.where((o) => o['type'] == c['type']).toList()),
      ];
  static const objetsNiveau = {2: 'av-nuit', 5: 'av-fleuve'};
  static Map<String, dynamic> collection(Profil p) {
    if (p['collection'] is! Map) p['collection'] = <String, dynamic>{};
    final c = p['collection'] as Map<String, dynamic>;
    if (c['possedes'] is! List) c['possedes'] = <dynamic>[];
    final pos = c['possedes'] as List;
    for (final id in ['av-laiton', 'dos-laiton']) { if (!pos.contains(id)) pos.add(id); }
    final e = c['equipes'] is Map ? Map<String, dynamic>.from(c['equipes'] as Map) : <String, dynamic>{};
    c['equipes'] = {'avatar': 'av-laiton', 'dos': 'dos-laiton', 'cadre': null, ...e};
    return c;
  }
  static bool donnerObjet(Profil p, String id) {
    final c = collection(p), o = objets[id];
    if (o == null || (c['possedes'] as List).contains(id)) return false;
    (c['possedes'] as List).add(id);
    (c['equipes'] as Map)[o['type']] = id;
    return true;
  }
  static bool equiper(Profil p, String id) {
    final c = collection(p), o = objets[id];
    if (o == null) return false;
    final eq = c['equipes'] as Map;
    if (o['type'] == 'cadre' && eq['cadre'] == id) { eq['cadre'] = null; return true; }
    if (!(c['possedes'] as List).contains(id)) return false;
    eq[o['type']] = id;
    return true;
  }

  // ------------------------------------------------------------------ missions du jour
  static final List<Modele> modeles = [
    Modele('jouer2', 'Joue 2 parties', 2, 20, (e) => 1),
    Modele('jouer3', 'Joue 3 parties', 3, 30, (e) => 1),
    Modele('jouer5', 'Joue 5 parties', 5, 50, (e) => 1),
    Modele('manches5', 'Survis à 5 manches', 5, 30, (e) => e.manches),
    Modele('manches10', 'Survis à 10 manches', 10, 60, (e) => e.manches),
    Modele('katapss', 'Fais un Katapss', 1, 60, (e) => e.katapss),
    Modele('premier2', 'Sors le premier de 2 manches', 2, 50, (e) => e.premierSorti),
    Modele('finale', 'Atteins une finale', 1, 40, (e) => e.finale ? 1 : 0),
    Modele('finales2', 'Atteins 2 finales', 2, 70, (e) => e.finale ? 1 : 0),
    Modele('gagner', 'Gagne une partie', 1, 80, (e) => e.victoire ? 1 : 0),
    Modele('gagner5', 'Gagne une partie à 5 joueurs ou plus', 1, 100, (e) => e.victoire && e.nbJoueurs >= 5 ? 1 : 0),
    Modele('moitie2', 'Finis 2 parties dans la première moitié', 2, 40, (e) => e.place <= (e.nbJoueurs / 2).ceil() ? 1 : 0),
    Modele('enligne', 'Joue une partie en ligne', 1, 40, (e) => e.publique ? 1 : 0),
    Modele('amis', 'Joue une partie entre amis', 1, 50, (e) => !e.publique && !e.avecRobots && e.nbJoueurs >= 2 ? 1 : 0),
    Modele('grande', 'Joue une partie à 7 joueurs ou plus', 1, 50, (e) => e.nbJoueurs >= 7 ? 1 : 0),
  ];
  static Modele? modele(Object? id) { for (final m in modeles) { if (m.id == id) return m; } return null; }
  static const parJour = 3, dureeMission = 2;
  static int xpMission(Modele m) => (m.pieces / 10).round();

  static List<Map<String, dynamic>> _tirerMissions(String jour, List exclus, int n, [String sel = '']) {
    final r = hasard('missions-$jour$sel');
    final libres = modeles.where((m) => !exclus.contains(m.id)).toList();
    final choix = <Modele>[];
    bool jouer(String id) => id.startsWith('jouer');
    final faciles = libres.where((m) => jouer(m.id)).toList();
    if (!exclus.any((id) => jouer(id.toString())) && faciles.isNotEmpty && n == parJour) choix.add(faciles[(r() * faciles.length).floor()]);
    while (choix.length < n) {
      final restes = libres.where((m) => !choix.contains(m) && !(choix.any((c) => jouer(c.id)) && jouer(m.id))).toList();
      if (restes.isEmpty) break;
      choix.add(restes[(r() * restes.length).floor()]);
    }
    return [for (final m in choix) {'id': m.id, 'jour': jour, 'avance': 0, 'finie': false}];
  }
  static Map<String, dynamic> _ms(Profil p) {
    if (p['missions'] is! Map) p['missions'] = <String, dynamic>{};
    final ms = p['missions'] as Map<String, dynamic>;
    if (ms['liste'] is! List) ms['liste'] = <dynamic>[];
    return ms;
  }
  static List<VueMission> missionsDuJour(Profil p, String jour) {
    final ms = _ms(p);
    ms['liste'] = (ms['liste'] as List).where((m) {
      if (modele(m['id']) == null) return false;
      if (m['finie'] == true) return m['aEncaisser'] == true;
      final e = ecart(m['jour'] as String, jour);
      return e >= 0 && e < dureeMission;
    }).toList();
    if (ms['tire'] != jour) {
      ms['tire'] = jour;
      ms['changeLe'] = null;
      final nouvelles = _tirerMissions(jour, (ms['liste'] as List).map((m) => m['id']).toList(), parJour);
      ms['liste'] = [...(ms['liste'] as List).where((m) => m['jour'] != jour), ...nouvelles];
    }
    return [for (final m in ms['liste'] as List) _vueMission(m as Map, jour)];
  }
  static VueMission _vueMission(Map m, String jour) {
    final md = modele(m['id'])!;
    return VueMission(m['id'] as String, md.texte, md.cible, math.min((m['avance'] as num).toInt(), md.cible), m['finie'] == true, m['finie'] == true && m['aEncaisser'] == true, md.pieces, xpMission(md), m['jour'] != jour, m['finieLe'] as String?);
  }
  static Map<String, dynamic>? encaisserMission(Profil p, String jour, String id) {
    missionsDuJour(p, jour);
    final liste = _ms(p)['liste'] as List;
    final i = liste.indexWhere((m) => m['id'] == id && m['finie'] == true && m['aEncaisser'] == true);
    if (i < 0) return null;
    final m = liste.removeAt(i) as Map;
    final md = modele(m['id'])!;
    crediter(p, md.pieces);
    final n = ajouterXp(p, xpMission(md));
    return {'id': m['id'], 'texte': md.texte, 'pieces': md.pieces, 'xp': xpMission(md), 'finieLe': m['finieLe'] ?? jour, 'niveauAvant': n.avant, 'niveauApres': n.apres, 'objets': n.objets};
  }
  static int aEncaisser(Profil p, String jour) => missionsDuJour(p, jour).where((m) => m.aEncaisser).length;
  static bool peutChanger(Profil p, String jour) => p['missions'] is Map && p['missions']['tire'] == jour && p['missions']['changeLe'] != jour;
  static bool changerMission(Profil p, String jour, String id) {
    missionsDuJour(p, jour);
    final ms = _ms(p), liste = ms['liste'] as List;
    final i = liste.indexWhere((m) => m['id'] == id && m['finie'] != true);
    if (i < 0 || !peutChanger(p, jour)) return false;
    final n = _tirerMissions(jour, liste.map((m) => m['id']).toList(), 1, '-changer');
    if (n.isEmpty) return false;
    liste[i] = n.first;
    ms['changeLe'] = jour;
    return true;
  }

  // ------------------------------------------------------------------ défi de la semaine
  static final List<Modele> defis = [
    Modele('gagner5', 'Gagne 5 parties cette semaine', 5, 0, (e) => e.victoire ? 1 : 0),
    Modele('parties15', 'Joue 15 parties cette semaine', 15, 0, (e) => 1),
    Modele('manches30', 'Survis à 30 manches cette semaine', 30, 0, (e) => e.manches),
    Modele('katapss3', 'Fais 3 Katapss cette semaine', 3, 0, (e) => e.katapss),
    Modele('finales6', 'Atteins 6 finales cette semaine', 6, 0, (e) => e.finale ? 1 : 0),
  ];
  static const cadres = ['cadre-kinshasa', 'cadre-abidjan', 'cadre-dakar', 'cadre-douala', 'cadre-brazzaville'];
  static const defiPieces = 300, defiXp = 30;
  static Map<String, dynamic> defiSemaine(Profil p, String jour) {
    final sem = semaineDe(jour);
    if (p['defi'] is! Map || p['defi']['semaine'] != sem) {
      final n = int.parse(sem.substring(sem.length - 2)) + int.parse(sem.substring(0, 4)) * 53;
      p['defi'] = {'semaine': sem, 'id': defis[n % defis.length].id, 'cadre': cadres[n % cadres.length], 'avance': 0, 'finie': false};
    }
    final pd = p['defi'] as Map;
    final d = defis.firstWhere((x) => x.id == pd['id'], orElse: () => defis.first);
    final fin = decaler(jour, 6 - (dateDe(jour).weekday - 1));
    return {'texte': d.texte, 'cible': d.cible, 'avance': math.min((pd['avance'] as num).toInt(), d.cible), 'finie': pd['finie'] == true, 'pieces': defiPieces, 'xp': defiXp, 'cadre': pd['cadre'], 'nomCadre': objets[pd['cadre']]?['nom'] ?? '', 'joursRestants': ecart(jour, fin) + 1};
  }

  // ------------------------------------------------------------------ parcours de bienvenue (7 jours de jeu)
  static const bienvenueCadeaux = [
    {'pieces': 100}, {'pieces': 150}, {'objet': 'av-kinshasa'}, {'pieces': 200},
    {'pieces': 250}, {'pieces': 300}, {'objet': 'dos-kinshasa'},
  ];
  static Map<String, dynamic> bienvenue(Profil p, String jour) {
    if (p['bienvenue'] is! Map) p['bienvenue'] = {'recus': 0, 'dernier': null};
    final b = p['bienvenue'] as Map;
    final recus = (b['recus'] as num? ?? 0).toInt();
    final aRecevoir = recus < bienvenueCadeaux.length && b['dernier'] != jour;
    return {
      'recus': recus, 'aRecevoir': aRecevoir, 'jour': aRecevoir ? recus + 1 : recus, 'termine': recus >= bienvenueCadeaux.length,
      'cadeaux': [for (final c in bienvenueCadeaux) {...c, if (c['objet'] != null) 'nom': objets[c['objet']]!['nom'], if (c['objet'] != null) 'type': objets[c['objet']]!['type']}],
    };
  }
  static Map<String, dynamic>? recevoirBienvenue(Profil p, String jour) {
    final e = bienvenue(p, jour);
    if (e['aRecevoir'] != true) return null;
    final b = p['bienvenue'] as Map;
    final c = bienvenueCadeaux[(b['recus'] as num).toInt()];
    b['recus'] = (b['recus'] as num).toInt() + 1;
    b['dernier'] = jour;
    if (c['pieces'] != null) crediter(p, c['pieces'] as int);
    if (c['objet'] != null) donnerObjet(p, c['objet'] as String);
    return {'jour': b['recus'], ...c};
  }

  // ------------------------------------------------------------------ bonus du jour + joker (hors ligne)
  static int gainBonus(int serie) => math.min(50 + (serie - 1) * 10, 150);
  static Map<String, dynamic> pieces(Profil p) {
    if (p['pieces'] is! Map) p['pieces'] = {'solde': 500, 'essai': true, 'bonusSerie': 0, 'bonusDernier': null};
    return p['pieces'] as Map<String, dynamic>;
  }
  static void crediter(Profil p, int n) { final pc = pieces(p); pc['solde'] = ((pc['solde'] as num?) ?? 0) + n; }
  static bool jokerLibre(Profil p, String jour) => pieces(p)['jokerSemaine'] != semaineDe(jour);

  // ------------------------------------------------------------------ bilan d'une partie
  /// suivi : { avecRobots, publique, katapss, premierSorti, guidee }
  static Bilan bilanPartie(Map v, Map suivi) {
    final ordre = [v['vainqueur'], ...(v['elimines'] as List).reversed];
    final place = ordre.indexOf(v['moi']) + 1;
    final nb = ordre.length;
    final elimines = v['elimines'] as List;
    final manches = place == 1 ? (v['numeroManche'] as num).toInt() : math.max(0, elimines.indexOf(v['moi']));
    final humains = (v['joueurs'] as List).where((j) => j['id'] != v['moi'] && j['robot'] != true);
    return Bilan(
      place: place, nbJoueurs: nb, manches: manches,
      finale: place > 0 && place <= 2 && nb >= 2, victoire: place == 1,
      katapss: (suivi['katapss'] as num? ?? 0).toInt(), premierSorti: (suivi['premierSorti'] as num? ?? 0).toInt(),
      avecRobots: suivi['avecRobots'] == true, publique: suivi['publique'] == true, guidee: suivi['guidee'] == true,
      adversaires: [for (final j in humains) (id: j['id'] as String, nom: (j['nom'] ?? '?') as String, devant: ordre.contains(j['id']) && ordre.indexOf(j['id']) < ordre.indexOf(v['moi']))],
    );
  }

  static const stats0 = {'parties': 0, 'victoires': 0, 'finales': 0, 'manchesSurvecues': 0, 'katapss': 0, 'eliminePremier': 0, 'battus': 0};
  static ({Niveau avant, Niveau apres, List<String> objets}) ajouterXp(Profil p, int n) {
    final avant = (p['xp'] as num? ?? 0).toInt();
    p['xp'] = avant + n;
    final na = niveauDe(avant), np = niveauDe(p['xp'] as num);
    final obj = <String>[];
    for (var k = na.niveau + 1; k <= np.niveau; k++) {
      final o = objetsNiveau[k];
      if (o != null && donnerObjet(p, o)) obj.add(o);
    }
    return (avant: na, apres: np, objets: obj);
  }

  static int _n(Object? x) => x is num ? x.toInt() : 0;

  /// Enregistre une partie terminée et renvoie le récap à montrer (XP, missions, défi, face-à-face).
  static Recap? enregistrerPartie(Profil p, Bilan e, String jour) {
    if (e.place < 1) return null;
    convertirXp(p);
    final xpAvant = _n(p['xp']);
    final premiere = p['premierePartie'] == null;
    var xp = xpPartie + e.manches * xpManche + e.katapss * xpKatapss + (e.finale ? xpFinale : 0) + (e.victoire ? xpVictoire : 0);
    if (e.avecRobots) xp = math.max(1, (xp / 2).floor());
    if (premiere) { xp += xpPremiere; p['premierePartie'] = jour; }
    if (e.avecRobots) {
      final en = p['entrainement'] is Map ? p['entrainement'] as Map : (p['entrainement'] = {'parties': 0, 'victoires': 0});
      en['parties'] = _n(en['parties']) + 1;
      if (e.victoire) en['victoires'] = _n(en['victoires']) + 1;
    } else {
      final s = <String, dynamic>{...stats0, ...((p['stats'] as Map?)?.cast<String, dynamic>() ?? {})};
      p['stats'] = s;
      s['parties'] = _n(s['parties']) + 1;
      if (e.victoire) s['victoires'] = _n(s['victoires']) + 1;
      if (e.finale) s['finales'] = _n(s['finales']) + 1;
      s['manchesSurvecues'] = _n(s['manchesSurvecues']) + e.manches;
      s['katapss'] = _n(s['katapss']) + e.katapss;
      if (e.place == e.nbJoueurs) s['eliminePremier'] = _n(s['eliminePremier']) + 1;
      s['battus'] = _n(s['battus']) + math.max(0, e.nbJoueurs - e.place);
    }
    FaceAFace? faceAFace;
    if (estDuel(e)) {
      final rv = p['rivaux'] is Map ? p['rivaux'] as Map : (p['rivaux'] = <String, dynamic>{});
      for (final a in e.adversaires) {
        final r = rv[a.id] is Map ? rv[a.id] as Map : (rv[a.id] = {'pseudo': a.nom, 'gagnes': 0, 'perdus': 0});
        r['pseudo'] = a.nom; r['vuLe'] = jour;
        if (a.devant) { r['perdus'] = _n(r['perdus']) + 1; } else { r['gagnes'] = _n(r['gagnes']) + 1; }
      }
      final choisi = e.adversaires.first;
      final r = rv[choisi.id] as Map;
      faceAFace = FaceAFace(choisi.id, r['pseudo'] as String, _n(r['gagnes']), _n(r['perdus']), !choisi.devant);
      faceAFace.taquinerie = taquinerie(faceAFace.nom, faceAFace.gagnes, faceAFace.perdus, faceAFace.gagne);
      final ids = rv.keys.toList();
      if (ids.length > 200) {
        ids.sort((a, b) => ((rv[a]['vuLe'] ?? '') as String).compareTo((rv[b]['vuLe'] ?? '') as String));
        for (final id in ids.take(ids.length - 200)) { rv.remove(id); }
      }
    }
    missionsDuJour(p, jour);
    final missions = <LigneMission>[];
    var piecesGagnees = 0, xpMissions = 0;
    for (final m in _ms(p)['liste'] as List) {
      if (m['finie'] == true) continue;
      final md = modele(m['id'])!;
      final n = md.compte(e);
      if (n == 0) continue;
      final avant = _n(m['avance']);
      m['avance'] = math.min(md.cible, avant + n);
      if (_n(m['avance']) >= md.cible) { m['finie'] = true; m['finieLe'] = jour; m['aEncaisser'] = true; }
      missions.add(LigneMission(md.texte, avant, _n(m['avance']), md.cible, m['finie'] == true, m['finie'] == true, md.pieces));
    }
    defiSemaine(p, jour);
    LigneMission? defi;
    final pd = p['defi'] as Map;
    if (pd['finie'] != true) {
      final d = defis.firstWhere((x) => x.id == pd['id']);
      final n = d.compte(e);
      if (n > 0) {
        final avant = _n(pd['avance']);
        pd['avance'] = math.min(d.cible, avant + n);
        if (_n(pd['avance']) >= d.cible) { pd['finie'] = true; piecesGagnees += defiPieces; xpMissions += defiXp; donnerObjet(p, pd['cadre'] as String); }
        defi = LigneMission(d.texte, avant, _n(pd['avance']), d.cible, pd['finie'] == true, false, defiPieces, defi: true);
      }
    }
    if (piecesGagnees > 0) crediter(p, piecesGagnees);
    p['xp'] = xpAvant;
    final x = ajouterXp(p, xp + xpMissions);
    return Recap(xpPartie: xp, xpMissions: xpMissions, niveauAvant: x.avant, niveauApres: x.apres, missions: missions, defi: defi,
        piecesGagnees: piecesGagnees, faceAFace: faceAFace, objets: x.objets, premiere: premiere, titre: titre(p), bilan: e);
  }

  static bool estDuel(Bilan? e) => e != null && !e.avecRobots && e.nbJoueurs == 2 && e.adversaires.length == 1;

  static String? taquinerie(String? n, int g, int p, bool gagne) {
    if (n == null || n.isEmpty) return null;
    String pl(int k) => k > 1 ? 's' : '';
    if (gagne) {
      if (g == 1 && p == 0) return 'Première victoire contre $n. Ça commence !';
      if (g >= 10 && g > p && (g - 1 < 10 || g - 1 <= p)) return 'Tu deviens le Cauchemar de $n !';
      if (g >= 10 && g > p) return 'Toujours le Cauchemar de $n.';
      if (g == p) return "Égalité ! $n n'est plus tranquille.";
      if (g == p + 1) return 'Tu repasses devant $n !';
      if (p == 0 && g >= 3) return '$g – 0 : $n cherche encore sa première victoire.';
      if (g - p >= 5) return '$n devient ton client préféré.';
      if (p > g) return 'Tu reviens : plus que ${p - g} victoire${pl(p - g)} de retard sur $n.';
      return 'Encore une pour toi contre $n.';
    }
    if (p == 1 && g == 0) return '$n ouvre le score. Revanche ?';
    if (g >= 10 && g == p) return "$n t'a repris le titre de Cauchemar !";
    if (p >= 10 && p > g && (p - 1 < 10 || p - 1 <= g)) return '$n a fait de toi son client préféré… Réagis !';
    if (g == p) return '$n revient à égalité. Revanche ?';
    if (p == g + 1) return '$n passe devant toi.';
    if (g == 0 && p >= 3) return '0 – $p : $n te connaît par cœur.';
    if (p - g >= 5) return '$n devient ta bête noire.';
    if (g > p) return '$n se rapproche, attention !';
    return '$n creuse l\'écart.';
  }

  static String? titre(Profil p) {
    Map? meilleur;
    final rv = p['rivaux'];
    if (rv is Map) {
      for (final r in rv.values) {
        final g = _n(r['gagnes']), pe = _n(r['perdus']);
        if (g >= 10 && g > pe && (meilleur == null || g - pe > _n(meilleur['gagnes']) - _n(meilleur['perdus']))) meilleur = r as Map;
      }
    }
    return meilleur == null ? null : 'Le Cauchemar de ${meilleur['pseudo']}';
  }

  // ------------------------------------------------------------------ réunir deux profils
  static String signatureProfil(Map p) => [p['premierePartie'] ?? '', p['xp'] ?? 0, (p['stats'] is Map ? p['stats']['parties'] : null) ?? 0, (p['entrainement'] is Map ? p['entrainement']['parties'] : null) ?? 0].join('|');
  static bool fusionnerProfils(Profil p, Object? ancienBrut, [String mode = 'somme']) {
    if (ancienBrut is! Map) return false;
    var ancien = Map<String, dynamic>.from(ancienBrut);
    if (!(_n(ancien['xp']) > 0 || ancien['premierePartie'] != null)) return false;
    final sig = signatureProfil(ancien);
    convertirXp(p);
    if (ancien['bareme'] != bareme) { ancien = Map<String, dynamic>.from(ancien); convertirXp(ancien); }
    final deja = p['fusions'] is List ? List.from(p['fusions'] as List) : <dynamic>[];
    if (deja.contains(sig)) return false;
    if (p['premierePartie'] != null && p['premierePartie'] == ancien['premierePartie'] && _n(p['xp']) >= _n(ancien['xp'])) return false;
    int plus(Object? a, Object? b) => mode == 'max' ? math.max(_n(a), _n(b)) : _n(a) + _n(b);
    p['xp'] = plus(p['xp'], ancien['xp']);
    for (final (cle, zero) in [('stats', stats0), ('entrainement', const {'parties': 0, 'victoires': 0})]) {
      if (ancien[cle] is! Map) continue;
      final s = <String, dynamic>{...zero, ...((p[cle] as Map?)?.cast<String, dynamic>() ?? {})};
      p[cle] = s;
      for (final k in zero.keys) { s[k] = plus(s[k], ancien[cle][k]); }
    }
    if (ancien['rivaux'] is Map) {
      final rv = p['rivaux'] is Map ? p['rivaux'] as Map : (p['rivaux'] = <String, dynamic>{});
      (ancien['rivaux'] as Map).forEach((id, a) {
        final r = rv[id];
        if (r is! Map) { rv[id] = Map<String, dynamic>.from(a as Map); return; }
        r['gagnes'] = plus(r['gagnes'], a['gagnes']); r['perdus'] = plus(r['perdus'], a['perdus']);
        if (r['vuLe'] == null || (a['vuLe'] != null && (a['vuLe'] as String).compareTo(r['vuLe'] as String) > 0)) { r['vuLe'] = a['vuLe']; r['pseudo'] = a['pseudo'] ?? r['pseudo']; }
      });
    }
    if (ancien['premierePartie'] != null && (p['premierePartie'] == null || (ancien['premierePartie'] as String).compareTo(p['premierePartie'] as String) < 0)) p['premierePartie'] = ancien['premierePartie'];
    if (ancien['fondateur'] != null && p['fondateur'] == null) p['fondateur'] = ancien['fondateur'];
    if (ancien['bienvenue'] is Map && (p['bienvenue'] is! Map || _n(ancien['bienvenue']['recus']) > _n(p['bienvenue']['recus']))) p['bienvenue'] = Map<String, dynamic>.from(ancien['bienvenue'] as Map);
    if (ancien['pieces'] is Map && (p['pieces'] is! Map || _n(ancien['pieces']['solde']) > _n(p['pieces']['solde']))) p['pieces'] = Map<String, dynamic>.from(ancien['pieces'] as Map);
    if (ancien['collection'] is Map && ancien['collection']['possedes'] is List) {
      final c = collection(p), ca = ancien['collection'] as Map;
      for (final id in ca['possedes'] as List) { if (!(c['possedes'] as List).contains(id)) (c['possedes'] as List).add(id); }
      const base = {'avatar': 'av-laiton', 'dos': 'dos-laiton', 'cadre': null};
      for (final t in base.keys) {
        final v = ca['equipes'] is Map ? ca['equipes'][t] : null;
        if (v != null && v != base[t] && (c['equipes'] as Map)[t] == base[t]) (c['equipes'] as Map)[t] = v;
      }
    }
    deja.add(sig);
    p['fusions'] = deja.length > 20 ? deja.sublist(deja.length - 20) : deja;
    return true;
  }
}

class Niveau {
  final int niveau, dansNiveau, pourSuivant;
  const Niveau(this.niveau, this.dansNiveau, this.pourSuivant);
  double get fraction => pourSuivant == 0 ? 0 : dansNiveau / pourSuivant;
}

class Modele {
  final String id, texte;
  final int cible, pieces;
  final int Function(Bilan) compte;
  const Modele(this.id, this.texte, this.cible, this.pieces, this.compte);
}

class VueMission {
  final String id, texte;
  final int cible, avance, pieces, xp;
  final bool finie, aEncaisser, hier;
  final String? finieLe;
  VueMission(this.id, this.texte, this.cible, this.avance, this.finie, this.aEncaisser, this.pieces, this.xp, this.hier, this.finieLe);
}

class Bilan {
  final int place, nbJoueurs, manches, katapss, premierSorti;
  final bool finale, victoire, avecRobots, publique, guidee;
  final List<({String id, String nom, bool devant})> adversaires;
  Bilan({required this.place, required this.nbJoueurs, required this.manches, required this.finale, required this.victoire, required this.katapss,
      required this.premierSorti, required this.avecRobots, required this.publique, required this.guidee, required this.adversaires});
}

class FaceAFace {
  final String id, nom;
  int gagnes, perdus;
  final bool gagne;
  String? taquinerie;
  FaceAFace(this.id, this.nom, this.gagnes, this.perdus, this.gagne);
}

class LigneMission {
  final String texte;
  final int avant, apres, cible, pieces;
  final bool finie, aEncaisser, defi;
  LigneMission(this.texte, this.avant, this.apres, this.cible, this.finie, this.aEncaisser, this.pieces, {this.defi = false});
}

class Recap {
  final int xpPartie, xpMissions, piecesGagnees;
  final Niveau niveauAvant, niveauApres;
  final List<LigneMission> missions;
  final LigneMission? defi;
  final FaceAFace? faceAFace;
  final List<String> objets;
  final bool premiere;
  final String? titre;
  final Bilan bilan;
  Recap({required this.xpPartie, required this.xpMissions, required this.niveauAvant, required this.niveauApres, required this.missions, required this.defi,
      required this.piecesGagnees, required this.faceAFace, required this.objets, required this.premiere, required this.titre, required this.bilan});
}
