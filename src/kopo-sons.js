// Kopo — sons du jeu, entièrement générés par le téléphone (Web Audio) : aucun fichier,
// aucune licence à respecter, rien à télécharger.
// Deux réglages indépendants : les effets (cartes, tour, Katapss…) et la musique d'ambiance.
// L'audio ne démarre qu'après un premier toucher (règle des navigateurs) et se met en veille
// quand la page est cachée.
(function (root) {
  'use strict';

  const etat = { effets: true, musique: false };
  let ctx = null, sortie = null, busEffets = null, busMusique = null, bruitBlanc = null;
  let toucheRecue = false;
  const VOL_EFFETS = 0.55, VOL_MUSIQUE = 0.22;

  // ------------------------------------------------------------------ contexte audio
  function contexte() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    sortie = ctx.createGain(); sortie.gain.value = 1;
    sortie.connect(comp); comp.connect(ctx.destination);
    busEffets = ctx.createGain(); busEffets.gain.value = etat.effets ? VOL_EFFETS : 0; busEffets.connect(sortie);
    busMusique = ctx.createGain(); busMusique.gain.value = 0; busMusique.connect(sortie);
    // Deux secondes de bruit blanc, réutilisée pour les frottements de cartes et le shaker.
    bruitBlanc = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = bruitBlanc.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const actif = () => etat.effets || etat.musique;
  // Prêt à jouer : contexte créé, débloqué par un toucher, page visible.
  function pret() {
    if (!toucheRecue || !actif()) return null;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
    const c = contexte();
    if (!c) return null;
    if (c.state === 'suspended') c.resume().catch(() => {});
    return c;
  }
  function debloquer() {
    toucheRecue = true;
    if (!actif()) return;
    const c = contexte();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    // iOS : un son muet joué pendant le toucher déverrouille la sortie audio.
    try { const b = c.createBufferSource(); b.buffer = c.createBuffer(1, 1, 22050); b.connect(c.destination); b.start(0); } catch (e) {}
    if (etat.musique) Musique.demarrer();
  }

  // ------------------------------------------------------------------ briques sonores
  // Note simple : oscillateur + enveloppe (attaque, décroissance exponentielle).
  function note(t, freq, duree, o = {}) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.vers) osc.frequency.exponentialRampToValueAtTime(o.vers, t + (o.glisse || duree));
    if (o.detune) osc.detune.value = o.detune;
    const vol = o.vol == null ? 0.3 : o.vol, att = o.attaque || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    let dernier = g;
    if (o.filtre) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filtre; g.connect(f); dernier = f; }
    osc.connect(g); dernier.connect(o.bus || busEffets);
    osc.start(t); osc.stop(t + duree + 0.05);
  }
  // Bruit filtré : frottement de carte, souffle, shaker.
  function bruit(t, duree, o = {}) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = bruitBlanc;
    f.type = o.filtreType || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2500, t);
    if (o.vers) f.frequency.exponentialRampToValueAtTime(o.vers, t + duree);
    f.Q.value = o.q || 1.2;
    const vol = o.vol == null ? 0.4 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attaque || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    s.connect(f); f.connect(g); g.connect(o.bus || busEffets);
    s.start(t, Math.random() * 0.5); s.stop(t + duree + 0.05);
  }
  // Timbre de kalimba / marimba : fondamentale + harmonique aiguë très courte.
  function lame(t, freq, vol, o = {}) {
    note(t, freq, o.duree || 0.9, { vol, bus: o.bus, attaque: 0.003 });
    note(t, freq * 4.02, 0.12, { vol: vol * 0.25, bus: o.bus, attaque: 0.002 });
  }
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // ------------------------------------------------------------------ effets
  const EFFETS = {
    carte(t) { // carte posée sur la table : claquement sec + petit coup sourd
      bruit(t, 0.07, { freq: 2800, q: 0.9, vol: 0.9 });
      note(t, 160, 0.09, { vers: 70, vol: 0.5 });
    },
    distribution(t, o) { // les cartes partent du tas, une par une
      const n = Math.min(o.nb || 8, 36);
      for (let i = 0; i < n; i++) bruit(t + i * 0.07, 0.05, { freq: 3200 + Math.random() * 900, q: 1.4, vol: 0.55 });
    },
    ramasse(t) { // souffle qui monte : la carte revient vers un joueur
      bruit(t, 0.32, { freq: 700, vers: 3500, q: 2, vol: 0.7, attaque: 0.06 });
      note(t + 0.18, 300, 0.12, { vers: 520, vol: 0.12, type: 'triangle' });
    },
    tour(t) { // c'est à toi : deux lames qui montent
      lame(t, hz(76), 0.32); lame(t + 0.12, hz(81), 0.32);
    },
    tic(t) { note(t, 1500, 0.04, { vol: 0.35, type: 'square', filtre: 3000 }); },
    decompte(t) { lame(t, hz(84), 0.3, { duree: 0.25 }); },
    qualifie(t, o) {
      if (o.moi) [72, 76, 79, 84].forEach((m, i) => lame(t + i * 0.09, hz(m), 0.3));
      else lame(t, hz(79), 0.16, { duree: 0.5 });
    },
    katapss(t) { // fanfare cuivrée + cymbale
      const accords = [[67, 0, 0.16], [72, 0.15, 0.16], [76, 0.3, 0.16], [79, 0.45, 0.9]];
      for (const [m, d, l] of accords) {
        note(t + d, hz(m), l + 0.1, { type: 'sawtooth', vol: 0.16, filtre: 2400, attaque: 0.02 });
        note(t + d, hz(m), l + 0.1, { type: 'sawtooth', vol: 0.12, filtre: 2400, attaque: 0.02, detune: 9 });
      }
      bruit(t + 0.45, 1.1, { filtreType: 'highpass', freq: 6000, q: 0.5, vol: 0.22, attaque: 0.005 });
      note(t + 0.45, hz(43), 0.9, { vol: 0.3, type: 'triangle' });
    },
    elimine(t, o) { // trois notes qui descendent
      const v = o.moi ? 0.26 : 0.14;
      [[67, 0], [62, 0.2], [55, 0.4]].forEach(([m, d]) => note(t + d, hz(m), 0.45, { type: 'triangle', vol: v, detune: -15 }));
      note(t + 0.4, 90, 0.5, { vers: 45, vol: v * 1.2 });
    },
    victoire(t) {
      const mel = [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.6], [84, 0.72]];
      mel.forEach(([m, d]) => { lame(t + d, hz(m), 0.3); note(t + d, hz(m), 0.3, { type: 'sawtooth', vol: 0.07, filtre: 2000, attaque: 0.02 }); });
      [60, 64, 67].forEach((m) => note(t + 0.72, hz(m), 1.4, { type: 'triangle', vol: 0.12, attaque: 0.03 }));
      bruit(t + 0.72, 1.2, { filtreType: 'highpass', freq: 7000, q: 0.5, vol: 0.18 });
    },
    defaite(t) {
      [[69, 0], [65, 0.25], [64, 0.5], [60, 0.8]].forEach(([m, d]) => lame(t + d, hz(m), 0.2, { duree: 0.8 }));
    },
    chat(t) { note(t, 520, 0.09, { vers: 980, glisse: 0.06, vol: 0.45 }); },
    clic(t) { bruit(t, 0.025, { freq: 1800, q: 3, vol: 0.35 }); },
    essai(t) { lame(t, hz(79), 0.3); lame(t + 0.1, hz(84), 0.3); },
  };

  function jouer(nom, o = {}) {
    if (!etat.effets || !EFFETS[nom]) return;
    const c = pret();
    if (!c) return;
    try { EFFETS[nom](c.currentTime + 0.01 + (o.delai || 0) / 1000, o); } catch (e) {}
  }

  // ------------------------------------------------------------------ musique d'ambiance
  // Boucle douce générée à la volée : basse, nappe, kalimba en gamme pentatonique,
  // petit shaker. Une phrase différente à chaque passage, toujours dans les mêmes accords.
  const Musique = (() => {
    const TEMPO = 92, croche = 60 / TEMPO / 2;
    // La mineur – Fa – Do – Sol : fondamentale + notes de l'accord (MIDI).
    const GRILLE = [[45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]]];
    const PENTA = [69, 72, 74, 76, 79, 81, 84];
    let minuteur = null, prochaine = 0, pas = 0, enMarche = false;
    function planifier() {
      while (prochaine < ctx.currentTime + 0.4) {
        const mesure = Math.floor(pas / 8) % GRILLE.length, temps = pas % 8;
        const [basse, accord] = GRILLE[mesure];
        const t = prochaine, bus = busMusique;
        if (temps === 0) {
          accord.forEach((m) => note(t, hz(m), croche * 8, { type: 'triangle', vol: 0.05, attaque: 0.4, filtre: 1200, bus }));
          note(t, hz(basse), croche * 3, { vol: 0.32, bus, attaque: 0.01 });
        }
        if (temps === 3 || temps === 6) note(t, hz(basse + (temps === 6 ? 7 : 0)), croche * 2, { vol: 0.22, bus });
        if (temps % 2 === 1) bruit(t, 0.05, { filtreType: 'highpass', freq: 7000, q: 0.7, vol: 0.06, bus });
        // Kalimba : une note sur deux environ, plutôt sur les notes de l'accord.
        if (Math.random() < (temps % 2 ? 0.35 : 0.6)) {
          const choix = Math.random() < 0.5 ? accord.map((m) => m + 12) : PENTA;
          lame(t, hz(choix[Math.floor(Math.random() * choix.length)]), 0.12, { bus, duree: 0.7 });
        }
        prochaine += croche; pas++;
      }
    }
    return {
      demarrer() {
        const c = pret();
        if (!c || enMarche) return;
        enMarche = true;
        prochaine = c.currentTime + 0.1; pas = 0;
        busMusique.gain.cancelScheduledValues(c.currentTime);
        busMusique.gain.setValueAtTime(0.0001, c.currentTime);
        busMusique.gain.exponentialRampToValueAtTime(VOL_MUSIQUE, c.currentTime + 2);
        minuteur = setInterval(() => { try { planifier(); } catch (e) {} }, 100);
        planifier();
      },
      arreter() {
        if (!enMarche) return;
        enMarche = false;
        clearInterval(minuteur); minuteur = null;
        if (ctx) { busMusique.gain.cancelScheduledValues(ctx.currentTime); busMusique.gain.setTargetAtTime(0, ctx.currentTime, 0.15); }
      },
      get enMarche() { return enMarche; },
    };
  })();

  // ------------------------------------------------------------------ réglages
  function regler(o) {
    if ('effets' in o) etat.effets = !!o.effets;
    if ('musique' in o) etat.musique = !!o.musique;
    if (ctx) busEffets.gain.setTargetAtTime(etat.effets ? VOL_EFFETS : 0, ctx.currentTime, 0.05);
    if (etat.musique) Musique.demarrer(); else Musique.arreter();
    if (ctx && !actif() && ctx.state === 'running') ctx.suspend().catch(() => {});
  }

  if (typeof document !== 'undefined') {
    for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, debloquer, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.visibilityState === 'hidden') { Musique.arreter(); ctx.suspend().catch(() => {}); }
      else if (actif()) { ctx.resume().catch(() => {}); if (etat.musique) Musique.demarrer(); }
    });
  }

  const KopoSons = { jouer, regler, debloquer, effets: Object.keys(EFFETS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = KopoSons;
  else root.KopoSons = KopoSons;
})(typeof window !== 'undefined' ? window : globalThis);
