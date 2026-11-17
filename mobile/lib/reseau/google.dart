// Connexion Google par Supabase : on ouvre la page d'autorisation de Supabase, qui revient dans l'appli,
// puis POST /connexion.
// Sécurité (17/11) : sur Android et iOS, méthode PKCE. Le lien de retour (com.masano.masano://login-callback?code=…)
// ne porte qu'un code à usage unique, échangé contre le jeton avec un secret (code_verifier) resté dans l'appli :
// une autre appli qui intercepterait le lien ne pourrait rien en faire. Sur le web : retour direct (#access_token=…).
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../commun/stock.dart';
import '../etat.dart';

class Google {
  static const retourAppli = 'com.masano.masano://login-callback';
  static StreamSubscription? _ecoute;

  /// À l'ouverture : écoute les retours de connexion (et le lien qui a ouvert l'appli).
  static Future<void> brancher() async {
    if (kIsWeb) {
      _lireLien(Uri.base);
      return;
    }
    try {
      final liens = AppLinks();
      _ecoute ??= liens.uriLinkStream.listen(_lireLien, onError: (_) {});
    } catch (_) {}
  }

  static void _lireLien(Uri u) {
    final f = Uri.splitQueryString(u.fragment.isNotEmpty ? u.fragment : u.query);
    final jeton = f['access_token'];
    final code = u.queryParameters['code'];
    if (jeton != null && jeton.isNotEmpty && kIsWeb) {
      app.finirConnexionGoogle(jeton);
    } else if (code != null && code.isNotEmpty && u.toString().startsWith(retourAppli)) {
      _echanger(code);
    } else if (f['error_description'] != null) {
      app.toast('Connexion Google annulée.');
    }
    // Liens du site : ?parrain=CODE, ?bande=CODE, #CODE (une table).
    final q = u.queryParameters;
    final parrain = (q['parrain'] ?? '').toUpperCase();
    if (RegExp(r'^[A-Z0-9]{6}$').hasMatch(parrain)) app.noterParrain(parrain);
    final bande = (q['bande'] ?? '').toUpperCase();
    if (RegExp(r'^[A-Z0-9]{6}$').hasMatch(bande)) app.noterBande(bande);
  }

  // PKCE : secret aléatoire gardé sur le téléphone, et son empreinte SHA-256 envoyée à Supabase.
  static const _cleVerifier = 'kopo-google-pkce';
  static String _aleatoire() {
    final r = Random.secure();
    return base64Url.encode(List<int>.generate(48, (_) => r.nextInt(256))).replaceAll('=', '');
  }
  static String _empreinte(String v) => base64Url.encode(sha256.convert(ascii.encode(v)).bytes).replaceAll('=', '');

  // Échange le code du lien de retour contre le jeton Supabase (une seule fois : le secret est effacé ensuite).
  static Future<void> _echanger(String code) async {
    final v = Stock.lire(_cleVerifier);
    if (v is! Map || v['verifier'] is! String || v['origine'] is! String) return;
    Stock.effacer(_cleVerifier);
    final cle = ((app.config?['supabase'] as Map?)?['cleAnon'] as String?) ?? '';
    try {
      final r = await http.post(Uri.parse('${v['origine']}/auth/v1/token?grant_type=pkce'),
          headers: {'content-type': 'application/json', if (cle.isNotEmpty) 'apikey': cle},
          body: jsonEncode({'auth_code': code, 'code_verifier': v['verifier']}));
      final j = jsonDecode(r.body);
      final jeton = j is Map ? j['access_token'] : null;
      if (r.statusCode == 200 && jeton is String && jeton.isNotEmpty) {
        app.finirConnexionGoogle(jeton);
      } else {
        app.toast('Connexion Google refusée. Réessaie.');
      }
    } catch (_) {
      app.toast('Pas de connexion au serveur. Vérifie ton réseau et réessaie.');
    }
  }

  /// supabaseUrl : config.google (l'origine du projet Supabase).
  static Future<void> connecter(String supabaseUrl) async {
    final origine = Uri.parse(supabaseUrl).origin;
    final retour = kIsWeb ? Uri.base.replace(fragment: '', query: '').toString() : retourAppli;
    var pkce = '';
    if (!kIsWeb) {
      final verifier = _aleatoire();
      Stock.ecrire(_cleVerifier, {'verifier': verifier, 'origine': origine});
      pkce = '&code_challenge=${_empreinte(verifier)}&code_challenge_method=s256';
    }
    final url = Uri.parse('$origine/auth/v1/authorize?provider=google&redirect_to=${Uri.encodeComponent(retour)}$pkce');
    final ok = await launchUrl(url, mode: kIsWeb ? LaunchMode.platformDefault : LaunchMode.externalApplication, webOnlyWindowName: kIsWeb ? '_self' : null);
    if (!ok) app.toast("Impossible d'ouvrir la connexion Google.");
  }
}
