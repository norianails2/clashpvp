import crypto from 'crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies Telegram WebApp initData and looks up / creates the user.
 * Attaches `user` (id, telegram_id, username, balance) to socket.data.
 */
export async function verifyConnection(socket, next) {
  try {
    const raw = socket.handshake.query?.initData;
    // Dev bypass — allow test users when no initData
    if (!raw && config.isDev) {
      const testUser = socket.handshake.query?.testUser;
      const telegramId = testUser || 'dev_user_1';
      try {
        const { rows } = await query(
          `INSERT INTO users (telegram_id, username)
           VALUES ($1, $2)
           ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username
           RETURNING id, telegram_id, username, balance`,
          [telegramId, telegramId]
        );
        socket.data.user = rows[0];
        return next();
      } catch (dbErr) {
        console.error('[auth] DB error:', dbErr.message, dbErr.code, dbErr.stack?.slice(0, 300));
        return next(new Error('DB: ' + (dbErr.message || dbErr.code || 'unknown')));
      }
    }

    if (!raw) return next(new Error('Missing Telegram initData'));

    // Parse with URLSearchParams (matches Telegram's official algorithm)
    const sp = new URLSearchParams(raw);
    const hash = sp.get('hash');
    if (!hash) return next(new Error('Missing hash'));
    const authDate = Number(sp.get('auth_date'));
    const now = Date.now() / 1000;
    if (!Number.isInteger(authDate) || authDate > now + 300 || now - authDate > MAX_INIT_DATA_AGE_SECONDS) {
      return next(new Error('Expired Telegram initData'));
    }

    sp.delete('hash');

    const dataCheckString = Array.from(sp.entries())
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

    if (hash.length !== computedHash.length || !crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash))) {
      return next(new Error('Invalid initData signature'));
    }

    const userJson = sp.get('user');
    if (!userJson) return next(new Error('Missing user'));

    let tgUser;
    try {
      tgUser = JSON.parse(userJson);
    } catch (e) {
      console.error('[auth] JSON parse error:', e.message, userJson.slice(0, 100));
      return next(new Error('Invalid user JSON in initData'));
    }
    const telegramId = String(tgUser.id);

    // Upsert user
    let rows;
    try {
      const result = await query(
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
      rows = result.rows;
    } catch (dbErr) {
      console.error('[auth] User upsert DB error:', dbErr.message, dbErr.code);
      return next(new Error('DB upsert: ' + (dbErr.message || dbErr.code)));
    }

    socket.data.user = rows[0];
    next();
  } catch (err) {
    console.error('[socket:auth] FULL ERROR:', err.message, err.stack?.slice(0, 500));
    next(new Error('Auth: ' + (err.message || 'unknown')));
  }
}
