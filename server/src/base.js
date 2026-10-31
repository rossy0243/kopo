// Accès à la base. En production : Postgres (Supabase) via DATABASE_URL.
// Sans DATABASE_URL (essais, tests) : une vraie base Postgres en mémoire (PGlite).
'use strict';
const fs = require('fs');
const path = require('path');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

async function ouvrirBase(url = process.env.DATABASE_URL) {
  let base;
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL || 10), ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    base = {
      genre: 'postgres',
      query: (sql, p) => pool.query(sql, p),
      async transaction(fn) {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const r = await fn({ query: (sql, p) => c.query(sql, p) }); await c.query('COMMIT'); return r; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
        finally { c.release(); }
      },
      fermer: () => pool.end(),
    };
    await pool.query(SCHEMA);
  } else {
    let PGlite;
    try { ({ PGlite } = require('@electric-sql/pglite')); }
    catch (e) { throw new Error('DATABASE_URL manquant : indique l\'adresse de la base Supabase (voir server/README.md).'); }
    const db = new PGlite();
    base = {
      genre: 'memoire',
      query: (sql, p) => db.query(sql, p),
      transaction: (fn) => db.transaction((tx) => fn({ query: (sql, p) => tx.query(sql, p) })),
      fermer: () => db.close(),
    };
    await db.exec(SCHEMA);
  }
  return base;
}

module.exports = { ouvrirBase };
