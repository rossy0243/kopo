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

1. **Notifications (Firebase)** : `dart pub global activate flutterfire_cli`, puis dans `mobile/` :
   `flutterfire configure --project=<ton projet Firebase>`. Cela ajoute `google-services.json` (Android)
   et `GoogleService-Info.plist` (iOS). Sans ce fichier, l'appli marche, mais sans notifications.
2. **Connexion Google (Supabase)** : dans Supabase, *Authentication → URL Configuration → Redirect URLs*,
   ajouter `com.masano.masano://login-callback`.
3. **Identifiant de l'appli** : `com.masano.masano` (Android `applicationId` et iOS bundle id).
   Pour le changer : `android/app/build.gradle.kts`, `ios/Runner.xcodeproj`, et `retourAppli` dans
   `lib/reseau/google.dart` (et l'URL de retour dans Supabase).
4. **Publication** : signer l'APK (clé de signature Android) et régler l'équipe Apple dans Xcode.

## Organisation du code

- `lib/etat.dart` : l'état de l'appli (écran, vue de la partie, compte, fenêtre ouverte), comme l'état global du site.
- `lib/reseau/` : API `/api/v1`, salles Colyseus (WebSocket), connexion Google, notifications.
- `lib/ecrans/` : accueil, salon, partie (Kopo et Inter), racine (fenêtres, toasts, animations).
- `lib/fenetres/` : toutes les fenêtres (fin de manche, récap, amis, ligue, missions, profil, boutique, paramètres, tutoriel…).
- `lib/commun/` : thème, cartes, sons, stockage local, rétention.

`flutter analyze` et `flutter test` doivent passer avant chaque envoi.
