import { getClient, query } from '../db/pool.js';

const DAILY_REWARD = 10;

export function registerEngagementHandlers(io, socket) {
  const userId = socket.data.user.id;

  socket.on('engagement:leaderboard', async (_payload, ack) => {
    try {
      const { rows } = await query(
        `SELECT COALESCE(NULLIF(username, ''), NULLIF(first_name, ''), 'Player') AS name, balance
         FROM users ORDER BY balance DESC, created_at ASC LIMIT 20`
      );
      ack?.({ players: rows.map((row, index) => ({ rank: index + 1, ...row })) });
    } catch (err) { ack?.({ error: 'Failed to load leaderboard' }); }
  });

  socket.on('engagement:daily_status', async (_payload, ack) => {
    try {
      const { rows } = await query('SELECT claim_date = CURRENT_DATE AS claimed FROM daily_reward_claims WHERE user_id = $1', [userId]);
      ack?.({ claimed: Boolean(rows[0]?.claimed), reward: DAILY_REWARD });
    } catch (err) { ack?.({ error: 'Failed to load task status' }); }
  });

  socket.on('engagement:claim_daily', async (_payload, ack) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const balanceBefore = Number(users[0].balance);
      const { rows: claims } = await client.query(
        `INSERT INTO daily_reward_claims (user_id, claim_date, claimed_at) VALUES ($1, CURRENT_DATE, NOW())
         ON CONFLICT (user_id) DO UPDATE SET claim_date = CURRENT_DATE, claimed_at = NOW()
         WHERE daily_reward_claims.claim_date < CURRENT_DATE RETURNING claim_date`,
        [userId]
      );
      if (!claims.length) throw new Error('Reward already claimed today');
      const balanceAfter = balanceBefore + DAILY_REWARD;
      await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, userId]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'task_reward', $2, $3, $4, $5)`,
        [userId, DAILY_REWARD, balanceBefore, balanceAfter, JSON.stringify({ task: 'daily_reward' })]
      );
      await client.query('COMMIT');
      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ success: true, reward: DAILY_REWARD, balance: balanceAfter });
    } catch (err) {
      await client.query('ROLLBACK');
      ack?.({ error: err.message || 'Failed to claim reward' });
    } finally { client.release(); }
  });
}
