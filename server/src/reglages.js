// Réglages du jeu modifiables depuis le tableau de bord (valeurs de départ : strategie-pieces.md v1.0).
'use strict';

const DEFAUTS = {
  // plafondJour : pièces gagnées au plus par jour (heure de Kinshasa) aux tables gratuites, manches, Katapss et places
  // comprises (0 = sans plafond). Contre les comptes qui enchaînent les parties pour amasser des pièces.
  gains: { bienvenue: 500, manche: 5, katapss: 10, victoire: 40, deuxieme: 15, plafondJour: 0 },
  bonusJour: { depart: 50, pas: 10, plafond: 150 },
  remiseAFlot: { seuil: 20, niveau: 100 },
  pot: { vainqueur: 50, deuxieme: 25, troisieme: 10, maison: 15 },
  tables: { bronze: 50, argent: 200, or: 1000, diamant: 5000 },
  // debut / fin (instants ISO, facultatifs) : l'annonce n'est montrée qu'entre ces deux dates (annonce programmée).
  annonce: { texte: '', active: false, debut: '', fin: '' },
  // Fenêtre « Nouveau » au premier lancement (annonce-competition.md) : éteinte tant qu'on n'ouvre pas la compétition.
  nouveaute: { bande: false },
  maintenance: { active: false, message: 'Masano est en maintenance. On revient très vite !' },
  versionMin: '1.0',
  // Applis mobiles (Flutter) : version minimale par plateforme (en dessous, l'API répond 426 « mets à jour »)
  // et lien vers la fiche du store. Vide = pas de minimum.
  mobile: { android: { versionMin: '', store: '' }, ios: { versionMin: '', store: '' } },
  // État de chaque jeu : ouvert à tous, réservé aux testeurs (pseudos de la liste), ou en maintenance.
  jeux: { kopo: 'ouvert', inter8: 'ouvert', testeurs: [] },
  // Messages du chat en partie : les joueurs ne peuvent envoyer que ceux-là (pas de texte libre, donc pas d'insultes).
  // Ligue classée (retention.md §3.4). Divisions : bois, bronze, argent, or, diamant, legende.
  ligue: {
    seuils: { bois: 0, bronze: 100, argent: 250, or: 450, diamant: 700, legende: 1000 }, // points pour entrer dans la division
    // Durcis le 06/11 (avant : 30 / 15 / 5 / -5 / -10 / -15) : un joueur moyen ne gagne plus que 2 à 3 points par partie.
    points: { premier: 20, deuxieme: 8, troisieme: 2, avantDernier: -8, dernier: -12, abandon: -20 },
    protection: 3, // parties après une montée (ou un début de saison) pendant lesquelles on ne peut pas redescendre
    joueursMin: 3, // joueurs humains minimum pour qu'une partie publique soit classée
    dureeJours: 28, // 4 semaines (décision du 31/10)
    recompenses: { bois: 100, bronze: 200, argent: 400, or: 700, diamant: 1000, legende: 1500 }, // pièces selon la division atteinte
    descente: { bois: 0, bronze: 1, argent: 1, or: 1, diamant: 2, legende: 2 }, // divisions perdues au début de la saison suivante
  },
  // Parcours de saison (retention.md §3.5), durci le 06/11 : environ 18 XP par partie (avant : 30 / 5 / 15, environ 43).
  parcours: { xpPartie: 10, xpManche: 3, xpVictoire: 10, xpPalier: 100, paliers: 30 },
  // Seuils de la ligue et XP par palier plus durs : appliqués à l'ouverture de la prochaine saison (décision du 06/11),
  // pour ne faire redescendre personne en pleine saison. Remis à { enAttente: false } une fois appliqués.
  durcissement: { enAttente: true, seuils: { bois: 0, bronze: 100, argent: 300, or: 600, diamant: 1000, legende: 1500 }, xpPalier: 120 },
  // Cadeau de fondateur (dos « Les Fondateurs ») pour ceux qui avaient des pièces d'essai (décision du 01/11).
  cadeauFondateur: { actif: true },
  // Parrainage : quand l'ami invité (compte Google neuf) a joué `parties` parties entre humains.
  // parMois : plafond anti-faux comptes, levé pour les créateurs vérifiés ; total : 0 = sans limite.
  parrainage: { actif: true, parties: 5, piecesParrain: 300, piecesFilleul: 200, parMois: 30, total: 0, joursCompte: 7, joursPourJouer: 30 },
  // Match du jour (competition-amis.md) : 8 robots de niveau Fort (décision du 2/11), à pleine force, la même donne pour tous.
  matchJour: { actif: true, robots: 'forts', niveauRobots: 20 },
  // Salles publiques gratuites (Kopo et Inter (8)) : des robots complètent la table après `attente` secondes
  // sans assez de joueurs (actif : 1 = oui, 0 = non). Jamais aux tables à mise ; partie sans pièces, Ligue ni XP.
  // robots / force : niveau des robots qui complètent la table (faciles, normaux, forts) et leur force (1 à 20).
  robotsPublics: { actif: 1, attente: 45, robots: 'normaux', force: 10 },
  // Rythme des parties (onglet Réglages > Rythme des parties), en secondes. Lu à l'ouverture de chaque salle, sur le
  // serveur (salles en ligne, entre amis, entraînement de l'appli) et sur le site (contre les robots, via /api/config).
  // rapide : robots entre eux (plus aucun humain dans la manche), tout s'accélère (1 = oui, 0 = non).
  rythme: {
    kopo: { finTour: 5, depart: 5, mancheAuto: 10, revanche: 15, pauseRobot: 1.2, absent: 5, rapide: 1 },
    inter8: { depart: 5, mancheAuto: 10, revanche: 15, pauseRobot: 1.8, annonce: 3, absent: 5, rapide: 1 },
  },
  // Heures (Kinshasa) des rappels push automatiques, et heures de silence (aucun rappel entre silenceDebut et silenceFin).
  heuresPush: { serie: 17, relance: 18, bande: 18, matchJour: 19, silenceDebut: 22, silenceFin: 8 },
  // Notifications push programmées (onglet Notifications) : { id, titre, texte, quand (ISO), pays, envoye (ISO ou '') }.
  pushProgrammes: [],
  // Prix de Kopo+ en francs congolais (formules « 1 mois » et « 1 an »).
  kopoPlus: { mois: 2500, an: 25000 },
  // Comptes suspects : deux comptes qui ont joué au moins `parties` parties seuls ensemble en `jours` jours,
  // gagnées à `pourcent` % ou plus par le même.
  suspects: { jours: 14, parties: 5, pourcent: 80 },
  // Limites contre les abus (par minute) et salles ouvertes en même temps par compte.
  limites: { apiCompte: 120, apiIp: 600, codesCompte: 30, sallesMax: 3 },
  // Création de comptes invités (sans Google) : 1 = ouverte, 0 = fermée (les comptes déjà créés continuent).
  inscriptions: { invites: 1 },
  // Tableau de bord : alerte quand les pièces créées dépassent les détruites de plus de `inflation` % sur 7 jours.
  alertes: { inflation: 25 },
  // Rappels push du serveur (1 = oui, 0 = non), rangés avec le rappel du Match du jour (le joueur les coupe ensemble) :
  // série du bonus du jour à 17 h, mise de la Bande le mercredi à 18 h, fin de saison de la Ligue 24 h avant (heure de Kinshasa).
  rappels: { serie: 1, bande: 1, saison: 1 },
  // Événement à durée limitée (onglet Pilotage) : entre debut et fin (instants ISO), les gains des tables gratuites sont
  // multipliés par `pieces` et le bonus du jour par `bonus` (1 à 5). Annoncé tout seul aux joueurs (/api/config).
  // Relance des joueurs absents (abonnés aux notifications) : après `jours` jours sans venir (et moins de 30), un push à 18 h
  // et `pieces` pièces offertes (0 = rien). Au plus une relance par joueur tous les 30 jours.
  relance: { actif: 1, jours: 3, pieces: 100 },
  // Inter (8), mode Cahier : points de chaque carte restée en main (X = joker). Lu par le serveur au début de
  // chaque partie (figé jusqu'à la fin) : rien à changer dans l'appli. Valeurs de départ : barème du créateur (14/11).
  // Montants d'élimination proposés aux joueurs (« Cahier petit » et « Cahier grand »). Une partie lancée garde le sien.
  // Les anciennes applis envoient 500 ou 1000 : le serveur les prend pour le petit et le grand montant.
  cahierTotaux: { petit: 500, grand: 1000 },
  cahier: { X: 50, A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 25, 9: 9, 10: 10, V: 10, D: 10, R: 10 },
  evenement: { actif: 0, nom: '', debut: '', fin: '', pieces: 2, bonus: 2 },
  // La Bande : maison = % des mises détruit ; inscrits de 2 à 20 ; 5 Matchs sur 7 au moins, sinon la mise est détruite ;
  // jour manqué avant l'inscription = pire note du jour - penaliteRetard ; inscription jusqu'au mercredi 23 h (heure de Kinshasa).
  // Pour miser : compte Google de joursCompte jours au moins, avec partiesMin parties jouées contre des humains.
  bande: { actif: true, maison: 15, miseMin: 500, miseMax: 10000, inscritsMin: 2, membresMax: 20, bandesMax: 3, matchsMin: 5, penaliteRetard: 10, joursCompte: 7, partiesMin: 10 },
  // Nom et thème de la prochaine saison (sinon : une ville, thème validé le 31/10).
  prochaineSaison: { nom: '', theme: '' },
  // Groupes de la communauté (bouton Partager) : réseau, nom, lien, visible. Dans l'ordre de la liste ; sans lien, pas affiché.
  communautes: [],
  // Stickers animés : interrupteur éteint au départ (tout grisé), offres en pièces et en argent réel, pas encore en vente.
  stickers: { actif: false, vente: false, remisePack: require('./stickers').REMISE_PACK, offres: require('./stickers').OFFRES_DEFAUT },
  // Bouquets de pièces (argent réel, du moins cher au plus cher, 40 000 FC au plus) : au taux des stickers, bonus croissant.
  bouquets: { bouquets: require('./bouquets').BOUQUETS_DEFAUT },
  messagesRapides: ['👏', '😂', '😮', '🔥', '😡', '👍', '😭', '🙏', 'Bien joué !', 'Bravo !', 'Joli coup !', 'Belle carte !', 'Bien vu !', 'Trop fort !', 'Merci !', 'Désolé !', 'Oups !', 'Aïe !', 'Pas de chance !', 'Je ramasse…', 'Je t’ai eu !', 'Katapss !', 'Vite !', 'Prends ton temps', 'À toi !', 'Encore une !', 'Bonne chance !', 'Bonne partie !', 'GG !', 'Revanche ?', 'On en refait une ?', 'Je reviens', 'Salut tout le monde !', 'À la prochaine !'],
};
// Version actuelle de l'appli (const VERSION dans src/source.html). La version minimale demandée
// aux joueurs ne peut pas la dépasser : sinon même l'appli à jour demande une mise à jour, en boucle.
const VERSION_APPLI = (() => {
  try { return /const VERSION = '([0-9.]+)'/.exec(require('fs').readFileSync(require('path').join(__dirname, '../../src/source.html'), 'utf8'))[1]; } catch (e) { return null; }
})();
// a est-elle plus récente que b ? ('1.10' > '1.9')
function versionPlusRecente(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
const ANCIEN_MESSAGE_MAINTENANCE = 'Le Kopo est en maintenance. On revient très vite !';
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

// Groupes de la communauté : réseaux connus, liens https seulement (pas de javascript: ni de lien interne).
const RESEAUX = { whatsapp: 'WhatsApp', telegram: 'Telegram', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', discord: 'Discord', autre: 'Autre' };
const COMMUNAUTES_MAX = 12;
function verifierCommunautes(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  if (!Array.isArray(v)) err('Il faut une liste de groupes.');
  if (v.length > COMMUNAUTES_MAX) err(`Au plus ${COMMUNAUTES_MAX} groupes.`);
  return v.map((g, i) => {
    g = g || {};
    const reseau = String(g.reseau || '');
    if (!(reseau in RESEAUX)) err(`Groupe ${i + 1} : réseau inconnu.`);
    const libelle = String(g.libelle == null ? '' : g.libelle).replace(/\s+/g, ' ').trim();
    if (libelle.length > 40) err(`Groupe ${i + 1} : nom de 40 caractères au plus.`);
    if (/[<>]/.test(libelle)) err(`Groupe ${i + 1} : les signes < et > ne sont pas acceptés.`);
    let url = String(g.url == null ? '' : g.url).trim();
    if (url) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      let u = null;
      try { u = new URL(url); } catch (e) {}
      if (!u || u.protocol !== 'https:' || !u.hostname.includes('.') || url.length > 300) err(`Groupe ${i + 1} : lien invalide (il doit commencer par https://).`);
      url = u.href;
    }
    return { reseau, libelle, url, visible: g.visible !== false && g.visible !== 0 };
  });
}
// Ce que voient les joueurs : les groupes visibles qui ont un lien, dans l'ordre.
const communautesPubliques = (l) => (Array.isArray(l) ? l : []).filter((g) => g && g.visible && g.url).map((g) => ({ reseau: g.reseau, libelle: g.libelle || RESEAUX[g.reseau] || '', url: g.url }));

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

// Réglages de la Bande : entiers dans des bornes raisonnables, mise minimum sous la mise maximum.
function verifierBande(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  const bornes = { maison: [0, 50], miseMin: [1, 1e6], miseMax: [1, 1e6], inscritsMin: [2, 20], membresMax: [2, 50], bandesMax: [1, 10], matchsMin: [1, 7], penaliteRetard: [0, 100], joursCompte: [0, 365], partiesMin: [0, 1000] };
  const out = { actif: v.actif !== false && v.actif !== 0 };
  for (const [k, [a, b]] of Object.entries(bornes)) {
    const n = entier(v[k]);
    if (!(n >= a && n <= b)) err(`Valeur invalide : ${k} (entre ${a} et ${b}).`);
    out[k] = n;
  }
  if (out.miseMin > out.miseMax) err('La mise minimum doit être sous la mise maximum.');
  if (out.inscritsMin > out.membresMax) err('Il faut plus de membres possibles que d\'inscrits minimum.');
  return out;
}

// Barème du Cahier : un nombre entier de 0 à 500 points pour chaque carte.
function verifierCahier(v) {
  const out = {};
  for (const k of Object.keys(DEFAUTS.cahier)) {
    const n = entier(v[k]);
    if (!(n >= 0 && n <= 500)) throw Object.assign(new Error(`Points invalides pour ${k === 'X' ? 'le joker' : 'la carte ' + k} (entier de 0 à 500).`), { statut: 400 });
    out[k] = n;
  }
  return out;
}

// Montants d'élimination du Cahier : entiers de 50 à 10 000, le petit sous le grand.
function verifierTotauxCahier(v) {
  const petit = entier(v.petit), grand = entier(v.grand);
  if (!(petit >= 50 && petit <= 10000 && grand >= 50 && grand <= 10000)) throw Object.assign(new Error('Montants d\'élimination : entiers de 50 à 10 000.'), { statut: 400 });
  if (petit >= grand) throw Object.assign(new Error('Le petit montant doit être plus bas que le grand.'), { statut: 400 });
  return { petit, grand };
}
const totauxCahier = (r) => (r && r.petit && r.grand ? [r.petit, r.grand] : [500, 1000]);

// État des jeux : chaque jeu ouvert, testeurs ou maintenance ; au moins un jeu ouvert ; pseudos des testeurs.
const ETATS_JEU = ['ouvert', 'testeurs', 'maintenance'];
const NOMS_JEUX = { kopo: 'Kopo', inter8: 'Inter (8)' };
function verifierJeux(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  const out = {};
  for (const j of Object.keys(NOMS_JEUX)) {
    if (!ETATS_JEU.includes(v[j])) err(`État invalide pour ${NOMS_JEUX[j]} : ouvert, testeurs ou maintenance.`);
    out[j] = v[j];
  }
  if (!Object.keys(NOMS_JEUX).some((j) => out[j] === 'ouvert')) err('Garde au moins un jeu ouvert à tous.');
  const liste = Array.isArray(v.testeurs) ? v.testeurs : String(v.testeurs || '').split(/[\n,]/);
  const vus = new Set();
  out.testeurs = liste.map((x) => String(x || '').trim()).filter((x) => x && !vus.has(x.toLowerCase()) && vus.add(x.toLowerCase())).slice(0, 50);
  if (out.testeurs.some((x) => x.length > 24 || /[<>]/.test(x))) err('Pseudo de testeur invalide.');
  return out;
}
// Ce qu'un joueur voit d'un jeu : 'ouvert', 'test' (testeur d'un jeu réservé), 'ferme' (réservé, pas testeur) ou 'maintenance'.
function etatJeuPour(jeux, jeu, pseudo) {
  const e = (jeux && jeux[jeu]) || 'ouvert';
  if (e !== 'testeurs') return e;
  const p = String(pseudo || '').toLowerCase();
  return p && (jeux.testeurs || []).some((t) => t.toLowerCase() === p) ? 'test' : 'ferme';
}

// Versions des applis mobiles : { android: { versionMin: '1.2.0', store: 'https://play.google.com/…' }, ios: { … } }.
const PLATEFORMES = ['android', 'ios'];
function verifierMobile(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  const out = {};
  for (const p of PLATEFORMES) {
    const x = (v && v[p]) || {};
    const versionMin = String(x.versionMin || '').trim();
    if (versionMin && !/^\d{1,3}(\.\d{1,3}){0,3}$/.test(versionMin)) err(`Version invalide pour ${p} (exemple : 1.2.0).`);
    const store = String(x.store || '').trim();
    if (store && !/^https:\/\/[^\s<>"]{3,300}$/.test(store)) err(`Lien du store invalide pour ${p} (https://…).`);
    out[p] = { versionMin, store };
  }
  return out;
}

// Événement : dates saisies à l'heure de Kinshasa (« 2026-11-28T18:00 ») ou en ISO complet, gardées en ISO UTC.
function verifierEvenement(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  const date = (x, nom) => {
    const t = String(x || '').trim();
    if (!t) return '';
    const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t) ? t + '+01:00' : t);
    if (isNaN(d)) err(`Date de ${nom} invalide.`);
    return d.toISOString();
  };
  const mult = (x, nom) => { const n = Number(x); if (!(n >= 1 && n <= 5)) err(`Multiplicateur ${nom} entre 1 et 5.`); return Math.round(n * 10) / 10; };
  const out = { actif: v.actif === true || v.actif === 1 || v.actif === '1' ? 1 : 0, nom: String(v.nom || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    debut: date(v.debut, 'début'), fin: date(v.fin, 'fin'), pieces: mult(v.pieces, 'des pièces'), bonus: mult(v.bonus, 'du bonus') };
  if (out.actif) {
    if (!out.nom) err('Donne un nom à l\'événement (exemple : Week-end doré).');
    if (!out.debut || !out.fin) err('Il faut une date de début et une date de fin.');
    if (out.fin <= out.debut) err('La fin doit venir après le début.');
  }
  return out;
}
// L'événement en cours à cet instant, ou null.
function evenementEnCours(e, maintenant = new Date()) {
  if (!e || !e.actif || !e.debut || !e.fin) return null;
  const t = maintenant.getTime();
  return t >= Date.parse(e.debut) && t < Date.parse(e.fin) ? e : null;
}

// Nombres d'un réglage, chacun dans ses bornes [min, max] ; `pas` : entiers seulement si 1.
function verifierBornes(v, bornes, { pas = 1, nom = '' } = {}) {
  const out = {};
  for (const [k, [a, b, lib]] of Object.entries(bornes)) {
    const n = Number(v && v[k]);
    if (!Number.isFinite(n) || n < a || n > b || (pas === 1 && !Number.isInteger(n))) throw Object.assign(new Error(`${nom}${lib || k} : entre ${String(a).replace('.', ',')} et ${String(b).replace('.', ',')}.`), { statut: 400 });
    out[k] = pas === 1 ? n : Math.round(n * 10) / 10;
  }
  return out;
}
const oui = (x) => !(x === false || x === 0 || x === '0');
// Rythme des parties : bornes des salles (src/kopo-salle.js, src/inter8-salle.js), en secondes, au dixième.
function verifierRythme(v) {
  const SK = require('../../src/kopo-salle.js'), SI = require('../../src/inter8-salle.js');
  const LIB = { finTour: 'cartes sur la table', depart: 'compte à rebours du départ', mancheAuto: 'manche suivante', revanche: 'temps pour la revanche', pauseRobot: 'réflexion d\'un robot', absent: 'temps d\'un absent', annonce: 'délai pour annoncer' };
  const bornes = (B) => Object.fromEntries(Object.entries(B).map(([k, [a, b]]) => [k, [a, b, LIB[k]]]));
  return {
    kopo: { ...verifierBornes((v || {}).kopo, bornes(SK.BORNES_RYTHME), { pas: 0.1, nom: 'Kopo, ' }), rapide: oui(((v || {}).kopo || {}).rapide) ? 1 : 0 },
    inter8: { ...verifierBornes((v || {}).inter8, bornes(SI.BORNES_RYTHME), { pas: 0.1, nom: 'Inter (8), ' }), rapide: oui(((v || {}).inter8 || {}).rapide) ? 1 : 0 },
  };
}
// Heures de Kinshasa : entiers de 0 à 23.
const HEURES_PUSH = { serie: 'série du bonus', relance: 'relance des absents', bande: 'mise de la Bande', matchJour: 'Match du jour', silenceDebut: 'début du silence', silenceFin: 'fin du silence' };
const verifierHeuresPush = (v) => verifierBornes(v, Object.fromEntries(Object.entries(HEURES_PUSH).map(([k, l]) => [k, [0, 23, 'Heure ' + l]])));
// L'heure h (0 à 23) tombe-t-elle dans le silence ? (de 22 h à 8 h : la plage passe minuit)
function heureDeSilence(h, hp) {
  const d = hp && Number.isInteger(hp.silenceDebut) ? hp.silenceDebut : 22, f = hp && Number.isInteger(hp.silenceFin) ? hp.silenceFin : 8;
  if (d === f) return false;
  return d < f ? h >= d && h < f : h >= d || h < f;
}
// Notifications programmées : 20 au plus, texte court, date à l'heure de Kinshasa ou ISO.
function verifierPushProgrammes(v) {
  const err = (m) => { throw Object.assign(new Error(m), { statut: 400 }); };
  if (!Array.isArray(v)) err('Il faut une liste de notifications.');
  if (v.length > 20) err('Au plus 20 notifications programmées.');
  return v.map((x, i) => {
    x = x || {};
    const texte = String(x.texte || '').replace(/\s+/g, ' ').trim().slice(0, 200), titre = String(x.titre || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!texte) err(`Notification ${i + 1} : écris le texte.`);
    if (/[<>]/.test(texte + titre)) err(`Notification ${i + 1} : les signes < et > ne sont pas acceptés.`);
    const t = String(x.quand || '').trim();
    const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t) ? t + '+01:00' : t);
    if (!t || isNaN(d)) err(`Notification ${i + 1} : date d'envoi invalide.`);
    const pays = String(x.pays || '').trim().toUpperCase();
    if (pays && !/^[A-Z]{2}$/.test(pays)) err(`Notification ${i + 1} : pays inconnu (deux lettres, ex. CD).`);
    const envoye = x.envoye && !isNaN(new Date(x.envoye)) ? new Date(x.envoye).toISOString() : '';
    const id = /^[a-z0-9]{4,16}$/.test(String(x.id || '')) ? String(x.id) : Math.random().toString(36).slice(2, 10);
    return { id, titre, texte, quand: d.toISOString(), pays, envoye, resultat: String(x.resultat || '').slice(0, 120) };
  });
}
// L'annonce de l'admin est-elle visible maintenant ? (active, avec un texte, et dans sa fenêtre si elle en a une)
function annonceVisible(a, maintenant = new Date()) {
  if (!a || !a.active || !a.texte) return false;
  const t = maintenant.getTime();
  if (a.debut && t < Date.parse(a.debut)) return false;
  if (a.fin && t >= Date.parse(a.fin)) return false;
  return true;
}

