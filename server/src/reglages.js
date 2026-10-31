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
  messagesRapides: ['👏', '😂', '😮', '🔥', '😡', '👍', '😭', '🙏', 'Bien joué !', 'Vite !', 'Katapss !', 'Oups !'],
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

module.exports = { creerReglages, DEFAUTS, verifierMessages, MESSAGE_MAX };
