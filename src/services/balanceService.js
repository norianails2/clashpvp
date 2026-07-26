import { query, getClient } from '../db/pool.js';

/**
 * BalanceService
 *
 * Все операции атомарны: BEGIN → SELECT ... FOR UPDATE → UPDATE → COMMIT.
 * Row-level lock не даёт балансу уйти в минус даже при параллельных запросах.
 * Каждая операция пишет аудит в таблицу transactions.
 *
 * Все методы принимают опциональный txClient — если передан, транзакция
 * управляется вызвавшим кодом (позволяет комбинировать с другими операциями).
 */

/** Комиссия дома (2%) — применяется к выигрышу */
export const HOUSE_EDGE = 0.10;

async function withClient(txClient, fn) {
  if (txClient) return fn(txClient);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function checkUserBalance(client, userId, minAmount) {
  const { rows } = await client.query(
    `SELECT balance FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }
  const balanceBefore = Number(rows[0].balance);
  if (minAmount && balanceBefore < minAmount) {
    throw Object.assign(
      new Error(`Insufficient balance: ${balanceBefore} < ${minAmount}`),
      { status: 400, balance: balanceBefore }
    );
  }
  return { rows, balanceBefore };
}

// ---------------------------------------------------------------------------
// 1. ХОЛД (списание ставки)
// ---------------------------------------------------------------------------
export async function holdBet(userId, amount, gameType, roomId, txClient) {
  if (!userId || !amount || amount < 1) {
    throw Object.assign(new Error('Invalid bet params'), { status: 400 });
  }

  return withClient(txClient, async (client) => {
    const { balanceBefore } = await checkUserBalance(client, userId, amount);

    const balanceAfter = balanceBefore - amount;

    await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [balanceAfter, userId]);

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type, room_id)
       VALUES ($1, 'bet', $2, $3, $4, $5, $6)`,
      [userId, amount, balanceBefore, balanceAfter, gameType || null, roomId || null]
    );

    return { balanceBefore, balanceAfter };
  });
}

// ---------------------------------------------------------------------------
// 2. ВЫПЛАТА (начисление выигрыша)
//    commission — комиссия дома (0..1), по умолчанию 0 (нет комиссии).
//    Для PvP игр передавайте HOUSE_EDGE (0.10 → 10%).
// ---------------------------------------------------------------------------
export async function payout(userId, grossAmount, gameType, roomId, txClient, commission = 0) {
  if (!userId || !grossAmount || grossAmount < 1) {
    throw Object.assign(new Error('Invalid payout params'), { status: 400 });
  }

  const netAmount = commission > 0 ? Math.floor(grossAmount * (1 - commission)) : grossAmount;

  return withClient(txClient, async (client) => {
    const { balanceBefore } = await checkUserBalance(client, userId);

    const balanceAfter = balanceBefore + netAmount;

    await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [balanceAfter, userId]);

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type, room_id, metadata)
       VALUES ($1, 'win', $2, $3, $4, $5, $6, $7)`,
      [userId, netAmount, balanceBefore, balanceAfter, gameType || null, roomId || null,
       commission > 0 ? JSON.stringify({ gross: grossAmount, commission }) : null]
    );

    return { balanceBefore, balanceAfter, grossAmount, commission, netAmount };
  });
}

// ---------------------------------------------------------------------------
// 3. ВОЗВРАТ (отмена игры, ничья, техническая ошибка)
// ---------------------------------------------------------------------------
export async function refund(userId, amount, gameType, roomId, txClient) {
  if (!userId || !amount || amount < 1) {
    throw Object.assign(new Error('Invalid refund params'), { status: 400 });
  }

  return withClient(txClient, async (client) => {
    const { balanceBefore } = await checkUserBalance(client, userId);

    const balanceAfter = balanceBefore + amount;

    await client.query(`UPDATE users SET balance = $1 WHERE id = $2`, [balanceAfter, userId]);

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type, room_id)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6)`,
      [userId, amount, balanceBefore, balanceAfter, gameType || null, roomId || null]
    );

    return { balanceBefore, balanceAfter };
  });
}

// ---------------------------------------------------------------------------
// 4. ПРОВЕРКА БАЛАНСА (без блокировки, для UI)
// ---------------------------------------------------------------------------
export async function getBalance(userId) {
  const { rows } = await query(`SELECT balance FROM users WHERE id = $1`, [userId]);
  if (rows.length === 0) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }
  return Number(rows[0].balance);
}

// ---------------------------------------------------------------------------
// 5. ИСТОРИЯ ТРАНЗАКЦИЙ
// ---------------------------------------------------------------------------
export async function getTransactionHistory(userId, limit = 30) {
  const { rows } = await query(
    `SELECT id, type, amount, balance_before, balance_after, game_type, room_id, metadata, created_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
