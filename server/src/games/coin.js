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
  // Safety: same picks shouldn't happen (enforced by handler), but if they do, refund
  if (creatorChoice === opponentChoice) {
    return { winnerId: null, draw: true };
  }

  if (winnerSide === creatorChoice) {
    return { winnerId: creatorId, draw: false };
  }
  if (winnerSide === opponentChoice) {
    return { winnerId: opponentId, draw: false };
  }
  // Should never reach: one side always wins when picks differ
  return { winnerId: null, draw: true };
}

export { MIN_BET, MAX_BET };
