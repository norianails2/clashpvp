import crypto from 'crypto';

export const ROULETTE_COLORS = ['red', 'black', 'green'];
export const MIN_BET = 1;
export const MAX_BET = 100000;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function spinRoulette(serverSeed, clientSeed, nonce) {
  let number;
  if (serverSeed && clientSeed && Number.isSafeInteger(nonce)) {
    const max = 1n << 64n;
    const limit = max - (max % 37n);
    let counter = 0;
    while (true) {
      const payload = `${clientSeed}-${nonce}-${counter++}`;
      const value = crypto.createHmac('sha256', serverSeed).update(payload).digest().readBigUInt64BE(0);
      if (value < limit) { number = Number(value % 37n); break; }
    }
  } else number = crypto.randomInt(0, 37);
  if (number === 0) return { number, color: 'green' };
  return { number, color: RED_NUMBERS.has(number) ? 'red' : 'black' };
}

export function isValidColor(color) {
  return ROULETTE_COLORS.includes(color);
}

export function getMultiplier(color) {
  return color === 'green' ? 36 : 2;
}
