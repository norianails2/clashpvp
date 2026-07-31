import assert from 'node:assert/strict';
import test from 'node:test';
import { io } from 'socket.io-client';

test('production rejects Socket.IO clients without Telegram initData', async () => {
  const result = await new Promise((resolve, reject) => {
    const socket = io('https://clashpvp.app', { transports: ['polling'], timeout: 10000, reconnection: false });
    socket.on('connect', () => { socket.close(); reject(new Error('Unauthenticated client connected')); });
    socket.on('connect_error', error => { socket.close(); resolve(error.message); });
  });
  assert.match(result, /Telegram initData/i);
});

test('production referral API rejects a caller-provided user ID', async () => {
  const response = await fetch('https://clashpvp.app/api/referral/stats', {
    headers: { 'x-user-id': 'attacker-controlled-id' },
  });
  assert.equal(response.status, 401);
});
