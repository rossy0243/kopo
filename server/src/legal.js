// Pages légales (CGU, politique de confidentialité, et pages ajoutées) : gardées en base, modifiées dans le tableau
// de bord, lues par le site (legal/*.html) et par les applis (liens de Paramètres, via /api/config et /api/legal).
// Un changement est en ligne tout de suite : ni redéploiement du site, ni mise à jour des applis.
'use strict';
const fs = require('fs');
const path = require('path');

// Les deux pages d'origine : leur lien ne change jamais (stores, liens déjà partagés), elles ne se suppriment pas.
const PAGES_FIXES = { conditions: 'legal/conditions.html', confidentialite: 'legal/confidentialite.html' };
const DOSSIER_LEGAL = path.join(__dirname, '..', '..', 'legal');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const TAILLE_MAX = 200000; // caractères de HTML par page

const erreur = (m) => Object.assign(new Error(m), { statut: 400 });
const cleValide = (c) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(c || ''));
const lienPage = (cle) => PAGES_FIXES[cle] || `legal/page.html?p=${cle}`;
const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const versionTexte = (iso) => { const [a, m, j] = String(iso).split('-').map(Number); return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`; };

// --- Nettoyage du HTML écrit dans le tableau de bord : seules les balises de mise en forme passent.
// Pas de script, de style, d'iframe ni d'attribut on… : la page est affichée sur masano.online et dans les applis.
const BALISES = new Set(['h2', 'h3', 'h4', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sup', 'sub', 'a', 'span', 'div', 'blockquote', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const VIDES = new Set(['br', 'hr']);
const A_RETIRER_AVEC_CONTENU = /<(script|style|iframe|object|embed|noscript|template|svg|math|textarea|select|button|form)\b[\s\S]*?<\/\1\s*>/gi;
function lienSur(h) {
  const v = String(h).trim().replace(/[\u0000- ]/g, '');
  return /^(https?:|mailto:|#|[a-z0-9_.\-/]+\.html(?:[?#][^"'<>\s]*)?$|\.\.?\/)/i.test(v) && !/^(javascript|data|vbscript):/i.test(v);
}
function nettoyerHtml(html) {
  let s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(A_RETIRER_AVEC_CONTENU, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|<[!?][^>]*>/g, (tout, nom, attrs) => {
    if (!nom) return '';
    nom = nom.toLowerCase();
    if (!BALISES.has(nom)) return '';
    if (tout[1] === '/') return VIDES.has(nom) ? '' : `</${nom}>`;
    const garde = [];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(attrs || ''))) {
      const a = m[1].toLowerCase();
      const v = (m[2] ?? m[3] ?? m[4] ?? '').replace(/"/g, '&quot;');
      if (a === 'href' && nom === 'a' && lienSur(v)) garde.push(`href="${v}"`);
      else if ((a === 'id' || a === 'class') && /^[\w\- ]{1,60}$/.test(v)) garde.push(`${a}="${v}"`);
      else if ((a === 'colspan' || a === 'rowspan') && /^\d{1,2}$/.test(v)) garde.push(`${a}="${v}"`);
    }
    if (nom === 'a' && garde.some((x) => /^href="https?:/i.test(x))) garde.push('target="_blank"', 'rel="noopener"');
    return `<${nom}${garde.length ? ' ' + garde.join(' ') : ''}>`;
  });
  return s.trim();
}

// --- Contenu de départ : les pages legal/*.html du dépôt (titre <h1>, « Version du … », puis le contenu).
function lireFichier(cle) {
  try {
    const t = fs.readFileSync(path.join(DOSSIER_LEGAL, path.basename(PAGES_FIXES[cle])), 'utf8');
    const titre = ((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(t) || [])[1] || cle).replace(/<[^>]+>/g, '').trim();
    const v = /Version du (\d{1,2})(?:er)? (\S+) (\d{4})/.exec(t);
    const mois = v ? MOIS.indexOf(v[2]) + 1 : 0;
    const version = v && mois ? `${v[3]}-${String(mois).padStart(2, '0')}-${String(v[1]).padStart(2, '0')}` : new Date().toISOString().slice(0, 10);
    // Contenu : dans <div id="contenu"> s'il existe, sinon tout ce qui suit la ligne de version jusqu'à </main>.
    let corps = (/<div id="contenu">([\s\S]*?)<\/div>\s*(?:<nav[\s\S]*?<\/nav>\s*)?<\/main>/.exec(t) || [])[1];
    if (corps == null) corps = ((/<p class="muted"[^>]*>Version du[^<]*<\/p>([\s\S]*?)<\/main>/.exec(t) || [])[1] || '');
    return { titre, version, html: nettoyerHtml(corps) };
  } catch (e) { return null; }
}

function creerLegal(base) {
  let cache = null; // liste des pages (sans le HTML), relue après chaque changement
  const ligne = (l) => l && { cle: l.cle, titre: l.titre, version: dateIso(l.version), versionTexte: versionTexte(dateIso(l.version)), html: l.html, ordre: l.ordre, visible: l.visible, majLe: l.maj_le, lien: lienPage(l.cle), fixe: !!PAGES_FIXES[l.cle] };

  async function charger() {
    // Premier démarrage : les deux pages d'origine sont reprises des fichiers du site.
    let ordre = 0;
    for (const cle of Object.keys(PAGES_FIXES)) {
      const f = lireFichier(cle);
      if (f) await base.query('INSERT INTO pages_legales (cle, titre, version, html, ordre) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cle) DO NOTHING', [cle, f.titre, f.version, f.html, ordre]);
      ordre++;
    }
    cache = (await base.query('SELECT cle, titre, version, ordre, visible, maj_le FROM pages_legales ORDER BY ordre, cle')).rows.map((l) => { const x = ligne({ ...l, html: '' }); delete x.html; return x; });
    return cache;
  }
  const liste = () => cache || [];
  // Liens de Paramètres (site et applis) : pages visibles, dans l'ordre.
  const liens = (site) => liste().filter((p) => p.visible).map((p) => ({ cle: p.cle, titre: p.titre, lien: site + p.lien }));

  async function page(cle) {
    if (!cleValide(cle)) return null;
    return ligne((await base.query('SELECT * FROM pages_legales WHERE cle = $1', [cle])).rows[0]);
  }

  // Créer ou modifier une page. L'ancienne version est gardée (historique, et preuve de ce qui s'appliquait).
  async function enregistrer(cle, { titre, version, html, visible, ordre } = {}) {
    if (!cleValide(cle)) throw erreur('Adresse de page invalide : 2 à 40 lettres minuscules, chiffres ou tirets.');
    titre = String(titre || '').replace(/[<>]/g, '').trim().slice(0, 120);
    if (!titre) throw erreur('Il faut un titre.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(version || '')) || Number.isNaN(Date.parse(version))) throw erreur('Date de version invalide.');
    const propre = nettoyerHtml(html);
    if (!propre) throw erreur('La page est vide.');
    if (propre.length > TAILLE_MAX) throw erreur('La page est trop longue.');
    if (PAGES_FIXES[cle] && visible === false) throw erreur('Les conditions et la confidentialité restent toujours visibles (exigé par Google Play et l\'App Store).');
    const avant = (await base.query('SELECT * FROM pages_legales WHERE cle = $1', [cle])).rows[0];
    await base.transaction(async (tx) => {
      if (avant) await tx.query('INSERT INTO pages_legales_versions (cle, titre, version, html, cree_le) VALUES ($1,$2,$3,$4,$5)', [cle, avant.titre, avant.version, avant.html, avant.maj_le]);
      const o = Number.isInteger(ordre) ? ordre : avant ? avant.ordre : (liste().reduce((m, p) => Math.max(m, p.ordre), 0) + 1);
      const v = typeof visible === 'boolean' ? visible : avant ? avant.visible : true;
      await tx.query(`INSERT INTO pages_legales (cle, titre, version, html, ordre, visible, maj_le) VALUES ($1,$2,$3,$4,$5,$6, now())
        ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, version = EXCLUDED.version, html = EXCLUDED.html, ordre = EXCLUDED.ordre, visible = EXCLUDED.visible, maj_le = now()`, [cle, titre, version, propre, o, v]);
    });
    await charger();
    return { page: await page(cle), nouvelle: !avant, avant: avant ? { titre: avant.titre, version: dateIso(avant.version), taille: avant.html.length } : null };
  }

  async function supprimer(cle) {
    if (PAGES_FIXES[cle]) throw erreur('Cette page ne peut pas être supprimée.');
    const r = await base.query('DELETE FROM pages_legales WHERE cle = $1', [cle]);
    await charger();
    return r.rowCount || (r.affectedRows ?? 0);
  }

  async function historique(cle) {
    return (await base.query('SELECT id, titre, version, length(html)::int AS taille, cree_le FROM pages_legales_versions WHERE cle = $1 ORDER BY id DESC LIMIT 30', [cle])).rows.map((l) => ({ id: Number(l.id), titre: l.titre, version: dateIso(l.version), taille: l.taille, le: l.cree_le }));
  }
  async function ancienne(cle, id) {
    const l = (await base.query('SELECT titre, version, html FROM pages_legales_versions WHERE cle = $1 AND id = $2', [cle, Number(id) || 0])).rows[0];
    return l && { titre: l.titre, version: dateIso(l.version), html: l.html };
  }

  return { charger, liste, liens, page, enregistrer, supprimer, historique, ancienne };
}

module.exports = { creerLegal, nettoyerHtml, PAGES_FIXES, lienPage, versionTexte };
