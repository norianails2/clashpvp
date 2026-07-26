import crashEngine from '../games/crash.js';
import provablyFair from '../services/provablyFairService.js';
import { broadcastLobbyUpdate } from './lobbyHandler.js';

export function registerCrashHandlers(io, socket) {
  const { user } = socket.data;

  // Join crash game room
  socket.on('crash:join', () => {
    socket.join('game:crash');
    socket.emit('crash:state', crashEngine.getState());
    socket.emit('crash:history', { history: crashEngine.history.slice(0, 20) });
  });

  socket.on('crash:leave', () => {
    socket.leave('game:crash');
  });

  socket.on('crash:bet', async (payload, ack) => {
    try {
      const { amount, autoCashoutAt } = payload || {};
      if (!amount || amount < 1) return ack?.({ error: 'Minimum bet is 1' });

      const result = await crashEngine.placeBet(
        user.id,
        user.username || 'Player',
        amount,
        autoCashoutAt || null
      );

      ack?.(result);
    } catch (err) {
      console.error('[crash:bet]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to place bet' });
    }
  });

  socket.on('crash:cashout', async (payload, ack) => {
    try {
      const multiplier = payload?.multiplier || undefined;
      const result = await crashEngine.cashout(user.id, multiplier);
      ack?.(result);
    } catch (err) {
      console.error('[crash:cashout]', err?.message || err);
      ack?.({ error: err?.message || 'Failed to cashout' });
    }
  });

  socket.on('crash:get_state', (_payload, ack) => {
    ack?.(crashEngine.getState());
  });

  socket.on('crash:get_round_seed', (payload, ack) => {
    const roundNum = payload?.round || crashEngine.round;
    const info = provablyFair.getRoundInfo(roundNum);
    ack?.(info || { error: 'Round not found' });
  });
}

// Start the crash engine when the server starts
export async function startCrashEngine() {
  await provablyFair.refillSeeds();
  // Sync round counter with provablyFair (survives server restarts)
  crashEngine.round = provablyFair.currentRound;
  setTimeout(() => crashEngine.startBetting(), 1000);
}
