// Connexion Google par Supabase, comme sur le site : on ouvre la page d'autorisation de Supabase,
// qui revient dans l'appli (com.masano.masano://login-callback#access_token=…), puis POST /connexion.
import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

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
    if (jeton != null && jeton.isNotEmpty) {
      app.finirConnexionGoogle(jeton);
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

  /// supabaseUrl : config.google (l'origine du projet Supabase).
  static Future<void> connecter(String supabaseUrl) async {
    final origine = Uri.parse(supabaseUrl).origin;
    final retour = kIsWeb ? Uri.base.replace(fragment: '', query: '').toString() : retourAppli;
    final url = Uri.parse('$origine/auth/v1/authorize?provider=google&redirect_to=${Uri.encodeComponent(retour)}');
    final ok = await launchUrl(url, mode: kIsWeb ? LaunchMode.platformDefault : LaunchMode.externalApplication, webOnlyWindowName: kIsWeb ? '_self' : null);
    if (!ok) app.toast("Impossible d'ouvrir la connexion Google.");
  }
}
