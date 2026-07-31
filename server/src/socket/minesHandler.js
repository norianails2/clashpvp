import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
import { query } from '../db/pool.js';
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

async function saveGame(userId, game) {
  await query(
    `INSERT INTO solo_mines_games (user_id, game_data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE SET game_data = EXCLUDED.game_data, updated_at = NOW()`,
    [userId, JSON.stringify(game)]
  );
}

async function deleteGame(userId) {
  await query('DELETE FROM solo_mines_games WHERE user_id = $1', [userId]);
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
      if (!betAmount || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      const count = minesCount ?? 3;
      if (!isValidMinesCount(count)) return ack?.({ error: `Mines count must be between ${MIN_MINES} and ${MAX_MINES}` });

      if (await loadGame(userId)) {
        return ack?.({ error: 'Finish the active mines game first' });
      }

      const { balanceAfter } = await holdBet(userId, betAmount, 'mines', null, null);
      socket.emit('balance:update', { balance: balanceAfter });

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
      await saveGame(userId, game);

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

      const game = await loadGame(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.openedCells.includes(cellIndex)) return ack?.({ error: 'Cell already opened' });

      if (isMine(game.minePositions, cellIndex)) {
        game.active = false;
        game.openedCells.push(cellIndex);
        await deleteGame(userId);
        return ack?.({ isMine: true, gameOver: true });
      }

      const newSafe = game.safeOpenedCount + 1;
      const mult = calculateMultiplier(game.minesCount, newSafe);
      game.openedCells.push(cellIndex);
      game.safeOpenedCount = newSafe;
      game.multiplier = mult;

      const totalSafe = TOTAL_CELLS - game.minesCount;
      if (newSafe >= totalSafe) {
        const win = Math.ceil(game.betAmount * mult * (1 - HOUSE_EDGE));
        const { balanceAfter } = await payout(userId, win, 'mines', null, null, 0);
        game.active = false;
        await deleteGame(userId);
        socket.emit('balance:update', { balance: balanceAfter });
        return ack?.({ isMine: false, gameOver: true, multiplier: mult, payout: win, allSafe: true });
      }

      await saveGame(userId, game);
      ack?.({ isMine: false, multiplier: mult, safeOpenedCount: newSafe, gameOver: false });
    } catch (err) {
      console.error('[mines:reveal]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to reveal cell' });
    }
  });

  socket.on('mines:cashout', async (payload, ack) => {
    try {
      const game = await loadGame(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.safeOpenedCount === 0) return ack?.({ error: 'Open at least one cell first' });

      const win = Math.ceil(game.betAmount * game.multiplier * (1 - HOUSE_EDGE));
      const { balanceAfter } = await payout(userId, win, 'mines', null, null, 0);
      game.active = false;
      await deleteGame(userId);
      socket.emit('balance:update', { balance: balanceAfter });

      socket.emit('mines:cashout_result', { success: true, multiplier: game.multiplier, payout: win, safeOpenedCount: game.safeOpenedCount });
      ack?.({ success: true, multiplier: game.multiplier, payout: win, safeOpenedCount: game.safeOpenedCount });
    } catch (err) {
      console.error('[mines:cashout]', err?.message || err);
      ack?.({ error: err?.message || 'Cashout failed' });
    }
  });

}
