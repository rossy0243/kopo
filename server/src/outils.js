// Petits outils : node server/src/outils.js totp
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
} else console.log('Usage : node server/src/outils.js totp');
