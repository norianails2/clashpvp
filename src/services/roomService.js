import { query, getClient } from '../db/pool.js';
import { holdBet, refund, payout, HOUSE_EDGE } from './balanceService.js';

const MIN_BET = 1;

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/**
 * Получить комнату по ID (без блокировки, для чтения).
 */
export async function getRoomById(roomId) {
  const { rows } = await query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
  return rows[0] || null;
}

/**
 * Список ожидающих комнат для лобби.
 */
export async function listWaitingRooms(gameType, limit = 50) {
  const { rows } = await query(
    `SELECT id, game_type, bet_amount, creator_id,
            created_at
     FROM rooms
     WHERE game_type = $1 AND status = 'WAITING'
     ORDER BY created_at ASC
     LIMIT $2`,
    [gameType, limit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 1. CREATE ROOM
// ---------------------------------------------------------------------------

/**
 * Создать комнату.
 *
 * Алгоритм:
 *   1. Валидация ставки
 *   2. Открыть транзакцию
 *   3. Заблокировать строку пользователя (FOR UPDATE)
 *   4. Списать ставку (через holdBet с переданным txClient)
 *   5. Вставить комнату со статусом WAITING
 *   6. COMMIT
 *
 * @param {string} userId
 * @param {string} gameType — 'rps' | 'dice' | 'coin' | 'mines' | 'blackjack' | 'crash'
 * @param {number} betAmount
 * @param {object} [gameData=null] — дополнительные игровые данные (например, прогноз для Dice)
 * @returns {object} созданная комната
 */
export async function createRoom(userId, gameType, betAmount, gameData = null) {
  if (!betAmount || betAmount < MIN_BET) {
    throw Object.assign(
      new Error(`Minimum bet is ${MIN_BET}`),
      { status: 400 }
    );
  }

  const validTypes = ['rps', 'dice', 'coin', 'mines', 'blackjack', 'crash'];
  if (!validTypes.includes(gameType)) {
    throw Object.assign(
      new Error(`Invalid game type: ${gameType}`),
      { status: 400 }
    );
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Auto-cancel any existing waiting rooms for this user and refund bets
    await client.query(
      `UPDATE users u SET balance = balance + r.bet_amount
       FROM rooms r
       WHERE r.creator_id = $1 AND r.status = 'WAITING' AND u.id = r.creator_id`,
      [userId]
    );
    await client.query(
      `UPDATE rooms SET status = 'CANCELLED' WHERE creator_id = $1 AND status = 'WAITING'`,
      [userId]
    );

    // 1. Списать ставку (внутри SELECT ... FOR UPDATE)
    await holdBet(userId, betAmount, gameType, null, client);

    // 2. Создать комнату
    const { rows } = await client.query(
      `INSERT INTO rooms (game_type, bet_amount, creator_id${gameData ? ', game_data' : ''})
       VALUES ($1, $2, $3${gameData ? ', $4::jsonb' : ''})
       RETURNING *`,
      gameData ? [gameType, betAmount, userId, JSON.stringify(gameData)] : [gameType, betAmount, userId]
    );

    const room = rows[0];

    await client.query('COMMIT');

    return room;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 2. JOIN ROOM
// ---------------------------------------------------------------------------

/**
 * Присоединиться к комнате.
 *
 * Защита от race condition:
 *   - Блокируем строку комнаты (FOR UPDATE)
 *   - Статус проверяется внутри блокировки
 *   - Если два запроса придут одновременно — второй получит "Room is no longer available"
 *
 * Алгоритм:
 *   1. Открыть транзакцию
 *   2. Заблокировать строку комнаты (FOR UPDATE)
 *   3. Проверить статус WAITING
 *   4. Проверить userId != creator_id
 *   5. Заблокировать строку второго игрока (FOR UPDATE)
 *   6. Списать ставку (holdBet с txClient)
 *   7. Обновить статус → IN_PROGRESS, записать opponent_id
 *   8. COMMIT
 *
 * @param {string} userId — ID присоединяющегося
 * @param {string} roomId — ID комнаты
 * @returns {object} обновлённая комната
 */
export async function joinRoom(userId, roomId) {
  if (!userId || !roomId) {
    throw Object.assign(new Error('Missing userId or roomId'), { status: 400 });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Заблокировать комнату
    const { rows: roomRows } = await client.query(
      `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
      [roomId]
    );
    if (roomRows.length === 0) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Room not found'), { status: 404 });
    }

    const room = roomRows[0];

    // 2. Проверить статус
    if (room.status !== 'WAITING') {
      await client.query('ROLLBACK');
      throw Object.assign(
        new Error('Room is no longer available'),
        { status: 409, room }
      );
    }

    // 3. Нельзя играть с самим собой
    if (room.creator_id === userId) {
      await client.query('ROLLBACK');
      throw Object.assign(
        new Error('Cannot join your own room'),
        { status: 400 }
      );
    }

    // 4. Списать ставку у второго игрока (внутри FOR UPDATE)
    await holdBet(userId, room.bet_amount, room.game_type, room.id, client);

    // 5. Обновить комнату
    const { rows: updated } = await client.query(
      `UPDATE rooms
       SET status = 'IN_PROGRESS', opponent_id = $1
       WHERE id = $2
       RETURNING *`,
      [userId, roomId]
    );

    await client.query('COMMIT');

    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 3. CANCEL ROOM
// ---------------------------------------------------------------------------

/**
 * Отменить комнату (только создатель, только в статусе WAITING).
 *
 * Алгоритм:
 *   1. Открыть транзакцию
 *   2. Заблокировать строку комнаты (FOR UPDATE)
 *   3. Проверить creator_id и статус WAITING
 *   4. Вернуть ставку создателю (refund с txClient)
 *   5. Обновить статус → CANCELLED
 *   6. COMMIT
 *
 * @param {string} userId — ID создателя
 * @param {string} roomId — ID комнаты
 * @returns {object} обновлённая комната
 */
export async function cancelRoom(userId, roomId) {
  if (!userId || !roomId) {
    throw Object.assign(new Error('Missing userId or roomId'), { status: 400 });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Заблокировать комнату
    const { rows } = await client.query(
      `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
      [roomId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Room not found'), { status: 404 });
    }

    const room = rows[0];

    // 2. Проверить, что отменяет создатель
    if (room.creator_id !== userId) {
      await client.query('ROLLBACK');
      throw Object.assign(
        new Error('Only the creator can cancel this room'),
        { status: 403 }
      );
    }

    // 3. Проверить, что комната ещё ожидает
    if (room.status !== 'WAITING') {
      await client.query('ROLLBACK');
      throw Object.assign(
        new Error('Cannot cancel a room that is not waiting'),
        { status: 409 }
      );
    }

    // 4. Вернуть ставку
    await refund(userId, room.bet_amount, room.game_type, room.id, client);

    // 5. Обновить статус
    const { rows: updated } = await client.query(
      `UPDATE rooms SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
      [roomId]
    );

    await client.query('COMMIT');

    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 4. SET GAME MOVE
// ---------------------------------------------------------------------------

/**
 * Сохранить ход игрока в game_data (атомарно, с блокировкой строки).
 */
export async function setGameMove(roomId, userId, moveKey, moveValue) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
      [roomId]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); throw Object.assign(new Error('Room not found'), { status: 404 }); }

    const room = rows[0];
    if (room.status !== 'IN_PROGRESS') { await client.query('ROLLBACK'); throw Object.assign(new Error('Game is not in progress'), { status: 409 }); }

    const moves = room.game_data?.moves || {};

    if (moves[moveKey]) { await client.query('ROLLBACK'); throw Object.assign(new Error('Already moved'), { status: 409 }); }

    moves[moveKey] = moveValue;

    const updatedGameData = { ...room.game_data, moves };
    const bothMoved = room.opponent_id
      ? moves[room.creator_id] && moves[room.opponent_id]
      : false;

    const { rows: updated } = await client.query(
      `UPDATE rooms SET game_data = $1::jsonb WHERE id = $2 RETURNING *`,
      [JSON.stringify(updatedGameData), roomId]
    );

    await client.query('COMMIT');

    return { room: updated[0], moves, bothMoved };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 5. FINISH GAME (выплата + финиш комнаты)
// ---------------------------------------------------------------------------

/**
 * Завершить игру: FINISHED, winner_id, game_data.result, payout/refund.
 * @param {number} [commission=HOUSE_EDGE] — комиссия дома (0..1), 10% по умолчанию
 */
export async function finishGame(roomId, winnerId, result, draw = false, commission = HOUSE_EDGE) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
      [roomId]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); throw Object.assign(new Error('Room not found'), { status: 404 }); }

    const room = rows[0];
    if (room.status !== 'IN_PROGRESS') { await client.query('ROLLBACK'); throw Object.assign(new Error('Game is not in progress'), { status: 409 }); }

    if (draw) {
      await refund(room.creator_id, room.bet_amount, room.game_type, room.id, client);
      if (room.opponent_id) { await refund(room.opponent_id, room.bet_amount, room.game_type, room.id, client); }
    } else if (winnerId) {
      await payout(winnerId, room.bet_amount * 2, room.game_type, room.id, client, commission);
    }

    const gameData = room.game_data || {};
    gameData.result = result;

    const { rows: updated } = await client.query(
      `UPDATE rooms SET status = 'FINISHED', winner_id = $1, game_data = $2::jsonb WHERE id = $3 RETURNING *`,
      [winnerId, JSON.stringify(gameData), roomId]
    );

    await client.query('COMMIT');

    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
