import { resolve, VALID_MOVES } from './rps.js';
import { isValidPrediction, resolveDice } from './dice.js';
import { generateFlip, isValidChoice } from './coin.js';
import { isValidCellIndex, isMine } from './mines.js';
import { calculateScore, isBust } from './blackjack.js';

function createGame(type, config = {}) {
  return {
    type,
    config,
    onRoomCreated: async () => ({}),
    onGameStart: async () => ({}),
    handleMove: async () => ({ action: 'wait', }),
  };
}

const registry = {
  rps: createGame('rps'),
  dice: createGame('dice'),
  coin: createGame('coin'),
  mines: createGame('mines'),
  blackjack: createGame('blackjack'),
  crash: createGame('crash'),
};

export function getGame(type) {
  const game = registry[type];
  if (!game) throw new Error(`Unknown game type: ${type}`);
  return game;
}

export function getGameTypes() {
  return Object.keys(registry);
}
