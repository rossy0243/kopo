// Test de charge : node tests/charge.js [joueurs=600] [secondes=60]
// Lance le serveur dans un processus séparé, puis des joueurs simulés qui enchaînent les parties
// (3 par table, chacun joue 0,3 à 1,5 s après son tour : bien plus vite qu'un humain).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('colyseus.js');

const JOUEURS = Number(process.argv[2] || 600), DUREE = Number(process.argv[3] || 60), PAR_TABLE = 3;
const PORT = 3900 + Math.floor(Math.random() * 1000);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function cpu(pid) { const t = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(t[11]) + Number(t[12])) / 100; }
function memoire(pid) { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return Math.round(Number(m[1]) / 1024); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], { env: { ...process.env, PORT, KOPO_TESTS: '1', NODE_ENV: 'test', SECRET_SERVEUR: 'x'.repeat(40) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => srv.stdout.on('data', (d) => /prêt/.test(d) && ok()));
  const U = 'http://localhost:' + PORT;
  let coups = 0, parties = 0, erreurs = 0;
  const latences = [];

  async function table() {
    const jetons = [];
    for (let i = 0; i < PAR_TABLE; i++) jetons.push((await (await fetch(U + '/api/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pseudo: 'Charge' + Math.floor(Math.random() * 1e6) }) })).json()).jeton);
    const c = new Client(U.replace('http', 'ws'));
    const salles = [];
    for (const j of jetons) {
      const s = salles.length ? await c.joinById(salles[0].roomId, { jeton: j }) : await c.create('kopo', { jeton: j, rapide: true });
      s.onMessage('erreur', () => erreurs++);
      s.onMessage('solde', () => {});
      let attente = null;
      s.onMessage('vue', (v) => {
        if (attente) { latences.push(Date.now() - attente); attente = null; }
        if (s === salles[0] && v.etat === 'finPartie') { parties++; setTimeout(() => { s.send('rejouer'); setTimeout(() => s.send('lancer'), 200); }, 300); }
        const a = v.manche && v.manche.actions[0];
        if (v.etat === 'manche' && a && v.manche.joueurCourant === v.moi) setTimeout(() => { attente = Date.now(); coups++; s.send('action', { action: a }); }, 300 + Math.random() * 1200);
      });
      salles.push(s);
    }
    await attendre(100);
    salles[0].send('lancer');
  }

  const t0 = Date.now();
  const tables = Math.ceil(JOUEURS / PAR_TABLE);
  for (let i = 0; i < tables; i += 20) await Promise.all(Array.from({ length: Math.min(20, tables - i) }, table));
  console.log(`${tables * PAR_TABLE} joueurs connectés sur ${tables} tables en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);

  const cpu0 = cpu(srv.pid), d0 = Date.now(); coups = 0; parties = 0; latences.length = 0;
  await attendre(DUREE * 1000);
  const cpuPct = (100 * (cpu(srv.pid) - cpu0)) / ((Date.now() - d0) / 1000);
  latences.sort((a, b) => a - b);
  const p = (q) => latences[Math.floor(latences.length * q)] || 0;
  console.log(`Sur ${DUREE} s : ${coups} coups joués (${(coups / DUREE).toFixed(0)}/s), ${parties} parties terminées, ${erreurs} refus.`);
  console.log(`Temps de réponse du serveur : médiane ${p(0.5)} ms, 95 % sous ${p(0.95)} ms, 99 % sous ${p(0.99)} ms.`);
  console.log(`Serveur : processeur ${cpuPct.toFixed(0)} % d'un cœur, mémoire ${memoire(srv.pid)} Mo.`);
  srv.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
