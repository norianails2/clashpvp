import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifyConnection } from './auth.js';

// Simple in-memory rate limiter for socket events
const socketRateLimits = new Map();
function checkRateLimit(socket, maxEvents = 30, windowMs = 10000) {
  const now = Date.now();
  let entry = socketRateLimits.get(socket.id);
  if (!entry) {
    entry = { count: 0, resetAt: now + windowMs };
    socketRateLimits.set(socket.id, entry);
  }
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  return entry.count <= maxEvents;
}
// Clean up rate limit entries on disconnect
setInterval(() => {
  for (const [id, entry] of socketRateLimits) {
    if (Date.now() > entry.resetAt) socketRateLimits.delete(id);
  }
}, 30000);
import { registerLobbyHandlers } from './lobbyHandler.js';
import { registerRoomHandlers } from './roomHandler.js';
import { registerRPSHandlers } from './rpsHandler.js';
import { registerDiceHandlers } from './diceHandler.js';
import { registerCoinHandlers } from './coinHandler.js';
import { registerMinesHandlers } from './minesHandler.js';
import { registerBlackjackHandlers } from './blackjackHandler.js';
import { registerCrashHandlers, startCrashEngine } from './crashHandler.js';
import { query } from '../db/pool.js';
import crashEngine from '../games/crash.js';
import { getBot } from '../services/telegramBot.js';

let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  crashEngine.setIO(io);

  io.use(verifyConnection);

  io.on('connection', (socket) => {
    const { user } = socket.data;

    if (!config.isDev && !checkRateLimit(socket, 60, 10000)) {
      socket.emit('error', { message: 'Rate limited' });
      socket.disconnect();
      return;
    }

    socket.join(`user:${user.id}`);

    // Send user info to client
    socket.emit('user:info', {
      id: user.id,
      telegramId: user.telegram_id,
      username: user.username,
      balance: Number(user.balance),
    });

    // Wrap event handlers with rate limiting
    const originalOn = socket.on;
    socket.on = function(event, handler) {
      if (event === 'disconnect') return originalOn.call(this, event, handler);
      return originalOn.call(this, event, function(...args) {
        if (!config.isDev && !checkRateLimit(socket, 30, 10000)) {
          socket.emit('error', { message: 'Too many requests' });
          if (args[args.length - 1] && typeof args[args.length - 1] === 'function') {
            args[args.length - 1]({ error: 'Rate limited' });
          }
          return;
        }
        try {
          const result = handler.apply(this, args);
          if (result && typeof result.catch === 'function') {
            result.catch(err => {
              console.error(`[socket] ${event} error:`, err);
              const ack = args[args.length - 1];
              if (typeof ack === 'function') ack({ error: err.message });
            });
          }
        } catch (err) {
          console.error(`[socket] ${event} error:`, err);
          const ack = args[args.length - 1];
          if (typeof ack === 'function') ack({ error: err.message });
        }
      });
    };

    registerLobbyHandlers(io, socket);
    registerRoomHandlers(io, socket);
    registerRPSHandlers(io, socket);
    registerDiceHandlers(io, socket);
    registerCoinHandlers(io, socket);
    registerMinesHandlers(io, socket);
    registerBlackjackHandlers(io, socket);
    registerCrashHandlers(io, socket);

    // Add balance (dev & test)
    socket.on('balance:add', async (payload, ack) => {
      const amount = payload?.amount || 1000;
      try {
        const { rows } = await query(
          `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
          [amount, user.id]
        );
        const balance = Number(rows[0].balance);
        socket.emit('balance:update', { balance });
        ack?.({ balance });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    // Dev: get balance
    socket.on('balance:get', async (_payload, ack) => {
      try {
        const { rows } = await query(`SELECT balance FROM users WHERE id = $1`, [user.id]);
        ack?.({ balance: Number(rows[0].balance) });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    // Stars purchase (from Telegram.WebApp.purchaseStars or dev simulation)
    socket.on('stars:purchase', async (payload, ack) => {
      const amount = payload?.amount || 0;
      if (amount <= 0 || !Number.isInteger(amount)) {
        return ack?.({ error: 'Invalid amount' });
      }
      try {
        const { rows } = await query(
          `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
          [amount, user.id]
        );
        const balance = Number(rows[0].balance);
        await query(
          `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'deposit', $2, $3, $4, $5)`,
          [user.id, amount, balance - amount, balance,
           JSON.stringify({ method: payload.method || 'websocket' })]
        );
        socket.emit('balance:update', { balance });
        ack?.({ balance });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    // Create Telegram Stars invoice (sends invoice to user's chat via bot)
    socket.on('stars:create_invoice', async (payload, ack) => {
      const amount = payload?.amount || 0;
      if (amount <= 0 || !Number.isInteger(amount)) {
        return ack?.({ error: 'Invalid amount' });
      }
      const bot = getBot();
      if (!bot) {
        return ack?.({ error: 'Bot not available' });
      }
      const telegramId = user.telegram_id;
      if (!telegramId) {
        return ack?.({ error: 'Telegram ID not found' });
      }
      try {
        await bot.sendInvoice(
          Number(telegramId),
          `Clash PVP — ${amount} ⭐ Stars`,
          `Пополнение игрового баланса на ${amount} Stars`,
          JSON.stringify({ amount, userId: user.id }),
          '',
          'stars_topup',
          'XTR',
          JSON.stringify([ { label: `${amount} ⭐ Stars`, amount } ])
        );
        ack?.({ success: true });
      } catch (err) {
        console.error('[stars:create_invoice]', err.message);
        ack?.({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] ${user.username || user.id} disconnected`);
    });
  });

  // Start crash engine
  startCrashEngine().catch(err => console.error('[crash] engine start error:', err.message));

  console.log('[socket] Initialized');
  return io;
}

export function getIO() {
  return io;
}
