import http from 'http';
import { config } from './config.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { initBot, startBotPolling, stopBotPolling } from './services/telegramBot.js';
import { runMigrations } from './db/migrate.js';
import { query } from './db/pool.js';
import crashEngine from './games/crash.js';
import rouletteEngine from './games/rouletteEngine.js';

const INVOICE_EXPIRY_CHECK_MS = 60 * 60 * 1000;

async function expireStaleStarInvoices() {
  const result = await query(
    `UPDATE star_invoices
     SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at < NOW() - INTERVAL '24 hours'`
  );
  if (result.rowCount > 0) {
    console.log(`[payments] Expired ${result.rowCount} stale Star invoice(s)`);
  }
}

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  await runMigrations();
  await expireStaleStarInvoices();

  initSocket(server);
  const telegramBot = initBot(server);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);

    Promise.allSettled([
      stopBotPolling(),
      crashEngine.stopForShutdown(),
      rouletteEngine.stopForShutdown(),
    ])
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') console.warn('[server] Shutdown task failed:', result.reason?.message);
        }
      })
      .finally(() => server.close(() => process.exit(0)));

    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  // Keep Neon database alive (prevent cold starts on free tier)
  setInterval(() => { query('SELECT 1').catch(() => {}); }, 15000);

  const invoiceExpiryInterval = setInterval(() => {
    expireStaleStarInvoices().catch((err) => {
      console.error('[payments] Invoice expiry check failed:', err.message);
    });
  }, INVOICE_EXPIRY_CHECK_MS);
  invoiceExpiryInterval.unref();

  server.listen(config.port, () => {
    console.log(`[server] Starqc backend running on port ${config.port}`);
    console.log(`[server] Environment: ${config.nodeEnv}`);
    startBotPolling().catch((err) => {
      console.error('[telegramBot] initial polling start failed:', err.message);
    });
  });
}

main().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
