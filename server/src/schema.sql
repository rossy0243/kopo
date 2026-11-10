-- Kopo : schéma de la base (Postgres / Supabase). Idempotent : peut être relancé.

CREATE TABLE IF NOT EXISTS comptes (
  id            text PRIMARY KEY,                 -- identifiant interne, tiré au hasard
  auth_id       text UNIQUE,                      -- identifiant Supabase Auth (Google / téléphone), NULL pour un invité
  pseudo        text NOT NULL,
  numero        char(4) NOT NULL,                 -- Rossy#4821
  avatar        text NOT NULL DEFAULT 'a1',
  solde         integer NOT NULL DEFAULT 0 CHECK (solde >= 0),
  statut        text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'banni', 'supprime')),
  suspendu_jusqu timestamptz,
  micro_coupe   boolean NOT NULL DEFAULT false,   -- sanction : micro désactivé
  pays          text,
  serie_bonus   integer NOT NULL DEFAULT 0,
  dernier_bonus date,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  vu_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comptes_pseudo ON comptes (lower(pseudo));

-- Changements de pseudo : le pseudo choisi à la création, puis 2 changements au plus sur 12 mois glissants.
CREATE TABLE IF NOT EXISTS changements_pseudo (
  id         bigserial PRIMARY KEY,
  compte_id  text NOT NULL REFERENCES comptes(id),
  ancien     text NOT NULL,
  nouveau    text NOT NULL,
  cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS changements_pseudo_compte ON changements_pseudo (compte_id, cree_le);

-- Registre des pièces : chaque mouvement est une ligne, jamais modifiée ni effacée.
-- comptes.solde est la somme de ce registre (mise à jour dans la même transaction).
CREATE TABLE IF NOT EXISTS registre_pieces (
  id         bigserial PRIMARY KEY,
  compte_id  text NOT NULL REFERENCES comptes(id),
  montant    integer NOT NULL,                    -- positif = gain, négatif = dépense
  motif      text NOT NULL,                       -- bienvenue, bonus_jour, manche, katapss, victoire, deuxieme, mise, pot, remise_a_flot, admin, cadeau…
  ref        text,                                -- partie, achat, ou action admin concernée
  par_admin  boolean NOT NULL DEFAULT false,
  cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registre_compte ON registre_pieces (compte_id, cree_le);
CREATE INDEX IF NOT EXISTS registre_date ON registre_pieces (cree_le);

-- Un jour où le joueur a ouvert le jeu (joueurs actifs et rétention).
CREATE TABLE IF NOT EXISTS presences (
  compte_id text NOT NULL REFERENCES comptes(id),
  jour      date NOT NULL,
  PRIMARY KEY (compte_id, jour)
);
CREATE INDEX IF NOT EXISTS presences_jour ON presences (jour);

CREATE TABLE IF NOT EXISTS parties (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  publique    boolean NOT NULL DEFAULT false,
  nb_joueurs  integer NOT NULL,
  avec_robots boolean NOT NULL DEFAULT false,
  vainqueur   text,
  debut       timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz
);
CREATE INDEX IF NOT EXISTS parties_debut ON parties (debut);

CREATE TABLE IF NOT EXISTS participations (
  partie_id text NOT NULL REFERENCES parties(id),
  compte_id text NOT NULL REFERENCES comptes(id),
  place     integer,                              -- 1 = vainqueur
  abandon   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (partie_id, compte_id)
);
CREATE INDEX IF NOT EXISTS participations_compte ON participations (compte_id);

CREATE TABLE IF NOT EXISTS signalements (
  id         bigserial PRIMARY KEY,
  auteur_id  text NOT NULL REFERENCES comptes(id),
  cible_id   text NOT NULL REFERENCES comptes(id),
  motif      text NOT NULL CHECK (motif IN ('pseudo', 'insultes', 'triche', 'abandon', 'autre')),
  details    text,
  partie_id  text,
  statut     text NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'traite', 'rejete')),
  decision   text,
  cree_le    timestamptz NOT NULL DEFAULT now(),
  traite_le  timestamptz
);
CREATE INDEX IF NOT EXISTS signalements_statut ON signalements (statut, cree_le);

