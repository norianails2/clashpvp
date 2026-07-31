import crypto from 'crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

export async function telegramRestAuth(req, res, next) {
  try {
    const raw = req.get('x-telegram-init-data');
    if (!raw) return res.status(401).json({ error: 'Telegram initData required' });

    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));
    if (!hash || !Number.isInteger(authDate) || authDate > Date.now() / 1000 + 300 || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
    const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const valid = hash.length === expected.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
    if (!valid) return res.status(401).json({ error: 'Invalid Telegram initData signature' });

    const telegramUser = JSON.parse(params.get('user') || '');
    const { rows } = await query('SELECT id FROM users WHERE telegram_id = $1', [String(telegramUser.id)]);
    if (!rows.length) return res.status(401).json({ error: 'Telegram user not found' });
    req.userId = rows[0].id;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid Telegram initData' });
  }
}
