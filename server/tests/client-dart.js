// Essai du client Dart de référence (docs/api/dart) contre un vrai serveur en mémoire.
// Demande le SDK Dart (ou Flutter) : node server/tests/client-dart.js [chemin/vers/dart]
'use strict';
process.env.KOPO_TESTS = '1';
const path = require('path');
const { spawn } = require('child_process');
const { demarrer } = require('../src/index');

(async () => {
  const dart = process.argv[2] || process.env.DART || 'dart';
  const srv = await demarrer({ port: 0, env: { NODE_ENV: 'test', SECRET_SERVEUR: 'x'.repeat(40) } });
  // spawn (pas spawnSync) : le serveur doit continuer à répondre pendant l'essai.
  const enfant = spawn(dart, ['run', path.join(__dirname, '..', '..', 'docs', 'api', 'dart', 'bin', 'essai.dart'), 'http://localhost:' + srv.port], { stdio: 'inherit' });
  const minuteur = setTimeout(() => enfant.kill(), 180e3);
  const statut = await new Promise((ok) => { enfant.on('error', (e) => { console.error('Dart introuvable :', e.message); ok(2); }); enfant.on('exit', (c) => ok(c)); });
  clearTimeout(minuteur);
  await srv.arreter();
  process.exit(statut === 0 ? 0 : statut === 2 ? 2 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
