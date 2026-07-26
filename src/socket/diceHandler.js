import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { generateRoll, isValidPrediction, resolveDice, MIN_BET, MAX_BET } from '../games/dice.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerDiceHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('dice:create_room', async (payload, ack) => {
    try {
      const { betAmount, prediction } = payload || {};

      if (!betAmount || betAmount < MIN_BET) {
        return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      }
      if (betAmount > MAX_BET) {
        return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      }
      if (!prediction || !isValidPrediction(prediction)) {
        return ack?.({ error: 'Invalid prediction. Use: over, under, exact' });
      }

      const room = await createRoom(user.id, 'dice', betAmount, {
        creatorPrediction: prediction,
      });

      socket.join(`room:${room.id}`);

      ack?.({ roomId: room.id });

      broadcastLobbyUpdate(io, 'dice');
    } catch (err) {
      console.error('[dice:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create dice room' });
    }
  });

  socket.on('dice:join_room', async (payload, ack) => {
    try {
      const { roomId, prediction } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
      }
      if (!prediction || !isValidPrediction(prediction)) {
        return ack?.({ error: 'Invalid prediction. Use: over, under, exact' });
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const { rows: roomRows } = await client.query(
          `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`,
          [roomId]
        );

        if (roomRows.length === 0) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room not found' });
        }

        const room = roomRows[0];

        if (room.status !== 'WAITING') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not available' });
        }

        if (room.creator_id === user.id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Cannot join your own room' });
        }

        if (room.game_type !== 'dice') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not a dice game' });
        }

        const creatorPrediction = room.game_data?.creatorPrediction;
        if (!creatorPrediction) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is missing creator prediction' });
        }

        if (prediction === creatorPrediction) {
          await client.query('ROLLBACK');
          return ack?.({ error: `Cannot pick the same prediction as opponent (${creatorPrediction}). Choose: ${['over', 'under', 'exact'].filter(p => p !== creatorPrediction).join(', ')}` });
        }

        await holdBet(user.id, room.bet_amount, 'dice', room.id, client);

        const { dice, total } = generateRoll();

        const gameData = {
          creatorPrediction,
          opponentPrediction: prediction,
          dice,
          total,
        };

        await client.query(
          `UPDATE rooms
           SET status = 'IN_PROGRESS',
               opponent_id = $1,
               game_data = $2::jsonb
           WHERE id = $3`,
          [user.id, JSON.stringify(gameData), room.id]
        );

        const { winnerId, draw } = resolveDice(
          total,
          creatorPrediction,
          prediction,
          room.creator_id,
          user.id
        );

        let payouts = {};
        if (draw) {
          await refund(room.creator_id, room.bet_amount, 'dice', room.id, client);
          await refund(user.id, room.bet_amount, 'dice', room.id, client);
          payouts = {
            [room.creator_id]: room.bet_amount,
            [user.id]: room.bet_amount,
          };
        } else {
          const pot = room.bet_amount * 2;
          await payout(winnerId, pot, 'dice', room.id, client, HOUSE_EDGE);
          payouts = { [winnerId]: pot };
        }

        gameData.winnerId = winnerId;
        gameData.draw = draw;
        gameData.payouts = payouts;

        await client.query(
          `UPDATE rooms
           SET status = 'FINISHED',
               winner_id = $1,
               game_data = $2::jsonb
           WHERE id = $3`,
          [winnerId, JSON.stringify(gameData), room.id]
        );

        await client.query('COMMIT');

        socket.join(`room:${room.id}`);

        const resultPayload = {
          roomId: room.id,
          roll: dice,
          total,
          winnerId,
          draw,
          payouts,
        };

        io.to(`room:${room.id}`).emit('dice:result', resultPayload);

        ack?.(resultPayload);

        broadcastLobbyUpdate(io, 'dice');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[dice:join_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to join dice room' });
    }
  });
}
