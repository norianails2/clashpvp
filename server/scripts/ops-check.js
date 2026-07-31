import pool, { query } from '../src/db/pool.js';

try {
  const [activeCrashBets, expiredRooms] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM crash_bets WHERE status = 'active'`),
    query(
      `SELECT COUNT(*)::int AS count
       FROM rooms
       WHERE (status = 'WAITING' AND NOW() - updated_at > INTERVAL '15 minutes')
          OR (status = 'IN_PROGRESS' AND NOW() - updated_at > INTERVAL '30 minutes')`
    ),
  ]);

  console.log(JSON.stringify({
    activeCrashBets: activeCrashBets.rows[0].count,
    expiredRooms: expiredRooms.rows[0].count,
  }));
} finally {
  await pool.end();
}
