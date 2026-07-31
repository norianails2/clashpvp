import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const { rows: applied } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (applied.length) {
      console.log(`[migrate] ${file} skipped (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').trim();
    if (!sql) continue;

    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log(`[migrate] ${file} done.`);
    } catch (err) {
      // Allow ADD VALUE IF NOT EXISTS failures
      if (err.message.includes('already exists')) {
        console.log(`[migrate] ${file} skipped (already applied)`);
        continue;
      }
      console.error(`[migrate] ${file} error:`, err.message.slice(0, 200));
      throw err;
    }
  }

  console.log('[migrate] All migrations complete.');
}

// Allow running directly: node src/db/migrate.js
if (process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => { console.error('[migrate] Failed:', err); process.exit(1); });
}