function creerReglages(base) {
  let cache = JSON.parse(JSON.stringify(DEFAUTS));
  return {
    async charger() {
      const r = await base.query('SELECT cle, valeur FROM reglages_jeu');
      cache = JSON.parse(JSON.stringify(DEFAUTS));
      for (const l of r.rows) if (l.cle in cache) cache[l.cle] = typeof l.valeur === 'string' ? JSON.parse(l.valeur) : l.valeur;
      // Réglages enregistrés avant l'ajout d'un champ (ex. gains.plafondJour) : le champ manquant prend sa valeur de départ.
      for (const k of ['gains', 'annonce', 'robotsPublics', 'heuresPush', 'kopoPlus', 'suspects', 'limites', 'inscriptions', 'alertes']) {
        if (cache[k] && typeof cache[k] === 'object' && !Array.isArray(cache[k])) cache[k] = { ...DEFAUTS[k], ...cache[k] };
      }
      if (cache.rythme) cache.rythme = { kopo: { ...DEFAUTS.rythme.kopo, ...cache.rythme.kopo }, inter8: { ...DEFAUTS.rythme.inter8, ...cache.rythme.inter8 } };
      // L'appli s'appelle maintenant Masano : l'ancien message par défaut, enregistré tel quel, prend le nouveau nom.
      if (cache.maintenance && cache.maintenance.message === ANCIEN_MESSAGE_MAINTENANCE) cache.maintenance = { ...cache.maintenance, message: DEFAUTS.maintenance.message };
      // Une version minimale plus haute que l'appli bloquerait tout le monde : on la ramène à la version actuelle.
      if (VERSION_APPLI && versionPlusRecente(cache.versionMin, VERSION_APPLI)) cache.versionMin = VERSION_APPLI;
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
      if (cle === 'communautes') valeur = verifierCommunautes(valeur);
      if (cle === 'versionMin') {
        valeur = String(valeur || '').trim();
        if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(valeur)) throw Object.assign(new Error('Version invalide (exemple : 1.1).'), { statut: 400 });
        if (VERSION_APPLI && versionPlusRecente(valeur, VERSION_APPLI)) throw Object.assign(new Error(`La version actuelle de l'appli est ${VERSION_APPLI} : la version minimale ne peut pas être plus haute, sinon même l'appli à jour demanderait une mise à jour.`), { statut: 400 });
      }
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
      if (cle === 'matchJour') {
        const n = entier(valeur.niveauRobots);
        if (!['faciles', 'normaux', 'forts'].includes(valeur.robots)) throw Object.assign(new Error('Niveau des robots : faciles, normaux ou forts.'), { statut: 400 });
        if (!(n >= 1 && n <= 100)) throw Object.assign(new Error('Niveau des robots entre 1 et 100.'), { statut: 400 });
        valeur = { actif: valeur.actif !== false && valeur.actif !== 0, robots: valeur.robots, niveauRobots: n };
      }
      if (cle === 'relance') {
        const jours = entier(valeur.jours), pieces = entier(valeur.pieces);
        if (!(jours >= 2 && jours <= 29)) throw Object.assign(new Error('Absence entre 2 et 29 jours.'), { statut: 400 });
        if (!(pieces >= 0 && pieces <= 2000)) throw Object.assign(new Error('Cadeau entre 0 et 2 000 pièces.'), { statut: 400 });
        valeur = { actif: valeur.actif === false || valeur.actif === 0 || valeur.actif === '0' ? 0 : 1, jours, pieces };
      }
      if (cle === 'evenement') valeur = verifierEvenement(valeur);
      if (cle === 'rythme') valeur = verifierRythme(valeur);
      if (cle === 'heuresPush') valeur = verifierHeuresPush(valeur);
      if (cle === 'pushProgrammes') valeur = verifierPushProgrammes(valeur);
      if (cle === 'kopoPlus') {
        valeur = verifierBornes(valeur, { mois: [100, 1e6, 'Prix d\'un mois'], an: [100, 1e7, 'Prix d\'un an'] });
        if (valeur.an < valeur.mois) throw Object.assign(new Error('Un an ne peut pas coûter moins qu\'un mois.'), { statut: 400 });
      }
      if (cle === 'suspects') valeur = verifierBornes(valeur, { jours: [1, 90, 'Période (jours)'], parties: [2, 100, 'Parties ensemble'], pourcent: [50, 100, 'Victoires du même (%)'] });
      if (cle === 'limites') valeur = verifierBornes(valeur, { apiCompte: [30, 2000, 'Appels par compte'], apiIp: [100, 10000, 'Appels par adresse'], codesCompte: [5, 200, 'Codes essayés'], sallesMax: [1, 10, 'Salles par compte'] });
      if (cle === 'inscriptions') valeur = { invites: oui(valeur.invites) ? 1 : 0 };
      if (cle === 'alertes') valeur = verifierBornes(valeur, { inflation: [0, 500, 'Seuil d\'alerte (%)'] });
      if (cle === 'gains') valeur = verifierBornes({ plafondJour: 0, ...valeur }, { bienvenue: [0, 100000], manche: [0, 10000], katapss: [0, 10000], victoire: [0, 100000], deuxieme: [0, 100000], plafondJour: [0, 1e6, 'Plafond par jour'] });
      if (cle === 'annonce') {
        const date = (x, nom) => { const t = String(x || '').trim(); if (!t) return ''; const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t) ? t + '+01:00' : t); if (isNaN(d)) throw Object.assign(new Error(`Date de ${nom} invalide.`), { statut: 400 }); return d.toISOString(); };
        valeur = { texte: String(valeur.texte || '').slice(0, 300), active: !!valeur.active, debut: date(valeur.debut, 'début'), fin: date(valeur.fin, 'fin') };
        if (valeur.debut && valeur.fin && valeur.fin <= valeur.debut) throw Object.assign(new Error('La fin doit venir après le début.'), { statut: 400 });
      }
      if (cle === 'rappels') valeur = Object.fromEntries(Object.keys(DEFAUTS.rappels).map((k) => [k, valeur[k] === false || valeur[k] === 0 || valeur[k] === '0' ? 0 : 1]));
      if (cle === 'robotsPublics') {
        const attente = entier(valeur.attente);
        if (!(attente >= 10 && attente <= 600)) throw Object.assign(new Error('Attente entre 10 et 600 secondes.'), { statut: 400 });
        const force = valeur.force === undefined ? 10 : entier(valeur.force);
        if (!(force >= 1 && force <= 20)) throw Object.assign(new Error('Force des robots entre 1 et 20.'), { statut: 400 });
        const robots = valeur.robots === undefined ? 'normaux' : valeur.robots;
        if (!['faciles', 'normaux', 'forts'].includes(robots)) throw Object.assign(new Error('Niveau des robots : faciles, normaux ou forts.'), { statut: 400 });
        valeur = { actif: valeur.actif !== false && valeur.actif !== 0 && valeur.actif !== '0' ? 1 : 0, attente, robots, force };
      }
      if (cle === 'bande') valeur = verifierBande(valeur);
      if (cle === 'cahier') valeur = verifierCahier(valeur);
      if (cle === 'cahierTotaux') valeur = verifierTotauxCahier(valeur);
      if (cle === 'stickers') valeur = require('./stickers').verifierReglage(valeur);
      if (cle === 'bouquets') valeur = require('./bouquets').verifierReglage(valeur);
      if (cle === 'durcissement') {
        if (valeur.enAttente) {
          verifierLigue({ ...DEFAUTS.ligue, seuils: valeur.seuils });
          if (!(entier(valeur.xpPalier) >= 10)) throw Object.assign(new Error('Il faut au moins 10 XP par palier.'), { statut: 400 });
          valeur = { enAttente: true, seuils: { ...valeur.seuils }, xpPalier: entier(valeur.xpPalier) };
        } else valeur = { enAttente: false };
      }
      if (cle === 'jeux') valeur = verifierJeux(valeur);
      if (cle === 'mobile') valeur = verifierMobile(valeur);
      if (cle === 'nouveaute') valeur = { bande: !!(valeur && valeur.bande === true) };
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

module.exports = { verifierRythme, verifierHeuresPush, heureDeSilence, verifierPushProgrammes, annonceVisible, verifierBornes, verifierTotauxCahier, totauxCahier, verifierCahier, evenementEnCours, verifierEvenement, verifierMobile, PLATEFORMES, verifierCommunautes, communautesPubliques, RESEAUX, verifierJeux, etatJeuPour, NOMS_JEUX, creerReglages, DEFAUTS, VERSION_APPLI, versionPlusRecente, verifierMessages, verifierLigue, verifierBande, DIVISIONS, MESSAGE_MAX };