CREATE TABLE IF NOT EXISTS blocages (
  compte_id text NOT NULL REFERENCES comptes(id),
  bloque_id text NOT NULL REFERENCES comptes(id),
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (compte_id, bloque_id)
);

CREATE TABLE IF NOT EXISTS amis (
  compte_id text NOT NULL REFERENCES comptes(id),
  ami_id    text NOT NULL REFERENCES comptes(id),
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (compte_id, ami_id)
);

CREATE TABLE IF NOT EXISTS sanctions (
  id        bigserial PRIMARY KEY,
  compte_id text NOT NULL REFERENCES comptes(id),
  type      text NOT NULL CHECK (type IN ('avertissement', 'micro', 'suspension', 'bannissement', 'levee')),
  motif     text NOT NULL,
  jusqu     timestamptz,
  cree_le   timestamptz NOT NULL DEFAULT now()
);

-- Réglages du jeu modifiables depuis le tableau de bord, sans mise à jour.
CREATE TABLE IF NOT EXISTS reglages_jeu (
  cle    text PRIMARY KEY,
  valeur jsonb NOT NULL
);

-- Toutes les actions de l'admin.
CREATE TABLE IF NOT EXISTS journal_admin (
  id      bigserial PRIMARY KEY,
  action  text NOT NULL,
  cible   text,
  details jsonb,
  cree_le timestamptz NOT NULL DEFAULT now()
);

-- ===== Ligue classée et saisons (retention.md §3.4) =====
ALTER TABLE parties ADD COLUMN IF NOT EXISTS classee boolean NOT NULL DEFAULT false;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS jeu text NOT NULL DEFAULT 'kopo'; -- 'kopo' ou 'inter8'

-- Une saison dure 4 semaines. Une seule est en cours à la fois.
CREATE TABLE IF NOT EXISTS saisons (
  numero      integer PRIMARY KEY,                -- Saison 1, 2, 3…
  nom         text NOT NULL,                      -- « Les Fondateurs », « Kinshasa »…
  theme       text,
  debut       timestamptz NOT NULL,
  fin         timestamptz NOT NULL,
  statut      text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'terminee')),
  cloturee_le timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS saisons_une_en_cours ON saisons (statut) WHERE statut = 'en_cours';

-- Place de chaque joueur dans la ligue, par saison.
CREATE TABLE IF NOT EXISTS ligue (
  saison     integer NOT NULL REFERENCES saisons(numero),
  compte_id  text NOT NULL REFERENCES comptes(id),
  points     integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  division   text NOT NULL DEFAULT 'bois',
  meilleure  text NOT NULL DEFAULT 'bois',        -- meilleure division atteinte (récompense de fin de saison)
  parties    integer NOT NULL DEFAULT 0,
  victoires  integer NOT NULL DEFAULT 0,
  protection integer NOT NULL DEFAULT 0,          -- parties restantes sans pouvoir descendre de division
  maj_le     timestamptz NOT NULL DEFAULT now(),  -- à points égaux, le premier arrivé passe devant
  PRIMARY KEY (saison, compte_id)
);
CREATE INDEX IF NOT EXISTS ligue_classement ON ligue (saison, points DESC, maj_le);

-- Chaque partie classée, joueur par joueur (une seule fois par partie : pas de double comptage).
CREATE TABLE IF NOT EXISTS ligue_parties (
  partie_id      text NOT NULL,
  compte_id      text NOT NULL REFERENCES comptes(id),
  saison         integer NOT NULL,
  place          integer,
  nb_joueurs     integer NOT NULL,
  delta          integer NOT NULL,
  points_apres   integer NOT NULL,
  division_apres text NOT NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partie_id, compte_id)
);
CREATE INDEX IF NOT EXISTS ligue_parties_compte ON ligue_parties (compte_id, cree_le);
CREATE INDEX IF NOT EXISTS ligue_parties_date ON ligue_parties (cree_le);

