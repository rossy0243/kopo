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
