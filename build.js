// Assemble la page unique index.html à partir des sources.  Lancer : node build.js
const fs = require('fs');
const path = require('path');
const ici = (p) => path.join(__dirname, p);
const lire = (p) => fs.readFileSync(ici(p), 'utf8').replace(/<\/script/gi, '<\\/script');
let html = fs.readFileSync(ici('src/source.html'), 'utf8');
const rempl = {
  COLYSEUS: lire('vendor/colyseus.min.js').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  QRCODE: lire('vendor/qrcode.js'),
  MOTEUR: lire('moteur/kopo-moteur.js'),
  SALLE: lire('src/kopo-salle.js'),
  RETENTION: lire('src/kopo-retention.js'),
  SONS: lire('src/kopo-sons.js'),
  STICKERS: lire('src/kopo-stickers.js'),
  MOTEUR_INTER8: lire('moteur/inter8-moteur.js'),
  ROBOTS_INTER8: lire('moteur/inter8-robots.js'),
  SALLE_INTER8: lire('src/inter8-salle.js'),
};
for (const [k, v] of Object.entries(rempl)) html = html.replace(`/*${k}*/`, () => v);
// Adresse publique du site (aperçus WhatsApp, etc.) : SITE_URL sur Render, GitHub Pages par défaut.
const site = (process.env.SITE_URL || 'https://rossy0243.github.io/kopo/').replace(/\/?$/, '/');
html = html.split('__KOPO_SITE__').join(site);
// Empreinte de la page : le jeu la compare à celle en ligne pour proposer « Mettre à jour ».
html = html.replace('__KOPO_BUILD__', require('crypto').createHash('sha1').update(html).digest('hex').slice(0, 12));
fs.writeFileSync(ici('index.html'), html);
console.log('index.html :', html.length, 'octets');

// Pages de partage d'un jeu (kopo/ et inter8/) : légères (quelques Ko au lieu de la page entière),
// avec l'aperçu propre au jeu (titre, texte, image) que lisent Facebook, WhatsApp, Messenger…
// Une personne qui ouvre le lien est envoyée aussitôt sur la page du jeu, avec le bon jeu choisi
// (le ?parrain=, ?bande= et le #CODE de la table suivent).
const PAGES_JEU = {
  kopo: {
    titre: 'Kopo sur Masano · le jeu de cartes à élimination',
    texte: 'Une manche, un éliminé : le dernier debout gagne. Annonce KATAPSS pour te qualifier d\'un coup. De 2 à 9 joueurs, entre amis ou en ligne. Gratuit.',
    nom: 'Kopo', bouton: 'Jouer au Kopo', logo: 'icons/kopo-logo.svg',
  },
  inter8: {
    titre: 'Inter (8) sur Masano · vide ta main le premier',
    texte: 'Le 8 demande, le 2, le 10 et le Joker font piocher : vide ta main le premier ! De 2 à 8 joueurs, entre amis ou en ligne. Gratuit.',
    nom: 'Inter (8)', bouton: 'Jouer à Inter (8)', logo: 'icons/masano-logo.svg',
  },
  // Page « Recharger » (pièces et Kopo+), à partager sur WhatsApp et Facebook : ouvre la fenêtre Recharger du site.
  recharger: {
    titre: 'Recharger mes pièces Masano · pièces et Kopo+',
    texte: 'Des pièces pour les tables à mise, les apparences et les stickers, et Kopo+ pour parler au micro en partie. Paiement en francs congolais par mobile money.',
    nom: 'Recharger', bouton: 'Recharger mes pièces', logo: 'icons/masano-logo.svg', image: 'og-masano', ouvrir: 'recharger',
  },
};
const echap = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const [jeu, p] of Object.entries(PAGES_JEU)) {
  const url = site + jeu + '/', image = site + 'icons/' + (p.image || 'og-' + jeu) + '.png?v=2'; // ?v= : Facebook garde les images en cache, changer le numéro force la nouvelle
  const page = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echap(p.titre)}</title>
<meta name="description" content="${echap(p.texte)}">
<meta name="theme-color" content="#10233a">
<link rel="icon" href="../icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Masano">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${echap(p.titre)}">
<meta property="og:description" content="${echap(p.texte)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${echap(p.nom)} sur Masano">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${echap(p.titre)}">
<meta name="twitter:description" content="${echap(p.texte)}">
<meta name="twitter:image" content="${image}">
<script>
(function () {
  var q = new URLSearchParams(location.search); ${p.ouvrir ? `q.set('ouvrir', '${p.ouvrir}');` : `q.set('jeu', '${jeu}');`}
  location.replace('../?' + q.toString() + location.hash);
})();
</script>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 30%, #1f3d63, #0b1726); color: #eef2f7; font: 16px/1.4 system-ui, sans-serif; text-align: center; }
main { padding: 24px; max-width: 420px; }
img { width: 96px; height: 96px; }
h1 { color: #e2b04a; letter-spacing: 2px; margin: 12px 0 4px; }
a { display: inline-block; margin-top: 16px; padding: 12px 22px; border-radius: 12px; background: #e2b04a; color: #1d1606; font-weight: 700; text-decoration: none; }
</style>
</head>
<body>
<main>
<img src="../${p.logo}" alt="">
<h1>${echap(p.nom)}</h1>
<p>${echap(p.texte)}</p>
<a href="../?${p.ouvrir ? 'ouvrir=' + p.ouvrir : 'jeu=' + jeu}">${echap(p.bouton)}</a>
</main>
</body>
</html>
`;
  fs.mkdirSync(ici('_partage/' + jeu), { recursive: true });
  fs.writeFileSync(ici('_partage/' + jeu + '/index.html'), page);
  console.log('_partage/' + jeu + '/index.html :', page.length, 'octets');
}
