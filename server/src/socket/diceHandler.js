import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { rollDie, resolveDice, MIN_BET, MAX_BET } from '../games/dice.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';
import { distributeLossCommissions } from '../services/referralCommissionService.js';

export function registerDiceHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('dice:create_room', async (payload, ack) => {
    try {
      const { betAmount } = payload || {};
      if (!betAmount || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });

      const room = await createRoom(user.id, 'dice', betAmount);
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
      const { roomId } = payload || {};
      if (!roomId) return ack?.({ error: 'Room ID is required' });

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const { rows: roomRows } = await client.query(`SELECT * FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
        if (roomRows.length === 0) { await client.query('ROLLBACK'); return ack?.({ error: 'Room not found' }); }
        const room = roomRows[0];
        if (room.status !== 'WAITING') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not available' }); }
        if (room.creator_id === user.id) { await client.query('ROLLBACK'); return ack?.({ error: 'Cannot join your own room' }); }
        if (room.game_type !== 'dice') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not dice' }); }

        await holdBet(user.id, room.bet_amount, 'dice', room.id, client);

        const gameData = {
          rolls: {},
          currentTurn: room.creator_id,
        };

        await client.query(
          `UPDATE rooms SET status = 'IN_PROGRESS', opponent_id = $1, game_data = $2::jsonb WHERE id = $3`,
          [user.id, JSON.stringify(gameData), room.id]
        );

        await client.query('COMMIT');
        socket.join(`room:${room.id}`);

        io.to(`room:${room.id}`).emit('dice:game_started', {
          roomId: room.id, currentTurn: room.creator_id,
        });

        ack?.({ roomId: room.id, currentTurn: room.creator_id });
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

  socket.on('dice:roll', async (payload, ack) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) return ack?.({ error: 'Room ID is required' });

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const { rows: roomRows } = await client.query(`SELECT * FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
        if (roomRows.length === 0) { await client.query('ROLLBACK'); return ack?.({ error: 'Room not found' }); }
        const room = roomRows[0];
        if (room.status !== 'IN_PROGRESS') { await client.query('ROLLBACK'); return ack?.({ error: 'Game not in progress' }); }
        if (user.id !== room.creator_id && user.id !== room.opponent_id) {
          await client.query('ROLLBACK');
          return ack?.({ error: 'You are not part of this room' });
        }

        const gd = room.game_data || {};
        if (gd.rolls?.[user.id]) { await client.query('ROLLBACK'); return ack?.({ error: 'Already rolled' }); }

        const roll = rollDie();
        const newRolls = { ...(gd.rolls || {}), [user.id]: roll };
        const rolledCount = Object.keys(newRolls).length;

        if (rolledCount === 2) {
          const creatorRoll = newRolls[room.creator_id];
          const opponentRoll = newRolls[room.opponent_id];
          const { winnerId, draw } = resolveDice(creatorRoll, opponentRoll, room.creator_id, room.opponent_id);
          const pot = room.bet_amount * 2;

          if (draw) {
            await refund(room.creator_id, room.bet_amount, 'dice', room.id, client);
            await refund(room.opponent_id, room.bet_amount, 'dice', room.id, client);
          } else {
            await payout(winnerId, pot, 'dice', room.id, client, HOUSE_EDGE);
            const loserId = winnerId === room.creator_id ? room.opponent_id : room.creator_id;
            await distributeLossCommissions(client, { lossKey: `room:${room.id}:${loserId}`, sourceUserId: loserId, lossAmount: Number(room.bet_amount), gameType: 'dice' });
          }

          const finalData = { ...gd, rolls: newRolls, winnerId, draw };
          await client.query(
            `UPDATE rooms SET status = 'FINISHED', winner_id = $1, game_data = $2::jsonb WHERE id = $3`,
            [winnerId, JSON.stringify(finalData), room.id]
          );
          await client.query('COMMIT');

          io.to(`room:${room.id}`).emit('dice:result', {
            roomId, rolls: newRolls, winnerId, draw,
            payout: draw ? room.bet_amount : Math.ceil(pot * (1 - HOUSE_EDGE)),
          });
          broadcastLobbyUpdate(io, 'dice');
          return ack?.({ roll, winnerId, draw, gameOver: true });
        }

        const updatedData = { ...gd, rolls: newRolls };
        await client.query(
          `UPDATE rooms SET game_data = $1::jsonb WHERE id = $2`,
          [JSON.stringify(updatedData), room.id]
        );
        await client.query('COMMIT');

        ack?.({ roll, gameOver: false });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[dice:roll]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to roll' });
    }
  });
}
