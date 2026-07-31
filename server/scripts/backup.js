import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const tables = [
  'schema_migrations',
  'users',
  'transactions',
  'rooms',
  'star_invoices',
  'solo_blackjack_games',
  'solo_mines_games',
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const snapshot = { createdAt: new Date().toISOString(), tables: {} };
  for (const table of tables) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    snapshot.tables[table] = rows;
  }

  const backupDir = path.resolve('backups');
  await fs.mkdir(backupDir, { recursive: true });
  const filename = `clashpvp-${snapshot.createdAt.replace(/[:.]/g, '-')}.json`;
  const outputPath = path.join(backupDir, filename);
  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Backup written: ${outputPath}`);
} finally {
  await pool.end();
}
