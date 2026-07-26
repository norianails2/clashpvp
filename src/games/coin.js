import crypto from 'crypto';

export const SIDES = ['heads', 'tails'];

const MIN_BET = 1;
const MAX_BET = 100000;

export function generateFlip() {
  return { side: crypto.randomInt(0, 2) === 0 ? 'heads' : 'tails' };
}

export function isValidChoice(choice) {
  return SIDES.includes(choice);
}

export function getOppositeSide(choice) {
  return choice === 'heads' ? 'tails' : 'heads';
}

export function resolveCoin(winnerSide, creatorChoice, creatorId, opponentId) {
  if (winnerSide === creatorChoice) {
    return { winnerId: creatorId };
  }
  return { winnerId: opponentId };
}

export { MIN_BET, MAX_BET };
