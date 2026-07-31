import { query, getClient } from '../db/pool.js';

/** Бонус рефереру за приведённого друга */
const REFERRAL_BONUS = 50;

export async function applyReferral(userId, referrerId) {
  if (!referrerId || referrerId === userId) return;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: refs } = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [referrerId]);
    if (!refs.length) { await client.query('ROLLBACK'); return; }
    const { rows: referred } = await client.query(
      `UPDATE users SET referrer_id = $1 WHERE id = $2 AND referrer_id IS NULL RETURNING id`,
      [referrerId, userId]
    );
    if (!referred.length) { await client.query('ROLLBACK'); return; }
    const { rows: [refUser] } = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [REFERRAL_BONUS, referrerId]
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
       VALUES ($1, 'referral_bonus', $2, $3, $4, $5)`,
      [referrerId, REFERRAL_BONUS, Number(refUser.balance) - REFERRAL_BONUS, Number(refUser.balance),
       JSON.stringify({ referredUserId: userId, bonus: REFERRAL_BONUS })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getReferralStats(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total_referrals,
            SUM(CASE WHEN u2.created_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS recent_referrals
     FROM users u WHERE u.referrer_id = $1`,
    [userId]
  );

  const { rows: bonusRows } = await query(
    `SELECT COALESCE(SUM(amount)::bigint, 0) AS total_earned
     FROM transactions WHERE user_id = $1 AND type = 'referral_bonus'`,
    [userId]
  );

  return {
    totalReferrals: rows[0]?.total_referrals || 0,
    recentReferrals: rows[0]?.recent_referrals || 0,
    totalEarned: bonusRows[0]?.total_earned || 0,
    bonusPerReferral: REFERRAL_BONUS,
  };
}

export function generateReferralLink(userId, botUsername) {
  return `https://t.me/${botUsername}/app?startapp=ref_${userId}`;
}
