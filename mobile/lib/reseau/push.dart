// Notifications push (FCM) : le jeton du téléphone est donné au serveur (POST /push/natif).
// Il faut d'abord lancer « flutterfire configure » (voir README) : sans configuration Firebase,
// l'appli marche normalement, sans notifications. L'autorisation est demandée au premier démarrage.
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
  /// Notification reçue appli ouverte (Android ne l'affiche pas lui-même) : titre, texte, données.
  static void Function(String titre, String texte, Map<String, dynamic> donnees)? surRecevoir;
  /// Réponse du téléphone à la demande d'autorisation (null : pas encore demandé).
  static bool? autorise;

  static Future<void> initialiser() async {
    if (kIsWeb) return;
    try {
      await Firebase.initializeApp();
      pret = true;
      // iOS : montrer aussi la notification quand l'appli est ouverte.
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
      FirebaseMessaging.onMessage.listen((m) {
        final n = m.notification;
        if (n != null && defaultTargetPlatform == TargetPlatform.android) surRecevoir?.call(n.title ?? '', n.body ?? '', m.data);
      });
      FirebaseMessaging.onMessageOpenedApp.listen((m) => surToucher?.call(m.data));
      final premier = await FirebaseMessaging.instance.getInitialMessage();
      if (premier != null) Timer(const Duration(seconds: 3), () => surToucher?.call(premier.data));
      FirebaseMessaging.instance.onTokenRefresh.listen((t) { jeton = t; _envoyer(); });
    } catch (e) {
      // Le plus souvent : google-services.json / GoogleService-Info.plist absent de la version construite.
      debugPrint('Push : Firebase ne démarre pas, pas de notifications ($e)');
      pret = false;
    }
  }

  /// Activées par défaut ; seul le joueur les coupe (Paramètres > Notifications > Sur ce téléphone).
  static bool get actif => Stock.lire('kopo-push-natif') != false && autorise != false;

  /// Au démarrage : le téléphone demande l'autorisation (Android 13+, iOS) tant que le joueur ne les a pas coupées.
  /// Le téléphone ne repose pas la question s'il a déjà eu une réponse : l'appel ne dérange qu'une fois.
  static Future<void> demanderAuDemarrage() async {
    if (!pret || Stock.lire('kopo-push-natif') == false) return;
    try {
      final r = await FirebaseMessaging.instance.requestPermission();
      autorise = r.authorizationStatus == AuthorizationStatus.authorized || r.authorizationStatus == AuthorizationStatus.provisional;
    } catch (e) {
      debugPrint('Push : demande d\'autorisation impossible ($e)');
    }
    await synchroniser();
  }

  /// Demande la permission (Android 13+, iOS) puis enregistre le jeton. Lève un message à montrer.
  static Future<void> activer() async {
    if (!pret) throw Exception("Les notifications ne sont pas encore configurées dans cette version de l'appli.");
    final r = await FirebaseMessaging.instance.requestPermission();
    autorise = r.authorizationStatus != AuthorizationStatus.denied;
    if (!autorise!) throw Exception('Notifications bloquées : autorise-les dans les réglages du téléphone pour Masano.');
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
