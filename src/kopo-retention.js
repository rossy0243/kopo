// Kopo — tout ce qui donne envie de revenir, calculé sur le téléphone (retention.md v1.0, lot A).
// XP et niveau, stats, face-à-face, missions du jour, défi de la semaine, parcours de bienvenue,
// joker de série du bonus du jour, objets de collection (thème des villes).
// Fonctions pures : on leur passe le profil (objet kopo-profil) et le jour ('AAAA-MM-JJ'),
// elles le modifient et renvoient ce qu'il faut montrer. Aucune dépendance au navigateur.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ dates
  const jourDe = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dateDe = (jour) => { const [a, m, j] = jour.split('-').map(Number); return new Date(a, m - 1, j, 12); };
  const decaler = (jour, n) => { const d = dateDe(jour); d.setDate(d.getDate() + n); return jourDe(d); };
  const ecart = (a, b) => Math.round((dateDe(b) - dateDe(a)) / 864e5); // jours de a à b
  // Semaine ISO (lundi → dimanche), ex. '2026-W44'.
  function semaineDe(jour) {
    const d = dateDe(jour);
    const jd = (d.getDay() + 6) % 7; // lundi = 0
    d.setDate(d.getDate() - jd + 3); // jeudi de la semaine
    const n = Math.ceil((Math.round((d - new Date(d.getFullYear(), 0, 1, 12)) / 864e5) + 1) / 7);
    return d.getFullYear() + '-W' + String(n).padStart(2, '0');
  }
  // Petit hasard reproductible (missions tirées le même jour donnent les mêmes).
  function hasard(graine) {
    let h = 2166136261;
    for (const c of String(graine)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------------ XP et niveau (profil-joueur §3)
  const XP = { partie: 5, manche: 10, katapss: 15, finale: 20, victoire: 50, premiere: 100 };
  const xpPourNiveau = (n) => 100 + 25 * (n - 1); // XP pour passer du niveau n au niveau n+1
  function niveauDe(xp) {
    let n = 1, reste = Math.max(0, xp || 0);
    while (reste >= xpPourNiveau(n)) { reste -= xpPourNiveau(n); n++; }
    return { niveau: n, dansNiveau: reste, pourSuivant: xpPourNiveau(n) };
  }

  // ------------------------------------------------------------------ objets de collection
  // Thème des villes (retention §3.6). Rien n'aide à gagner : ce sont des apparences.
  const OBJETS = {
    'av-laiton': { type: 'avatar', nom: 'Laiton', d: 'De base' },
    'av-nuit': { type: 'avatar', nom: 'Nuit', d: 'Niveau 2' },
    'av-kinshasa': { type: 'avatar', nom: 'Kinshasa', d: 'Bienvenue, jour 3' },
    'av-fleuve': { type: 'avatar', nom: 'Fleuve', d: 'Niveau 5' },
    'dos-laiton': { type: 'dos', nom: 'Laiton', d: 'De base' },
    'dos-kinshasa': { type: 'dos', nom: 'Kinshasa', d: 'Bienvenue, jour 7' },
    'cadre-kinshasa': { type: 'cadre', nom: 'Kinshasa', d: 'Défi de la semaine' },
    'cadre-lubumbashi': { type: 'cadre', nom: 'Lubumbashi', d: 'Défi de la semaine' },
    'cadre-abidjan': { type: 'cadre', nom: 'Abidjan', d: 'Défi de la semaine' },
    'cadre-dakar': { type: 'cadre', nom: 'Dakar', d: 'Défi de la semaine' },
    'cadre-douala': { type: 'cadre', nom: 'Douala', d: 'Défi de la semaine' },
    'cadre-brazzaville': { type: 'cadre', nom: 'Brazzaville', d: 'Défi de la semaine' },
  };
  const OBJETS_NIVEAU = { 2: 'av-nuit', 5: 'av-fleuve' };
  function collection(p) {
    if (!p.collection || typeof p.collection !== 'object') p.collection = {};
    const c = p.collection;
    if (!Array.isArray(c.possedes)) c.possedes = [];
    for (const id of ['av-laiton', 'dos-laiton']) if (!c.possedes.includes(id)) c.possedes.push(id);
    if (!c.equipes || typeof c.equipes !== 'object') c.equipes = {};
    c.equipes = Object.assign({ avatar: 'av-laiton', dos: 'dos-laiton', cadre: null }, c.equipes);
    return c;
  }
  // Donne un objet ; on l'équipe tout de suite pour que le joueur le voie.
  function donnerObjet(p, id) {
    const c = collection(p), o = OBJETS[id];
    if (!o || c.possedes.includes(id)) return false;
    c.possedes.push(id);
    c.equipes[o.type] = id;
    return true;
  }
  function equiper(p, id) {
    const c = collection(p), o = OBJETS[id];
    if (!o) return false;
    if (o.type === 'cadre' && c.equipes.cadre === id) { c.equipes.cadre = null; return true; } // retirer le cadre
    if (!c.possedes.includes(id)) return false;
    c.equipes[o.type] = id;
    return true;
  }

  // ------------------------------------------------------------------ missions du jour (retention §3.2)
  // ev : ce qu'une partie apporte (voir bilanPartie). Chaque modèle dit de combien il avance.
  const MODELES = [
    { id: 'jouer2', texte: 'Joue 2 parties', cible: 2, pieces: 20, compte: (e) => 1 },
    { id: 'jouer3', texte: 'Joue 3 parties', cible: 3, pieces: 30, compte: (e) => 1 },
    { id: 'jouer5', texte: 'Joue 5 parties', cible: 5, pieces: 50, compte: (e) => 1 },
    { id: 'manches5', texte: 'Survis à 5 manches', cible: 5, pieces: 30, compte: (e) => e.manches },
    { id: 'manches10', texte: 'Survis à 10 manches', cible: 10, pieces: 60, compte: (e) => e.manches },
    { id: 'katapss', texte: 'Fais un Katapss', cible: 1, pieces: 60, compte: (e) => e.katapss },
    { id: 'premier2', texte: 'Sors le premier de 2 manches', cible: 2, pieces: 50, compte: (e) => e.premierSorti },
    { id: 'finale', texte: 'Atteins une finale', cible: 1, pieces: 40, compte: (e) => (e.finale ? 1 : 0) },
    { id: 'finales2', texte: 'Atteins 2 finales', cible: 2, pieces: 70, compte: (e) => (e.finale ? 1 : 0) },
    { id: 'gagner', texte: 'Gagne une partie', cible: 1, pieces: 80, compte: (e) => (e.victoire ? 1 : 0) },
    { id: 'gagner5', texte: 'Gagne une partie à 5 joueurs ou plus', cible: 1, pieces: 100, compte: (e) => (e.victoire && e.nbJoueurs >= 5 ? 1 : 0) },
    { id: 'moitie2', texte: 'Finis 2 parties dans la première moitié', cible: 2, pieces: 40, compte: (e) => (e.place <= Math.ceil(e.nbJoueurs / 2) ? 1 : 0) },
    { id: 'enligne', texte: 'Joue une partie en ligne', cible: 1, pieces: 40, compte: (e) => (e.publique ? 1 : 0) },
    { id: 'amis', texte: 'Joue une partie entre amis', cible: 1, pieces: 50, compte: (e) => (!e.publique && !e.avecRobots && e.nbJoueurs >= 2 ? 1 : 0) },
    { id: 'grande', texte: 'Joue une partie à 7 joueurs ou plus', cible: 1, pieces: 50, compte: (e) => (e.nbJoueurs >= 7 ? 1 : 0) },
  ];
  const modele = (id) => MODELES.find((m) => m.id === id);
  const PAR_JOUR = 3, DUREE_MISSION = 2; // 3 missions par jour, gardées 2 jours (on peut rater un jour)
  const xpMission = (m) => Math.round(m.pieces / 2);

  function tirerMissions(jour, exclus, n, sel) {
    const r = hasard('missions-' + jour + (sel || ''));
    const libres = MODELES.filter((m) => !exclus.includes(m.id));
    const choix = [];
    // Une mission « facile » (jouer) au moins, pour que chaque journée soit faisable.
    const faciles = libres.filter((m) => /^jouer/.test(m.id));
    if (!exclus.some((id) => /^jouer/.test(id)) && faciles.length && n === PAR_JOUR) choix.push(faciles[Math.floor(r() * faciles.length)]);
    while (choix.length < n) {
      const restes = libres.filter((m) => !choix.includes(m) && !(choix.some((c) => /^jouer/.test(c.id)) && /^jouer/.test(m.id)));
      if (!restes.length) break;
      choix.push(restes[Math.floor(r() * restes.length)]);
    }
    return choix.map((m) => ({ id: m.id, jour, avance: 0, finie: false }));
  }
  // Prépare les missions du jour : 3 nouvelles chaque jour, celles d'hier restent si pas finies.
  function missionsDuJour(p, jour) {
    const ms = p.missions && typeof p.missions === 'object' ? p.missions : (p.missions = {});
    if (!Array.isArray(ms.liste)) ms.liste = [];
    // On garde les missions encore valables (2 jours) et pas terminées ; les terminées du jour restent affichées.
    ms.liste = ms.liste.filter((m) => modele(m.id) && ecart(m.jour, jour) >= 0 && ecart(m.jour, jour) < DUREE_MISSION && (!m.finie || m.jour === jour || m.finieLe === jour));
    if (ms.tire !== jour) {
      ms.tire = jour;
      ms.changeLe = null;
      const nouvelles = tirerMissions(jour, ms.liste.map((m) => m.id), PAR_JOUR);
      ms.liste = ms.liste.filter((m) => m.jour !== jour).concat(nouvelles);
    }
    return ms.liste.map((m) => vueMission(m, jour));
  }
  function vueMission(m, jour) {
    const md = modele(m.id);
    return { id: m.id, texte: md.texte, cible: md.cible, avance: Math.min(m.avance, md.cible), finie: !!m.finie, pieces: md.pieces, xp: xpMission(md), hier: m.jour !== jour };
  }
  // 1 bouton « Changer » par jour pour remplacer une mission pas commencée qui ne plaît pas.
  function peutChanger(p, jour) { return !!(p.missions && p.missions.tire === jour && p.missions.changeLe !== jour); }
  function changerMission(p, jour, id) {
    missionsDuJour(p, jour);
    const ms = p.missions;
    const i = ms.liste.findIndex((m) => m.id === id && !m.finie);
    if (i < 0 || !peutChanger(p, jour)) return null;
    const [nouvelle] = tirerMissions(jour, ms.liste.map((m) => m.id), 1, '-changer');
    if (!nouvelle) return null;
    ms.liste[i] = nouvelle;
    ms.changeLe = jour;
    return vueMission(nouvelle, jour);
  }

  // ------------------------------------------------------------------ défi de la semaine
  const DEFIS = [
    { id: 'gagner5', texte: 'Gagne 5 parties cette semaine', cible: 5, compte: (e) => (e.victoire ? 1 : 0) },
    { id: 'parties15', texte: 'Joue 15 parties cette semaine', cible: 15, compte: () => 1 },
    { id: 'manches30', texte: 'Survis à 30 manches cette semaine', cible: 30, compte: (e) => e.manches },
    { id: 'katapss3', texte: 'Fais 3 Katapss cette semaine', cible: 3, compte: (e) => e.katapss },
    { id: 'finales6', texte: 'Atteins 6 finales cette semaine', cible: 6, compte: (e) => (e.finale ? 1 : 0) },
  ];
  const CADRES = ['cadre-kinshasa', 'cadre-lubumbashi', 'cadre-abidjan', 'cadre-dakar', 'cadre-douala', 'cadre-brazzaville'];
  const DEFI_PIECES = 300, DEFI_XP = 150;
  function defiSemaine(p, jour) {
    const sem = semaineDe(jour);
    if (!p.defi || p.defi.semaine !== sem) {
      const n = parseInt(sem.slice(-2), 10) + parseInt(sem.slice(0, 4), 10) * 53;
      p.defi = { semaine: sem, id: DEFIS[n % DEFIS.length].id, cadre: CADRES[n % CADRES.length], avance: 0, finie: false };
    }
    const d = DEFIS.find((x) => x.id === p.defi.id) || DEFIS[0];
    const fin = decaler(jour, 6 - ((dateDe(jour).getDay() + 6) % 7));
    return { texte: d.texte, cible: d.cible, avance: Math.min(p.defi.avance, d.cible), finie: p.defi.finie, pieces: DEFI_PIECES, xp: DEFI_XP, cadre: p.defi.cadre, nomCadre: OBJETS[p.defi.cadre].nom, joursRestants: ecart(jour, fin) + 1 };
  }

  // ------------------------------------------------------------------ parcours de bienvenue (7 jours)
  // Compté en jours de jeu, pas en jours du calendrier : rater un jour ne fait rien perdre.
  const BIENVENUE = [
    { pieces: 100 }, { pieces: 150 }, { objet: 'av-kinshasa' }, { pieces: 200 },
    { pieces: 250 }, { pieces: 300 }, { objet: 'dos-kinshasa' },
  ];
  function bienvenue(p, jour) {
    const b = p.bienvenue && typeof p.bienvenue === 'object' ? p.bienvenue : (p.bienvenue = { recus: 0, dernier: null });
    const aRecevoir = b.recus < BIENVENUE.length && b.dernier !== jour;
    return { recus: b.recus, aRecevoir, jour: aRecevoir ? b.recus + 1 : b.recus, termine: b.recus >= BIENVENUE.length, cadeaux: BIENVENUE.map((c) => Object.assign({}, c, c.objet ? { nom: OBJETS[c.objet].nom, type: OBJETS[c.objet].type } : {})) };
  }
  // Donne le cadeau du jour. Renvoie { pieces?, objet? } ou null.
  function recevoirBienvenue(p, jour) {
    const etat = bienvenue(p, jour);
    if (!etat.aRecevoir) return null;
    const c = BIENVENUE[p.bienvenue.recus];
    p.bienvenue.recus++;
    p.bienvenue.dernier = jour;
    if (c.pieces) crediter(p, c.pieces);
    if (c.objet) donnerObjet(p, c.objet);
    return Object.assign({ jour: p.bienvenue.recus }, c);
  }

  // ------------------------------------------------------------------ bonus du jour + joker de série
  // Série : 50, 60, 70… plafonnée à 150. Un jour raté par semaine ne casse pas la série (joker).
  const gainBonus = (serie) => Math.min(50 + (serie - 1) * 10, 150);
  function pieces(p) {
    if (!p.pieces) p.pieces = { solde: 500, essai: true, bonusSerie: 0, bonusDernier: null };
    return p.pieces;
  }
  function crediter(p, n) { pieces(p).solde += n; }
  const jokerLibre = (p, jour) => pieces(p).jokerSemaine !== semaineDe(jour);
  function bonusDuJour(p, jour) {
    const pc = pieces(p);
    if (pc.bonusDernier === jour) return null;
    let serie = 1, joker = false;
    if (pc.bonusDernier === decaler(jour, -1)) serie = (pc.bonusSerie || 0) + 1;
    else if (pc.bonusDernier === decaler(jour, -2) && pc.bonusSerie && jokerLibre(p, jour)) {
      serie = pc.bonusSerie + 1; joker = true; pc.jokerSemaine = semaineDe(jour);
    }
    const gain = gainBonus(serie);
    pc.solde += gain; pc.bonusSerie = serie; pc.bonusDernier = jour;
    return { gain, serie, joker, prochain: gainBonus(serie + 1) };
  }

  // ------------------------------------------------------------------ bilan d'une partie
  // À partir de la vue de fin de partie et de ce que le téléphone a vu manche après manche.
  // suivi : { avecRobots, publique, katapss, premierSorti, guidee }
  function bilanPartie(v, suivi) {
    const ordre = [v.vainqueur].concat(v.elimines.slice().reverse());
    const place = ordre.indexOf(v.moi) + 1;
    const nbJoueurs = ordre.length;
    const manches = place === 1 ? v.numeroManche : Math.max(0, v.elimines.indexOf(v.moi));
    const humains = v.joueurs.filter((j) => j.id !== v.moi && !j.robot);
    return {
      place, nbJoueurs, manches,
      finale: place > 0 && place <= 2 && nbJoueurs >= 2,
      victoire: place === 1,
      katapss: suivi.katapss || 0,
      premierSorti: suivi.premierSorti || 0,
      avecRobots: !!suivi.avecRobots,
      publique: !!suivi.publique,
      guidee: !!suivi.guidee,
      adversaires: humains.map((j) => ({ id: j.id, nom: j.nom, devant: ordre.indexOf(j.id) > -1 && ordre.indexOf(j.id) < ordre.indexOf(v.moi) })),
    };
  }

  const STATS0 = { parties: 0, victoires: 0, finales: 0, manchesSurvecues: 0, katapss: 0, eliminePremier: 0 };
  // Enregistre une partie terminée. Renvoie le récap à montrer (XP, missions, défi, face-à-face).
  function enregistrerPartie(p, e, jour) {
    if (e.place < 1) return null;
    const xpAvant = p.xp || 0;
    const premiere = !p.premierePartie;
    // XP (divisée par deux avec des robots) + bonus de la toute première partie (niveau 2 tout de suite).
    let xp = XP.partie + e.manches * XP.manche + e.katapss * XP.katapss + (e.finale ? XP.finale : 0) + (e.victoire ? XP.victoire : 0);
    if (e.avecRobots) xp = Math.floor(xp / 2);
    if (premiere) { xp += XP.premiere; p.premierePartie = jour; }
    // Stats (les parties avec des robots sont rangées à part : entraînement)
    if (e.avecRobots) {
      const en = p.entrainement || (p.entrainement = { parties: 0, victoires: 0 });
      en.parties++; if (e.victoire) en.victoires++;
    } else {
      const s = p.stats = Object.assign({}, STATS0, p.stats || {});
      s.parties++; if (e.victoire) s.victoires++; if (e.finale) s.finales++;
      s.manchesSurvecues += e.manches; s.katapss += e.katapss;
      if (e.place === e.nbJoueurs) s.eliminePremier++;
    }
    // Face-à-face : seulement entre humains, sans robot à la table.
    let faceAFace = null;
    if (!e.avecRobots && e.adversaires.length) {
      const rv = p.rivaux || (p.rivaux = {});
      for (const a of e.adversaires) {
        const r = rv[a.id] || (rv[a.id] = { pseudo: a.nom, gagnes: 0, perdus: 0 });
        r.pseudo = a.nom; r.vuLe = jour;
        if (a.devant) r.perdus++; else r.gagnes++;
      }
      // On montre l'adversaire avec qui l'histoire est la plus longue (à égalité : celui qui t'a battu).
      const choisi = e.adversaires.slice().sort((a, b) => (rv[b.id].gagnes + rv[b.id].perdus) - (rv[a.id].gagnes + rv[a.id].perdus) || (b.devant - a.devant))[0];
      const r = rv[choisi.id];
      faceAFace = { nom: r.pseudo, gagnes: r.gagnes, perdus: r.perdus, gagne: !choisi.devant };
      // Les 200 plus récents seulement.
      const ids = Object.keys(rv);
      if (ids.length > 200) ids.sort((a, b) => (rv[a].vuLe < rv[b].vuLe ? -1 : 1)).slice(0, ids.length - 200).forEach((id) => delete rv[id]);
    }
    // Missions du jour
    missionsDuJour(p, jour);
    const missions = [];
    let piecesGagnees = 0, xpMissions = 0;
    for (const m of p.missions.liste) {
      if (m.finie) continue;
      const md = modele(m.id);
      const n = md.compte(e);
      if (!n) continue;
      const avant = m.avance;
      m.avance = Math.min(md.cible, m.avance + n);
      if (m.avance >= md.cible) { m.finie = true; m.finieLe = jour; piecesGagnees += md.pieces; xpMissions += xpMission(md); }
      missions.push({ texte: md.texte, avant, apres: m.avance, cible: md.cible, finie: m.finie, pieces: md.pieces });
    }
    // Défi de la semaine
    defiSemaine(p, jour);
    let defi = null;
    if (!p.defi.finie) {
      const d = DEFIS.find((x) => x.id === p.defi.id);
      const n = d.compte(e);
      if (n) {
        const avant = p.defi.avance;
        p.defi.avance = Math.min(d.cible, avant + n);
        if (p.defi.avance >= d.cible) { p.defi.finie = true; piecesGagnees += DEFI_PIECES; xpMissions += DEFI_XP; donnerObjet(p, p.defi.cadre); }
        defi = { texte: d.texte, avant, apres: p.defi.avance, cible: d.cible, finie: p.defi.finie, pieces: DEFI_PIECES, cadre: p.defi.finie ? OBJETS[p.defi.cadre].nom : null };
      }
    }
    if (piecesGagnees) crediter(p, piecesGagnees);
    p.xp = xpAvant + xp + xpMissions;
    const nAvant = niveauDe(xpAvant), nApres = niveauDe(p.xp);
    const objets = [];
    for (let n = nAvant.niveau + 1; n <= nApres.niveau; n++) if (OBJETS_NIVEAU[n] && donnerObjet(p, OBJETS_NIVEAU[n])) objets.push(OBJETS_NIVEAU[n]);
    return {
      xpPartie: xp, xpMissions, xpAvant, xpApres: p.xp, niveauAvant: nAvant, niveauApres: nApres,
      missions, defi, piecesGagnees, faceAFace, objets, premiere,
      titre: titre(p),
    };
  }

  // « Le Cauchemar de Kevin » : battre le même adversaire 10 fois, et rester devant (profil-joueur §6).
  function titre(p) {
    let meilleur = null;
    for (const r of Object.values(p.rivaux || {})) if (r.gagnes >= 10 && r.gagnes > r.perdus && (!meilleur || r.gagnes - r.perdus > meilleur.gagnes - meilleur.perdus)) meilleur = r;
    return meilleur ? 'Le Cauchemar de ' + meilleur.pseudo : null;
  }

  const KopoRetention = {
    jourDe, decaler, ecart, semaineDe, hasard,
    XP, xpPourNiveau, niveauDe,
    OBJETS, OBJETS_NIVEAU, collection, donnerObjet, equiper,
    MODELES, missionsDuJour, peutChanger, changerMission,
    DEFIS, defiSemaine,
    BIENVENUE, bienvenue, recevoirBienvenue,
    gainBonus, bonusDuJour, jokerLibre, pieces,
    bilanPartie, enregistrerPartie, titre,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KopoRetention;
  else root.KopoRetention = KopoRetention;
})(typeof window !== 'undefined' ? window : globalThis);
