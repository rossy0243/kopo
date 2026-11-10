// Petits outils : node server/src/outils.js totp | vapid
// Crée le secret du code à deux facteurs de l'admin, à mettre dans ADMIN_TOTP sur Render,
// et le lien à ouvrir (ou recopier) dans Google Authenticator.
'use strict';
const { nouveauSecretTotp, codeTotp } = require('./auth');
if (process.argv[2] === 'totp') {
  const s = nouveauSecretTotp();
  console.log('ADMIN_TOTP = ' + s);
  console.log('À ajouter dans Google Authenticator (clé de configuration) : ' + s);
  console.log('Ou ce lien : otpauth://totp/Kopo:admin?secret=' + s + '&issuer=Kopo');
  console.log('Code actuel, pour vérifier : ' + codeTotp(s));
} else if (process.argv[2] === 'vapid') {
  // Clés des notifications push, à mettre dans VAPID_PUBLIC et VAPID_PRIVE sur Render (une seule fois :
  // en changer désabonne tous les téléphones).
  const k = require('web-push').generateVAPIDKeys();
  console.log('VAPID_PUBLIC = ' + k.publicKey);
  console.log('VAPID_PRIVE = ' + k.privateKey);
} else console.log('Usage : node server/src/outils.js totp | vapid');
