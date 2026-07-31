import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();

router.use(adminAuth);

// Dashboard stats
router.get('/stats', async (req, res, next) => {
  try {
    const [users, activeRooms, totalGames, totalRake, recentTxs] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total, SUM(balance)::bigint AS total_balance FROM users`),
      query(`SELECT COUNT(*)::int AS count FROM rooms WHERE status = 'IN_PROGRESS'`),
      query(`SELECT COUNT(*)::int AS count FROM rooms WHERE status = 'FINISHED'`),
      query(`SELECT COALESCE(SUM(amount)::bigint, 0) AS rake FROM transactions WHERE type = 'win' AND metadata->>'commission' IS NOT NULL`),
      query(`SELECT id, type, amount, user_id, game_type, created_at FROM transactions ORDER BY created_at DESC LIMIT 20`),
    ]);

    res.json({
      totalUsers: users.rows[0]?.total || 0,
      totalBalance: users.rows[0]?.total_balance || 0,
      activeRooms: activeRooms.rows[0]?.count || 0,
      totalGamesPlayed: totalGames.rows[0]?.count || 0,
      totalRake: totalRake.rows[0]?.rake || 0,
      recentTransactions: recentTxs.rows,
    });
  } catch (err) {
    next(err);
  }
});

// List users
router.get('/users', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50;
    const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const { rows } = await query(
      `SELECT id, telegram_id, username, balance, created_at FROM users ORDER BY balance DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ users: rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

// Update user balance
router.post('/users/:id/balance', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!Number.isSafeInteger(amount) || amount === 0) {
      return res.status(400).json({ error: 'Amount is required (positive or negative)' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query(
        'SELECT id, username, balance FROM users WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!users.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
      const user = users[0];
      const balanceBefore = Number(user.balance);
      const balanceAfter = Math.max(0, balanceBefore + amount);
      const appliedAmount = balanceAfter - balanceBefore;
      await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, id]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'admin', $2, $3, $4, $5)`,
        [id, appliedAmount, balanceBefore, balanceAfter,
         JSON.stringify({ reason: reason || 'admin adjustment', adminAction: true, requestedAmount: amount })]
      );
      await client.query('COMMIT');
      res.json({ user: { id: user.id, username: user.username, balance: balanceAfter } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Game stats
router.get('/games', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT game_type, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'FINISHED')::int AS finished,
              COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress
       FROM rooms GROUP BY game_type ORDER BY total DESC`
    );
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
