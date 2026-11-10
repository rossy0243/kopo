// Génère les sons de l'appli (assets/sons/*.wav) à partir des mêmes recettes que src/kopo-sons.js
// (Web Audio sur le site). Ici, la synthèse est faite hors ligne, une fois : node outils/sons.js
// Rien à télécharger, aucune licence : chaque son est calculé note par note.
'use strict';
const fs = require('fs');
const path = require('path');

const TAUX = 44100;
const VOL_EFFETS = 0.55, VOL_MUSIQUE = 0.22;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Graine fixe : les mêmes fichiers à chaque génération.
let graine = 12345;
const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };

function tampon(duree) { return new Float32Array(Math.ceil(duree * TAUX)); }

// Enveloppe Web Audio : 0.0001 → vol (rampe exponentielle) → 0.0001.
function enveloppe(ti, att, duree, vol) {
  if (ti < 0 || ti > duree) return 0;
  if (ti < att) return 0.0001 * Math.pow(vol / 0.0001, ti / att);
  return vol * Math.pow(0.0001 / vol, (ti - att) / Math.max(1e-6, duree - att));
}

// Filtre biquad (formules RBJ), coefficients recalculés quand la fréquence bouge.
function biquad(type, freq, q) {
  let b0, b1, b2, a1, a2, x1 = 0, x2 = 0, y1 = 0, y2 = 0, f0 = -1;
  function calc(f) {
    const w = 2 * Math.PI * Math.min(f, TAUX * 0.45) / TAUX, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let n0, n1, n2;
    if (type === 'lowpass') { n0 = (1 - c) / 2; n1 = 1 - c; n2 = (1 - c) / 2; }
    else if (type === 'highpass') { n0 = (1 + c) / 2; n1 = -(1 + c); n2 = (1 + c) / 2; }
    else { n0 = al; n1 = 0; n2 = -al; } // bandpass (gain de pic constant)
    const d0 = 1 + al;
    b0 = n0 / d0; b1 = n1 / d0; b2 = n2 / d0; a1 = -2 * c / d0; a2 = (1 - al) / d0; f0 = f;
  }
  calc(freq);
  return (x, f) => {
    if (f !== undefined && Math.abs(f - f0) > 0.5) calc(f);
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function forme(type, phase) {
  const p = phase - Math.floor(phase);
  if (type === 'square') return p < 0.5 ? 1 : -1;
  if (type === 'sawtooth') return 2 * p - 1;
  if (type === 'triangle') return 1 - 4 * Math.abs(p - 0.5);
  return Math.sin(2 * Math.PI * p);
}

// note(t, freq, duree, { type, vers, glisse, detune, vol, attaque, filtre })
function note(buf, t, freq, duree, o = {}) {
  const vol = o.vol == null ? 0.3 : o.vol, att = o.attaque || 0.005, type = o.type || 'sine';
  const filtre = o.filtre ? biquad('lowpass', o.filtre, 0.707) : null;
  const det = o.detune ? Math.pow(2, o.detune / 1200) : 1;
  const debut = Math.floor(t * TAUX), n = Math.ceil((duree + 0.05) * TAUX);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const k = debut + i; if (k >= buf.length) break;
    const ti = i / TAUX;
    let f = freq;
    if (o.vers) { const g = o.glisse || duree; f = ti < g ? freq * Math.pow(o.vers / freq, ti / g) : o.vers; }
    phase += (f * det) / TAUX;
    let x = forme(type, phase) * enveloppe(ti, att, duree, vol);
    if (filtre) x = filtre(x);
    if (k >= 0) buf[k] += x * (o.bus || 1);
  }
}

// bruit(t, duree, { filtreType, freq, vers, q, vol, attaque })
function bruit(buf, t, duree, o = {}) {
  const vol = o.vol == null ? 0.4 : o.vol, att = o.attaque || 0.004;
  const type = o.filtreType || 'bandpass', f0 = o.freq || 2500;
  const filtre = biquad(type, f0, o.q || 1.2);
  const debut = Math.floor(t * TAUX), n = Math.ceil((duree + 0.05) * TAUX);
  for (let i = 0; i < n; i++) {
    const k = debut + i; if (k >= buf.length) break;
    const ti = i / TAUX;
    const f = o.vers ? f0 * Math.pow(o.vers / f0, Math.min(1, ti / duree)) : undefined;
    let x = filtre(alea() * 2 - 1, f) * enveloppe(ti, att, duree, vol);
    if (k >= 0) buf[k] += x * (o.bus || 1);
  }
}
function lame(buf, t, freq, vol, o = {}) {
  note(buf, t, freq, o.duree || 0.9, { vol, attaque: 0.003, bus: o.bus });
  note(buf, t, freq * 4.02, 0.12, { vol: vol * 0.25, attaque: 0.002, bus: o.bus });
}

const EFFETS = {
  carte: [0.25, (b) => { bruit(b, 0.01, 0.07, { freq: 2800, q: 0.9, vol: 0.9 }); note(b, 0.01, 160, 0.09, { vers: 70, vol: 0.5 }); }],
  distribution: [2.8, (b) => { for (let i = 0; i < 36; i++) bruit(b, 0.01 + i * 0.07, 0.05, { freq: 3200 + alea() * 900, q: 1.4, vol: 0.55 }); }],
  distribution8: [0.8, (b) => { for (let i = 0; i < 8; i++) bruit(b, 0.01 + i * 0.07, 0.05, { freq: 3200 + alea() * 900, q: 1.4, vol: 0.55 }); }],
  ramasse: [0.5, (b) => { bruit(b, 0.01, 0.32, { freq: 700, vers: 3500, q: 2, vol: 0.7, attaque: 0.06 }); note(b, 0.19, 300, 0.12, { vers: 520, vol: 0.12, type: 'triangle' }); }],
  tour: [1.2, (b) => { lame(b, 0.01, hz(76), 0.32); lame(b, 0.13, hz(81), 0.32); }],
  tic: [0.1, (b) => note(b, 0.01, 1500, 0.04, { vol: 0.35, type: 'square', filtre: 3000 })],
  decompte: [0.35, (b) => lame(b, 0.01, hz(84), 0.3, { duree: 0.25 })],
  qualifie_moi: [1.3, (b) => [72, 76, 79, 84].forEach((m, i) => lame(b, 0.01 + i * 0.09, hz(m), 0.3))],
  qualifie: [0.6, (b) => lame(b, 0.01, hz(79), 0.16, { duree: 0.5 })],
  katapss: [1.8, (b) => {
    const t = 0.01;
    for (const [m, d, l] of [[67, 0, 0.16], [72, 0.15, 0.16], [76, 0.3, 0.16], [79, 0.45, 0.9]]) {
      note(b, t + d, hz(m), l + 0.1, { type: 'sawtooth', vol: 0.16, filtre: 2400, attaque: 0.02 });
      note(b, t + d, hz(m), l + 0.1, { type: 'sawtooth', vol: 0.12, filtre: 2400, attaque: 0.02, detune: 9 });
    }
    bruit(b, t + 0.45, 1.1, { filtreType: 'highpass', freq: 6000, q: 0.5, vol: 0.22, attaque: 0.005 });
    note(b, t + 0.45, hz(43), 0.9, { vol: 0.3, type: 'triangle' });
  }],
  elimine_moi: [1.1, (b) => { const v = 0.26; [[67, 0], [62, 0.2], [55, 0.4]].forEach(([m, d]) => note(b, 0.01 + d, hz(m), 0.45, { type: 'triangle', vol: v, detune: -15 })); note(b, 0.41, 90, 0.5, { vers: 45, vol: v * 1.2 }); }],
  elimine: [1.1, (b) => { const v = 0.14; [[67, 0], [62, 0.2], [55, 0.4]].forEach(([m, d]) => note(b, 0.01 + d, hz(m), 0.45, { type: 'triangle', vol: v, detune: -15 })); note(b, 0.41, 90, 0.5, { vers: 45, vol: v * 1.2 }); }],
  victoire: [2.3, (b) => {
    const t = 0.01;
    [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.6], [84, 0.72]].forEach(([m, d]) => { lame(b, t + d, hz(m), 0.3); note(b, t + d, hz(m), 0.3, { type: 'sawtooth', vol: 0.07, filtre: 2000, attaque: 0.02 }); });
    [60, 64, 67].forEach((m) => note(b, t + 0.72, hz(m), 1.4, { type: 'triangle', vol: 0.12, attaque: 0.03 }));
    bruit(b, t + 0.72, 1.2, { filtreType: 'highpass', freq: 7000, q: 0.5, vol: 0.18 });
  }],
  defaite: [1.8, (b) => [[69, 0], [65, 0.25], [64, 0.5], [60, 0.8]].forEach(([m, d]) => lame(b, 0.01 + d, hz(m), 0.2, { duree: 0.8 }))],
  chat: [0.15, (b) => note(b, 0.01, 520, 0.09, { vers: 980, glisse: 0.06, vol: 0.45 })],
  clic: [0.06, (b) => bruit(b, 0.005, 0.025, { freq: 1800, q: 3, vol: 0.35 })],
  essai: [1.1, (b) => { lame(b, 0.01, hz(79), 0.3); lame(b, 0.11, hz(84), 0.3); }],
};

