import { getClient } from '../db/pool.js';
import { holdBet, payout, refund, HOUSE_EDGE } from '../services/balanceService.js';
import { createRoom } from '../services/roomService.js';
import { isValidChoice, resolveCoin, SIDES, MIN_BET, MAX_BET } from '../games/coin.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerCoinHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('coin:create_room', async (payload, ack) => {
    try {
      const { betAmount } = payload || {};
      if (!betAmount || betAmount < MIN_BET) return ack?.({ error: `Minimum bet is ${MIN_BET}` });
      if (betAmount > MAX_BET) return ack?.({ error: `Maximum bet is ${MAX_BET}` });

      const room = await createRoom(user.id, 'coin', betAmount);
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
      if (!roomId) return ack?.({ error: 'Room ID is required' });

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const { rows: roomRows } = await client.query(`SELECT * FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
        if (roomRows.length === 0) { await client.query('ROLLBACK'); return ack?.({ error: 'Room not found' }); }
        const room = roomRows[0];
        if (room.status !== 'WAITING') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not available' }); }
        if (room.creator_id === user.id) { await client.query('ROLLBACK'); return ack?.({ error: 'Cannot join your own room' }); }
        if (room.game_type !== 'coin') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not coin' }); }

        await holdBet(user.id, room.bet_amount, 'coin', room.id, client);

        const gameData = { picks: {}, currentTurn: room.creator_id };
        await client.query(
          `UPDATE rooms SET status = 'IN_PROGRESS', opponent_id = $1, game_data = $2::jsonb WHERE id = $3`,
          [user.id, JSON.stringify(gameData), room.id]
        );
        await client.query('COMMIT');
        socket.join(`room:${room.id}`);
        ack?.({ roomId: room.id, currentTurn: room.creator_id });
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

  socket.on('coin:pick', async (payload, ack) => {
    try {
      const { roomId, choice } = payload || {};
      if (!roomId || choice === undefined) return ack?.({ error: 'Room ID and choice required' });
      if (!isValidChoice(choice)) return ack?.({ error: 'Invalid choice. Use: heads (0) or tails (1)' });

      const client = await getClient();
      try {
        await client.query('BEGIN');
        const { rows: roomRows } = await client.query(`SELECT * FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
        if (roomRows.length === 0) { await client.query('ROLLBACK'); return ack?.({ error: 'Room not found' }); }
        const room = roomRows[0];
        if (room.status !== 'IN_PROGRESS') { await client.query('ROLLBACK'); return ack?.({ error: 'Game not in progress' }); }

        const gd = room.game_data || {};
        if (gd.picks?.[user.id] !== undefined) { await client.query('ROLLBACK'); return ack?.({ error: 'Already picked' }); }

        const newPicks = { ...(gd.picks || {}), [user.id]: choice };
        const pickedCount = Object.keys(newPicks).length;

        if (pickedCount === 2) {
          const crypto = await import('crypto');
          const flip = crypto.randomInt(0, 2); // 0=heads, 1=tails
          const winnerSide = flip === 0 ? 'heads' : 'tails';
          const creatorPick = newPicks[room.creator_id]; // 'heads' or 'tails'
          const { winnerId } = resolveCoin(winnerSide, creatorPick, room.creator_id, room.opponent_id);
          const pot = room.bet_amount * 2;

          await payout(winnerId, pot, 'coin', room.id, client, HOUSE_EDGE);

          const finalData = { ...gd, picks: newPicks, flip, winnerId };
          await client.query(
            `UPDATE rooms SET status = 'FINISHED', winner_id = $1, game_data = $2::jsonb WHERE id = $3`,
            [winnerId, JSON.stringify(finalData), room.id]
          );
          await client.query('COMMIT');

          io.to(`room:${room.id}`).emit('coin:result', {
            roomId, picks: newPicks, flip, winnerId,
            payout: Math.floor(pot * (1 - HOUSE_EDGE)),
          });
          broadcastLobbyUpdate(io, 'coin');
          return ack?.({ flip, winnerId, gameOver: true });
        }

        const updatedData = { ...gd, picks: newPicks };
        await client.query(
          `UPDATE rooms SET game_data = $1::jsonb WHERE id = $2`,
          [JSON.stringify(updatedData), room.id]
        );
        await client.query('COMMIT');

        ack?.({ gameOver: false });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[coin:pick]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to pick' });
    }
  });
}
