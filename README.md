# Kopo

Jeu de cartes multijoueur, de 2 à 9 joueurs, chacun sur son téléphone.

**Jouer :** https://rossy0243.github.io/kopo/

## Comment ça marche
- Une personne crée la partie et devient l'hôte. Les autres scannent le QR code ou tapent le code à 4 lettres.
- Le téléphone de l'hôte fait tourner le moteur de règles et envoie à chaque joueur uniquement sa propre main.
- Les messages du jeu passent par des relais publics MQTT (EMQX, HiveMQ, Mosquitto), ce qui marche sur tous les réseaux, 4G comprise. L'hôte écoute sur tous les relais à la fois. Chaque joueur a une clé secrète : personne ne peut lire sa main ni jouer à sa place.
- L'hôte peut ajouter des robots dans le salon, et remplacer par un robot un joueur déconnecté (le joueur reprend sa place en revenant).
- L'hôte doit garder la page ouverte pendant la partie. S'il recharge la page, la partie reprend avec le même code.
- Compte à rebours de 5 s avant chaque manche, avec le joueur qui commence. En fin de tour, les cartes restent 2 s sur la table avec celui qui reprend la main.
- Chrono réglable (5 s par défaut) : un joueur trop lent ou hors ligne pioche. En ouverture, sa plus petite carte autorisée est posée.
- Micro optionnel (WebRTC via PeerJS, avec relais TURN) : chacun l'active, le coupe, ou coupe le son des autres.

## Fichiers
- `index.html` : la page complète, générée par `node build.js`.
- `moteur/` : moteur de règles (règlement v1.2) et ses tests.
- `src/kopo-salle.js` : salle de jeu (salon, manches, chrono, vues par joueur) et ses tests.
- `src/source.html` : écrans et réseau.
- `vendor/` : MQTT.js, PeerJS et qrcode-generator (licences MIT).

## Tests
```
node moteur/kopo-tests.js
node src/kopo-salle-tests.js
```
Pour tester à plusieurs onglets sur un seul appareil, sans réseau : ouvrir `index.html?local=1` dans plusieurs onglets.
