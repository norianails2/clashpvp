import assert from 'node:assert/strict';
import test from 'node:test';
import { holdBet, payout, refund } from '../src/services/balanceService.js';

function client(balance = 100) {
  const state = { balance, transactions: [] };
  return { state, async query(sql, params = []) {
    if (sql.includes('SELECT balance')) return { rows: [{ balance: state.balance }] };
    if (sql.startsWith('UPDATE users SET balance = $1')) { state.balance = params[0]; return { rows: [] }; }
    if (sql.includes('INSERT INTO transactions')) { state.transactions.push(params); return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  }};
}

test('hold, ceil payout, and refund preserve balance', async () => {
  const c = client(100);
  await holdBet('u', 11, 'mines', null, c);
  assert.equal(c.state.balance, 89);
  const win = await payout('u', 11, 'mines', null, c, 0.1);
  assert.equal(win.netAmount, 10);
  await refund('u', 1, 'mines', null, c);
  assert.equal(c.state.balance, 100);
});

test('hold rejects insufficient balance', async () => {
  await assert.rejects(() => holdBet('u', 101, 'mines', null, client(100)), /Insufficient balance/);
});
