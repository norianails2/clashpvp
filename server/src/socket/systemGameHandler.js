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

  socket.on('system:resume', async (_payload, ack) => {
    try {
      const client = await getClient();
      try {
        const { rows } = await client.query(
          'SELECT round_id, game_type, bet_amount FROM system_game_rooms WHERE user_id = $1',
          [user.id]
        );
        const room = rows[0];
        ack?.(room ? { active: true, roundId: room.round_id, gameType: room.game_type, betAmount: Number(room.bet_amount) } : { active: false });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[system:resume]', err?.message || err);
      ack?.({ error: 'Failed to resume system room' });
    }
  });

  socket.on('system:create_room', async (payload, ack) => {
    const gameType = payload?.gameType;
    const betAmount = payload?.betAmount;
    try {
      if (!['rps', 'dice', 'coin'].includes(gameType)) return ack?.({ error: 'Unsupported system game' });
      if (!Number.isSafeInteger(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
        return ack?.({ error: `Bet must be between ${MIN_BET} and ${MAX_BET}` });
      }

      const client = await getClient();
      let held;
      const roundId = crypto.randomUUID();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT round_id FROM system_game_rooms WHERE user_id = $1 FOR UPDATE', [user.id]);
        if (existing.rows.length) throw new Error('Finish your current system game first');
        held = await holdBet(user.id, betAmount, gameType, roundId, client);
        await client.query(
          `INSERT INTO system_game_rooms (user_id, round_id, game_type, bet_amount)
           VALUES ($1, $2, $3, $4)`,
          [user.id, roundId, gameType, betAmount]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      socket.emit('balance:update', { balance: held.balanceAfter });
      ack?.({ roundId, gameType, betAmount, balance: held.balanceAfter });
    } catch (err) {
      console.error('[system:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create system room' });
    }
  });

  socket.on('system:play', async (payload, ack) => {
    try {
      const client = await getClient();
      let outcome;
      let room;
      let balanceAfter;
      let payoutAmount = 0;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT * FROM system_game_rooms WHERE user_id = $1 FOR UPDATE',
          [user.id]
        );
        room = rows[0];
        if (!room) throw new Error('Create a system room first');
        if (payload?.gameType !== room.game_type) throw new Error('Game type does not match the room');

        outcome = resolveSystemRound(room.game_type, payload?.choice);
        const betAmount = Number(room.bet_amount);
        if (outcome.draw) {
          const refunded = await refund(user.id, betAmount, room.game_type, room.round_id, client);
          payoutAmount = betAmount;
          balanceAfter = refunded.balanceAfter;
        } else if (outcome.won) {
          const paid = await payout(user.id, betAmount * 2, room.game_type, room.round_id, client, HOUSE_EDGE);
          payoutAmount = paid.netAmount;
          balanceAfter = paid.balanceAfter;
        } else {
          const current = await client.query('SELECT balance FROM users WHERE id = $1', [user.id]);
          balanceAfter = Number(current.rows[0].balance);
          await distributeLossCommissions(client, {
            lossKey: `system:${room.round_id}`,
            sourceUserId: user.id,
            lossAmount: betAmount,
            gameType: room.game_type,
          });
        }
        await client.query('DELETE FROM system_game_rooms WHERE user_id = $1', [user.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      socket.emit('balance:update', { balance: balanceAfter });
      ack?.({ gameType: room.game_type, betAmount: Number(room.bet_amount), payout: payoutAmount, balance: balanceAfter, ...outcome });
    } catch (err) {
      console.error('[system:play]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to play against system' });
    }
  });
}
