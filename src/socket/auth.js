import crypto from 'crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';

/**
 * Verifies Telegram WebApp initData and looks up / creates the user.
 * Attaches `user` (id, telegram_id, username, balance) to socket.data.
 */
export async function verifyConnection(socket, next) {
  try {
    const raw = socket.handshake.query?.initData;

    // Dev bypass — allow test users when no initData
    if (!raw) {
      const testUser = socket.handshake.query?.testUser;
      const telegramId = testUser || 'dev_user_1';
      const { rows } = await query(
        `INSERT INTO users (telegram_id, username)
         VALUES ($1, $2)
         ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username
         RETURNING id, telegram_id, username, balance`,
        [telegramId, telegramId]
      );
      socket.data.user = rows[0];
      return next();
    }

    if (!raw) return next(new Error('Missing initData'));

    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash) return next(new Error('Missing hash in initData'));

    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(config.telegram.botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return next(new Error('Invalid initData signature'));
    }

    const userJson = params.get('user');
    if (!userJson) return next(new Error('Missing user in initData'));

    const tgUser = JSON.parse(userJson);
    const telegramId = String(tgUser.id);

    // Upsert user
    const { rows } = await query(
      `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username   = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
         first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
         last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''), users.last_name),
         photo_url  = COALESCE(NULLIF(EXCLUDED.photo_url, ''), users.photo_url)
       RETURNING id, telegram_id, username, balance`,
      [telegramId, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.photo_url || null]
    );

    socket.data.user = rows[0];
    next();
  } catch (err) {
    console.error('[socket:auth]', err);
    next(new Error('Authentication failed'));
  }
}
