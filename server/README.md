# Serveur du Kopo

Fait tourner les parties (Colyseus), garde les comptes et le registre des pièces (Postgres chez Supabase), et sert le tableau de bord du super admin (`/admin`).

La logique de jeu n'est pas dupliquée : le serveur utilise `src/kopo-salle.js` et `moteur/kopo-moteur.js`, les mêmes fichiers que la page du jeu.

## Lancer en local
```
cd server
npm install
npm start              # sans DATABASE_URL : base Postgres en mémoire (rien n'est gardé)
npm test               # 52 tests
npm run charge -- 1500 30   # test de charge : 1 500 joueurs simulés pendant 30 s
```
Tableau de bord en local : http://localhost:2567/admin (définir `ADMIN_MOT_DE_PASSE` et `ADMIN_TOTP`).

## Mise en ligne (Render + Supabase)
1. **Supabase** : créer un projet (région Europe, Francfort). Dans *Authentication → Providers*, activer **Google** (et **Phone** plus tard). Noter l'URL du projet et la chaîne de connexion à la base (*Connect → Session pooler*).
2. **Admin** : lancer `node server/src/outils.js totp`, ajouter le secret dans Google Authenticator.
3. **Render** : *New → Blueprint*, choisir ce dépôt. Render lit `render.yaml` et demande `DATABASE_URL`, `SUPABASE_URL`, `ADMIN_MOT_DE_PASSE`, `ADMIN_TOTP`.
4. Vérifier `https://<nom>.onrender.com/sante` puis `/admin`.

Les tables sont créées toutes seules au premier démarrage (`src/schema.sql`).

## Variables
| Nom | Rôle |
|---|---|
| `DATABASE_URL` | Base Postgres (Supabase) |
| `SECRET_SERVEUR` | Signe les jetons des joueurs (généré par Render) |
| `SUPABASE_URL` | Vérifie les connexions Google / téléphone |
| `SUPABASE_JWT_SECRET` | Facultatif, si le projet Supabase utilise encore l'ancien secret partagé |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète *service_role* : efface aussi l'utilisateur Google dans Supabase quand un joueur supprime son compte. Sans elle, le serveur le signale dans les journaux et il faut l'effacer à la main (Authentication → Users) |
| `ADMIN_MOT_DE_PASSE`, `ADMIN_TOTP` | Accès au tableau de bord (mot de passe + code à 6 chiffres) |
| `CONNEXION_GOOGLE` | `1` pour afficher « Se connecter avec Google » dans le jeu (après avoir activé Google dans Supabase, avec la Site URL du jeu) |
| `ORIGINES` | Pages autorisées à appeler l'API (séparées par des virgules) |

