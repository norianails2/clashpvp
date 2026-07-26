import http from 'http';
import { config } from './config.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { initBot } from './services/telegramBot.js';
import { runMigrations } from './db/migrate.js';

async function main() {
  process.stdout.write('[boot] starting...\n');
  try { {
  const app = createApp();
  const server = http.createServer(app);

  // Run migrations on startup
  try {
    await runMigrations();
  } catch (err) {
    console.warn('[server] Migration skipped:', err.message);
  }

  initSocket(server);
  initBot(server);

  server.listen(config.port, () => {
    console.log(`[server] Clash PVP backend running on port ${config.port}`);
    console.log(`[server] Environment: ${config.nodeEnv}`);
  });
}

} catch(e) { process.stdout.write('[boot] ERROR: '+e.message+'\n'); throw e; }
main().catch((err) => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
