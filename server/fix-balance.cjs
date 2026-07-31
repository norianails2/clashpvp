const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_6MTro1KEszDQ@ep-winter-fire-a21gwkkw.eu-central-1.aws.neon.tech/neondb?sslmode=require' });

(async () => {
  const c = await pool.connect();
  try {
    const r = await c.query('SELECT id, balance FROM users ORDER BY balance DESC LIMIT 5');
    console.log('User balances:');
    r.rows.forEach(row => console.log(row.id, row.balance));
    
    // Fix any balance > 1e15 (likely corrupted)
    const bad = await c.query("SELECT id, balance FROM users WHERE balance > 1000000000000000");
    if (bad.rows.length > 0) {
      console.log('\nFixing corrupted balances:');
      for (const row of bad.rows) {
        console.log(`  ${row.id}: ${row.balance} -> 10000`);
        await c.query('UPDATE users SET balance = 10000 WHERE id = $1', [row.id]);
      }
    }
  } finally {
    c.release();
    await pool.end();
  }
})();
