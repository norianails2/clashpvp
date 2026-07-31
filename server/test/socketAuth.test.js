import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { config } from '../src/config.js';
import { verifyConnection } from '../src/socket/auth.js';

function signedInitData(authDate) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'test-query',
    user: JSON.stringify({ id: 1, first_name: 'Test' }),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}

test('socket authentication rejects expired Telegram initData before database access', async () => {
  const socket = { handshake: { query: { initData: signedInitData(Math.floor(Date.now() / 1000) - 86_401) } }, data: {} };
  const error = await new Promise(resolve => verifyConnection(socket, resolve));
  assert.match(error.message, /Expired Telegram initData/);
});