-- Récompenses de fin de saison (titre « Diamant S1 », pièces, rang final).
CREATE TABLE IF NOT EXISTS recompenses_saison (
  saison    integer NOT NULL REFERENCES saisons(numero),
  compte_id text NOT NULL REFERENCES comptes(id),
  division  text NOT NULL,                        -- division à la fin
  meilleure text NOT NULL,                        -- division atteinte : c'est elle qui est récompensée
  titre     text NOT NULL,
  pieces    integer NOT NULL DEFAULT 0,
  rang      integer,
  vue       boolean NOT NULL DEFAULT false,       -- le joueur a vu l'écran de fin de saison
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saison, compte_id)
);

-- ===== Amis, rivalités et notifications (retention.md §3.7) =====
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS notifs jsonb NOT NULL DEFAULT '{}'; -- types coupés par le joueur : { "rivalite": false }

-- Face-à-face entre deux joueurs (a < b) : qui finit devant l'autre dans les parties jouées ensemble.
CREATE TABLE IF NOT EXISTS face_a_face (
  a          text NOT NULL REFERENCES comptes(id),
  b          text NOT NULL REFERENCES comptes(id),
  victoires_a integer NOT NULL DEFAULT 0,
  victoires_b integer NOT NULL DEFAULT 0,
  maj_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE INDEX IF NOT EXISTS face_a_face_b ON face_a_face (b);

-- Notifications dans le jeu (rivalité, invitation d'un ami, nouvel ami).
CREATE TABLE IF NOT EXISTS notifications (
  id        bigserial PRIMARY KEY,
  compte_id text NOT NULL REFERENCES comptes(id),
  type      text NOT NULL CHECK (type IN ('rivalite', 'invitation', 'ami')),
  texte     text NOT NULL,
  donnees   jsonb,
  lue       boolean NOT NULL DEFAULT false,
  cree_le   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_compte ON notifications (compte_id, lue, cree_le);

-- ===== Collection, parcours de saison, Kopo+ (retention.md §3.5, §3.6) =====
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS equipes jsonb NOT NULL DEFAULT '{}';     -- { avatar, dos, cadre }
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS kopo_plus_jusqu timestamptz;             -- abonnement Kopo+ (cosmétique seulement)

-- Objets possédés (apparences uniquement : rien n'aide à gagner).
CREATE TABLE IF NOT EXISTS inventaire (
  compte_id text NOT NULL REFERENCES comptes(id),
  objet     text NOT NULL,
  source    text NOT NULL,                        -- parcours:1, boutique, admin, saison:1…
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (compte_id, objet)
);

-- Parcours de saison : XP de saison et paliers récupérés (voie gratuite et voie Kopo+).
CREATE TABLE IF NOT EXISTS parcours (
  saison     integer NOT NULL REFERENCES saisons(numero),
  compte_id  text NOT NULL REFERENCES comptes(id),
  xp         integer NOT NULL DEFAULT 0,
  gratuits   integer[] NOT NULL DEFAULT '{}',     -- paliers récupérés, voie gratuite
  plus       integer[] NOT NULL DEFAULT '{}',     -- paliers récupérés, voie Kopo+
  maj_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saison, compte_id)
);
CREATE TABLE IF NOT EXISTS parcours_parties (
  partie_id text NOT NULL,
  compte_id text NOT NULL REFERENCES comptes(id),
  xp        integer NOT NULL,
  PRIMARY KEY (partie_id, compte_id)
);

-- ===== Bascule vers les pièces du serveur (décision du 01/11) =====
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS joker_semaine text;               -- semaine où le joker de série a servi (2026-W45)

-- ===== Parrainage (retention.md §3.7) =====
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS code_parrain text;                -- code du lien d'invitation (?parrain=ABC234)
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS identite_connue boolean NOT NULL DEFAULT false; -- une de ses identités Google/e-mail servait déjà à un autre compte
CREATE UNIQUE INDEX IF NOT EXISTS comptes_code_parrain ON comptes (code_parrain) WHERE code_parrain IS NOT NULL;

-- Empreinte de chaque compte Google (ou téléphone) vu par le serveur : HMAC de l'identifiant Google
-- et de l'adresse, jamais l'identifiant lui-même. Gardée après la suppression du compte : un même
-- compte Google ne peut pas se faire parrainer deux fois en supprimant son compte et en revenant.
CREATE TABLE IF NOT EXISTS empreintes (
  empreinte text PRIMARY KEY,
  compte_id text NOT NULL REFERENCES comptes(id), -- le premier compte Kopo de cette identité
  cree_le   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS empreintes_compte ON empreintes (compte_id);

-- Un filleul n'a qu'un parrain, une seule fois.
CREATE TABLE IF NOT EXISTS parrainages (
  filleul_id     text PRIMARY KEY REFERENCES comptes(id),
  parrain_id     text NOT NULL REFERENCES comptes(id),
  statut         text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'valide', 'expire')),
  parties        integer NOT NULL DEFAULT 0,      -- parties qui comptent, jouées par le filleul
  pieces_parrain integer NOT NULL DEFAULT 0,
  pieces_filleul integer NOT NULL DEFAULT 0,
  note           text,                            -- pourquoi le parrain n'a rien reçu (plafond…)
  cree_le        timestamptz NOT NULL DEFAULT now(),
  expire_le      timestamptz NOT NULL,
  valide_le      timestamptz
);
CREATE INDEX IF NOT EXISTS parrainages_parrain ON parrainages (parrain_id, valide_le);

ALTER TABLE comptes ADD COLUMN IF NOT EXISTS parrain_createur boolean NOT NULL DEFAULT false; -- créateur vérifié par l'admin : pas de plafond par mois

-- Paliers du parrainage déjà donnés (une fois chacun) : 3, 10, 25, 50, 100, 250, 500, 1 000 amis.
CREATE TABLE IF NOT EXISTS parrainage_paliers (
  compte_id text NOT NULL REFERENCES comptes(id),
  palier    integer NOT NULL,
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (compte_id, palier)
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('rivalite', 'invitation', 'ami', 'parrainage', 'bande')); -- bande : rappel du Match du jour, fin de semaine

-- ===== Sauvegarde du profil du téléphone (niveau, statistiques, face-à-face, collection) =====
-- Le profil est calculé sur le téléphone ; sa copie ici le fait revenir sur un autre téléphone,
-- une autre adresse du site ou après un nettoyage du navigateur.
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS profil jsonb;
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS profil_maj timestamptz;

-- ===== Demandes d'ami =====
-- Ajouter quelqu'un envoie une demande : il l'accepte (amis des deux côtés) ou la refuse.
-- Un refus n'est pas dit à l'autre ; il ne peut pas redemander pendant 7 jours (sa demande reste « envoyée »).
CREATE TABLE IF NOT EXISTS demandes_ami (
  de_id      text NOT NULL REFERENCES comptes(id),
  a_id       text NOT NULL REFERENCES comptes(id),
  cree_le    timestamptz NOT NULL DEFAULT now(),
  refusee_le timestamptz,
  PRIMARY KEY (de_id, a_id)
);
CREATE INDEX IF NOT EXISTS demandes_ami_a ON demandes_ami (a_id, cree_le);

-- ===== Match du jour et Bande (competition-amis.md v1.3, validé le 2/11) =====
-- Match du jour : un seul essai officiel par joueur et par jour (jour de Kinshasa). Score sur 100.
CREATE TABLE IF NOT EXISTS match_jour (
  compte_id text NOT NULL REFERENCES comptes(id),
  jour      date NOT NULL,
  score     integer NOT NULL DEFAULT 0,
  manches   integer NOT NULL DEFAULT 0,               -- manches passées (7 au plus avant la finale)
  victoire  boolean NOT NULL DEFAULT false,
  statut    text NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'fini')),
  debut     timestamptz NOT NULL DEFAULT now(),
  fin       timestamptz,
  PRIMARY KEY (compte_id, jour)
);
CREATE INDEX IF NOT EXISTS match_jour_jour ON match_jour (jour, score DESC);

