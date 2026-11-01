// Assemble la page unique index.html à partir des sources.  Lancer : node build.js
const fs = require('fs');
const path = require('path');
const ici = (p) => path.join(__dirname, p);
const lire = (p) => fs.readFileSync(ici(p), 'utf8').replace(/<\/script/gi, '<\\/script');
let html = fs.readFileSync(ici('src/source.html'), 'utf8');
const rempl = {
  MQTT: lire('vendor/mqtt.min.js').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  COLYSEUS: lire('vendor/colyseus.min.js').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  PEERJS: lire('vendor/peerjs.min.js').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  QRCODE: lire('vendor/qrcode.js'),
  MOTEUR: lire('moteur/kopo-moteur.js'),
  SALLE: lire('src/kopo-salle.js'),
  RETENTION: lire('src/kopo-retention.js'),
  SONS: lire('src/kopo-sons.js'),
};
for (const [k, v] of Object.entries(rempl)) html = html.replace(`/*${k}*/`, () => v);
// Adresse publique du site (aperçus WhatsApp, etc.) : SITE_URL sur Render, GitHub Pages par défaut.
const site = (process.env.SITE_URL || 'https://rossy0243.github.io/kopo/').replace(/\/?$/, '/');
html = html.split('__KOPO_SITE__').join(site);
// Empreinte de la page : le jeu la compare à celle en ligne pour proposer « Mettre à jour ».
html = html.replace('__KOPO_BUILD__', require('crypto').createHash('sha1').update(html).digest('hex').slice(0, 12));
fs.writeFileSync(ici('index.html'), html);
console.log('index.html :', html.length, 'octets');
