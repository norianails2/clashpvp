import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({
  connectionString: config.db.url || 'postgresql://neondb_owner:npg_6MTro1KEszDQ@ep-winter-fire-a21gwkkw.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export default pool;
