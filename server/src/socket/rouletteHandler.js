import { getClient } from '../db/pool.js';
import { holdBet, payout } from '../services/balanceService.js';
import { MAX_BET, MIN_BET, getMultiplier, isValidColor, spinRoulette } from '../games/roulette.js';

export function registerRouletteHandlers(_io, socket) {
  const userId = socket.data.user.id;

  socket.on('roulette:spin', async (payload, ack) => {
    const betAmount = payload?.betAmount;
    const color = payload?.color;
    if (!Number.isSafeInteger(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      return ack?.({ error: `Bet must be between ${MIN_BET} and ${MAX_BET}` });
    }
    if (!isValidColor(color)) return ack?.({ error: 'Invalid roulette color' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const result = spinRoulette();
      const won = result.color === color;
      const held = await holdBet(userId, betAmount, 'roulette', null, client);
      let balanceAfter = held.balanceAfter;
      let payoutAmount = 0;
      if (won) {
        payoutAmount = betAmount * getMultiplier(color);
        const payoutResult = await payout(userId, payoutAmount, 'roulette', null, client, 0);
        balanceAfter = payoutResult.balanceAfter;
      }
      await client.query('COMMIT');
      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ number: result.number, color: result.color, won, payout: payoutAmount, balance: balanceAfter });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[roulette:spin]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to spin roulette' });
    } finally {
      client.release();
    }
  });
}
