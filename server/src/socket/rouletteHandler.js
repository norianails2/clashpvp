import rouletteEngine from '../games/rouletteEngine.js';

export function registerRouletteHandlers(_io, socket) {
  const userId = socket.data.user.id;

  socket.on('roulette:join', () => {
    socket.join('game:roulette');
    socket.emit('roulette:state', rouletteEngine.state());
  });
  socket.on('roulette:leave', () => socket.leave('game:roulette'));
  socket.on('roulette:bet', async (payload, ack) => {
    const result = await rouletteEngine.placeBet(userId, socket.data.user.username || 'Player', socket.data.user.photo_url || null, payload?.betAmount, payload?.color);
    ack?.(result);
  });
  socket.on('roulette:cancel_bet', async (payload, ack) => {
    const result = await rouletteEngine.cancelBet(userId, payload?.color);
    ack?.(result);
  });
}
