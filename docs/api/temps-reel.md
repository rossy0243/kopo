# Temps réel : salles de jeu Masano (Kopo et Inter (8))

Les parties se jouent sur le serveur, dans des salles **Colyseus 0.16** reliées par WebSocket. Le serveur applique les règles et envoie à chaque joueur **sa vue** (sa main seulement, jamais celle des autres). Le chat en partie, les robots, la revanche, le Match du jour et les tables à mise passent aussi par là.

Les salles Masano n'utilisent **pas** l'état synchronisé de Colyseus (`schema`) : tout passe par des **messages** nommés, encodés en MessagePack. Un client Flutter n'a donc besoin que d'un WebSocket et d'un décodeur MessagePack.

Un client Dart de référence, sans dépendance et testé contre le serveur, est dans [`dart/`](dart/) : [`masano_salle.dart`](dart/lib/masano_salle.dart) (connexion, messages, reconnexion) et [`msgpack.dart`](dart/lib/msgpack.dart). L'essai [`bin/essai.dart`](dart/bin/essai.dart) joue de vraies parties : `node server/tests/client-dart.js` (avec le SDK Dart ou Flutter installé).

## 1. Les salles

| Salle | Pour quoi | Options d'entrée (`create`, `join`, `joinOrCreate`) |
|---|---|---|
| `kopo` | Kopo entre amis (code à 4 lettres) ou en ligne (salle publique) | `jeton` ; **entre amis** : `create` (avec `code` de 4 lettres majuscules, ou sans : le serveur en choisit un, lu dans `vue.code`), les amis font `join` avec le même `code` ; **en ligne** : `joinOrCreate` avec `publique: true, taille: 2..9` |
| `kopo-mise` | Tables à mise (Bronze, Argent, Or, Diamant), en ligne seulement | `jeton`, `publique: true`, `taille`, `mise: 'bronze'\|'argent'\|'or'\|'diamant'`. Il faut 10 fois la mise en solde (`/config`: `tables`, `deblocage`) |
| `inter8-mise` | Tables à mise d'Inter (8) (Bronze, Argent, Or, Diamant), en ligne seulement | `jeton`, `publique: true`, `taille`, `mise: 'bronze'\|'argent'\|'or'\|'diamant'`. Il faut 10 fois la mise en solde (`/config`: `tables`, `deblocage`) |
| `inter8` | Inter (8) entre amis ou en ligne (2 à 8 joueurs, gratuit) | comme `kopo`, plus `mode: 'simple'\|'delire'` et `jRetour: bool` (Délire seulement) à la création |
| `entrainement` | Seul contre des robots (Kopo ou Inter (8)). **Pas besoin de Google**, ni pièces, ni ligue, ni XP de parcours | `jeton`, `jeu: 'kopo'\|'inter8'`, `robots` (1 à 8 en Kopo, 1 à 7 en Inter (8), 2 par défaut), `niveau: 'faciles'\|'normaux'\|'forts'\|'gentils'`, `niveauJoueur: 1..1000` (les robots se renforcent avec le niveau du joueur, plafond 20), `delai` (secondes du chrono), `mode`, `jRetour` (Inter (8)), `lancer: true` pour démarrer tout de suite. Une seule personne par salle |
| `kopo-jour` | Match du jour : seul contre 8 robots Forts, même donne pour tous | `jeton` seulement (`create`). Compte Google obligatoire, un essai officiel par jour |
| `fleuve` | Le Fleuve : une étape, seul contre les robots fixés par l'étape (Kopo sur le Congo, Inter (8) sur le Niger) | `jeton`, `fleuve` (`congo` ou `niger`), `numero` (`create`). Compte Google obligatoire, une pagaie perdue en cas d'échec |

Pour rejoindre un ami avec un code, demander d'abord **`GET /api/v1/salles/{code}`** : la réponse donne `salle` (`kopo`, `kopo-mise`, `inter8` ou `inter8-mise`), puis `join(salle, { jeton, code })`.

