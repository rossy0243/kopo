# Guide de l'appli mobile (Flutter)

Ce guide dit, écran par écran, ce que l'appli appelle sur le serveur. Le détail de chaque route est dans [`openapi.yaml`](openapi.yaml) (servi aussi par le serveur : `GET /api/openapi.yaml`, à ouvrir dans Swagger UI, Postman, ou à passer à `openapi-generator` pour générer un client Dart). Les parties en direct sont dans [`temps-reel.md`](temps-reel.md), avec un client Dart de référence dans [`dart/`](dart/).

## 1. Adresses et versions

- API : `https://kopo-serveur.onrender.com/api/v1/…` (le site garde `/api/…`, mêmes routes).
- Salles de jeu : `https://kopo-serveur.onrender.com/matchmake/…` puis `wss://kopo-serveur.onrender.com/…` (voir temps-reel.md).
- Envoyer sur **chaque** requête : `X-Masano-Client: android/1.0.0` (ou `ios/1.0.0`), avec la version de l'appli.
- Si l'appli est trop ancienne (version minimale réglée dans le tableau de bord, onglet Pilotage, « Applis mobiles »), toutes les routes répondent **426** avec `miseAJour.store` : afficher l'écran « Mets à jour » avec ce lien. `GET /config` ne répond jamais 426 mais donne `miseAJour: true`.

## 2. Au démarrage

