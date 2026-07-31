import { cancelRoom } from '../services/roomService.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerRoomHandlers(io, socket) {
  const { user } = socket.data;

  socket.on('room:cancel', async (payload, ack) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) return ack?.({ error: 'Room ID is required' });

      const room = await cancelRoom(user.id, roomId);
      ack?.({ success: true, room });

      broadcastLobbyUpdate(io, room.game_type);
    } catch (err) {
      console.error('[room:cancel]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to cancel room' });
    }
  });
}
