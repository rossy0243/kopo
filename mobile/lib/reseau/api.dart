// API du serveur Masano (/api/v1), comme apiJoueur() du site : jeton Bearer, en-tête X-Masano-Client,
// messages d'erreur en français à montrer tels quels.
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../commun/stock.dart';

class Api {
  static const serveurParDefaut = 'https://kopo-serveur.onrender.com';
  /// Pour essayer un autre serveur : flutter run --dart-define=SERVEUR=http://10.0.2.2:2567
  static const serveur = String.fromEnvironment('SERVEUR', defaultValue: serveurParDefaut);
  static const version = '1.0.0';
  static String get plateforme => kIsWeb ? 'web' : (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
  static Map<String, String> get entetes => {'X-Masano-Client': '$plateforme/$version'};

  /// Appelé quand le serveur répond 426 (appli trop ancienne) avec le lien du store.
  static void Function(String? store)? surMiseAJour;

  static Map<String, dynamic>? get compte {
    final c = Stock.lire('kopo-compte-serveur');
    return c is Map && c['jeton'] != null ? c.cast<String, dynamic>() : null;
  }
  static String? get jeton => compte?['jeton'] as String?;

  static String erreurServeur(int statut) {
    if (statut == 0) return 'Pas de connexion au serveur. Vérifie ton réseau et réessaie.';
    if (statut == 404) return "Le serveur n'est pas encore à jour. Réessaie dans quelques minutes.";
    if (statut >= 502) return 'Le serveur redémarre. Réessaie dans une minute.';
    return 'Le serveur ne répond pas ($statut).';
  }

  /// Appel avec le jeton du compte. Lève ErreurApi (message à montrer) si ça échoue.
  static Future<dynamic> appel(String chemin, {String methode = 'GET', Object? corps, bool sansJeton = false, Duration delai = const Duration(seconds: 70)}) async {
    final j = jeton;
    if (!sansJeton && j == null) throw ErreurApi(401, 'Il faut un compte en ligne.');
    final url = Uri.parse('$serveur/api/v1$chemin');
    final h = {
      ...entetes,
      'accept': 'application/json',
      if (corps != null) 'content-type': 'application/json',
      if (j != null) 'authorization': 'Bearer $j',
    };
    http.Response r;
    try {
      final b = corps == null ? null : jsonEncode(corps);
      r = await switch (methode) {
        'POST' => http.post(url, headers: h, body: b ?? '{}'),
        'PUT' => http.put(url, headers: h, body: b),
        'PATCH' => http.patch(url, headers: h, body: b),
        'DELETE' => http.delete(url, headers: h, body: b),
        _ => http.get(url, headers: h),
      }.timeout(delai);
    } catch (_) {
      throw ErreurApi(0, erreurServeur(0));
    }
    dynamic json;
    try { json = r.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(r.bodyBytes)); } catch (_) {}
    if (r.statusCode == 426) {
      surMiseAJour?.call(json is Map && json['miseAJour'] is Map ? json['miseAJour']['store'] as String? : null);
    }
    if (r.statusCode < 200 || r.statusCode >= 300) {
      final m = json is Map && json['erreur'] != null ? json['erreur'].toString() : erreurServeur(r.statusCode);
      throw ErreurApi(r.statusCode, m);
    }
    return json ?? {};
  }

  static Future<dynamic> get(String c) => appel(c);
  static Future<dynamic> post(String c, [Object? corps]) => appel(c, methode: 'POST', corps: corps ?? {});
  static Future<dynamic> patch(String c, Object corps) => appel(c, methode: 'PATCH', corps: corps);
  static Future<dynamic> put(String c, Object corps) => appel(c, methode: 'PUT', corps: corps);
  static Future<dynamic> delete(String c, [Object? corps]) => appel(c, methode: 'DELETE', corps: corps);
}

class ErreurApi implements Exception {
  final int statut;
  final String message;
  ErreurApi(this.statut, this.message);
  @override
  String toString() => message;
}