Refus à l'entrée (message à afficher tel quel) : `Connexion requise.`, `Ce compte est banni.`, `Compte suspendu jusqu'au …`, `Kopo est en maintenance…`, `… n'est pas encore ouvert.` (jeu réservé aux testeurs), `Connecte-toi avec Google pour jouer en ligne ou entre amis…` (quand `googleObligatoire`), `La partie a déjà commencé.`, `La table est pleine.`, `Il te faut au moins N pièces pour la table …`, `Cette partie n'est pas la tienne.`

## 2. Le protocole, octet par octet

### 2.1 Réserver une place (HTTP)

```
POST https://kopo-serveur.onrender.com/matchmake/<méthode>/<salle>
Content-Type: application/json

{ "jeton": "<jeton Masano>", "code": "ABCD" }
```

`<méthode>` : `create`, `join`, `joinOrCreate`, `joinById` (à la place de `<salle>`, l'identifiant `roomId`), `reconnect` (voir 2.5).

La réponse est **toujours 200**. Succès :

```json
{ "room": { "name": "kopo", "roomId": "DYhxKcC_B", "processId": "Xq3…", "publicAddress": null, "clients": 1, "maxClients": 9 },
  "sessionId": "Ab12Cd34" }
```

Échec : `{ "code": 4212, "error": "room \"…\" is locked" }`. Codes Colyseus : 4210 salle inconnue, 4211 critères invalides, 4212 salle introuvable ou verrouillée (partie commencée, salle pleine), 4214 réservation expirée, 4215 refus d'authentification, 4216 erreur de l'application (refus de Masano, message en français dans `error`).

### 2.2 Ouvrir le WebSocket

```
wss://kopo-serveur.onrender.com/<processId>/<roomId>?sessionId=<sessionId>
```

(si `publicAddress` est donné, il remplace l'hôte). La place réservée expire après quelques secondes : se connecter tout de suite.

### 2.3 Entrer dans la salle

Le serveur envoie d'abord **JOIN_ROOM** :

```
[10] [n] [jeton de reconnexion, n octets UTF-8] [m] [nom du sérialiseur, m octets] [poignée de main…]
```

Le client garde le jeton de reconnexion (sous la forme `roomId:jeton`) et répond par **un seul octet `10`**. À partir de là, les messages arrivent. Si l'entrée est refusée, le serveur envoie **ERROR** puis ferme avec le code 4002 :

```
[11] [code en MessagePack (entier)] [message en MessagePack (texte)]
```

### 2.4 Messages

Dans les deux sens :

```
[13] [type : texte MessagePack (fixstr a0-bf, str8 d9, str16 da, str32 db)] [valeur : MessagePack, facultative]
```

Exemple, envoyer `action` avec `{ "action": { "type": "ramasser" } }` :

```
0d  a6 61 63 74 69 6f 6e   81 a6 61 63 74 69 6f 6e  81 a4 74 79 70 65  a8 72 61 6d 61 73 73 65 72
13  "action"               { "action":              { "type":           "ramasser" } }
```

Le serveur code `undefined` en extension MessagePack `fixext 1` (`d4 00 00`) : la lire comme `null`. Les entiers peuvent arriver en `uint8/16/32`, les nombres à virgule en `float64`.

Quitter volontairement : envoyer **un octet `12`** (LEAVE_ROOM). Le serveur ferme avec le code 4000. Pendant une partie, partir volontairement compte comme un **abandon** (pas de gains, −20 points de ligue en partie classée).

Codes de fermeture : 1000/4000 départ voulu ; **4000 aussi quand le même compte s'est connecté ailleurs** (autre téléphone, appli rouverte) ; 4001 exclu par l'admin (après le message `exclu`) ; 4002 erreur ; 1006 coupure réseau.

Le serveur envoie un ping WebSocket toutes les 5 s et coupe après 3 pings sans réponse (`dart:io` répond tout seul).

### 2.5 Coupure et retour

- **Coupure réseau** (pas un départ voulu) : la place est gardée. Pendant la partie, le joueur absent n'a plus que 5 s par tour (coup automatique ensuite), et l'hôte peut le remplacer par un robot ; il reprend sa place en revenant.
- **Revenir dans les 2 minutes** : `POST /matchmake/reconnect/<roomId>` avec `{ "reconnectionToken": "<jeton>" }`, puis WebSocket avec `?sessionId=<sessionId>&reconnectionToken=<jeton>`.
- **Après 2 minutes, ou jeton perdu** (appli tuée) : `POST /api/v1/reprendre { code }` avec le jeton Masano. La réponse est une réservation de place à consommer comme en 2.2. 404 : le joueur n'est plus assis à cette table. Garder le `code` de la table en mémoire tant que la partie dure.
- Après tout retour, envoyer `sync` pour recevoir la vue.

## 3. Messages envoyés par l'appli

Après l'entrée, envoyer **`sync`** : le serveur répond par la vue. Toutes les règles sont vérifiées par le serveur ; un message refusé reçoit `erreur` (texte à afficher).

| Type | Valeur | Qui, quand |
|---|---|---|
| `sync` | rien | Demander sa vue (après l'entrée, un retour, l'appli revenue au premier plan) |
| `action` | `{ action }` : une des actions de `vue.manche.actions`, **renvoyée telle quelle** | Pendant une manche. Kopo : `{ type: 'jouer', carte }`, `{ type: 'ramasser' }`, `{ type: 'katapss' }`, `{ type: 'toutPoser' }`. Inter (8) : `{ type: 'jouer', cartes: [...], demande? }`, `{ type: 'piocher' }`, `{ type: 'passer' }`, `{ type: 'annoncer' }`, `{ type: 'contester', cible? }` |
| `lancer` | rien | L'hôte, dans le salon, 2 joueurs au moins (pas en salle publique : elle part seule quand elle est pleine) |
| `reglages` | `{ delai }` (Kopo : 0, 3, 5, 10, 15 ; Inter (8) : 0, 5, 10, 15, 20 ; 0 = sans chrono) ; `{ robots: 'faciles'\|'normaux'\|'forts'\|'gentils', niveau? }` ; Inter (8) : `{ mode: 'simple'\|'delire', jRetour }` | L'hôte, dans le salon. Kopo : sans `robots`, `delai` est obligatoire |
| `ajouterRobot` | `{ niveau? }` | L'hôte, salon d'une salle privée (9 places en Kopo, 8 en Inter (8)) |
| `niveauRobot` | `{ cible: idRobot, niveau }` | L'hôte, salon |
| `retirer` | `{ cible: idJoueur }` | L'hôte, salon (un joueur ou un robot) |
| `remplacerParRobot` | `{ cible: idJoueur }` | L'hôte, pendant la partie (joueur absent) |
| `pret` | `{ pret: bool }` | Un joueur, salon (indicatif) |
| `reaction` | `{ emoji: texte }` | **Chat** : seulement un des messages de `GET /api/v1/config` → `messages` (pas de texte libre). Un par seconde au plus. Relayé à toute la table par le message `reaction` |
| `sticker` | `{ sticker: id }` | **Sticker animé** (`GET /api/v1/stickers`) : seulement quand l'admin a allumé les stickers (sinon `Les stickers arrivent bientôt.`), un toutes les 5 s, et s'il reste au moins une utilisation (une de moins à chaque envoi). Relayé à toute la table par le message `sticker` ; l'envoyeur reçoit aussi `stickers` |
| `micro` | `{ voix: bool, muet: bool }` | Micro (voir 5) : `voix` reste faux pour un non-abonné |
| `vocal` | rien | Micro (voir 5) : demande le jeton du salon vocal de la table. Réponse : message `vocal` |
| `mancheSuivante` | rien | L'hôte, entre deux manches (sinon elle part seule après 10 s) |
| `revanche` / `revancheNon` | rien | Chaque joueur, en fin de partie (15 s). La revanche part quand tout le monde a répondu, ou à la fin du temps avec 2 joueurs au moins |
| `rejouer` | rien | L'hôte, fin de partie : retour au salon avec les mêmes joueurs |

Match du jour (`kopo-jour`) : la table est fixée par le serveur et la partie démarre seule. `lancer`, `reglages`, les robots et la revanche répondent `Pas pendant le Match du jour.`
Le Fleuve (`fleuve`) : pareil, la table et la donne sont fixées par l'étape. Les mêmes messages répondent `Pas pendant une étape du Fleuve.` Quitter (`leave`) compte comme un échec.

## 4. Messages reçus du serveur

| Type | Valeur | Quand |
|---|---|---|
| `vue` | la vue du joueur (4.1) | Après chaque changement, et en réponse à `sync` |
| `erreur` | texte | Message refusé (à afficher brièvement) |
| `reaction` | `{ type: 'reaction', joueur, emoji }` | Chat : quelqu'un a envoyé un message rapide |
| `sticker` | `{ type: 'sticker', joueur, sticker }` | Quelqu'un a envoyé un sticker animé (il joue une fois, puis une ligne s'écrit dans le fil du chat) |
| `stickers` | `{ sticker, restants }` | À l'envoyeur : utilisations restantes de ce sticker (0 : il se reverrouille) |
| `classee` | `{ classee: bool }` | Début de partie : la partie compte pour la ligue |
| `mise` | `{ niveau, mise, pot }` | Table à mise : mise prélevée, pot de la partie |
| `solde` | `{ solde }` | Solde après une mise ou en fin de partie |
| `pot` | `{ pot, gain, place }` | Fin d'une partie à mise |
| `ligue` | `{ delta, points, division, divisionAvant, promu, relegue, protection, prochaine, saison }` | Fin d'une partie classée |
| `parcours` | `{ xp, total, palier, nouveaux, xpPalier, paliers }` | Fin de partie entre humains : XP du parcours de saison |
| `faceAFace` | `[{ id, pseudo, moi, lui }]` | Fin d'un duel : score du face-à-face, le même des deux côtés |
| `adversaires` | `[{ id, pseudo, numero, avatar, apparence, niveau…, recue, moi, lui }]` | Fin d'une partie entre humains : ses adversaires qui ne sont pas encore ses amis (ni demandés). L'écran de fin propose « Ajouter » (`POST /amis`), ou « Accepter » si `recue` |
| `matchJour` | `{ debut: true, numero, officiel }` puis `{ fin: true, numero, officiel, manches, victoire, score, parti }` | Match du jour |
| `fleuve` | `{ debut: true, etape, adoucir }` puis `{ fin: true, fleuve, numero, reussi, parti, etoiles, score, seuils, texte, pieces, double, piecesEscale?, solde?, pagaies, biefTermine?, depasses?, premierA? }` (`depasses` : pseudos des amis que tu viens de dépasser ; `premierA` : ville où tu arrives avant tous tes amis) (ou `{ fin: true, erreur }`) | Le Fleuve |
| `exclu` | texte (raison) | Exclu par l'admin (la connexion se ferme avec 4001) |

### 4.1 La vue

Champs communs (Kopo et Inter (8)) :

```jsonc
{
  "jeu": "inter8",               // absent en Kopo
  "code": "DUMP",                // code de la table (à garder pour /reprendre)
  "etat": "salon",               // salon | manche | finManche | finPartie
  "moi": "c_…", "hote": "c_…",
  "joueurs": [{ "id": "c_…", "nom": "Bruno", "connecte": true, "absent": false, "robot": false,
                "niveau": null,            // robots : faciles | normaux | forts | gentils
                "remplace": false,         // un robot tient la place d'un joueur parti
                "pret": false, "voix": false, "muet": true, "peerId": null }],
  "delai": 5, "publique": false, "taille": null, "robots": "normaux",
  "chrono":   { "resteMs": 4200, "totalMs": 5000 } | null,   // tour en cours
  "suite":    { "resteMs": 8000, "totalMs": 10000 } | null,  // finManche : manche suivante automatique
  "revanche": { "oui": [], "non": [], "resteMs": 12000, "totalMs": 15000 } | null,
  "revancheRatee": false,
  "restants": ["c_…"], "elimines": ["c_…"],   // éliminés dans l'ordre (le dernier éliminé est 2e)
  "numeroManche": 1, "vainqueur": null,
  "mode": "delire", "jRetour": false,          // Inter (8) seulement
  "manche": { … }                              // absent dans le salon
}
```

`manche` en **Kopo** :

```jsonc
{ "sieges": ["c_…"], "enJeu": ["c_…"], "nbCartes": { "c_…": 4 },
  "main": ["6T", "2P", "10K", "7C"],              // MA main seulement
  "table": [{ "joueur": "c_…", "cartes": ["5T"], "compte": 1 }],
  "phase": "ouverture",                           // ouverture | suite | terminee
  "couleurTour": "T" | null, "couleurInterdite": "P" | null,
  "joueurCourant": "c_…",
  "pause": { "type": "depart" | "finTour", "resteMs": 3000, "totalMs": 5000, "annonce": … } | null,
  "qualifies": [{ "joueur": "c_…", "raison": "main vide en ouvrant" }], "elimine": null,
  "redistributions": [{ "joueur": "c_…", "main": ["4P", …] }],
  "journal": ["Bruno ouvre avec 5♣.", …],         // 8 dernières lignes, déjà en français
  "actions": [{ "type": "jouer", "carte": "6T" }, { "type": "ramasser" }] }   // ce que JE peux faire maintenant
