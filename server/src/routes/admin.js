import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();

router.use(adminAuth);

// Dashboard stats
router.get('/stats', async (req, res, next) => {
  try {
    const [users, activeRooms, totalGames, totalRake, turnover, payouts, todayUsers, recentTxs, activeCrashBets, expiredRooms, staleInvoices] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total, SUM(balance)::bigint AS total_balance FROM users`),
      query(`SELECT COUNT(*)::int AS count FROM rooms WHERE status = 'IN_PROGRESS'`),
      query(`SELECT COUNT(*)::int AS count FROM rooms WHERE status = 'FINISHED'`),
      query(`SELECT COALESCE(SUM(((metadata->>'gross')::bigint - amount)), 0) AS rake FROM transactions WHERE type = 'win' AND metadata->>'commission' IS NOT NULL`),
      query(`SELECT COALESCE(SUM(amount)::bigint, 0) AS total FROM transactions WHERE type = 'bet'`),
      query(`SELECT COALESCE(SUM(amount)::bigint, 0) AS total FROM transactions WHERE type = 'win'`),
      query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at >= CURRENT_DATE`),
      query(`SELECT t.id, t.type, t.amount, t.user_id, t.game_type, t.created_at, u.username FROM transactions t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 20`),
      query(`SELECT COUNT(*)::int AS count FROM crash_bets WHERE status = 'active'`),
      query(`SELECT COUNT(*)::int AS count FROM rooms WHERE (status = 'WAITING' AND NOW() - updated_at > INTERVAL '15 minutes') OR (status = 'IN_PROGRESS' AND NOW() - updated_at > INTERVAL '30 minutes')`),
      query(`SELECT COUNT(*)::int AS count FROM star_invoices WHERE status = 'pending' AND expires_at < NOW() - INTERVAL '24 hours'`),
    ]);

    res.json({
      totalUsers: users.rows[0]?.total || 0,
      totalBalance: users.rows[0]?.total_balance || 0,
      activeRooms: activeRooms.rows[0]?.count || 0,
      totalGamesPlayed: totalGames.rows[0]?.count || 0,
      totalRake: totalRake.rows[0]?.rake || 0,
      totalTurnover: turnover.rows[0]?.total || 0,
      totalPayouts: payouts.rows[0]?.total || 0,
      newUsersToday: todayUsers.rows[0]?.count || 0,
      recentTransactions: recentTxs.rows,
      activeCrashBets: activeCrashBets.rows[0]?.count || 0,
      expiredRooms: expiredRooms.rows[0]?.count || 0,
      stalePendingInvoices: staleInvoices.rows[0]?.count || 0,
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

router.get('/withdrawals', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT w.id, w.stars_amount, w.wallet_address, w.status, w.ton_tx_hash, w.created_at, w.processed_at,
              u.username, u.telegram_id
       FROM ton_withdrawal_requests w
       JOIN users u ON u.id = w.user_id
       ORDER BY CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END, w.created_at DESC
       LIMIT 100`
    );
    res.json({ withdrawals: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/withdrawals/:id/paid', async (req, res, next) => {
  try {
    const tonTxHash = typeof req.body?.tonTxHash === 'string' ? req.body.tonTxHash.trim() : '';
    if (!tonTxHash || tonTxHash.length > 128) return res.status(400).json({ error: 'TON transaction hash is required' });
    const { rows } = await query(
      `UPDATE ton_withdrawal_requests SET status = 'paid', ton_tx_hash = $2, processed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id, status`,
      [req.params.id, tonTxHash]
    );
    if (!rows.length) return res.status(409).json({ error: 'Withdrawal is no longer pending' });
    res.json({ withdrawal: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/withdrawals/:id/reject', async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: requests } = await client.query(
      `SELECT id, user_id, stars_amount FROM ton_withdrawal_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (!requests.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Withdrawal is no longer pending' }); }
    const withdrawal = requests[0];
    const { rows: users } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [withdrawal.user_id]);
    const balanceBefore = Number(users[0].balance);
    const balanceAfter = balanceBefore + Number(withdrawal.stars_amount);
    await client.query("UPDATE ton_withdrawal_requests SET status = 'rejected', processed_at = NOW() WHERE id = $1", [withdrawal.id]);
    await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, withdrawal.user_id]);
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
       VALUES ($1, 'refund', $2, $3, $4, $5)`,
      [withdrawal.user_id, withdrawal.stars_amount, balanceBefore, balanceAfter, JSON.stringify({ withdrawalId: withdrawal.id, reason: 'withdrawal_rejected' })]
    );
    await client.query('COMMIT');
    res.json({ withdrawal: { id: withdrawal.id, status: 'rejected' }, balance: balanceAfter });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
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
