// Réglages du jeu modifiables depuis le tableau de bord (valeurs de départ : strategie-pieces.md v1.0).
'use strict';

const DEFAUTS = {
  gains: { bienvenue: 500, manche: 5, katapss: 10, victoire: 40, deuxieme: 15 },
  bonusJour: { depart: 50, pas: 10, plafond: 150 },
  remiseAFlot: { seuil: 20, niveau: 100 },
  pot: { vainqueur: 50, deuxieme: 25, troisieme: 10, maison: 15 },
  tables: { bronze: 50, argent: 200, or: 1000, diamant: 5000 },
  annonce: { texte: '', active: false },
  maintenance: { active: false, message: 'Le Kopo est en maintenance. On revient très vite !' },
  versionMin: '1.0',
  // Messages du chat en partie : les joueurs ne peuvent envoyer que ceux-là (pas de texte libre, donc pas d'insultes).
  // Ligue classée (retention.md §3.4). Divisions : bois, bronze, argent, or, diamant, legende.
  ligue: {
    seuils: { bois: 0, bronze: 100, argent: 250, or: 450, diamant: 700, legende: 1000 }, // points pour entrer dans la division
    points: { premier: 30, deuxieme: 15, troisieme: 5, avantDernier: -5, dernier: -10, abandon: -15 },
    protection: 3, // parties après une montée (ou un début de saison) pendant lesquelles on ne peut pas redescendre
    joueursMin: 3, // joueurs humains minimum pour qu'une partie publique soit classée
    dureeJours: 28, // 4 semaines (décision du 31/10)
    recompenses: { bois: 100, bronze: 200, argent: 400, or: 700, diamant: 1000, legende: 1500 }, // pièces selon la division atteinte
    descente: { bois: 0, bronze: 1, argent: 1, or: 1, diamant: 2, legende: 2 }, // divisions perdues au début de la saison suivante
  },
  // Parcours de saison (retention.md §3.5) : environ 50 XP par partie, 100 XP par palier, 30 paliers.
  parcours: { xpPartie: 30, xpManche: 5, xpVictoire: 15, xpPalier: 100, paliers: 30 },
  // Cadeau de fondateur (dos « Les Fondateurs ») pour ceux qui avaient des pièces d'essai (décision du 01/11).
  cadeauFondateur: { actif: true },
  // Parrainage : quand l'ami invité (compte Google neuf) a joué `parties` parties entre humains.
  // parMois : plafond anti-faux comptes, levé pour les créateurs vérifiés ; total : 0 = sans limite.
  parrainage: { actif: true, parties: 5, piecesParrain: 300, piecesFilleul: 200, parMois: 30, total: 0, joursCompte: 7, joursPourJouer: 30 },
  // Nom et thème de la prochaine saison (sinon : une ville, thème validé le 31/10).
  prochaineSaison: { nom: '', theme: '' },
  messagesRapides: ['👏', '😂', '😮', '🔥', '😡', '👍', '😭', '🙏', 'Bien joué !', 'Bravo !', 'Joli coup !', 'Belle carte !', 'Bien vu !', 'Trop fort !', 'Merci !', 'Désolé !', 'Oups !', 'Aïe !', 'Pas de chance !', 'Je ramasse…', 'Je t’ai eu !', 'Katapss !', 'Vite !', 'Prends ton temps', 'À toi !', 'Encore une !', 'Bonne chance !', 'Bonne partie !', 'GG !', 'Revanche ?', 'On en refait une ?', 'Je reviens', 'Salut tout le monde !', 'À la prochaine !'],
};
const MESSAGE_MAX = 40, MESSAGES_MAX = 40;
// Nettoie une liste de messages : texte seul, sans doublon, ni trop long ni trop nombreux.
function verifierMessages(v) {
  if (!Array.isArray(v)) return { ok: false, erreur: 'Il faut une liste de messages.' };
  const l = [...new Set(v.map((m) => String(m == null ? '' : m).replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!l.length) return { ok: false, erreur: 'Garde au moins un message.' };
  if (l.length > MESSAGES_MAX) return { ok: false, erreur: `Au plus ${MESSAGES_MAX} messages.` };
  const long = l.find((m) => m.length > MESSAGE_MAX);
  if (long) return { ok: false, erreur: `« ${long.slice(0, 20)}… » dépasse ${MESSAGE_MAX} caractères.` };
  if (l.some((m) => /[<>]/.test(m))) return { ok: false, erreur: 'Les signes < et > ne sont pas acceptés.' };
  return { ok: true, liste: l };
}

const DIVISIONS = ['bois', 'bronze', 'argent', 'or', 'diamant', 'legende'];
const entier = (x) => Number.isInteger(Number(x)) && x !== '' && x !== null ? Number(x) : NaN;
// Réglages de la ligue : tout est entier, seuils croissants à partir de 0, divisions toutes présentes.
function verifierLigue(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  const d = DEFAUTS.ligue;
  const out = {};
  for (const k of ['seuils', 'recompenses', 'descente']) {
    out[k] = {};
    for (const div of DIVISIONS) {
      const n = entier(v[k] && v[k][div]);
      if (!(n >= 0)) err('Valeur manquante ou invalide : ' + k + ' / ' + div + '.');
      out[k][div] = n;
    }
  }
  if (out.seuils.bois !== 0) err('La division Bois commence à 0 point.');
  for (let i = 1; i < DIVISIONS.length; i++) if (out.seuils[DIVISIONS[i]] <= out.seuils[DIVISIONS[i - 1]]) err('Chaque division doit demander plus de points que la précédente.');
  out.points = {};
  for (const k of Object.keys(d.points)) {
    const n = entier(v.points && v.points[k]);
    if (Number.isNaN(n) || Math.abs(n) > 1000) err('Points invalides : ' + k + '.');
    out.points[k] = n;
  }
  for (const k of ['protection', 'joueursMin', 'dureeJours']) {
    const n = entier(v[k]);
    if (!(n >= 0)) err('Valeur invalide : ' + k + '.');
    out[k] = n;
  }
  if (out.joueursMin < 2) err('Il faut au moins 2 joueurs pour une partie classée.');
  if (out.dureeJours < 7 || out.dureeJours > 91) err('Une saison dure entre 7 et 91 jours.');
  return out;
}

function creerReglages(base) {
  let cache = JSON.parse(JSON.stringify(DEFAUTS));
  return {
    async charger() {
      const r = await base.query('SELECT cle, valeur FROM reglages_jeu');
      cache = JSON.parse(JSON.stringify(DEFAUTS));
      for (const l of r.rows) if (l.cle in cache) cache[l.cle] = typeof l.valeur === 'string' ? JSON.parse(l.valeur) : l.valeur;
      return cache;
    },
    tout: () => cache,
    get: (cle) => cache[cle],
    async ecrire(cle, valeur) {
      if (!(cle in DEFAUTS)) throw Object.assign(new Error('Réglage inconnu : ' + cle), { statut: 400 });
      if (typeof DEFAUTS[cle] === 'object' && (typeof valeur !== 'object' || valeur === null)) throw Object.assign(new Error('Valeur invalide.'), { statut: 400 });
      if (cle === 'messagesRapides') {
        const v = verifierMessages(valeur);
        if (!v.ok) throw Object.assign(new Error(v.erreur), { statut: 400 });
        valeur = v.liste;
      }
      if (cle === 'ligue') valeur = verifierLigue(valeur);
      if (cle === 'parcours') {
        const v = {};
        for (const k of Object.keys(DEFAUTS.parcours)) {
          v[k] = entier(valeur[k]);
          if (!(v[k] >= 0)) throw Object.assign(new Error('Valeur invalide : ' + k + '.'), { statut: 400 });
        }
        if (v.xpPalier < 10) throw Object.assign(new Error('Il faut au moins 10 XP par palier.'), { statut: 400 });
        if (v.paliers < 10 || v.paliers > 30) throw Object.assign(new Error('Le parcours a entre 10 et 30 paliers.'), { statut: 400 });
        valeur = v;
      }
      if (cle === 'parrainage') {
        const v = { actif: valeur.actif !== false && valeur.actif !== 0 };
        for (const k of Object.keys(DEFAUTS.parrainage)) {
          if (k === 'actif') continue;
          v[k] = entier(valeur[k]);
          if (!(v[k] >= 0) || v[k] > 100000) throw Object.assign(new Error('Valeur invalide : ' + k + '.'), { statut: 400 });
        }
        if (v.parties < 1) throw Object.assign(new Error('Il faut au moins 1 partie pour valider un parrainage.'), { statut: 400 });
        if (v.joursPourJouer < 1 || v.joursCompte < 1) throw Object.assign(new Error('Les délais font au moins 1 jour.'), { statut: 400 });
        valeur = v;
      }
      if (cle === 'prochaineSaison') valeur = { nom: String(valeur.nom || '').replace(/[<>]/g, '').trim().slice(0, 40), theme: String(valeur.theme || '').replace(/[<>]/g, '').trim().slice(0, 40) };
      if (cle === 'pot') {
        const t = ['vainqueur', 'deuxieme', 'troisieme', 'maison'].reduce((s, k) => s + Number(valeur[k] || 0), 0);
        if (t !== 100) throw Object.assign(new Error('Les parts du pot doivent faire 100 %.'), { statut: 400 });
      }
      await base.query('INSERT INTO reglages_jeu (cle, valeur) VALUES ($1, $2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur', [cle, JSON.stringify(valeur)]);
      cache[cle] = valeur;
      return valeur;
    },
  };
}

module.exports = { creerReglages, DEFAUTS, verifierMessages, verifierLigue, DIVISIONS, MESSAGE_MAX };
