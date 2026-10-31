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
};
for (const [k, v] of Object.entries(rempl)) html = html.replace(`/*${k}*/`, () => v);
fs.writeFileSync(ici('index.html'), html);
console.log('index.html :', html.length, 'octets');