```

`manche` en **Inter (8)** : `sieges`, `enJeu`, `nbCartes`, `main`, `phase` (`jeu` ou `nulle`), `nulle`, `joueurCourant`, `qualifies`, `elimine`, `journal`, `pause`, `actions`, et :
`reference` (carte du centre), `libre` (on pose ce qu'on veut), `demande` (`{ valeur, par }` : « Inter demande »), `sens` (1 ou −1), `pioche` et `piochable` (cartes), `aPioche`, `annonces`, `contestables`, `enGrace` (joueurs qui ont encore 3 s pour annoncer), `posees` et `nbPosees` (dernières cartes posées, pour l'animation), `dernier` (qui a posé la carte du centre), `piocheVide` (`{ joueur, motif, n }`), `paquets` (1 ou 2).

**Règle d'or :** l'appli n'a pas à connaître les règles pour jouer. Elle montre `main`, et rend jouables les cartes présentes dans `actions` ; elle renvoie l'action choisie telle quelle. Les règles complètes sont dans les règlements (Kopo v1.2, Inter (8) v1.1).

### 4.2 Les cartes

- **Kopo** : `<valeur><couleur>`, valeur 2 à 10, couleur `P` pique ♠, `C` cœur ♥, `K` carreau ♦, `T` trèfle ♣. Exemple : `10K` = 10♦.
- **Inter (8)** : valeur `A 2 3 4 5 6 7 8 9 10 V D R` (à l'écran : A, 2…10, J, Q, K), mêmes couleurs ; jokers `XR` (rouge) et `XN` (noir). En Délire (2 paquets), les cartes du second paquet finissent par `*` (`RK*`). Exemple : `VK` = valet de carreau. Une `demande` (après un 8) est une valeur (`'R'`, `'7'`…).

## 5. Micro (abonnés Kopo+)

Le micro est réservé aux abonnés Kopo+ (`GET /api/v1/abonnement`). La voix passe par un serveur LiveKit : chaque abonné de la table entre dans le salon vocal `table-<roomId>`, et seuls les abonnés y sont admis.

1. Au toucher du bouton micro, l'appli envoie `vocal`.
2. Le serveur répond par le message `vocal` :
   - `{ url, jeton, salon, parler }` : se connecter à LiveKit (`url`, `jeton`), publier le micro si `parler` est vrai (faux = sanction « micro » : on écoute seulement) ;
   - `{ refuse: 'abonnement', formules, avantages, paiement }` : pas abonné, montrer la fenêtre « Abonne-toi » avec les prix ;
   - `{ refuse: 'bientot' }` : serveur vocal pas encore réglé ; `{ refuse: 'seul' }` : entraînement ou Match du jour.
3. L'appli envoie ensuite `micro` `{ voix: true, muet }` pour que la table voie l'icône. Le serveur force `voix: false` pour un non-abonné.

Dans la vue, `joueurs[].plus` vaut `true` pour un abonné (couronne dorée). `peerId` vaut toujours `null` (ancien micro PeerJS).

## 6. Exemple complet en Dart

```dart
final serveur = MasanoServeur('https://kopo-serveur.onrender.com');
final salle = await serveur.creer('entrainement', {'jeton': jeton, 'jeu': 'kopo', 'robots': 3, 'niveau': 'normaux'});
salle.sur('vue').listen((v) => afficher(v as Map));
salle.sur('erreur').listen((e) => toast(e.toString()));
salle.envoyer('sync');
salle.envoyer('lancer');
// … toucher une carte jouable :
salle.envoyer('action', {'action': action}); // action = un élément de vue['manche']['actions']
// coupure : await serveur.reconnecter(salle.jetonReconnexion) ; appli rouverte : await serveur.reprendre(jeton, code)
```
