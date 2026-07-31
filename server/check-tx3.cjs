const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_6MTro1KEszDQ@ep-winter-fire-a21gwkkw.eu-central-1.aws.neon.tech/neondb?sslmode=require' });

(async () => {
  const c = await pool.connect();
  try {
    const badId = 'c965e807-3094-43bf-a740-ad1ed33df3a8';
    const r = await c.query('SELECT type, amount, balance_before, balance_after, game_type, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at ASC', [badId]);
    let prev = 0;
    for (const row of r.rows) {
      const bal = parseInt(row.balance_after);
      if (bal > prev * 100) {
        console.log('⚠️ BIG JUMP:', row.created_at, row.type, row.amount, 'bal:', row.balance_before, '->', row.balance_after, row.game_type);
      }
      prev = bal;
      if (bal > 1e12) {
        console.log('HUGE:', row.created_at, row.type, row.amount, 'bal:', row.balance_before, '->', row.balance_after, row.game_type);
      }
    }
    console.log('\nTotal transactions:', r.rows.length);
    const last = r.rows[r.rows.length - 1];
    console.log('Last:', last?.created_at, last?.type, last?.amount, 'bal:', last?.balance_before, '->', last?.balance_after);
    const first = r.rows[0];
    console.log('First:', first?.created_at, first?.type, first?.amount, 'bal:', first?.balance_before, '->', first?.balance_after);
  } finally {
    c.release();
    await pool.end();
  }
})();
