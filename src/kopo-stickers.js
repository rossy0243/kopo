// Stickers animés de Masano (ergonomie/stickers, version 2 validée) : un personnage qui vit la partie.
// Chaque sticker est un SVG découpé en morceaux (classe « p ») ; les mouvements sont dans CSS (classe « anim » sur le parent).
// Le serveur ne connaît que les identifiants ; les noms affichés viennent de GET /api/stickers.
// Les images fixes de l'appli mobile (mobile/assets/stickers/*.svg) sont tirées de ce fichier : node mobile/outils/stickers-svg.js
(function (racine) {
'use strict';
  const C = '#FBF7EE', I = '#1D1606', B = '#E2B04A', R = '#C7362F', N = '#1B2533', SK = '#9A5B2E', HAIR = '#1D1606', BOUCHE = '#5a1a12', EAU = '#7FC8F0';
  const s = (w = 3) => `stroke="${I}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  const corps = c => `<rect x="52" y="78" width="16" height="20" fill="${SK}" ${s()}/><path d="M14 126 q2 -32 46 -32 q44 0 46 32z" fill="${c}" ${s()}/><path d="M50 95 q10 9 20 0" fill="none" ${s(2.5)}/>`;
  const tete = (cheveux = true) => `<circle cx="30" cy="58" r="6.5" fill="${SK}" ${s()}/><circle cx="90" cy="58" r="6.5" fill="${SK}" ${s()}/><circle cx="60" cy="56" r="30" fill="${SK}" ${s()}/>` + (cheveux ? cheveu() : '');
  const cheveu = () => `<path d="M31 50 q-1 -28 29 -28 q30 0 29 28 q-8 -18 -29 -18 q-21 0 -29 18z" fill="${HAIR}" ${s(2)}/>`;
  const bras = (hx, hy, px, py, c) => `<line x1="${px}" y1="${py}" x2="${hx}" y2="${hy}" stroke="${I}" stroke-width="17" stroke-linecap="round"/><line x1="${px}" y1="${py}" x2="${hx}" y2="${hy}" stroke="${SK}" stroke-width="11" stroke-linecap="round"/><line x1="${px}" y1="${py}" x2="${px + (hx - px) * .4}" y2="${py + (hy - py) * .4}" stroke="${c}" stroke-width="15" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="9.5" fill="${SK}" ${s()}/>`;
  const goutte = (x, y, k = '') => `<path class="${k}" d="M${x} ${y} q5.5 8 0 12.5 q-5.5 -4.5 0 -12.5z" fill="${EAU}" ${s(2)}/>`;
  const oeil = (x, y, r = 6.5, p = 3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${s(2.5)}/><circle cx="${x}" cy="${y + .5}" r="${p}" fill="${I}"/>`;
  const joues = `<circle cx="41" cy="67" r="5" fill="#EF6B5F" opacity=".35"/><circle cx="79" cy="67" r="5" fill="#EF6B5F" opacity=".35"/>`;
  const nuage = (pts, txt, tx, ty, fs = 12) => `<g>${pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 2.5}" fill="${I}"/>`).join('')}${pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/>`).join('')}${txt ? `<text x="${tx}" y="${ty}" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="${fs}" fill="${I}">${txt}</text>` : ''}</g>`;
  const etoile = (x, y, r, f = '#FFF3C8') => `<path d="M${x} ${y - r} L${x + r * .3} ${y - r * .3} L${x + r} ${y} L${x + r * .3} ${y + r * .3} L${x} ${y + r} L${x - r * .3} ${y + r * .3} L${x - r} ${y} L${x - r * .3} ${y - r * .3}z" fill="${f}" ${s(1.5)}/>`;
  const note = (x, y) => `<path d="M${x} ${y} v-16 l10 -3 v16" fill="none" stroke="${B}" stroke-width="3"/><circle cx="${x - 3}" cy="${y + 1}" r="4" fill="${B}"/><circle cx="${x + 7}" cy="${y - 2}" r="4" fill="${B}"/>`;
  const bouche_rire = `<path d="M43 64 h34 q-2 22 -17 22 q-15 0 -17 -22z" fill="${BOUCHE}" ${s(2.5)}/><path d="M45.5 65.5 h29 v4 q-14.5 2 -29 0z" fill="#fff"/><ellipse cx="60" cy="80" rx="7" ry="3.5" fill="#EF6B5F"/>`;
  const yeux_joie = `<path d="M43 57 q6.5 -8 13 0 M64 57 q6.5 -8 13 0" fill="none" ${s(3.5)}/>`;

  const ST = {
    ouf: { nom: 'Ouf !', d: '3.2s', note: 'Il a eu chaud et s\'essuie le front', svg: `
      <g class="p o-chaud">${[44, 60, 76].map(x => `<path d="M${x} 16 q-4 -4 0 -8 q4 -4 0 -8" fill="none" stroke="#EF6B5F" stroke-width="3" stroke-linecap="round"/>`).join('')}</g>
      <g class="p o-tremble">${corps('#F77F00')}${tete()}
        <g class="p o-stress"><path d="M42 46 L54 41 M78 46 L66 41" ${s(3.5)}/>${oeil(50, 55, 6.5, 2.2)}${oeil(70, 55, 6.5, 2.2)}<rect x="48" y="68" width="24" height="9" rx="3" fill="#fff" ${s(2.5)}/><path d="M48 72.5 h24 M54 68 v9 M60 68 v9 M66 68 v9" stroke="${I}" stroke-width="1.5"/></g>
        <g class="p o-ouf"><path d="M42 44 q6 -4 12 -1 M78 44 q-6 -4 -12 -1" fill="none" ${s(3.5)}/><path d="M43 55 q6.5 6 13 0 M64 55 q6.5 6 13 0" fill="none" ${s(3.5)}/>${joues}<ellipse cx="60" cy="73" rx="5" ry="4.5" fill="${BOUCHE}" ${s(2.5)}/></g>
        <g class="p o-gouttes">${goutte(50, 32)}${goutte(69, 31)}${goutte(85, 42)}${goutte(36, 44)}</g>
      </g>
      <g class="p o-souffle"><path d="M52 74 l-12 2 M52 78 l-10 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>${nuage([[22, 86, 12], [33, 80, 9], [10, 80, 7]], 'OUF', 22, 91, 15)}</g>
      <g class="p o-bras">${bras(50, 38, 106, 126, '#F77F00')}<path d="M44 33 q6 -3 12 0" fill="none" ${s(2)}/></g>
      <g class="p o-vol">${goutte(84, 28)}</g>` },

    rire: { nom: 'Je t\'ai eu !', d: '2.4s', note: 'Fou rire, il en pleure', svg: `
      <g class="p ri-corps">${corps('#3B8FD6')}${tete()}
        <path d="M41 42 q6 -6 13 -3 M79 42 q-6 -6 -13 -3" fill="none" ${s(3.5)}/>
        <path d="M44 50 l9 5 l-9 5 M76 50 l-9 5 l9 5" fill="none" ${s(3.5)}/>${bouche_rire}
        ${bras(48, 104, 18, 124, '#3B8FD6')}
      </g>
      <g class="p ri-l1">${goutte(38, 52)}</g><g class="p ri-l2">${goutte(82, 52)}</g>
      <g class="p ri-ha1"><text x="100" y="30" text-anchor="middle" transform="rotate(14 100 30)" font-family="Bebas Neue,Impact,sans-serif" font-size="22" fill="${B}" stroke="${I}" stroke-width="1">HA</text></g>
      <g class="p ri-ha2"><text x="18" y="26" text-anchor="middle" transform="rotate(-14 18 26)" font-family="Bebas Neue,Impact,sans-serif" font-size="22" fill="${B}" stroke="${I}" stroke-width="1">HA</text></g>` },

    louche: { nom: 'Bluff ?', d: '2.8s', note: 'Il te regarde de travers', svg: `
      ${corps('#6B4BA8')}${tete()}
      <path d="M42 45 h12" ${s(3.5)}/><g class="p lo-sourcil"><path d="M66 42 q6 -5 12 -1" fill="none" ${s(3.5)}/></g>
      <ellipse cx="50" cy="56" rx="7" ry="5.5" fill="#fff" ${s(2.5)}/><ellipse cx="70" cy="56" rx="7" ry="5.5" fill="#fff" ${s(2.5)}/>
      <g class="p lo-pup"><circle cx="50" cy="57.5" r="3" fill="${I}"/><circle cx="70" cy="57.5" r="3" fill="${I}"/></g>
      <path d="M42.5 55 a7.5 6 0 0 1 15 0z M62.5 55 a7.5 6 0 0 1 15 0z" fill="${SK}"/><path d="M42.5 55 h15 M62.5 55 h15" ${s(3)}/>
      <g class="p lo-cartes">${[-18, 0, 18].map(a => `<g transform="rotate(${a} 60 104)"><rect x="50" y="64" width="20" height="30" rx="3" fill="${R}" ${s(2.5)}/><rect x="53.5" y="67.5" width="13" height="23" rx="2" fill="none" stroke="${B}" stroke-width="1.5"/></g>`).join('')}${bras(60, 100, 96, 126, '#6B4BA8')}</g>
      <g class="p lo-q"><text x="100" y="34" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="30" fill="${B}" stroke="${I}" stroke-width="1.2">?</text></g>` },

    encore: { nom: 'Encore moi…', d: '3s', note: 'Il ramasse, la tête lui tourne', svg: `
      ${corps('#1F8A5B')}
      <g class="p ra-tete">${tete()}
        <g class="p ra-oeil"><path d="M50 55 m-6 0 a6 6 0 1 1 6 6 a4 4 0 1 1 -4 -4 a2 2 0 1 1 2 2" fill="#fff" ${s(2.5)}/></g>
        <g class="p ra-oeil"><path d="M70 55 m-6 0 a6 6 0 1 1 6 6 a4 4 0 1 1 -4 -4 a2 2 0 1 1 2 2" fill="#fff" ${s(2.5)}/></g>
        <path d="M46 74 q4.5 -5 9 0 q4.5 5 9 0 q4.5 -5 9 0" fill="none" ${s(3)}/>
      </g>
      <g class="p ra-c1"><rect x="36" y="4" width="24" height="34" rx="4" fill="${C}" transform="rotate(-14 48 21)" ${s(2.5)}/></g>
      <g class="p ra-c2"><rect x="60" y="2" width="24" height="34" rx="4" fill="${C}" transform="rotate(12 72 19)" ${s(2.5)}/><text x="72" y="25" text-anchor="middle" font-size="14" fill="${N}" transform="rotate(12 72 19)">♣</text></g>
      <g class="p ra-c3"><rect x="48" y="-6" width="24" height="34" rx="4" fill="${C}" transform="rotate(-3 60 11)" ${s(2.5)}/><text x="60" y="17" text-anchor="middle" font-size="14" fill="${R}">♦</text></g>
      <g class="ra-etoiles p">${[1, 2, 3].map(n => `<g class="p ra-s ra-s${n}">${etoile(60, 40, 6, n === 2 ? B : '#FFF3C8')}</g>`).join('')}</g>
      <g class="p ra-plus"><circle cx="100" cy="74" r="15" fill="${R}" ${s()}/><text x="100" y="81" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="21" fill="#fff">+3</text></g>` },

    katapss: { nom: 'Katapss !', d: '2.6s', note: 'Il saute de joie', svg: `
      ${[[14, 8, R], [30, 2, '#3B8FD6'], [52, 6, B], [70, 0, '#3FBF7F'], [90, 6, R], [104, 2, B], [22, 18, '#3FBF7F'], [98, 16, '#3B8FD6']].map(([x, y, c], i) => `<rect class="p ka-conf" style="animation-delay:${(i % 4) * .08}s" x="${x}" y="${y}" width="6" height="9" rx="1" fill="${c}"/>`).join('')}
      <g class="p ka-saut">
        <g class="p vb ka-bg">${bras(20, 26, 28, 112, B)}</g>
        <g class="p vb ka-bd"><rect x="88" y="-8" width="24" height="32" rx="4" fill="${C}" transform="rotate(12 100 8)" ${s(2.5)}/><text x="100" y="15" text-anchor="middle" font-size="16" fill="${R}" transform="rotate(12 100 8)">♥</text>${bras(100, 26, 92, 112, B)}</g>
        ${corps(B)}${tete()}
        <path d="M41 41 q6 -6 13 -3 M79 41 q-6 -6 -13 -3" fill="none" ${s(3.5)}/>${yeux_joie}${joues}${bouche_rire}
      </g>
      <g class="p ka-mot"><rect x="12" y="96" width="96" height="24" rx="6" fill="${R}" ${s()}/><text x="60" y="115" text-anchor="middle" font-family="Bebas Neue,Impact,sans-serif" font-size="21" letter-spacing="1" fill="#fff">KATAPSS !</text></g>` },

    grrr: { nom: 'Grrr…', d: '2.8s', note: 'La colère monte, ça fume', svg: `
      <g class="p co-v1"><circle cx="24" cy="46" r="7" fill="#fff"/><circle cx="17" cy="39" r="5.5" fill="#fff"/><circle cx="28" cy="38" r="4.5" fill="#fff"/></g><g class="p co-v2"><circle cx="96" cy="46" r="7" fill="#fff"/><circle cx="103" cy="39" r="5.5" fill="#fff"/><circle cx="92" cy="38" r="4.5" fill="#fff"/></g>
      <g class="p co-trem">${corps('#2C3E57')}${tete(false)}
        <circle class="p co-rouge" cx="60" cy="56" r="28.5" fill="#E0402F"/>${cheveu()}
        <path d="M41 42 L56 49 M79 42 L64 49" ${s(4)}/>
        <ellipse cx="50" cy="56" rx="6" ry="4.5" fill="#fff" ${s(2.5)}/><ellipse cx="70" cy="56" rx="6" ry="4.5" fill="#fff" ${s(2.5)}/><circle cx="51" cy="56.5" r="2.4" fill="${I}"/><circle cx="69" cy="56.5" r="2.4" fill="${I}"/>
        <rect x="47" y="69" width="26" height="9" rx="2.5" fill="#fff" ${s(2.5)}/><path d="M47 73.5 h26 M53.5 69 v9 M60 69 v9 M66.5 69 v9" stroke="${I}" stroke-width="1.5"/>
        <g class="p co-veine"><path d="M70 30 q4 4 0 8 M80 30 q-4 4 0 8 M71 29 q4 2 8 0 M71 39 q4 -2 8 0" fill="none" stroke="#E0402F" stroke-width="2.8" stroke-linecap="round"/></g>
      </g>` },

    danse: { nom: 'On danse !', d: '2.8s', pack: 'Ambiance', note: 'Il danse, la musique monte', svg: `
      <g class="p vb da-corps">
        ${bras(18, 30, 28, 112, '#C7362F')}${bras(102, 30, 92, 112, '#C7362F')}
        ${corps('#C7362F')}${tete()}
        <path d="M42 43 q6 -4 12 -1 M78 43 q-6 -4 -12 -1" fill="none" ${s(3.5)}/><path d="M43 56 q6.5 6 13 0 M64 56 q6.5 6 13 0" fill="none" ${s(3.5)}/>${joues}<path d="M48 68 q12 12 24 0z" fill="${BOUCHE}" ${s(2.5)}/>
      </g>
      <g class="p da-n1">${note(102, 60)}</g><g class="p da-n2">${note(12, 62)}</g>` },

    dodo: { nom: 'Tu dors ?', d: '2.4s', pack: 'Ambiance', note: 'Pour celui qui met trop de temps', svg: `
      ${corps('#183252')}
      <g class="p zz-tete">${tete()}<path d="M43 56 h12 M65 56 h12" ${s(3.5)}/><ellipse cx="60" cy="73" rx="4" ry="3" fill="${BOUCHE}" ${s(2)}/>
        <g class="p zz-bulle"><circle cx="70" cy="76" r="5" fill="#BFE6FF" opacity=".85" ${s(1.5)}/></g></g>
      ${[1, 2, 3].map(n => `<g class="p zz-z zz-z${n}"><text x="92" y="34" font-family="Bebas Neue,Impact,sans-serif" font-size="${10 + n * 4}" fill="#fff" stroke="${I}" stroke-width="1">Z</text></g>`).join('')}` },

    supporter: { nom: 'Allez la RDC !', d: '2.4s', pack: 'Supporters', note: 'Un par pays : RDC, Côte d\'Ivoire…', svg: `
      <g class="p su-saut">
        <g class="p vb su-drapeau"><rect x="98" y="-14" width="4" height="46" rx="2" fill="#5a3d1c" ${s(1.5)}/>
          <g class="p su-tissu"><clipPath id="cl-su"><rect x="101" y="-12" width="36" height="25" rx="2"/></clipPath><g clip-path="url(#cl-su)"><rect x="101" y="-12" width="36" height="25" fill="#3B8FD6"/><path d="M101 15 L137 -14 L137 -6 L101 23z" fill="#F7D038"/><path d="M101 17 L137 -12 L137 -8 L101 21z" fill="#CE1021"/></g><rect x="101" y="-12" width="36" height="25" rx="2" fill="none" ${s(2)}/>${etoile(108, -6, 4, '#F7D038')}</g>
          ${bras(100, 30, 92, 112, '#3B8FD6')}</g>
        ${bras(22, 34, 28, 112, '#3B8FD6')}
        ${corps('#3B8FD6')}<path d="M24 106 L96 126" stroke="#F7D038" stroke-width="7"/><path d="M24 106 L96 126" stroke="#CE1021" stroke-width="3"/>${tete()}
        <path d="M41 41 q6 -6 13 -3 M79 41 q-6 -6 -13 -3" fill="none" ${s(3.5)}/>${yeux_joie}<path d="M38 63 l6 2 M82 63 l-6 2" stroke="#3B8FD6" stroke-width="4"/><path d="M38 66 l6 2 M82 66 l-6 2" stroke="#F7D038" stroke-width="3"/><path d="M38 69 l6 2 M82 69 l-6 2" stroke="#CE1021" stroke-width="3"/>
        <ellipse cx="60" cy="75" rx="9" ry="8" fill="${BOUCHE}" ${s(2.5)}/>
      </g>` },
  };
  const CSS = `
/* ======================= animations des stickers ======================= */
svg .p { transform-box: fill-box; transform-origin: center; }
svg .vb { transform-box: view-box; }
.anim .p { animation-duration: var(--d, 2.8s); animation-iteration-count: infinite; animation-timing-function: cubic-bezier(.35,.6,.4,1); }

/* Ouf, j'ai eu chaud (3,2 s) */
.o-ouf, .o-vol { opacity: 0; } .o-souffle { transform: scale(0); }
.anim .o-bras { animation-name: o-bras; }
@keyframes o-bras { 0%, 12% { transform: translate(34px, 74px); opacity: 0 } 24% { transform: translate(0, 0); opacity: 1 } 30% { transform: translate(0, 0); opacity: 1 } 52% { transform: translate(27px, -3px); opacity: 1 } 58% { transform: translate(30px, -2px); opacity: 1 } 66% { transform: translate(44px, 16px); opacity: 1 } 72%, 100% { transform: translate(44px, 60px); opacity: 0 } }
.anim .o-gouttes { animation-name: o-gouttes; } @keyframes o-gouttes { 0%, 30% { opacity: 1 } 46%, 96% { opacity: 0 } 100% { opacity: 1 } }
.anim .o-stress { animation-name: o-stress; } @keyframes o-stress { 0%, 52% { opacity: 1 } 55%, 96% { opacity: 0 } 100% { opacity: 1 } }
.anim .o-ouf { animation-name: o-ouf; } @keyframes o-ouf { 0%, 52% { opacity: 0 } 55%, 96% { opacity: 1 } 100% { opacity: 0 } }
.anim .o-vol { animation-name: o-vol; } @keyframes o-vol { 0%, 60% { opacity: 0; transform: none } 62% { opacity: 1; transform: none } 80% { opacity: 0; transform: translate(24px, -20px) rotate(40deg) } 100% { opacity: 0 } }
.anim .o-souffle { animation-name: o-souffle; transform-origin: 90% 20%; } @keyframes o-souffle { 0%, 60% { transform: scale(0); opacity: 1 } 68% { transform: scale(1.12) } 72%, 92% { transform: scale(1); opacity: 1 } 98%, 100% { transform: scale(1); opacity: 0 } }
.anim .o-chaud { animation-name: o-chaud; } @keyframes o-chaud { 0% { transform: translateY(6px); opacity: 0 } 10% { opacity: 1 } 36% { transform: translateY(-6px); opacity: 1 } 46%, 100% { transform: translateY(-8px); opacity: 0 } }
.anim .o-tremble { animation-name: o-tremble; } @keyframes o-tremble { 0%, 2%, 6%, 10%, 14%, 18% { transform: translateX(0) } 4%, 12% { transform: translateX(-1.5px) } 8%, 16% { transform: translateX(1.5px) } 20%, 100% { transform: none } }

/* Je t'ai eu ! (fou rire) */
.anim .ri-corps { animation-name: ri-corps; animation-duration: .5s; } @keyframes ri-corps { 0%, 50%, 100% { transform: translateY(0) } 25%, 75% { transform: translateY(-3px) rotate(-2deg) } }
.anim .ri-l1, .anim .ri-l2 { animation-duration: .9s; } .anim .ri-l1 { animation-name: ri-l1; } .anim .ri-l2 { animation-name: ri-l2; animation-delay: .45s; }
@keyframes ri-l1 { 0% { transform: none; opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(-18px, -10px) rotate(-30deg); opacity: 0 } }
@keyframes ri-l2 { 0% { transform: none; opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(18px, -10px) rotate(30deg); opacity: 0 } }
.anim .ri-ha1, .anim .ri-ha2 { animation-name: ri-ha; animation-duration: 1.2s; } .anim .ri-ha2 { animation-delay: .6s; }
@keyframes ri-ha { 0% { transform: scale(0); opacity: 1 } 20% { transform: scale(1.2) } 30%, 70% { transform: scale(1); opacity: 1 } 100% { transform: scale(1) translateY(-6px); opacity: 0 } }

/* Bluff ? (regard en coin) */
.anim .lo-pup { animation-name: lo-pup; } @keyframes lo-pup { 0%, 14% { transform: translateX(0) } 22%, 40% { transform: translateX(-4px) } 48%, 66% { transform: translateX(4px) } 74%, 100% { transform: translateX(0) } }
.anim .lo-sourcil { animation-name: lo-sourcil; } @keyframes lo-sourcil { 0%, 70% { transform: translateY(0) } 76%, 90% { transform: translateY(-5px) } 96%, 100% { transform: translateY(0) } }
.anim .lo-cartes { animation-name: lo-cartes; } @keyframes lo-cartes { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
.anim .lo-q { animation-name: lo-q; } @keyframes lo-q { 0%, 70% { transform: scale(0) } 78% { transform: scale(1.3) } 84%, 96% { transform: scale(1) } 100% { transform: scale(0) } }

/* Encore moi… (ramasse et tourne la tête) */
.anim .ra-c1 { animation-name: ra-c1; } .anim .ra-c2 { animation-name: ra-c2; } .anim .ra-c3 { animation-name: ra-c3; }
@keyframes ra-c1 { 0% { transform: translateY(-70px) rotate(-30deg); opacity: 0 } 10% { opacity: 1 } 16%, 90% { transform: none; opacity: 1 } 100% { transform: none; opacity: 0 } }
@keyframes ra-c2 { 0%, 10% { transform: translateY(-70px) rotate(30deg); opacity: 0 } 18% { opacity: 1 } 26%, 90% { transform: none; opacity: 1 } 100% { transform: none; opacity: 0 } }
@keyframes ra-c3 { 0%, 20% { transform: translateY(-70px) rotate(-20deg); opacity: 0 } 28% { opacity: 1 } 36%, 90% { transform: none; opacity: 1 } 100% { transform: none; opacity: 0 } }
.anim .ra-tete { animation-name: ra-tete; transform-origin: 50% 100%; } @keyframes ra-tete { 0%, 14% { transform: none } 17% { transform: scale(1.04, .94) } 20%, 24% { transform: none } 27% { transform: scale(1.04, .94) } 30%, 34% { transform: none } 37% { transform: scale(1.05, .92) } 42%, 100% { transform: none } }
.anim .ra-oeil { animation-name: ra-oeil; animation-timing-function: linear; animation-duration: 1s; } @keyframes ra-oeil { to { transform: rotate(360deg) } }
.ra-etoiles { opacity: 0; } .anim .ra-etoiles { animation-name: ra-etoiles; } @keyframes ra-etoiles { 0%, 38% { opacity: 0 } 44%, 92% { opacity: 1 } 100% { opacity: 0 } }
.anim .ra-s { animation-name: ra-s; animation-duration: 1.2s; animation-timing-function: linear; }
@keyframes ra-s { 0% { transform: translate(-34px, 0) scale(.8) } 25% { transform: translate(0, 7px) scale(1.15) } 50% { transform: translate(34px, 0) scale(.8) } 75% { transform: translate(0, -7px) scale(.6) } 100% { transform: translate(-34px, 0) scale(.8) } }
.anim .ra-s2 { animation-delay: -.4s } .anim .ra-s3 { animation-delay: -.8s }
.anim .ra-plus { animation-name: ra-plus; } @keyframes ra-plus { 0%, 40% { transform: scale(0) } 48% { transform: scale(1.3) } 54%, 90% { transform: scale(1) } 100% { transform: scale(0) } }

/* KATAPSS ! (on saute de joie) */
.anim .ka-saut { animation-name: ka-saut; } @keyframes ka-saut { 0% { transform: translateY(0) } 12% { transform: translateY(5px) scale(1.03, .96) } 26% { transform: translateY(-14px) } 40% { transform: translateY(0) } 48% { transform: translateY(2px) } 56%, 100% { transform: translateY(0) } }
.anim .ka-bg { animation-name: ka-bg; transform-origin: 26px 112px; } .anim .ka-bd { animation-name: ka-bd; transform-origin: 96px 112px; }
@keyframes ka-bg { 0%, 100% { transform: rotate(0) } 25%, 75% { transform: rotate(-10deg) } 50% { transform: rotate(4deg) } }
@keyframes ka-bd { 0%, 100% { transform: rotate(0) } 25%, 75% { transform: rotate(10deg) } 50% { transform: rotate(-4deg) } }
.anim .ka-conf { animation-name: ka-conf; } @keyframes ka-conf { 0%, 24% { transform: translateY(-10px) rotate(0); opacity: 0 } 30% { opacity: 1 } 90% { transform: translateY(80px) rotate(260deg); opacity: 1 } 100% { transform: translateY(90px) rotate(300deg); opacity: 0 } }
.anim .ka-mot { animation-name: ka-mot; } @keyframes ka-mot { 0%, 28% { transform: scale(0) rotate(-6deg) } 38% { transform: scale(1.25) rotate(-6deg) } 46%, 92% { transform: scale(1) rotate(-6deg) } 100% { transform: scale(0) rotate(-6deg) } }

/* Grrr… (la colère monte) */
.co-rouge { opacity: 0; } .anim .co-rouge { animation-name: co-rouge; } @keyframes co-rouge { 0%, 8% { opacity: 0 } 50%, 92% { opacity: .75 } 100% { opacity: 0 } }
.co-v1, .co-v2 { opacity: 0; } .anim .co-v1, .anim .co-v2 { animation-duration: 1s; } .anim .co-v1 { animation-name: co-v1; } .anim .co-v2 { animation-name: co-v2; animation-delay: .5s; }
@keyframes co-v1 { 0% { transform: translate(0, 0) scale(.4); opacity: 0 } 20% { opacity: .95 } 100% { transform: translate(-12px, -24px) scale(1.3); opacity: 0 } }
@keyframes co-v2 { 0% { transform: translate(0, 0) scale(.4); opacity: 0 } 20% { opacity: .95 } 100% { transform: translate(12px, -24px) scale(1.3); opacity: 0 } }
.anim .co-trem { animation-name: co-trem; } @keyframes co-trem { 0%, 46% { transform: none } 50%, 58%, 66%, 74%, 82% { transform: translateX(-2px) } 54%, 62%, 70%, 78%, 86% { transform: translateX(2px) } 90%, 100% { transform: none } }
.co-veine { transform: scale(0); } .anim .co-veine { animation-name: co-veine; } @keyframes co-veine { 0%, 42% { transform: scale(0) } 50% { transform: scale(1.3) } 56%, 66% { transform: scale(1) } 72% { transform: scale(1.2) } 78%, 92% { transform: scale(1) } 100% { transform: scale(0) } }

/* Danse (pack Ambiance) */
.anim .da-corps { animation-name: da-corps; animation-duration: 1.2s; transform-origin: 60px 124px; animation-timing-function: ease-in-out; } @keyframes da-corps { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
.anim .da-n1, .anim .da-n2 { animation-name: da-n; } .anim .da-n2 { animation-delay: -1.4s; }
@keyframes da-n { 0% { transform: translate(0, 10px) scale(.4); opacity: 0 } 20% { opacity: 1 } 70% { transform: translate(6px, -22px) rotate(12deg); opacity: 1 } 100% { transform: translate(8px, -30px) rotate(18deg); opacity: 0 } }

/* Tu dors ? (pack Ambiance) */
.anim .zz-tete { animation-name: zz-tete; animation-duration: 2.4s; transform-origin: 50% 100%; animation-timing-function: ease-in-out; } @keyframes zz-tete { 0%, 100% { transform: rotate(-4deg) } 50% { transform: rotate(6deg) translateY(2px) } }
.anim .zz-z1, .anim .zz-z2, .anim .zz-z3 { animation-name: zz-z; animation-duration: 2.4s; } .anim .zz-z2 { animation-delay: -.8s } .anim .zz-z3 { animation-delay: -1.6s }
@keyframes zz-z { 0% { transform: translate(0, 8px) scale(.5); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(14px, -22px) scale(1.1); opacity: 0 } }
.anim .zz-bulle { animation-name: zz-bulle; animation-duration: 2.4s; } @keyframes zz-bulle { 0%, 100% { transform: scale(.7) } 50% { transform: scale(1.1) } }

/* Supporter (pack Supporters) */
.anim .su-saut { animation-name: su-saut; animation-duration: .8s; } @keyframes su-saut { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
.anim .su-drapeau { animation-name: su-drapeau; animation-duration: .8s; transform-origin: 96px 112px; animation-timing-function: ease-in-out; } @keyframes su-drapeau { 0%, 100% { transform: rotate(-10deg) } 50% { transform: rotate(14deg) } }
.anim .su-tissu { animation-name: su-tissu; animation-duration: .8s; transform-origin: left center; } @keyframes su-tissu { 0%, 100% { transform: skewY(-6deg) scaleX(.94) } 50% { transform: skewY(5deg) scaleX(1) } }

@media (prefers-reduced-motion: reduce) { .anim .p, .recu { animation: none !important; } .recu { opacity: 1 !important; } }
`;
  const svg = (id, etiquette) => `<svg viewBox="0 0 120 120" role="img" aria-label="${etiquette || ST[id].nom}" style="--d:${ST[id].d}">${ST[id].svg}</svg>`;
  const api = { ST, CSS, IDS: Object.keys(ST), svg, duree: (id) => parseFloat(ST[id].d) * 1000 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else racine.KopoStickers = api;
})(typeof window !== 'undefined' ? window : this);