## API (pour l'application)
| Route | Rôle |
|---|---|
| `GET /api/config` | Annonce, maintenance, version minimale, mises des tables |
| `POST /api/invite` | Jouer sans compte : renvoie un jeton et le compte (500 pièces) |
| `POST /api/connexion` | Connexion Google/téléphone (jeton Supabase), rattache le compte invité |
| `GET/PATCH/DELETE /api/moi` | Profil, changer pseudo/avatar, supprimer son compte |
| `POST /api/bonus-du-jour`, `POST /api/remise-a-flot`, `GET /api/pieces` | Pièces (bonus du jour avec joker de série hebdomadaire) |
| `POST /api/recompense`, `POST /api/cadeau-fondateur` | Pièces des missions, du défi et de la bienvenue gagnées sur le téléphone (plafonnées, sans doublon) ; dos « Les Fondateurs » (tant que la case est cochée dans Pilotage) |
| `POST /api/signaler`, `GET/POST/DELETE /api/bloques`, `GET/POST/DELETE /api/amis` | Entre joueurs |
| `GET /api/en-ligne` | Joueurs connectés et salles publiques ouvertes (`classee` : la salle compte pour la ligue) |
| `GET /api/rivaux` | Mes face-à-face (qui finit devant l'autre dans les parties jouées ensemble) |
| `GET /api/notifications`, `POST /api/notifications/lues` | Notifications dans le jeu : rivalité, invitation d'un ami, nouvel ami. Chaque type se coupe avec `PATCH /api/moi { notifs: { rivalite: false } }` |
| `POST /api/amis/:id/inviter` | Inviter un ami à sa table (`{ code }`) : 1 fois par ami toutes les 2 min, 15 par heure |
| `GET /api/parcours`, `POST /api/parcours/recuperer` | Parcours de saison : XP, 30 paliers (voie gratuite et voie Kopo+), récupérer un palier `{ palier, voie: 'gratuit'\|'plus' }` |
| `GET /api/collection`, `POST /api/collection/equiper` | Apparences possédées et équipées (avatar, dos de cartes, cadre) |
| `GET /api/boutique`, `POST /api/boutique/acheter` | Catalogue (thème des villes) et achat à prix affiché avec les pièces du serveur |
| `GET /api/ligue` | Saison en cours, divisions, mes points, ma division, mon rang (mondial, pays), mes 10 dernières parties classées, récompense de saison pas encore vue, mes titres |
| `POST /api/ligue/vu` | L'écran de fin de saison a été vu |
| `GET /api/classement?type=mondial\|pays\|amis` | Classement de la saison (`&pays=CD` pour un autre pays). Le pays se choisit avec `PATCH /api/moi { pays: 'CD' }` |
| `GET /api/parrainage`, `POST /api/parrainage` | Parrainage : mon code et lien (`?parrain=CODE`), mes invités, mes paliers ; saisir le code d'un ami `{ code }` (compte Google neuf). Le code passe aussi dans `POST /api/connexion { parrain }` |
| WebSocket, salle `kopo` | La partie. Options : `{ jeton, code?, publique? }`. Messages : les mêmes que `kopo-salle.js`. Le serveur envoie `vue`, `erreur`, `solde`, `exclu`, `classee` (au début : `{ classee }`) et `ligue` (fin de partie classée : `{ delta, points, division, divisionAvant, promu, relegue, protection, prochaine, saison }`). |

## Ligue classée et saisons
- **Saison de 4 semaines**, qui se termine un dimanche à 19 h UTC (20 h à Kinshasa). La saison 1 s'ouvre toute seule au premier démarrage (« Les Fondateurs ») ; les suivantes portent un nom de ville, sauf si l'admin en choisit un.
- **Partie classée** : salle publique uniquement, sans robot au départ, au moins 3 joueurs, et personne n'est entré avec le code (pas de complicité entre amis).
- **Points** : 1er +30, 2e +15, 3e +5 (dès 5 joueurs), avant-dernier −5 (dès 6), dernier −10 (dès 4), abandon −15. Moins de 5 joueurs : gains réduits en proportion. Coupure réseau sans retour : ni gain ni perte.
- **Divisions** : Bois 0, Bronze 100, Argent 250, Or 450, Diamant 700, Légende 1 000. Après une montée, 3 parties protégées (on ne redescend pas).
- **Fin de saison** (automatique, vérifiée chaque minute) : pièces et titre selon la meilleure division atteinte (« Diamant S1 »), rang final, puis chacun redescend (1 division, 2 depuis Diamant et Légende) pour la saison suivante.
- Tout se règle dans le tableau de bord, onglet **Ligue**, sans mise à jour.

## Parrainage
- Chaque joueur connecté avec Google a un lien `?parrain=CODE`. L'ami qui crée son compte avec Google par ce lien, puis joue **5 parties** contre d'autres joueurs dans les 30 jours, rapporte **300 pièces** à son parrain et en reçoit **200**.
- **Paliers** pour les gros parrains (amis venus jouer) : 3 (cadre Ambassadeur), 10 (1 000 pièces, avatar, titre « Ambassadeur »), 25 (2 500, dos de cartes), 50 (5 000), 100 (10 000, cadre doré, « Ambassadeur d'or »), 250 (20 000), 500 (30 000), 1 000 (50 000, « Légende du Kopo »). Pas de plafond à vie.
- **Anti-abus** : empreinte (HMAC) de l'identifiant Google et de l'adresse Gmail, gardée même après la suppression du compte (table `empreintes`) : un compte Google n'est parrainé qu'une fois. Compte de l'ami créé depuis moins de 7 jours, parrain connecté avec Google, pas d'auto-parrainage ni de parrainage croisé. Ne comptent pas : parties avec robots, abandons, parties où l'ami et son parrain sont les seuls humains. Plafond de 30 amis récompensés en pièces par mois (ils comptent quand même pour les paliers), levé pour un **créateur** vérifié (fiche du joueur dans le tableau de bord).
- `SECRET_EMPREINTES` (facultatif) : clé des empreintes. Sans elle, `SECRET_SERVEUR` sert ; changer cette clé fait oublier les comptes déjà vus.
- Réglages dans le tableau de bord, onglet **Pilotage** (montants, parties, plafond, délais, pause).

## Mesures (test de charge, 31/10/2026)
Joueurs simulés qui jouent bien plus vite que des humains (un coup toutes les 0,3 à 1,5 s), sur un vrai Postgres :

| Joueurs connectés | Coups par seconde | Temps de réponse (99 %) | Processeur | Mémoire |
|---|---|---|---|---|
| 1 500 | 544 | 6 ms | 29 % d'un cœur | 147 Mo |
| 3 000 | 1 080 | 16 ms | 51 % d'un cœur | 200 Mo |

L'offre Render Starter (0,5 processeur, 512 Mo) tient donc environ 2 000 à 3 000 joueurs connectés en même temps. Au-delà : offre Standard (1 processeur, 2 Go, ≈ 25 $/mois), puis plusieurs serveurs.
