import http from 'http';
import { config } from './config.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { initBot } from './services/telegramBot.js';
import { runMigrations } from './db/migrate.js';
import { query } from './db/pool.js';

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  try {
    await runMigrations();
  } catch (err) {
    console.warn('[server] Migration skipped:', err.message);
  }

  initSocket(server);
  initBot(server);

  // Keep Neon database alive (prevent cold starts on free tier)
  setInterval(() => { query('SELECT 1').catch(() => {}); }, 60000);

  server.listen(config.port, () => {
    console.log(`[server] Clash PVP backend running on port ${config.port}`);
    console.log(`[server] Environment: ${config.nodeEnv}`);
  });
}

main().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