1. `GET /config` (avec le jeton s'il y en a un). Y lire :
   - `maintenance` (texte) : afficher l'écran de maintenance ; `jeux.kopo` / `jeux.inter8` : `ouvert`, `test` (testeur), `ferme` (cacher le jeu), `maintenance` (visible, pas de nouvelle partie) ;
   - `annonce` (bandeau), `nouveaute` (fenêtre « Nouveau ») ;
   - `messages` (les messages du chat en partie), `communautes` (groupes à rejoindre, bouton Partager) ;
   - `tables`, `deblocage`, `pot` (tables à mise), `remiseAFlot` ;
   - `supabase` (connexion Google), `googleObligatoire` ;
   - `liens.conditions` (CGU), `liens.confidentialite`, `liens.support` : à montrer dans Paramètres et à l'inscription ;
   - `push.natif` : le serveur peut envoyer des notifications à l'appli.
2. Avec un jeton : `GET /moi` (compte, solde). Si **401** : jeton expiré ou compte supprimé → retour à l'écran de connexion.
3. Une fois par semaine environ : `POST /jeton` et garder le nouveau jeton.
4. `POST /push/natif` avec le jeton FCM (voir 4).
5. `GET /notifications` (pastille), `POST /bonus-du-jour` quand le joueur ouvre l'appli (réponse `{ ok: false }` si déjà pris).

## 3. Connexion

Garder le jeton Masano dans un stockage sécurisé (`flutter_secure_storage`).

**Invité** (aucun compte) : `POST /invite { pseudo }` → `{ jeton, compte }`. Il peut jouer contre les robots (salle `entrainement`) ; quand `googleObligatoire` est vrai, les parties en ligne et entre amis demandent Google (l'entrée dans la salle est refusée avec un message qui le dit).

**Google**, par le SDK Supabase (le compte Masano est rattaché à l'utilisateur Supabase, comme sur le site, donc un joueur retrouve le même compte sur le site et dans l'appli) :

```dart
// pubspec : supabase_flutter, google_sign_in
await Supabase.initialize(url: config['supabase']['url'], anonKey: config['supabase']['cleAnon']);
final google = await GoogleSignIn(serverClientId: '<ID client OAuth "Web" de Google>').signIn();
final auth = await google!.authentication;
final r = await Supabase.instance.client.auth.signInWithIdToken(
  provider: OAuthProvider.google, idToken: auth.idToken!, accessToken: auth.accessToken);
// Puis : POST /api/v1/connexion { jetonSupabase: r.session!.accessToken, jeton: <jeton invité s'il y en a un>, pseudo, parrain? }
```

`POST /connexion` renvoie le jeton Masano à garder ; avec le jeton invité, le compte invité (pièces, progrès) est rattaché à Google s'il est neuf. Le jeton Supabase ne sert qu'à cette route.

À régler une fois dans Supabase (*Authentication → Providers → Google*) : ajouter les ID clients Android et iOS dans *Authorized Client IDs* (et cocher *Skip nonce check* pour iOS si besoin). Dans Render, mettre `SUPABASE_ANON_KEY` (Supabase → Project Settings → API Keys → `anon`, clé publique).

**Déconnexion** : `DELETE /push/natif { jeton: <jeton FCM> }`, puis oublier le jeton Masano. **Supprimer le compte** (exigé par Google Play et l'App Store) : `DELETE /moi`, après confirmation.

## 4. Notifications push (FCM, Android et iOS)

- Paquet `firebase_messaging`. Sur iOS, téléverser la clé APNs dans la console Firebase ; l'appli envoie au serveur le **jeton FCM** (pas le jeton APNs).
- Après la connexion et à chaque démarrage : `POST /push/natif { jeton, plateforme: 'android'|'ios', appareil: 'Pixel 7' }`. Et à chaque `onTokenRefresh`.
- Réglages du joueur : `GET /push` (`prefs`), `PATCH /push/prefs { invitation|ami|match|annonce: bool }`.
- Le serveur envoie : **invitation** d'un ami (expire après 10 min, priorité haute, même la nuit), **ami** (demande reçue, demande acceptée), **match** (rappel du Match du jour à 19 h, Kinshasa), **annonce** (tableau de bord). Rien entre 22 h et 8 h sauf les invitations et les annonces.
- Chaque message a une notification visible (`title`, `body`) et des **données** (toutes en texte) :

  | Clé | Valeur |
  |---|---|
  | `type` | `invitation`, `ami`, `match`, `annonce` (c'est aussi le `channel_id` Android : créer ces 4 canaux dans l'appli) |
  | `action` | écran à ouvrir au toucher : `table`, `amis`, `match`, `accueil` |
  | `code`, `jeu` | invitation : code de la table et jeu (`kopo` ou `inter8`) |
  | `de` | identifiant du joueur qui invite ou demande |
  | `tag` | regroupe les notifications du même sujet |

- `action: table` : `GET /salles/{code}` puis entrer dans la salle donnée (`join(salle, { jeton, code })`). 404 : la table est fermée, le dire au joueur.
- Côté serveur : mettre dans Render la variable `FCM_COMPTE_SERVICE` (le JSON du compte de service Firebase, tel quel ou en base64 : console Firebase → Paramètres du projet → Comptes de service → Générer une clé privée). Sans elle, `POST /push/natif` répond 503 et le reste marche.

## 5. Écrans et routes

| Écran | Routes |
|---|---|
| Accueil | `GET /config`, `GET /moi`, `GET /en-ligne` (compteur, salles ouvertes), `GET /notifications`, `POST /bonus-du-jour`, `GET /match-jour` |
| Jouer en ligne | salle `kopo` / `inter8` avec `joinOrCreate({ publique: true, taille })` ; tables à mise : `kopo-mise` |
| Créer une table entre amis | `create('kopo'|'inter8', { jeton, code?, mode?, jRetour? })`, partager `vue.code`, `POST /amis/{id}/inviter { code }` |
| Rejoindre avec un code | `GET /salles/{code}` puis `join(salle, { jeton, code })` |
| Contre les robots | salle `entrainement` (`jeu`, `robots`, `niveau`, `niveauJoueur`, `delai`, `mode`) ; première partie guidée : `niveau: 'gentils'`, 2 robots |
| Partie en cours | messages temps réel (temps-reel.md) ; chat : message `reaction` avec un texte de `config.messages` ; signaler : `POST /signaler { cible, motif, partie }` |
| Retour après coupure | `reconnect` (2 min) sinon `POST /reprendre { code }` |
| Fin de partie | messages `solde`, `ligue`, `parcours`, `faceAFace`, `pot` ; revanche par `revanche` / `revancheNon` ; puis `PUT /profil` |
| Profil | `GET /moi`, `PATCH /moi` (pseudo, avatar, pays), `GET /statistiques`, `GET /rivaux`, `GET /ligue`, `GET /collection` |
| Amis | `GET /amis`, `GET /amis/demandes`, `GET /recents`, `POST /amis { cible: 'Kevin#1290' }`, accepter / refuser / annuler, `DELETE /amis/{id}`, `POST /bloques`, `GET/DELETE /bloques` |
| Notifications | `GET /notifications` (`action` : `table`, `amis`, `rivaux`, `bande`, `accueil`), `POST /notifications/lues` |
| Boutique et collection | `GET /boutique`, `POST /boutique/acheter { objet }`, `POST /collection/equiper { objet }`, `POST /cadeau-fondateur` |
| Parcours de saison | `GET /parcours`, `POST /parcours/recuperer { palier, voie }` |
| Ligue | `GET /ligue`, `GET /classement?type=mondial|pays|amis`, `POST /ligue/vu` (après l'écran de fin de saison) |
| Match du jour | `GET /match-jour`, `GET /match-jour/classement?type=mondial|pays|amis`, salle `kopo-jour` |
| La Bande | `GET/POST /bandes`, `GET /bandes/ouvertes`, `POST /bandes/rejoindre { code }`, `GET/PATCH /bandes/{id}`, `POST /bandes/{id}/miser`, `/auto`, `/demander`, `/quitter`, `POST /bandes/{id}/demandes/{compte} { accepter }`, `DELETE /bandes/{id}/membres/{compte}` |
| Parrainage | `GET /parrainage` (lien `<site>?parrain=CODE`), `POST /parrainage { code }`, ou `parrain` dans `POST /connexion` |
| Pièces | `GET /pieces`, `POST /remise-a-flot`, `POST /recompense` |
| Paramètres | `PATCH /moi { notifs }` (notifications dans le jeu), `PATCH /push/prefs` (push), liens de `config.liens`, `DELETE /moi` |

## 6. Ce qui reste à faire dans l'appli (le serveur ne le fait pas)

- **XP, niveau, missions du jour, défi de la semaine, parcours de bienvenue, joker de série** : sur le site, ils sont calculés sur le téléphone (`src/kopo-retention.js`, avec ses tests). L'appli Flutter doit reprendre ces règles en Dart (le fichier et ses tests servent de référence), garder le profil sur le téléphone, l'envoyer après chaque partie (`PUT /profil`, retrouvé avec `GET /profil` sur un autre téléphone), et demander les pièces gagnées avec `POST /recompense` (le serveur plafonne et refuse les doublons).
- **Sons et musique** : générés sur le téléphone (Web Audio sur le site, `src/kopo-sons.js`).
- **Robots hors ligne** : pas dans l'appli Flutter (les moteurs sont en JavaScript). Les parties contre les robots passent par la salle `entrainement`, donc demandent du réseau.
- **Micro** : WebRTC par PeerJS, facultatif (voir temps-reel.md).
- **Liens d'invitation qui ouvrent l'appli** (`<site>#CODE`, `?parrain=`, `?bande=`) : il faudra publier `assetlinks.json` (Android) et `apple-app-site-association` (iOS) sur le site quand les identifiants des applis seront connus.
- **Achats dans l'appli** (pièces, Kopo+) : rien côté serveur pour l'instant.

## 7. Variables à ajouter dans Render (serveur)

| Nom | Rôle |
|---|---|
| `FCM_COMPTE_SERVICE` | Push des applis (JSON du compte de service Firebase, ou ce JSON en base64) |
| `SUPABASE_ANON_KEY` | Clé publique Supabase donnée aux applis pour la connexion Google |
| `SITE_URL` | Adresse du site (liens CGU et confidentialité), `https://kopo-d655.onrender.com/` par défaut |
| `SUPPORT_URL` | Facultatif : page ou adresse de contact (`mailto:…`) affichée dans l'appli |

## 8. Tester en local

```
cd server && npm install && npm start          # http://localhost:2567, base en mémoire
node tests/client-dart.js /chemin/vers/dart    # le client Dart de référence joue de vraies parties
```

Avec `KOPO_TESTS=1`, l'option `rapide: true` d'une salle supprime les délais (comptes à rebours, pauses des robots) pour les essais automatiques.
