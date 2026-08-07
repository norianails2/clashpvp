import crypto from 'crypto';
import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { distributeLossCommissions } from '../services/referralCommissionService.js';
import { resolve as resolveRps, isValidMove, VALID_MOVES } from '../games/rps.js';
import { rollDie, MIN_BET, MAX_BET } from '../games/dice.js';
import { isValidChoice } from '../games/coin.js';

function resolveSystemRound(gameType, choice) {
  if (gameType === 'rps') {
    if (!isValidMove(choice)) throw new Error('Choose rock, paper, or scissors');
    const systemChoice = VALID_MOVES[crypto.randomInt(0, VALID_MOVES.length)];
    const { draw, winnerIndex } = resolveRps(choice, systemChoice);
    return { choice, systemChoice, draw, won: winnerIndex === 0 };
  }

  if (gameType === 'dice') {
    const playerRoll = rollDie();
    const systemRoll = rollDie();
    return { playerRoll, systemRoll, draw: playerRoll === systemRoll, won: playerRoll > systemRoll };
  }

  if (gameType === 'coin') {
    if (!isValidChoice(choice)) throw new Error('Choose heads or tails');
    const flip = crypto.randomInt(0, 2) === 0 ? 'heads' : 'tails';
    return { choice, flip, draw: false, won: choice === flip };
  }

  throw new Error('Unsupported system game');
}

export function registerSystemGameHandlers(_io, socket) {
  const { user } = socket.data;

  socket.on('system:play', async (payload, ack) => {
    const gameType = payload?.gameType;
    const betAmount = payload?.betAmount;
    const roundId = crypto.randomUUID();

    try {
      if (!['rps', 'dice', 'coin'].includes(gameType)) return ack?.({ error: 'Unsupported system game' });
      if (!Number.isSafeInteger(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
        return ack?.({ error: `Bet must be between ${MIN_BET} and ${MAX_BET}` });
      }

      const outcome = resolveSystemRound(gameType, payload?.choice);
      const client = await getClient();
      let balanceAfter;
      let payoutAmount = 0;
      try {
        await client.query('BEGIN');
        const held = await holdBet(user.id, betAmount, gameType, roundId, client);
        balanceAfter = held.balanceAfter;

        if (outcome.draw) {
          const refunded = await refund(user.id, betAmount, gameType, roundId, client);
          payoutAmount = betAmount;
          balanceAfter = refunded.balanceAfter;
        } else if (outcome.won) {
          const paid = await payout(user.id, betAmount * 2, gameType, roundId, client, HOUSE_EDGE);
          payoutAmount = paid.netAmount;
          balanceAfter = paid.balanceAfter;
        } else {
          await distributeLossCommissions(client, {
            lossKey: `system:${roundId}`,
            sourceUserId: user.id,
            lossAmount: betAmount,
            gameType,
          });
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ gameType, betAmount, payout: payoutAmount, balance: balanceAfter, ...outcome });
    } catch (err) {
      console.error('[system:play]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to play against system' });
    }
  });
}