// Musique d'ambiance : la boucle du site (La mineur – Fa – Do – Sol), 16 mesures, la fin repliée sur le début.
function musique() {
  const TEMPO = 92, croche = 60 / TEMPO / 2;
  const GRILLE = [[45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]]];
  const PENTA = [69, 72, 74, 76, 79, 81, 84];
  const pas = 16 * 8, longueur = pas * croche;
  const b = tampon(longueur + 3);
  for (let k = 0; k < pas; k++) {
    const mesure = Math.floor(k / 8) % GRILLE.length, temps = k % 8;
    const [basse, accord] = GRILLE[mesure];
    const t = k * croche;
    if (temps === 0) {
      accord.forEach((m) => note(b, t, hz(m), croche * 8, { type: 'triangle', vol: 0.05, attaque: 0.4, filtre: 1200 }));
      note(b, t, hz(basse), croche * 3, { vol: 0.32, attaque: 0.01 });
    }
    if (temps === 3 || temps === 6) note(b, t, hz(basse + (temps === 6 ? 7 : 0)), croche * 2, { vol: 0.22 });
    if (temps % 2 === 1) bruit(b, t, 0.05, { filtreType: 'highpass', freq: 7000, q: 0.7, vol: 0.06 });
    if (alea() < (temps % 2 ? 0.35 : 0.6)) {
      const choix = alea() < 0.5 ? accord.map((m) => m + 12) : PENTA;
      lame(b, t, hz(choix[Math.floor(alea() * choix.length)]), 0.12, { duree: 0.7 });
    }
  }
  const n = Math.round(longueur * TAUX), sortie = new Float32Array(n);
  for (let i = 0; i < b.length; i++) sortie[i % n] += b[i]; // les queues de la fin reviennent au début : boucle sans coupure
  return sortie;
}

