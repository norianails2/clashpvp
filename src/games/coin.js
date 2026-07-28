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

export function resolveCoin(winnerSide, creatorChoice, opponentChoice, creatorId, opponentId) {
  const creatorMatch = winnerSide === creatorChoice;
  const opponentMatch = winnerSide === opponentChoice;

  if (creatorMatch && opponentMatch) {
    return { winnerId: creatorId, draw: false }; // Split pot (payout both)
  }
  if (creatorMatch) {
    return { winnerId: creatorId, draw: false };
  }
  if (opponentMatch) {
    return { winnerId: opponentId, draw: false };
  }
  return { winnerId: null, draw: true }; // No one matched - house wins
}

export { MIN_BET, MAX_BET };
