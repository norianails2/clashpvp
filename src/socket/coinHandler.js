import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { generateFlip, isValidChoice, getOppositeSide, resolveCoin, SIDES, MIN_BET, MAX_BET } from '../games/coin.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerCoinHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('coin:create_room', async (payload, ack) => {
    try {
      const { betAmount, choice } = payload || {};

      if (!betAmount || betAmount < MIN_BET) {
        return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      }
      if (betAmount > MAX_BET) {
        return ack?.({ error: `Maximum bet is ${MAX_BET}` });
      }
      if (!choice || !isValidChoice(choice)) {
        return ack?.({ error: `Invalid choice. Use: heads or tails` });
      }

      const room = await createRoom(user.id, 'coin', betAmount, {
        creatorChoice: choice,
      });

      socket.join(`room:${room.id}`);

      ack?.({ roomId: room.id });

      broadcastLobbyUpdate(io, 'coin');
    } catch (err) {
      console.error('[coin:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create coin room' });
    }
  });

  socket.on('coin:join_room', async (payload, ack) => {
    try {
      const { roomId } = payload || {};

      if (!roomId) {
        return ack?.({ error: 'Room ID is required' });
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

        if (room.game_type !== 'coin') {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is not a coin game' });
        }

        const creatorChoice = room.game_data?.creatorChoice;
        if (!creatorChoice || !isValidChoice(creatorChoice)) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'Room is missing valid creator choice' });
        }

        const opponentChoice = getOppositeSide(creatorChoice);

        await holdBet(user.id, room.bet_amount, 'coin', room.id, client);

        const { side: winnerSide } = generateFlip();

        const gameData = {
          creatorChoice,
          opponentChoice,
          winnerSide,
        };

        await client.query(
          `UPDATE rooms
           SET status = 'IN_PROGRESS',
               opponent_id = $1,
               game_data = $2::jsonb
           WHERE id = $3`,
          [user.id, JSON.stringify(gameData), room.id]
        );

        const { winnerId } = resolveCoin(winnerSide, creatorChoice, room.creator_id, user.id);

        const pot = room.bet_amount * 2;
        await payout(winnerId, pot, 'coin', room.id, client, HOUSE_EDGE);

        gameData.winnerId = winnerId;

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
          winnerSide,
          winnerId,
          payout: pot,
        };

        io.to(`room:${room.id}`).emit('coin:result', resultPayload);

        ack?.(resultPayload);

        broadcastLobbyUpdate(io, 'coin');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[coin:join_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to join coin room' });
    }
  });
}
