import { Router } from 'express';
import { query } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { config } from '../config.js';

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
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
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

    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Amount is required (positive or negative)' });
    }

    const { rows } = await query(
      `UPDATE users SET balance = GREATEST(0, balance + $1) WHERE id = $2 RETURNING id, username, balance`,
      [amount, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
       VALUES ($1, 'admin', $2, $3, $4, $5)`,
      [id, amount, Number(rows[0].balance) - amount, Number(rows[0].balance),
       JSON.stringify({ reason: reason || 'admin adjustment', adminAction: true })]
    );

    res.json({ user: rows[0] });
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
