# Kopo

Jeu de cartes multijoueur, de 2 à 9 joueurs, chacun sur son téléphone.

**Jouer :** https://rossy0243.github.io/kopo/

## Comment ça marche
- Une personne crée la partie et devient l'hôte. Les autres scannent le QR code ou tapent le code à 4 lettres.
- Le téléphone de l'hôte fait tourner le moteur de règles et envoie à chaque joueur uniquement sa propre main.
- Les messages du jeu passent par des relais publics MQTT (EMQX, HiveMQ, Mosquitto), ce qui marche sur tous les réseaux, 4G comprise. L'hôte écoute sur tous les relais à la fois. Chaque joueur a une clé secrète : personne ne peut lire sa main ni jouer à sa place.
- L'hôte peut ajouter des robots dans le salon, et remplacer par un robot un joueur déconnecté (le joueur reprend sa place en revenant).
- « Contre les robots » : niveau Facile, Normal ou Fort (gardé sur le téléphone). Dans chaque niveau, les robots se renforcent peu à peu avec le niveau XP du joueur (plafond au niveau 20). Le robot fort compte les cartes déjà sorties mais ne voit jamais les mains des autres (`K.vuePublique`).
- L'hôte doit garder la page ouverte pendant la partie. S'il recharge la page, la partie reprend avec le même code.
- Compte à rebours de 5 s avant chaque manche, avec le joueur qui commence. En fin de tour, les cartes restent 5 s sur la table avec celui qui reprend la main. La manche suivante se lance seule après 10 s (l'hôte peut la lancer plus tôt).
- En ligne : salles publiques de 2 à 9 joueurs, qui démarrent seules quand elles sont pleines, et compteur des joueurs en ligne (canal commun sur les relais).
- Un joueur déconnecté, ou dont le temps s'est écoulé 2 fois d'affilée, n'a plus que 5 s par tour (même sans chrono) jusqu'à son retour.
- Chrono réglable (5 s par défaut) : un joueur trop lent ou hors ligne pioche. En ouverture, sa plus petite carte autorisée est posée.
- Sons générés par le téléphone (Web Audio, aucun fichier) : cartes posées, distribution, ramassage, à toi de jouer, dernières secondes du chrono, qualifié, Katapss, éliminé, victoire, chat. Musique d'ambiance douce en option. Deux interrupteurs dans Paramètres > Son et vibrations (effets activés et musique coupée par défaut), gardés sur le téléphone.
- Micro optionnel (WebRTC via PeerJS, avec relais TURN) : chacun l'active, le coupe, ou coupe le son des autres.
- Fin de partie : récap animé (XP et niveau, missions, face-à-face), **revanche** votée à la table (elle part dès que tout le monde a répondu, ou après 15 s avec au moins 2 joueurs ; les robots acceptent toujours). En salle publique, la partie suivante se cherche seule après 5 s (« Arrêter là » pour rester). Partage de la victoire en image (WhatsApp).
- Rétention (sur le téléphone, avec les pièces d'essai) : 3 missions du jour gardées 2 jours avec un « Changer » par jour, défi de la semaine (cadre d'une ville), parcours de bienvenue sur 7 jours de jeu, joker de série (un jour raté par semaine ne casse pas la série du bonus du jour), première partie guidée contre 2 robots gentils avec des bulles d'aide, table rapide à 5 joueurs en ligne.

## Serveur
Le dossier `server/` contient le serveur de la V1 (comptes, parties sur le serveur, registre des pièces, tableau de bord admin), prêt pour Render + Supabase. Voir [server/README.md](server/README.md).

## Fichiers
- `index.html` : la page complète, générée par `node build.js`.
- `moteur/` : moteur de règles (règlement v1.2) et ses tests.
- `src/kopo-salle.js` : salle de jeu (salon, manches, chrono, revanche, vues par joueur) et ses tests.
- `src/kopo-retention.js` : XP, niveau, stats, face-à-face, missions, défi, bienvenue, joker, collection (calculés sur le téléphone, dans `kopo-profil`) et ses tests.
- `src/kopo-sons.js` : effets sonores et musique d'ambiance, synthétisés en Web Audio.
- `src/source.html` : écrans et réseau.
- `vendor/` : MQTT.js, colyseus.js, PeerJS et qrcode-generator (licences MIT).

## Serveur
Quand une adresse de serveur est renseignée (`SERVEUR_PAR_DEFAUT` dans `src/source.html`, ou `?serveur=https://…` dans l'adresse de la page), les parties, la mise en relation et le compteur en ligne passent par le serveur (`server/`). Sans adresse, le jeu garde le mode relais MQTT.

## Tests
```
node moteur/kopo-tests.js
node src/kopo-salle-tests.js
node src/kopo-retention-tests.js
```
Pour tester à plusieurs onglets sur un seul appareil, sans réseau : ouvrir `index.html?local=1` dans plusieurs onglets.

## Passer la page du jeu chez Render (pour un dépôt privé)
`render.yaml` décrit aussi un site statique `kopo` (gratuit) : Render lance `node build.js` et ne publie que la page, le manifeste, les icônes et les pages légales.
1. Render → le Blueprint du dépôt → *Sync* (ou *New → Blueprint*) : le site `kopo` est créé. Noter son adresse (`https://kopo.onrender.com` si le nom est libre). Si l'adresse est différente, la mettre dans `SITE_URL` (site) et `ORIGINES` (serveur).
2. Supabase → *Authentication → URL Configuration* : mettre l'adresse dans *Site URL* et ajouter `https://kopo.onrender.com/**` aux *Redirect URLs* (connexion Google).
3. Vérifier sur le téléphone : partie, connexion Google, boutique.
4. Remplir `NOUVELLE_ADRESSE` dans `src/source.html`, `node build.js`, fusionner. Les joueurs qui ouvrent l'ancienne adresse partent sur la nouvelle avec leurs données du téléphone (compte invité, profil, réglages), envoyées dans le `#` de l'adresse.
5. Laisser l'ancienne adresse quelques semaines, puis passer le dépôt en privé (GitHub Pages s'arrête).

## Licence
Tous droits réservés. Voir [LICENSE](LICENSE) : le dépôt est public pour la mise en ligne, mais sa réutilisation n'est pas autorisée.
