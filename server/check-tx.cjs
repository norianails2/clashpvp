const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_6MTro1KEszDQ@ep-winter-fire-a21gwkkw.eu-central-1.aws.neon.tech/neondb?sslmode=require' });

(async () => {
  const c = await pool.connect();
  try {
    const badId = 'c965e807-3094-43bf-a740-ad1ed33df3a8';
    const r = await c.query('SELECT type, amount, balance_before, balance_after, game_type, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [badId]);
    console.log('Last 10 transactions for corrupted user:');
    r.rows.forEach(row => console.log(row.created_at, row.type, row.amount, 'bal:', row.balance_before, '->', row.balance_after, row.game_type));
  } finally {
    c.release();
    await pool.end();
  }
})();