-- Bande : un groupe d'amis (2 à 20 inscrits) qui mise chaque semaine sur ses Matchs du jour.
CREATE TABLE IF NOT EXISTS bandes (
  id        text PRIMARY KEY,
  nom       text NOT NULL,
  code      text NOT NULL UNIQUE,                     -- lien d'invitation ?bande=CODE
  createur  text NOT NULL REFERENCES comptes(id),
  mise      integer NOT NULL,                         -- mise des semaines pas encore commencées
  ouverte   boolean NOT NULL DEFAULT false,           -- visible des inconnus (sur demande, acceptée par le créateur)
  pays      text,
  cree_le   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bande_membres (
  bande_id  text NOT NULL REFERENCES bandes(id) ON DELETE CASCADE,
  compte_id text NOT NULL REFERENCES comptes(id),
  auto      boolean NOT NULL DEFAULT false,           -- remiser automatiquement chaque lundi
  rejoint_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bande_id, compte_id)
);
CREATE INDEX IF NOT EXISTS bande_membres_compte ON bande_membres (compte_id);
CREATE TABLE IF NOT EXISTS bande_demandes (
  bande_id  text NOT NULL REFERENCES bandes(id) ON DELETE CASCADE,
  compte_id text NOT NULL REFERENCES comptes(id),
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bande_id, compte_id)
);
-- Une semaine (du lundi au dimanche) : la mise est figée à la première inscription.
CREATE TABLE IF NOT EXISTS bande_semaines (
  bande_id  text NOT NULL REFERENCES bandes(id) ON DELETE CASCADE,
  semaine   date NOT NULL,                            -- le lundi
  mise      integer NOT NULL,
  statut    text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'cloturee', 'annulee')),
  resultat  jsonb,
  cloturee_le timestamptz,
  PRIMARY KEY (bande_id, semaine)
);
CREATE INDEX IF NOT EXISTS bande_semaines_statut ON bande_semaines (statut, semaine);
CREATE TABLE IF NOT EXISTS bande_inscriptions (
  bande_id  text NOT NULL,
  semaine   date NOT NULL,
  compte_id text NOT NULL REFERENCES comptes(id),
  mise      integer NOT NULL,
  inscrit_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bande_id, semaine, compte_id),
  FOREIGN KEY (bande_id, semaine) REFERENCES bande_semaines(bande_id, semaine) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bande_inscriptions_compte ON bande_inscriptions (compte_id, semaine);

