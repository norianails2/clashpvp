import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateScore, resolveGame } from '../src/games/blackjack.js';
import { calculateMultiplier, TOTAL_CELLS } from '../src/games/mines.js';
import { ProvablyFairService } from '../src/services/provablyFairService.js';
import { resolveDice } from '../src/games/dice.js';
import { resolveCoin } from '../src/games/coin.js';
import { resolve as resolveRps } from '../src/games/rps.js';
import { getMultiplier, isValidColor, spinRoulette } from '../src/games/roulette.js';
import { isValidAutoCashoutAt } from '../src/socket/crashHandler.js';
import { generateReferralLink } from '../src/services/referralService.js';

test('blackjack scores aces correctly', () => {
  assert.equal(calculateScore(['Ah', '9d']), 20);
  assert.equal(calculateScore(['Ah', '9d', '5s']), 15);
});

test('blackjack resolves bust and draw', () => {
  assert.equal(resolveGame(22, 'bust', 18, 'stood', 'a', 'b').winnerId, 'b');
  assert.equal(resolveGame(18, 'stood', 18, 'stood', 'a', 'b').draw, true);
});

test('referral links open the bot main mini app with startapp payload', () => {
  assert.equal(
    generateReferralLink('11111111-1111-4111-8111-111111111111', 'ClashPVPbot'),
    'https://t.me/ClashPVPbot?startapp=ref_11111111-1111-4111-8111-111111111111'
  );
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

test('Crash accepts a manual bet without an auto cashout target', () => {
  assert.equal(isValidAutoCashoutAt(null), true);
  assert.equal(isValidAutoCashoutAt(undefined), true);
  assert.equal(isValidAutoCashoutAt(2), true);
  assert.equal(isValidAutoCashoutAt(0), false);
});

test('dice resolves higher roll and ties correctly', () => {
  assert.equal(resolveDice(6, 2, 'a', 'b').winnerId, 'a');
  assert.equal(resolveDice(1, 5, 'a', 'b').winnerId, 'b');
  assert.equal(resolveDice(4, 4, 'a', 'b').draw, true);
});

test('coin resolves opposing choices and protects against matching picks', () => {
  assert.equal(resolveCoin('heads', 'heads', 'tails', 'a', 'b').winnerId, 'a');
  assert.equal(resolveCoin('tails', 'heads', 'tails', 'a', 'b').winnerId, 'b');
  assert.equal(resolveCoin('heads', 'heads', 'heads', 'a', 'b').draw, true);
});

test('RPS resolves every winning pair and a draw', () => {
  assert.equal(resolveRps('rock', 'scissors').winnerIndex, 0);
  assert.equal(resolveRps('paper', 'rock').winnerIndex, 0);
  assert.equal(resolveRps('scissors', 'paper').winnerIndex, 0);
  assert.equal(resolveRps('rock', 'paper').winnerIndex, 1);
  assert.equal(resolveRps('rock', 'rock').draw, true);
});

test('roulette accepts only board colors and keeps correct payouts', () => {
  assert.equal(isValidColor('red'), true);
  assert.equal(isValidColor('black'), true);
  assert.equal(isValidColor('green'), true);
  assert.equal(isValidColor('blue'), false);
  assert.equal(getMultiplier('red'), 2);
  assert.equal(getMultiplier('black'), 2);
  assert.equal(getMultiplier('green'), 14);
  const spin = spinRoulette();
  assert.ok(Number.isInteger(spin.number) && spin.number >= 0 && spin.number < 15);
  assert.ok(isValidColor(spin.color));
});

test('roulette seed result is deterministic and stays on the board', () => {
  const first = spinRoulette('server-seed', 'client-seed', 42);
  assert.deepEqual(spinRoulette('server-seed', 'client-seed', 42), first);
  assert.ok(first.number >= 0 && first.number < 15);
  assert.ok(isValidColor(first.color));
});
