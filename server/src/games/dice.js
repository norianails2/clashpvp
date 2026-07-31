import crypto from 'crypto';

const MIN_BET = 1;
const MAX_BET = 100000;

export function rollDie() {
  return crypto.randomInt(1, 7);
}

export function resolveDice(roll1, roll2, player1Id, player2Id) {
  if (roll1 > roll2) return { winnerId: player1Id, draw: false };
  if (roll2 > roll1) return { winnerId: player2Id, draw: false };
  return { winnerId: null, draw: true };
}

export { MIN_BET, MAX_BET };
