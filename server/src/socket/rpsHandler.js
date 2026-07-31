import { getRoomById, setGameMove, finishGame } from '../services/roomService.js';
import { getClient } from '../db/pool.js';
import { holdBet } from '../services/balanceService.js';
import { query } from '../db/pool.js';
import { createRoom } from '../services/roomService.js';
import { isValidMove, resolve } from '../games/rps.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerRPSHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('rps:create_room', async (payload, ack) => {
    try {
      const { betAmount } = payload || {};
      if (!betAmount || betAmount < 1) return ack?.({ error: 'Minimum bet is 1' });

      const room = await createRoom(user.id, 'rps', betAmount);

      socket.join(`room:${room.id}`);

      ack?.({ roomId: room.id });

      broadcastLobbyUpdate(io, 'rps');
    } catch (err) {
      console.error('[rps:create_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to create room' });
    }
  });

  socket.on('rps:join_room', async (payload, ack) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) return ack?.({ error: 'Room ID is required' });

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const { rows: roomRows } = await client.query(
          `SELECT * FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]
        );

        if (roomRows.length === 0) { await client.query('ROLLBACK'); return ack?.({ error: 'Room not found' }); }

        const room = roomRows[0];
        if (room.status !== 'WAITING') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not available' }); }
        if (room.creator_id === user.id) { await client.query('ROLLBACK'); return ack?.({ error: 'Cannot join your own room' }); }
        if (room.game_type !== 'rps') { await client.query('ROLLBACK'); return ack?.({ error: 'Room is not RPS' }); }

        await holdBet(user.id, room.bet_amount, 'rps', room.id, client);

        await client.query(
          `UPDATE rooms SET status = 'IN_PROGRESS', opponent_id = $1 WHERE id = $2`,
          [user.id, room.id]
        );

        await client.query('COMMIT');

        socket.join(`room:${room.id}`);

        io.to(`room:${room.id}`).emit('rps:game_started', { roomId: room.id, creatorId: room.creator_id });

        ack?.({ roomId: room.id });

        broadcastLobbyUpdate(io, 'rps');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[rps:join_room]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to join room' });
    }
  });

  socket.on('rps:make_move', async (payload, ack) => {
    try {
      const { roomId, move } = payload || {};

      if (!roomId || !move) return ack?.({ error: 'Missing roomId or move' });
      if (!isValidMove(move)) return ack?.({ error: 'Invalid move. Use: rock, paper, scissors' });

      const room = await getRoomById(roomId);
      if (!room) return ack?.({ error: 'Room not found' });
      if (room.status !== 'IN_PROGRESS') return ack?.({ error: 'Game is not in progress' });

      const isCreator = room.creator_id === user.id;
      const isOpponent = room.opponent_id === user.id;
      if (!isCreator && !isOpponent) return ack?.({ error: 'You are not part of this room' });

      const { room: updatedRoom, moves, bothMoved } = await setGameMove(
        roomId, user.id, user.id, move
      );

      socket.to(`room:${roomId}`).emit('rps:player_moved', { userId: user.id });

      if (bothMoved) {
        const move1 = moves[room.creator_id];
        const move2 = room.opponent_id ? moves[room.opponent_id] : null;
        if (!move1 || !move2) return ack?.({ error: 'Missing player move data' });
        const { draw, winnerIndex } = resolve(move1, move2);

        let winnerId = null;
        if (!draw && winnerIndex !== null) {
          winnerId = winnerIndex === 0 ? room.creator_id : room.opponent_id;
        }

        const finished = await finishGame(roomId, winnerId, {
          moves: { [room.creator_id]: move1, [room.opponent_id]: move2 }, draw,
        }, draw);

        // Send updated balance to winner
        if (winnerId) {
          const { rows } = await query(`SELECT balance FROM users WHERE id = $1`, [winnerId]);
          if (rows.length > 0) {
            io.to(`user:${winnerId}`).emit('balance:update', { balance: Number(rows[0].balance) });
          }
        }

        io.to(`room:${roomId}`).emit('rps:game_over', {
          moves: { [room.creator_id]: move1, [room.opponent_id]: move2 },
          winnerId, draw,
          payouts: draw
            ? { type: 'refund', amount: room.bet_amount }
            : { type: 'win', winnerId, amount: Math.ceil(room.bet_amount * 2 * 0.90) },
        });

        broadcastLobbyUpdate(io, 'rps');
        return ack?.({ room: finished, gameOver: true });
      }

      ack?.({ room: updatedRoom, gameOver: false });
    } catch (err) {
      console.error('[rps:make_move]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to make move' });
    }
  });
}
