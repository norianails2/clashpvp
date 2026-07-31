import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateScore, resolveGame } from '../src/games/blackjack.js';
import { calculateMultiplier, TOTAL_CELLS } from '../src/games/mines.js';

test('blackjack scores aces correctly', () => {
  assert.equal(calculateScore(['Ah', '9d']), 20);
  assert.equal(calculateScore(['Ah', '9d', '5s']), 15);
});

test('blackjack resolves bust and draw', () => {
  assert.equal(resolveGame(22, 'bust', 18, 'stood', 'a', 'b').winnerId, 'b');
  assert.equal(resolveGame(18, 'stood', 18, 'stood', 'a', 'b').draw, true);
});

test('mines multiplier increases with safe cells', () => {
  assert.ok(calculateMultiplier(3, 2) > calculateMultiplier(3, 1));
  assert.equal(TOTAL_CELLS, 25);
});
