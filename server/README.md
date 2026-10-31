# Serveur du Kopo

Fait tourner les parties (Colyseus), garde les comptes et le registre des pièces (Postgres chez Supabase), et sert le tableau de bord du super admin (`/admin`).

La logique de jeu n'est pas dupliquée : le serveur utilise `src/kopo-salle.js` et `moteur/kopo-moteur.js`, les mêmes fichiers que la page du jeu.

## Lancer en local
```
cd server
npm install
npm start              # sans DATABASE_URL : base Postgres en mémoire (rien n'est gardé)
npm test               # 22 tests
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
| `POST /api/bonus-du-jour`, `POST /api/remise-a-flot`, `GET /api/pieces` | Pièces |
| `POST /api/signaler`, `GET/POST/DELETE /api/bloques`, `GET/POST/DELETE /api/amis` | Entre joueurs |
| `GET /api/en-ligne` | Joueurs connectés et salles publiques ouvertes |
| WebSocket, salle `kopo` | La partie. Options : `{ jeton, code?, publique? }`. Messages : les mêmes que `kopo-salle.js`. Le serveur envoie `vue`, `erreur`, `solde`, `exclu`. |

## Mesures (test de charge, 31/10/2026)
Joueurs simulés qui jouent bien plus vite que des humains (un coup toutes les 0,3 à 1,5 s), sur un vrai Postgres :

| Joueurs connectés | Coups par seconde | Temps de réponse (99 %) | Processeur | Mémoire |
|---|---|---|---|---|
| 1 500 | 544 | 6 ms | 29 % d'un cœur | 147 Mo |
| 3 000 | 1 080 | 16 ms | 51 % d'un cœur | 200 Mo |

L'offre Render Starter (0,5 processeur, 512 Mo) tient donc environ 2 000 à 3 000 joueurs connectés en même temps. Au-delà : offre Standard (1 processeur, 2 Go, ≈ 25 $/mois), puis plusieurs serveurs.
