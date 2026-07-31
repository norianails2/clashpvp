import { query } from '../db/pool.js';

const LOBBY_ROOMS_LIMIT = 50;

export function registerLobbyHandlers(io, socket) {
  socket.on('lobby:list', async (payload, ack) => {
    try {
      const gameType = payload?.gameType;
      if (!gameType) return ack?.({ error: 'Missing gameType' });

      const { rows } = await query(
        `SELECT r.id, r.game_type, r.bet_amount AS bet, r.creator_id, r.opponent_id,
                u.username AS creator_name, u.photo_url AS creator_photo,
                r.created_at
         FROM rooms r
         LEFT JOIN users u ON u.id = r.creator_id
         WHERE r.game_type = $1 AND r.status = 'WAITING'
         ORDER BY r.created_at ASC
         LIMIT $2`,
        [gameType, LOBBY_ROOMS_LIMIT]
      );

      ack?.({ rooms: rows });
    } catch (err) {
      console.error('[lobby:list]', err);
      ack?.({ error: 'Failed to fetch lobby' });
    }
  });

  socket.on('lobby:subscribe', (payload) => {
    const gameType = payload?.gameType;
    if (!gameType) return;
    socket.join(`lobby:${gameType}`);
  });

  socket.on('lobby:unsubscribe', (payload) => {
    const gameType = payload?.gameType;
    if (!gameType) return;
    socket.leave(`lobby:${gameType}`);
  });
}

export async function broadcastLobbyUpdate(io, gameType) {
  try {
    const { rows } = await query(
      `SELECT r.id, r.game_type, r.bet_amount AS bet, r.creator_id, r.opponent_id,
              u.username AS creator_name, u.photo_url AS creator_photo,
              r.created_at
       FROM rooms r
       LEFT JOIN users u ON u.id = r.creator_id
       WHERE r.game_type = $1 AND r.status = 'WAITING'
       ORDER BY r.created_at ASC
       LIMIT $2`,
      [gameType, LOBBY_ROOMS_LIMIT]
    );

    io.to(`lobby:${gameType}`).emit('lobby:update', { rooms: rows });
  } catch (err) {
    console.error('[broadcastLobbyUpdate]', err);
  }
}
