import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import { query, getClient } from '../db/pool.js';
import {
  generateMinePositions,
  isValidCellIndex,
  isValidMinesCount,
  isMine,
  calculateMultiplier,
  TOTAL_CELLS,
  MIN_MINES, MAX_MINES,
  MIN_BET, MAX_BET,
} from '../games/mines.js';

async function loadGame(userId) {
  const { rows } = await query('SELECT game_data FROM solo_mines_games WHERE user_id = $1', [userId]);
  return rows[0]?.game_data || null;
}

async function withMinesTransaction(userId, work) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadGameForUpdate(client, userId) {
  const { rows } = await client.query(
    'SELECT game_data FROM solo_mines_games WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  return rows[0]?.game_data || null;
}

async function saveGameInTransaction(client, userId, game) {
  await client.query(
    `INSERT INTO solo_mines_games (user_id, game_data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET game_data = EXCLUDED.game_data, updated_at = NOW()`,
    [userId, JSON.stringify(game)]
  );
}

export function registerMinesHandlers(io, socket) {
  const { user } = socket.data;
  const userId = user.id;

  socket.on('mines:resume', async (_payload, ack) => {
    try {
      const game = await loadGame(userId);
      if (!game) return ack?.({ active: false });
      ack?.({ active: true, betAmount: game.betAmount, minesCount: game.minesCount, openedCells: game.openedCells, multiplier: game.multiplier, safeOpenedCount: game.safeOpenedCount });
    } catch (err) {
      ack?.({ error: 'Failed to restore mines game' });
    }
  });

  socket.on('mines:start', async (payload, ack) => {
    try {
      const { betAmount, minesCount } = payload || {};
      if (!Number.isInteger(betAmount) || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      const count = minesCount ?? 3;
      if (!isValidMinesCount(count)) return ack?.({ error: `Mines count must be between ${MIN_MINES} and ${MAX_MINES}` });

      const minePositions = generateMinePositions(count);
      const game = {
        userId,
        betAmount,
        minesCount: count,
        minePositions,
        openedCells: [],
        safeOpenedCount: 0,
        multiplier: 1,
        active: true,
      };
      const { balanceAfter } = await withMinesTransaction(userId, async (client) => {
        if (await loadGameForUpdate(client, userId)) {
          throw new Error('Finish the active mines game first');
        }
        const balance = await holdBet(userId, betAmount, 'mines', null, client);
        await saveGameInTransaction(client, userId, game);
        return balance;
      });
      socket.emit('balance:update', { balance: balanceAfter });

      socket.emit('mines:start_result', { success: true, totalCells: TOTAL_CELLS, gridCols: Math.sqrt(TOTAL_CELLS) });
      ack?.({ success: true, totalCells: TOTAL_CELLS, gridCols: Math.sqrt(TOTAL_CELLS) });
    } catch (err) {
      console.error('[mines:start]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to start mines game' });
    }
  });

  socket.on('mines:reveal', async (payload, ack) => {
    try {
      const { cellIndex } = payload || {};
      if (cellIndex === undefined || !isValidCellIndex(cellIndex)) {
        return ack?.({ error: `Cell must be 0-${TOTAL_CELLS - 1}` });
      }

      const result = await withMinesTransaction(userId, async (client) => {
        const game = await loadGameForUpdate(client, userId);
        if (!game || !game.active) throw new Error('No active game');
        if (game.openedCells.includes(cellIndex)) throw new Error('Cell already opened');

        if (isMine(game.minePositions, cellIndex)) {
          await client.query('DELETE FROM solo_mines_games WHERE user_id = $1', [userId]);
          return { isMine: true, gameOver: true };
        }

        const safeOpenedCount = game.safeOpenedCount + 1;
        const multiplier = calculateMultiplier(game.minesCount, safeOpenedCount);
        game.openedCells.push(cellIndex);
        game.safeOpenedCount = safeOpenedCount;
        game.multiplier = multiplier;

        if (safeOpenedCount >= TOTAL_CELLS - game.minesCount) {
          const win = Math.ceil(game.betAmount * multiplier * (1 - HOUSE_EDGE));
          const { balanceAfter } = await payout(userId, win, 'mines', null, client, 0);
          await client.query('DELETE FROM solo_mines_games WHERE user_id = $1', [userId]);
          return { isMine: false, gameOver: true, multiplier, payout: win, allSafe: true, balanceAfter };
        }

        await saveGameInTransaction(client, userId, game);
        return { isMine: false, multiplier, safeOpenedCount, gameOver: false };
      });
      if (result.balanceAfter !== undefined) socket.emit('balance:update', { balance: result.balanceAfter });
      ack?.(result);
    } catch (err) {
      console.error('[mines:reveal]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to reveal cell' });
    }
  });

  socket.on('mines:cashout', async (payload, ack) => {
    try {
      const result = await withMinesTransaction(userId, async (client) => {
        const game = await loadGameForUpdate(client, userId);
        if (!game || !game.active) throw new Error('No active game');
        if (game.safeOpenedCount === 0) throw new Error('Open at least one cell first');

        const payoutAmount = Math.ceil(game.betAmount * game.multiplier * (1 - HOUSE_EDGE));
        const { balanceAfter } = await payout(userId, payoutAmount, 'mines', null, client, 0);
        await client.query('DELETE FROM solo_mines_games WHERE user_id = $1', [userId]);
        return { balanceAfter, multiplier: game.multiplier, payout: payoutAmount, safeOpenedCount: game.safeOpenedCount };
      });
      const { balanceAfter, multiplier, payout: payoutAmount, safeOpenedCount } = result;
      socket.emit('balance:update', { balance: balanceAfter });

      socket.emit('mines:cashout_result', { success: true, multiplier, payout: payoutAmount, safeOpenedCount });
      ack?.({ success: true, multiplier, payout: payoutAmount, safeOpenedCount });
    } catch (err) {
      console.error('[mines:cashout]', err?.message || err);
      ack?.({ error: err?.message || 'Cashout failed' });
    }
  });

}
