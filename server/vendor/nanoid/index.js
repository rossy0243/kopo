'use strict';
// Remplaçant local de nanoid 2 pour @colyseus/core 0.16, qui l'appelle ainsi : nanoid(taille).
// nanoid 2.x n'est plus corrigé (failles GHSA-mwcw-c2x4-8c55 et suivantes) et nanoid 3+ n'a plus
// le même format d'export : ce petit module garde l'appel de la v2 et refuse les tailles invalides.
const { randomFillSync } = require('crypto');

const ALPHABET = '-_zZyYxXwWvVuUtTsSrRqQpPoOnNmMlLkKjJiIhHgGfFeEdDcCbBaA9876543210'; // 64 signes, comme nanoid 2

module.exports = function nanoid(taille) {
  let n = taille === undefined || taille === null || taille === 0 ? 21 : Number(taille);
  if (!Number.isInteger(n) || n < 1 || n > 1024) {
    throw new RangeError('nanoid : la taille doit être un entier entre 1 et 1024');
  }
  const octets = randomFillSync(Buffer.alloc(n));
  let id = '';
  while (n--) id += ALPHABET[octets[n] & 63];
  return id;
};
