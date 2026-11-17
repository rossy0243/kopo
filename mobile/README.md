# Masano (appli mobile Flutter)

L'appli Android / iOS de Masano : Kopo et Inter (8), entre amis, en ligne, contre les robots, avec la ligue,
le match du jour, la bande, les missions, la boutique, les amis et les notifications. Elle reprend le site
(`src/source.html`) écran par écran et parle au même serveur (`https://kopo-serveur.onrender.com`, API `/api/v1`).

## Lancer l'appli

Il faut Flutter 3.47 ou plus récent (Dart 3.13), et Android Studio (Android) ou Xcode (iOS).

```bash
cd mobile
flutter pub get
flutter run            # sur le téléphone branché ou l'émulateur
```

Par défaut l'appli joue sur le serveur en ligne. Pour un serveur local :

```bash
flutter run --dart-define=SERVEUR=http://10.0.2.2:2567   # émulateur Android
```

Pour une version à installer : `flutter build apk --release` (Android) ou `flutter build ipa` (iOS).

## À faire une seule fois

1. **Notifications (Firebase)** : sans ces étapes, l'appli marche mais ne demande pas l'autorisation et ne reçoit rien.
   - Projet Firebase : `masano-44770`. Les applis Android et iOS (`com.masano.masano`) y sont créées, et leurs fichiers
     `android/app/google-services.json` et `ios/Runner/GoogleService-Info.plist` (déjà ajouté au projet Xcode) sont dans
     le dépôt. Ils ne sont pas secrets. Pour les régénérer : `firebase apps:sdkconfig ANDROID|IOS <id> --project masano-44770`.
     Le plugin Gradle `google-services` s'active tout seul quand `google-services.json` est là.
   - iOS : dans le [portail Apple](https://developer.apple.com/account/resources/authkeys/list), créer une clé APNs (.p8),
     puis la déposer dans la console Firebase (*Paramètres du projet → Cloud Messaging → Configuration de l'appli Apple*).
     Le droit « Push Notifications » est déjà dans `ios/Runner/Runner.entitlements` ; vérifier qu'il est coché pour
     `com.masano.masano` dans le portail Apple (Identifiers) avant de régénérer le profil.
   - Serveur (Render) : variable `FCM_COMPTE_SERVICE` = le JSON du compte de service (console Firebase → *Paramètres du projet
     → Comptes de service → Générer une nouvelle clé privée*), tel quel ou en base64. Sans elle, le serveur n'envoie rien aux applis
     et Paramètres affiche « Bientôt disponibles ».
   - Vérifier : au premier lancement, le téléphone demande « Autoriser Masano à envoyer des notifications ? ». Une notification
     d'essai peut partir de la console Firebase (*Messaging → Nouvelle campagne → Envoyer un message test*).
2. **Connexion Google (Supabase)** : dans Supabase, *Authentication → URL Configuration → Redirect URLs*,
   ajouter `com.masano.masano://login-callback`.
3. **Identifiant de l'appli** : `com.masano.masano` (Android `applicationId` et iOS bundle id).
   Pour le changer : `android/app/build.gradle.kts`, `ios/Runner.xcodeproj`, et `retourAppli` dans
   `lib/reseau/google.dart` (et l'URL de retour dans Supabase).
4. **Publication Android (Play Store)** : la version « release » se signe avec ta clé de publication, lue dans
   `android/key.properties` (ce fichier et la clé ne vont jamais sur GitHub, ils sont ignorés). Une seule fois :
   ```bash
   keytool -genkey -v -keystore ~/masano-publication.jks -keyalg RSA -keysize 2048 -validity 10000 -alias masano
   ```
   puis créer `mobile/android/key.properties` :
   ```
   storePassword=<mot de passe de la clé>
   keyPassword=<mot de passe de la clé>
   keyAlias=masano
   storeFile=/chemin/vers/masano-publication.jks
   ```
   `flutter build appbundle --release` donne alors le fichier à envoyer au Play Store. **Garde la clé et ses mots
   de passe en lieu sûr** : sans eux, plus de mise à jour possible de l'appli. Sans `key.properties`, la version
   « release » est signée avec la clé de test (elle s'installe sur un téléphone, mais le Play Store la refuse).
5. **Liens des stores** : une fois l'appli publiée, coller les liens Play Store et App Store dans le tableau de bord,
   onglet *Pilotage*, « Applis mobiles » (ils servent au message « mets à jour »).
6. **iOS** : régler l'équipe Apple dans Xcode (*Signing & Capabilities*).

## Organisation du code

- `lib/etat.dart` : l'état de l'appli (écran, vue de la partie, compte, fenêtre ouverte), comme l'état global du site.
- `lib/reseau/` : API `/api/v1`, salles Colyseus (WebSocket), connexion Google, notifications.
- `lib/ecrans/` : accueil, salon, partie (Kopo et Inter), racine (fenêtres, toasts, animations).
- `lib/fenetres/` : toutes les fenêtres (fin de manche, récap, amis, ligue, missions, profil, boutique, paramètres, tutoriel…).
- `lib/commun/` : thème, cartes, sons, stockage local, rétention.

`flutter analyze` et `flutter test` doivent passer avant chaque envoi.
