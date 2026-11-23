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
4. **Publication Android (Play Store)** : la clé de signature fixe de Masano (alias `masano`, empreinte SHA-256
   `2B:1C:A9:47:…:F8:E5:2A`) est rangée dans les fichiers du projet, jamais dans le dépôt. GitHub la reçoit par deux
   secrets (*Settings → Secrets and variables → Actions*) : `ANDROID_CLE_BASE64` (la clé en base64) et
   `ANDROID_CLE_MOT_DE_PASSE`. Avec eux, le workflow *APK Android* signe l'APK avec cette clé et construit aussi le
   fichier du Play Store (artefact `masano-play-aab`, à envoyer à la main dans la Play Console). Le numéro de version
   (versionCode) est `100 + numéro du run`, il ne fait que monter. Sans les secrets, l'APK est signé avec la clé de test.
   - **Version Play Store sans achats** : l'AAB est construit avec `--dart-define=STORE=play` (`Api.sansAchats`). Google
     impose sa propre facturation pour les pièces et Kopo+, et le paiement externe (mobile money) n'y est pas permis en RDC :
     cette version n'affiche ni prix en francs, ni mobile money, ni « Acheter des pièces ». L'APK du site garde tout.
   - En local : créer `mobile/android/key.properties` (`storeFile`, `storePassword`, `keyPassword`, `keyAlias=masano`),
     puis `flutter build appbundle --release --dart-define=STORE=play`. Garde la clé et son mot de passe en lieu sûr :
     sans eux, plus de mise à jour possible de l'appli.
5. **Liens des stores** : une fois l'appli publiée, coller les liens Play Store et App Store dans le tableau de bord,
   onglet *Pilotage*, « Applis mobiles » (ils servent au message « mets à jour »).
6. **iOS** : régler l'équipe Apple dans Xcode (*Signing & Capabilities*).
7. **Micro des abonnés Kopo+** (paquet `livekit_client`) : rien à régler dans l'appli, le serveur donne l'adresse et le
   jeton LiveKit. Les autorisations sont déjà déclarées (Android : `RECORD_AUDIO` ; iOS : `NSMicrophoneUsageDescription`) ;
   le téléphone ne demande le micro qu'au premier toucher du bouton micro en partie, par un abonné. Après la mise à jour du
   paquet, lancer `pod install` dans `ios/` (Xcode le fait aussi au premier `flutter build ipa`).

## Organisation du code

- `lib/etat.dart` : l'état de l'appli (écran, vue de la partie, compte, fenêtre ouverte), comme l'état global du site.
- `lib/reseau/` : API `/api/v1`, salles Colyseus (WebSocket), connexion Google, notifications.
- `lib/ecrans/` : accueil, salon, partie (Kopo et Inter), racine (fenêtres, toasts, animations).
- `lib/fenetres/` : toutes les fenêtres (fin de manche, récap, amis, ligue, missions, profil, boutique, paramètres, tutoriel…).
- `lib/commun/` : thème, cartes, sons, stockage local, rétention, micro des abonnés (`vocal.dart`, LiveKit).

`flutter analyze` et `flutter test` doivent passer avant chaque envoi.
