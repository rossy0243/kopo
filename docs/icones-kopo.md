# Kopo — Style des icônes

**Statut : validé par le créateur** (31/10/2026, 20h06). C'est la référence pour toutes les icônes du Kopo.

Fichiers : `icones-kopo.svg` (sprite des symboles) · `planche-icones.png` (aperçu).
Dans le jeu : sprite intégré en tête de `#ecranAccueil` dans `src/source.html`, utilisé avec `<svg class="ico"><use href="#i-nom"/></svg>`.

## Règles du style
1. **La carte à jouer est la forme de base** : rectangle arrondi au rapport ≈ 2:3, coin arrondi 2 à 3 px (sur une grille de 32). Chaque icône contient une carte, ou en part.
2. **Trait unique** : épaisseur 2,2 sur 32, extrémités et angles arrondis, pas de remplissage (sauf pour masquer une carte placée derrière).
3. **Couleur** : un seul ton, le laiton `#e2b04a` sur le fond bleu nuit (`#10233a` / `#183252`). Sur la carte dorée, l'encre est `#1d1606`. Grisé (`--muted #9fb2c8`) pour « Bientôt ».
4. **Une seule touche de rouge** au plus (`#c7362f`). C'est le petit carreau ♦ ou un point, jamais une grande surface.
5. **Pas d'emoji ni d'icônes génériques** dans les menus. Les seuls symboles admis sont les quatre couleurs ♠ ♥ ♦ ♣ (coins des cartes de menu).
6. **Tailles** : lisibles de 24 à 48 px. En dessous de 24 px, on retire la touche de rouge.

## Icônes existantes
| id | Sens | Construction |
|---|---|---|
| `i-creer` | Créer une partie | deux cartes en éventail, un + sur celle de devant |
| `i-enligne` | En ligne | carte avec ondes de part et d'autre, ♦ rouge |
| `i-rejoindre` | Rejoindre | flèche qui entre dans une carte |
| `i-robots` | Contre les robots | carte-visage avec antenne (point rouge) |
| `i-tournoi` | Tournoi | couronne posée sur une carte, ♦ rouge |
| `i-partager` | Partager | carte avec flèche sortante |
| `i-regles` | Règles | carte avec lignes de texte, ♦ rouge |
| `i-plein` | Plein écran | quatre coins autour d'une petite carte |
| `i-reglages` | Paramètres | carte avec trois curseurs, dont un rouge |
| `i-cadenas` | Bientôt / verrouillé | cadenas |
| pièce « K » | Pièces | disque doré dégradé avec un K en Bebas Neue |

Toute nouvelle icône (profil, boutique, trophées, missions…) suit ces règles.
