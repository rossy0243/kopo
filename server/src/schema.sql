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
