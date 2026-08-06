import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();

router.use(adminAuth);

async function audit(client, action, targetUserId, metadata = {}) {
  await client.query(
    'INSERT INTO admin_audit_log (action, target_user_id, metadata) VALUES ($1, $2, $3::jsonb)',
    [action, targetUserId || null, JSON.stringify(metadata)]
  );
}

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
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    const filters = search ? `WHERE username ILIKE $1 OR telegram_id ILIKE $1 OR first_name ILIKE $1` : '';
    const params = search ? [`%${search}%`, limit, offset] : [limit, offset];
    const limitIndex = search ? '$2' : '$1';
    const offsetIndex = search ? '$3' : '$2';
    const [users, total] = await Promise.all([
      query(
        `SELECT id, telegram_id, username, first_name, photo_url, balance, is_banned, banned_reason, created_at
         FROM users ${filters} ORDER BY is_banned ASC, balance DESC, created_at DESC LIMIT ${limitIndex} OFFSET ${offsetIndex}`,
        params
      ),
      query(`SELECT COUNT(*)::int AS count FROM users ${filters}`, search ? [`%${search}%`] : [])
    ]);
    res.json({ users: users.rows, total: total.rows[0]?.count || 0, limit, offset, search });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [user, transactions, withdrawals, summary] = await Promise.all([
      query(`SELECT id, telegram_id, username, first_name, last_name, photo_url, balance, is_banned, banned_reason, banned_at, created_at
             FROM users WHERE id = $1`, [id]),
      query(`SELECT id, type, amount, balance_before, balance_after, game_type, metadata, created_at
             FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [id]),
      query(`SELECT id, stars_amount, wallet_address, status, ton_tx_hash, created_at, processed_at
             FROM ton_withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`, [id]),
      query(`SELECT
               COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)::bigint AS deposits,
               COALESCE(SUM(amount) FILTER (WHERE type = 'bet'), 0)::bigint AS bets,
               COALESCE(SUM(amount) FILTER (WHERE type = 'win'), 0)::bigint AS wins,
               COUNT(*) FILTER (WHERE type = 'bet')::int AS bet_count
             FROM transactions WHERE user_id = $1`, [id]),
    ]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.rows[0], transactions: transactions.rows, withdrawals: withdrawals.rows, summary: summary.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
    const offset = Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const supportedTypes = new Set(['bet', 'win', 'refund', 'deposit', 'withdraw', 'admin', 'task_reward', 'referral_bonus']);
    const clauses = [];
    const values = [];
    if (search) { values.push(`%${search}%`); clauses.push(`(u.username ILIKE $${values.length} OR u.telegram_id ILIKE $${values.length})`); }
    if (supportedTypes.has(type)) { values.push(type); clauses.push(`t.type = $${values.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    values.push(limit, offset);
    const rows = await query(
      `SELECT t.id, t.type, t.amount, t.balance_before, t.balance_after, t.game_type, t.metadata, t.created_at,
              u.id AS user_id, u.username, u.telegram_id
       FROM transactions t JOIN users u ON u.id = t.user_id
       ${where} ORDER BY t.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ transactions: rows.rows, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics', async (_req, res, next) => {
  try {
    const [today, daily, pendingWithdrawals, largestBets, auditLog] = await Promise.all([
      query(`SELECT
               COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)::bigint AS deposits,
               COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0)::bigint AS withdrawals,
               COALESCE(SUM(amount) FILTER (WHERE type = 'bet'), 0)::bigint AS turnover,
               COALESCE(SUM(amount) FILTER (WHERE type = 'win'), 0)::bigint AS payouts,
               COUNT(DISTINCT user_id)::int AS active_users
             FROM transactions WHERE created_at >= CURRENT_DATE`),
      query(`SELECT TO_CHAR(day, 'DD.MM') AS day, COALESCE(turnover, 0)::bigint AS turnover,
               COALESCE(deposits, 0)::bigint AS deposits, COALESCE(payouts, 0)::bigint AS payouts
             FROM (
               SELECT DATE(created_at) AS day,
                 SUM(amount) FILTER (WHERE type = 'bet') AS turnover,
                 SUM(amount) FILTER (WHERE type = 'deposit') AS deposits,
                 SUM(amount) FILTER (WHERE type = 'win') AS payouts
               FROM transactions WHERE created_at >= CURRENT_DATE - INTERVAL '13 days' GROUP BY DATE(created_at)
             ) daily ORDER BY day`),
      query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(stars_amount), 0)::bigint AS stars
             FROM ton_withdrawal_requests WHERE status = 'pending'`),
      query(`SELECT t.amount, t.game_type, t.created_at, u.username, u.telegram_id
             FROM transactions t JOIN users u ON u.id = t.user_id
             WHERE t.type = 'bet' ORDER BY t.amount DESC LIMIT 8`),
      query(`SELECT a.action, a.metadata, a.created_at, u.username
             FROM admin_audit_log a LEFT JOIN users u ON u.id = a.target_user_id
             ORDER BY a.created_at DESC LIMIT 20`),
    ]);
    res.json({ today: today.rows[0], daily: daily.rows, pendingWithdrawals: pendingWithdrawals.rows[0], largestBets: largestBets.rows, auditLog: auditLog.rows });
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
      await audit(client, 'balance_adjusted', id, { amount: appliedAmount, reason: reason || 'admin adjustment' });
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

router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const banned = req.body?.banned === true;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : '';
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE users SET is_banned = $2, banned_reason = $3, banned_at = CASE WHEN $2 THEN NOW() ELSE NULL END
         WHERE id = $1 RETURNING id, username, is_banned, banned_reason`,
        [req.params.id, banned, banned ? reason || 'No reason provided' : null]
      );
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
      await audit(client, banned ? 'user_banned' : 'user_unbanned', rows[0].id, { reason: rows[0].banned_reason });
      await client.query('COMMIT');
      res.json({ user: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
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
