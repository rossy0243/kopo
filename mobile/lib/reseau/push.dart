// Notifications push (FCM) : le jeton du téléphone est donné au serveur (POST /push/natif).
// Il faut d'abord lancer « flutterfire configure » (voir README) : sans configuration Firebase,
// l'appli marche normalement, sans notifications.
import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../commun/stock.dart';
import 'api.dart';

class Push {
  static bool pret = false;
  static String? jeton;
  static void Function(Map<String, dynamic> donnees)? surToucher;

  static Future<void> initialiser() async {
    if (kIsWeb) return;
    try {
      await Firebase.initializeApp();
      pret = true;
      FirebaseMessaging.onMessageOpenedApp.listen((m) => surToucher?.call(m.data));
      final premier = await FirebaseMessaging.instance.getInitialMessage();
      if (premier != null) Timer(const Duration(seconds: 3), () => surToucher?.call(premier.data));
      FirebaseMessaging.instance.onTokenRefresh.listen((t) { jeton = t; _envoyer(); });
    } catch (_) {
      pret = false;
    }
  }

  static bool get actif => Stock.lire('kopo-push-natif') == true;

  /// Demande la permission (Android 13+, iOS) puis enregistre le jeton. Lève un message à montrer.
  static Future<void> activer() async {
    if (!pret) throw Exception("Les notifications ne sont pas encore configurées dans cette version de l'appli.");
    final r = await FirebaseMessaging.instance.requestPermission();
    if (r.authorizationStatus == AuthorizationStatus.denied) throw Exception('Notifications bloquées : autorise-les dans les réglages du téléphone pour Masano.');
    Stock.ecrire('kopo-push-natif', true);
    await synchroniser();
  }

  static Future<void> couper() async {
    Stock.ecrire('kopo-push-natif', false);
    if (jeton != null) await Api.delete('/push/natif', {'jeton': jeton}).catchError((_) => null);
  }

  /// Au démarrage et après la connexion : le serveur garde le jeton de ce téléphone.
  static Future<void> synchroniser() async {
    if (!pret || !actif || Api.jeton == null) return;
    try { jeton ??= await FirebaseMessaging.instance.getToken(); } catch (_) {}
    await _envoyer();
  }

  static Future<void> _envoyer() async {
    if (jeton == null || Api.jeton == null || !actif) return;
    await Api.post('/push/natif', {'jeton': jeton, 'plateforme': Api.plateforme, 'appareil': defaultTargetPlatform == TargetPlatform.iOS ? 'iPhone' : 'Android'}).catchError((_) => null);
  }
}