function ecrireWav(fichier, donnees, gain, taux = TAUX) {
  const n = donnees.length, o = Buffer.alloc(44 + n * 2);
  o.write('RIFF', 0); o.writeUInt32LE(36 + n * 2, 4); o.write('WAVE', 8); o.write('fmt ', 12);
  o.writeUInt32LE(16, 16); o.writeUInt16LE(1, 20); o.writeUInt16LE(1, 22); o.writeUInt32LE(taux, 24);
  o.writeUInt32LE(taux * 2, 28); o.writeUInt16LE(2, 32); o.writeUInt16LE(16, 34); o.write('data', 36); o.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const x = Math.tanh(donnees[i] * gain * 1.2) / 1.05; // un peu de compression douce, comme le compresseur du site
    o.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(fichier, o);
}

// Musique : rééchantillonnée à 22 050 Hz (fichier deux fois plus petit, sans perte audible ici).
function souschantillonner(d) { const o = new Float32Array(Math.floor(d.length / 2)); for (let i = 0; i < o.length; i++) o[i] = (d[2 * i] + d[2 * i + 1]) / 2; return o; }

const dossier = path.join(__dirname, '..', 'assets', 'sons');
fs.mkdirSync(dossier, { recursive: true });
for (const [nom, [duree, f]] of Object.entries(EFFETS)) {
  const b = tampon(duree);
  f(b);
  ecrireWav(path.join(dossier, nom + '.wav'), b, VOL_EFFETS * 1.6); // haut-parleur de téléphone : un peu plus fort
}
ecrireWav(path.join(dossier, 'musique.wav'), souschantillonner(musique()), VOL_MUSIQUE * 2.2, TAUX / 2);
console.log('Sons écrits dans', dossier);
