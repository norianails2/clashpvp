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
import { registerSoloBlackjackHandlers } from './soloBlackjackHandler.js';
import { registerRouletteHandlers } from './rouletteHandler.js';
import { registerCrashHandlers, startCrashEngine } from './crashHandler.js';
import { registerWithdrawalHandlers } from './withdrawalHandler.js';
import { registerEngagementHandlers } from './engagementHandler.js';
import rouletteEngine from '../games/rouletteEngine.js';
import https from 'https';
import { randomUUID } from 'crypto';
import { query } from '../db/pool.js';
import crashEngine from '../games/crash.js';
import { getBot } from '../services/telegramBot.js';
import { cleanupExpiredRooms } from '../services/roomService.js';

let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    pingInterval: 3000,
    pingTimeout: 5000,
  });

  crashEngine.setIO(io);
  rouletteEngine.setIO(io);

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
    registerSoloBlackjackHandlers(io, socket);
    registerRouletteHandlers(io, socket);
    registerCrashHandlers(io, socket);
    registerWithdrawalHandlers(io, socket);
    registerEngagementHandlers(io, socket);

    // Add balance (dev & test)
    if (config.isDev) socket.on('balance:add', async (payload, ack) => {
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
      if (!config.isDev) return ack?.({ error: 'Direct balance credits are disabled' });
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

    // Create Telegram Stars invoice link (opens inside Mini App via openInvoice)
    socket.on('stars:create_invoice_link', async (payload, ack) => {
      const amount = payload?.amount || 0;
      if (!Number.isSafeInteger(amount) || amount < 1) {
        return ack?.({ error: 'Invalid amount' });
      }
      try {
        const invoiceId = randomUUID();
        await query(
          `INSERT INTO star_invoices (id, user_id, telegram_id, amount, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 minutes')`,
          [invoiceId, user.id, user.telegram_id, amount]
        );
        const botToken = config.telegram.botToken;
        const body = JSON.stringify({
          title: `Starqc — ${amount} Stars`,
          description: `Пополнение игрового баланса`,
          payload: JSON.stringify({ action: 'deposit', invoiceId }),
          currency: 'XTR',
          prices: JSON.stringify([{ label: 'Stars', amount }]),
        });
        const result = await new Promise((resolve, reject) => {
          const req = https.request(
            `https://api.telegram.org/bot${botToken}/createInvoiceLink`,
            { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, description: data }); } });
            }
          );
          req.on('error', reject);
          req.setTimeout(10_000, () => req.destroy(new Error('Telegram invoice request timed out')));
          req.write(body);
          req.end();
        });
        if (!result.ok) {
          throw new Error(result.description);
        }
        ack?.({ url: result.result });
      } catch (err) {
        console.error('[stars:create_invoice_link]', err.message);
        ack?.({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] ${user.username || user.id} disconnected`);
    });
  });

  // Start crash engine
  startCrashEngine().catch(err => console.error('[crash] engine start error:', err.message));
  rouletteEngine.start().catch(err => console.error('[roulette] engine start error:', err.message));

  const cleanupRooms = async () => {
    try {
      const refunds = await cleanupExpiredRooms();
      for (const refund of refunds) {
        io.to(`user:${refund.userId}`).emit('balance:update', { balance: refund.balance });
      }
    } catch (err) {
      console.error('[rooms] cleanup error:', err.message);
    }
  };
  cleanupRooms();
  setInterval(cleanupRooms, 60_000).unref();

  console.log('[socket] Initialized');
  return io;
}

export function getIO() {
  return io;
}
