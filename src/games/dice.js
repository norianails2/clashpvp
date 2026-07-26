import crypto from 'crypto';

export const VALID_PREDICTIONS = ['over', 'under', 'exact'];

const MIN_BET = 1;
const MAX_BET = 100000;

export function generateRoll() {
  const die1 = crypto.randomInt(1, 7);
  const die2 = crypto.randomInt(1, 7);
  return { dice: [die1, die2], total: die1 + die2 };
}

export function isValidPrediction(p) {
  return VALID_PREDICTIONS.includes(p);
}

export function getPredictionForTotal(total) {
  if (total < 7) return 'under';
  if (total === 7) return 'exact';
  return 'over';
}

export function resolveDice(total, pred1, pred2, creatorId, opponentId) {
  const actual = getPredictionForTotal(total);

  if (actual === pred1 && actual === pred2) {
    return { winnerId: null, draw: true };
  }
  if (actual === pred1) return { winnerId: creatorId, draw: false };
  if (actual === pred2) return { winnerId: opponentId, draw: false };

  return { winnerId: null, draw: true };
}

export { MIN_BET, MAX_BET };
