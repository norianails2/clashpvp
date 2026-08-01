import crypto from 'crypto';

export const ROULETTE_COLORS = ['red', 'black', 'green'];
export const MIN_BET = 1;
export const MAX_BET = 100000;

const WHEEL_SECTORS = 15;
const GREEN_SECTOR = 0;

export function spinRoulette(serverSeed, clientSeed, nonce) {
  let number;
  if (serverSeed && clientSeed && Number.isSafeInteger(nonce)) {
    const max = 1n << 64n;
    const limit = max - (max % BigInt(WHEEL_SECTORS));
    let counter = 0;
    while (true) {
      const payload = `${clientSeed}-${nonce}-${counter++}`;
      const value = crypto.createHmac('sha256', serverSeed).update(payload).digest().readBigUInt64BE(0);
      if (value < limit) { number = Number(value % BigInt(WHEEL_SECTORS)); break; }
    }
  } else number = crypto.randomInt(0, WHEEL_SECTORS);
  if (number === GREEN_SECTOR) return { number, color: 'green' };
  return { number, color: number <= 7 ? 'red' : 'black' };
}

export function isValidColor(color) {
  return ROULETTE_COLORS.includes(color);
}

export function getMultiplier(color) {
  return color === 'green' ? 14 : 2;
}
