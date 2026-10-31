# Kopo

Jeu de cartes multijoueur, de 2 à 9 joueurs, chacun sur son téléphone.

**Jouer :** https://rossy0243.github.io/kopo/

## Comment ça marche
- Une personne crée la partie et devient l'hôte. Les autres scannent le QR code ou tapent le code à 4 lettres.
- Le téléphone de l'hôte fait tourner le moteur de règles et envoie à chaque joueur uniquement sa propre main.
- Les messages du jeu passent par des relais publics MQTT (EMQX, HiveMQ, Mosquitto), ce qui marche sur tous les réseaux, 4G comprise. L'hôte écoute sur tous les relais à la fois. Chaque joueur a une clé secrète : personne ne peut lire sa main ni jouer à sa place.
- L'hôte peut ajouter des robots dans le salon, et remplacer par un robot un joueur déconnecté (le joueur reprend sa place en revenant).
- L'hôte doit garder la page ouverte pendant la partie. S'il recharge la page, la partie reprend avec le même code.
- Compte à rebours de 5 s avant chaque manche, avec le joueur qui commence. En fin de tour, les cartes restent 5 s sur la table avec celui qui reprend la main. La manche suivante se lance seule après 10 s (l'hôte peut la lancer plus tôt).
- En ligne : salles publiques de 2 à 9 joueurs, qui démarrent seules quand elles sont pleines, et compteur des joueurs en ligne (canal commun sur les relais).
- Un joueur déconnecté, ou dont le temps s'est écoulé 2 fois d'affilée, n'a plus que 5 s par tour (même sans chrono) jusqu'à son retour.
- Chrono réglable (5 s par défaut) : un joueur trop lent ou hors ligne pioche. En ouverture, sa plus petite carte autorisée est posée.
- Micro optionnel (WebRTC via PeerJS, avec relais TURN) : chacun l'active, le coupe, ou coupe le son des autres.

## Serveur
Le dossier `server/` contient le serveur de la V1 (comptes, parties sur le serveur, registre des pièces, tableau de bord admin), prêt pour Render + Supabase. Voir [server/README.md](server/README.md).

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
