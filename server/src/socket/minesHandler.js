import { holdBet, payout, HOUSE_EDGE } from '../services/balanceService.js';
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

const soloGames = new Map();

export function registerMinesHandlers(io, socket) {
  const { user } = socket.data;
  const userId = user.id;

  socket.on('mines:start', async (payload, ack) => {
    try {
      const { betAmount, minesCount } = payload || {};
      if (!betAmount || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      const count = minesCount ?? 3;
      if (!isValidMinesCount(count)) return ack?.({ error: `Mines count must be between ${MIN_MINES} and ${MAX_MINES}` });

      if (soloGames.has(userId)) {
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
      soloGames.set(userId, game);

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

      const game = soloGames.get(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.openedCells.includes(cellIndex)) return ack?.({ error: 'Cell already opened' });

      if (isMine(game.minePositions, cellIndex)) {
        game.active = false;
        game.openedCells.push(cellIndex);
        soloGames.delete(userId);
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
        soloGames.delete(userId);
        socket.emit('balance:update', { balance: balanceAfter });
        return ack?.({ isMine: false, gameOver: true, multiplier: mult, payout: win, allSafe: true });
      }

      ack?.({ isMine: false, multiplier: mult, safeOpenedCount: newSafe, gameOver: false });
    } catch (err) {
      console.error('[mines:reveal]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to reveal cell' });
    }
  });

  socket.on('mines:cashout', async (payload, ack) => {
    try {
      const game = soloGames.get(userId);
      if (!game || !game.active) return ack?.({ error: 'No active game' });
      if (game.safeOpenedCount === 0) return ack?.({ error: 'Open at least one cell first' });

      const win = Math.ceil(game.betAmount * game.multiplier * (1 - HOUSE_EDGE));
      const { balanceAfter } = await payout(userId, win, 'mines', null, null, 0);
      game.active = false;
      soloGames.delete(userId);
      socket.emit('balance:update', { balance: balanceAfter });

      socket.emit('mines:cashout_result', { success: true, multiplier: game.multiplier, payout: win, safeOpenedCount: game.safeOpenedCount });
      ack?.({ success: true, multiplier: game.multiplier, payout: win, safeOpenedCount: game.safeOpenedCount });
    } catch (err) {
      console.error('[mines:cashout]', err?.message || err);
      ack?.({ error: err?.message || 'Cashout failed' });
    }
  });

  socket.on('disconnect', () => {
    // Keep game alive for reconnection
  });
}
