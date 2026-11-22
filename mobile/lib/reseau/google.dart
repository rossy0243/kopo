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
      app.toast('Connexion Google annulée.', Niv.alerte);
    }
    // Liens du jeu (https://masano.online/kopo/#CODE, ?bande=, ?parrain=…, ou masano://ouvrir?… depuis le bandeau
    // « Ouvrir dans l'appli » du site) : traités par les fenêtres (branchement.dart).
    if (u.scheme == 'masano' || (u.scheme == 'https' && RegExp(r'^(www\.)?masano\.online$').hasMatch(u.host)) || kIsWeb) surLienJeu?.call(u);
  }

  /// Branché par les fenêtres : un lien du jeu a ouvert l'appli (ou l'a remise devant).
  static void Function(Uri)? surLienJeu;

  /// supabaseUrl : config.google (l'origine du projet Supabase).
  static Future<void> connecter(String supabaseUrl) async {
    final origine = Uri.parse(supabaseUrl).origin;
    final retour = kIsWeb ? Uri.base.replace(fragment: '', query: '').toString() : retourAppli;
    final url = Uri.parse('$origine/auth/v1/authorize?provider=google&redirect_to=${Uri.encodeComponent(retour)}');
    final ok = await launchUrl(url, mode: kIsWeb ? LaunchMode.platformDefault : LaunchMode.externalApplication, webOnlyWindowName: kIsWeb ? '_self' : null);
    if (!ok) app.toast("Impossible d'ouvrir la connexion Google.", Niv.echec);
  }
}