-- ===== Adresse Google visible dans l'admin (onglet Joueurs) =====
-- Notée à chaque connexion Google ; '' = compte lié sans adresse (téléphone). Effacée à la suppression du compte.
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS email text;

-- ===== Notifications push (Web Push) =====
-- Un abonnement par téléphone (navigateur ou appli installée). Effacé quand le navigateur le dit périmé (404, 410).
CREATE TABLE IF NOT EXISTS push_abonnements (
  endpoint  text PRIMARY KEY,
  compte_id text NOT NULL REFERENCES comptes(id),
  p256dh    text NOT NULL,
  auth      text NOT NULL,
  appareil  text,
  cree_le   timestamptz NOT NULL DEFAULT now(),
  vu_le     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_abonnements_compte ON push_abonnements (compte_id);
-- Types de notifications push coupés par le joueur : { "invitation": false, "ami": true, "match": true, "annonce": true }.
-- À part de « notifs » : couper la notification push ne cache pas le message dans le jeu.
ALTER TABLE comptes ADD COLUMN IF NOT EXISTS push_prefs jsonb NOT NULL DEFAULT '{}';
-- Rappel du Match du jour : au plus un par joueur et par jour, même si le serveur redémarre.
CREATE TABLE IF NOT EXISTS push_rappels (
  compte_id text NOT NULL REFERENCES comptes(id),
  jour      date NOT NULL,
  PRIMARY KEY (compte_id, jour)
);
-- Annonces envoyées depuis le tableau de bord.
CREATE TABLE IF NOT EXISTS push_annonces (
  id        bigserial PRIMARY KEY,
  titre     text NOT NULL,
  texte     text NOT NULL,
  public    jsonb,
  joueurs   integer NOT NULL DEFAULT 0,
  envoyees  integer NOT NULL DEFAULT 0,
  cree_le   timestamptz NOT NULL DEFAULT now()
);
