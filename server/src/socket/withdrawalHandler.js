import { getClient } from '../db/pool.js';

export const MIN_WITHDRAWAL_STARS = 100;

export function isValidTonWalletAddress(value) {
  if (typeof value !== 'string') return false;
  const address = value.trim();
  return /^(?:[EU0k]Q[A-Za-z0-9_-]{46}|-?1:[a-fA-F0-9]{64}|0:[a-fA-F0-9]{64})$/.test(address);
}

export function registerWithdrawalHandlers(io, socket) {
  const userId = socket.data.user.id;

  socket.on('withdrawals:create', async (payload, ack) => {
    const amount = payload?.amount;
    const walletAddress = typeof payload?.walletAddress === 'string' ? payload.walletAddress.trim() : '';
    if (!Number.isSafeInteger(amount) || amount < MIN_WITHDRAWAL_STARS) {
      return ack?.({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL_STARS} Stars` });
    }
    if (!isValidTonWalletAddress(walletAddress)) return ack?.({ error: 'Invalid TON wallet address' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!users.length) throw new Error('User not found');
      const balanceBefore = Number(users[0].balance);
      if (balanceBefore < amount) throw new Error('Insufficient balance');

      const { rows: existing } = await client.query(
        "SELECT id FROM ton_withdrawal_requests WHERE user_id = $1 AND status = 'pending' FOR UPDATE",
        [userId]
      );
      if (existing.length) throw new Error('You already have a pending withdrawal');

      const balanceAfter = balanceBefore - amount;
      const { rows: requests } = await client.query(
        `INSERT INTO ton_withdrawal_requests (user_id, stars_amount, wallet_address)
         VALUES ($1, $2, $3) RETURNING id, stars_amount, wallet_address, status, created_at`,
        [userId, amount, walletAddress]
      );
      await client.query('UPDATE users SET balance = $1 WHERE id = $2', [balanceAfter, userId]);
      await client.query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'withdraw', $2, $3, $4, $5)`,
        [userId, -amount, balanceBefore, balanceAfter, JSON.stringify({ withdrawalId: requests[0].id, walletAddress, status: 'pending' })]
      );
      await client.query('COMMIT');
      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ success: true, request: requests[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      ack?.({ error: err.message || 'Failed to create withdrawal' });
    } finally {
      client.release();
    }
  });
}
