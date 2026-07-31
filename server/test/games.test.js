import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateScore, resolveGame } from '../src/games/blackjack.js';
import { calculateMultiplier, TOTAL_CELLS } from '../src/games/mines.js';
import { ProvablyFairService } from '../src/services/provablyFairService.js';

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

test('Crash proof does not expose an unrevealed seed or crash point', () => {
  const service = new ProvablyFairService();
  service.rounds.set(7, {
    round: 7,
    serverSeedHash: 'hash',
    serverSeed: 'secret',
    clientSeed: 'client',
    nonce: 7,
    crashPoint: 12.34,
    revealed: false,
  });

  assert.deepEqual(service.getRoundInfo(7), {
    round: 7,
    serverSeedHash: 'hash',
    clientSeed: 'client',
    nonce: 7,
    revealed: false,
  });

  service.rounds.get(7).revealed = true;
  assert.equal(service.getRoundInfo(7).serverSeed, 'secret');
  assert.equal(service.getRoundInfo(7).crashPoint, 12.34);
});
