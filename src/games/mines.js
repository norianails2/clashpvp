import crypto from 'crypto';

export const GRID_ROWS = 3;
export const GRID_COLS = 3;
export const TOTAL_CELLS = 9;

const MIN_MINES = 1;
const MAX_MINES = 8;
const MIN_BET = 1;
const MAX_BET = 100000;

export function generateMinePositions(count) {
  const pool = Array.from({ length: TOTAL_CELLS }, (_, i) => i);
  const positions = [];

  for (let i = 0; i < count; i++) {
    const pick = crypto.randomInt(0, pool.length);
    positions.push(pool[pick]);
    pool[pick] = pool[pool.length - 1];
    pool.pop();
  }

  return positions.sort((a, b) => a - b);
}

export function isValidCellIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
}

export function isValidMinesCount(count) {
  return Number.isInteger(count) && count >= MIN_MINES && count <= MAX_MINES;
}

export function isMine(minePositions, cellIndex) {
  return minePositions.includes(cellIndex);
}

export function calculateMultiplier(minesCount, safeOpenedCount) {
  const safeCells = TOTAL_CELLS - minesCount;
  const remainingSafe = safeCells - safeOpenedCount;
  if (remainingSafe <= 0) return 99;
  return Math.round((safeCells / remainingSafe) * 100) / 100;
}

export { MIN_MINES, MAX_MINES, MIN_BET, MAX_BET };
