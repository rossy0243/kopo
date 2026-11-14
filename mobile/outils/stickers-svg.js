// Tire de src/kopo-stickers.js une image fixe par sticker pour l'appli (mobile/assets/stickers/<id>.svg).
// flutter_svg ne lit pas les animations CSS : on fige chaque sticker à un moment expressif de son mouvement,
// et on écrit les positions et transparences calculées par le navigateur directement dans le SVG.
// Lancer après un changement de dessin : node mobile/outils/stickers-svg.js   (demande Playwright et Chromium)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const K = require('../../src/kopo-stickers.js');
// Moment figé, en part de la durée du sticker (la pose la plus parlante).
const MOMENT = { ouf: 0.4, rire: 0.5, louche: 0.55, encore: 0.6, katapss: 0.45, grrr: 0.6, danse: 0.3, dodo: 0.5, supporter: 0.4,
  quoi: 0.5, aie: 0.5, pitie: 0.5, snif: 0.5, serieux: 0.5, pfff: 0.6, hmm: 0.6, chut: 0.5, frime: 0.5, byebye: 0.4, bravo: 0.45, revanche: 0.6 };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<style>${K.CSS}</style><div id="z"></div>`);
  const sortie = path.join(__dirname, '..', 'assets', 'stickers');
  fs.mkdirSync(sortie, { recursive: true });
  for (const id of K.IDS) {
    const svg = await p.evaluate(({ html, t }) => {
      const z = document.getElementById('z');
      z.className = 'anim'; z.innerHTML = html;
      const racine = z.querySelector('svg');
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * a.effect.getComputedTiming().duration; }
      const els = [...racine.querySelectorAll('*')];
      // On calcule tout avant de toucher au dessin : la place de chaque morceau dans son parent, et sa transparence.
      const figes = els.map((e) => {
        const cs = getComputedStyle(e);
        let m = null;
        if (e.getCTM && e.parentNode.getCTM && (cs.transform !== 'none' || e.classList.contains('p'))) {
          try {
            const x = e.parentNode.getCTM().inverse().multiply(e.getCTM());
            m = [x.a, x.b, x.c, x.d, x.e, x.f].map((v) => +v.toFixed(3));
          } catch (err) { return { e, m: null, op: 0 }; } // parent écrasé à zéro (pas encore apparu) : invisible
        }
        return { e, m, op: cs.opacity !== '1' ? +(+cs.opacity).toFixed(3) : null };
      });
      for (const { e, m, op } of figes) {
        if (!e.isConnected) continue;
        if (m) e.setAttribute('transform', `matrix(${m.join(' ')})`);
        if (op !== null) e.setAttribute('opacity', String(op));
        e.removeAttribute('class');
      }
      racine.removeAttribute('style'); racine.removeAttribute('role'); racine.removeAttribute('aria-label');
      racine.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      racine.setAttribute('viewBox', '-16 -26 152 152'); // l'image fixe est coupée au cadre : on laisse la place au drapeau, aux notes…
      // Les morceaux invisibles à ce moment ne servent à rien dans l'image fixe.
      racine.querySelectorAll('[opacity="0"]').forEach((e) => e.remove());
      return racine.outerHTML;
    }, { html: K.svg(id), t: MOMENT[id] || 0.5 });
    fs.writeFileSync(path.join(sortie, id + '.svg'), svg + '\n');
  }
  await b.close();
  console.log(K.IDS.length + ' stickers écrits dans ' + sortie);
})();
