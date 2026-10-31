// Jetons des joueurs et de l'admin, connexion Supabase (Google / téléphone), code à deux facteurs.
'use strict';
const crypto = require('crypto');
const jose = require('jose');

function creerAuth(env = process.env) {
  const secret = env.SECRET_SERVEUR || (env.NODE_ENV === 'production' ? null : 'secret-de-developpement-a-ne-pas-utiliser');
  if (!secret) throw new Error('SECRET_SERVEUR manquant (une longue chaîne aléatoire).');
  const cle = new TextEncoder().encode(secret);

  // Jeton Kopo : signé par le serveur, valable 90 jours (joueur) ou 12 h (admin).
  const signer = (sub, aud, duree) => new jose.SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience(aud).setIssuer('kopo').setIssuedAt().setExpirationTime(duree).sign(cle);
  async function verifier(jeton, aud) {
    try { const { payload } = await jose.jwtVerify(jeton, cle, { audience: aud, issuer: 'kopo' }); return payload.sub; }
    catch (e) { return null; }
  }

  // Jeton Supabase Auth (après connexion Google ou par SMS dans l'application).
  let jwks = null;
  async function verifierSupabase(jeton) {
    try {
      if (env.SUPABASE_JWT_SECRET) {
        const { payload } = await jose.jwtVerify(jeton, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { audience: 'authenticated' });
        return payload;
      }
      if (!env.SUPABASE_URL) return null;
      jwks = jwks || jose.createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL));
      const { payload } = await jose.jwtVerify(jeton, jwks, { audience: 'authenticated' });
      return payload;
    } catch (e) { return null; }
  }

  // Admin : mot de passe + code à 6 chiffres d'une application d'authentification (Google Authenticator…).
  const tentatives = new Map(); // ip -> { n, depuis }
  function limiter(ip) {
    const t = tentatives.get(ip) || { n: 0, depuis: Date.now() };
    if (Date.now() - t.depuis > 15 * 60e3) { t.n = 0; t.depuis = Date.now(); }
    t.n++; tentatives.set(ip, t);
    return t.n <= 5;
  }
  async function connexionAdmin(motDePasse, code, ip) {
    if (!env.ADMIN_MOT_DE_PASSE || !env.ADMIN_TOTP) return { ok: false, erreur: 'Admin non configuré (ADMIN_MOT_DE_PASSE et ADMIN_TOTP).' };
    if (!limiter(ip)) return { ok: false, erreur: 'Trop d\'essais. Réessaie dans 15 minutes.' };
    const a = Buffer.from(String(motDePasse || '')), b = Buffer.from(env.ADMIN_MOT_DE_PASSE);
    const mdpOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!mdpOk || !verifierTotp(env.ADMIN_TOTP, code)) return { ok: false, erreur: 'Mot de passe ou code incorrect.' };
    tentatives.delete(ip);
    return { ok: true, jeton: await signer('admin', 'kopo-admin', '12h') };
  }

  return {
    jetonJoueur: (id) => signer(id, 'kopo-joueur', '90d'),
    verifierJoueur: (j) => verifier(j, 'kopo-joueur'),
    verifierAdmin: async (j) => (await verifier(j, 'kopo-admin')) === 'admin',
    verifierSupabase,
    connexionAdmin,
  };
}

// --- Code à usage unique (TOTP, RFC 6238), compatible Google Authenticator.
function base32(texte) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of String(texte).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets);
}
function codeTotp(secretBase32, instant = Date.now()) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(Math.floor(instant / 30000)));
  const h = crypto.createHmac('sha1', base32(secretBase32)).update(compteur).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
function verifierTotp(secret, code, instant = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  return [-1, 0, 1].some((d) => codeTotp(secret, instant + d * 30000) === code);
}
function nouveauSecretTotp() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(crypto.randomBytes(32), (b) => A[b % 32]).join('');
}

module.exports = { creerAuth, codeTotp, verifierTotp, nouveauSecretTotp };
