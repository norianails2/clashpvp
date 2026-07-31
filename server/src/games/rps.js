/**
 * RPS — чистая игровая логика (нет зависимостей от БД или сокетов).
 */

export const VALID_MOVES = ['rock', 'paper', 'scissors'];

const RULES = {
  rock:     { beats: 'scissors', losesTo: 'paper' },
  paper:    { beats: 'rock',     losesTo: 'scissors' },
  scissors: { beats: 'paper',    losesTo: 'rock' },
};

/**
 * Проверить, что ход валидный.
 */
export function isValidMove(move) {
  return VALID_MOVES.includes(move);
}

/**
 * Определить победителя.
 *
 * @param {string} move1 — ход первого игрока
 * @param {string} move2 — ход второго игрока
 * @returns {{ draw: boolean, winnerIndex: 0 | 1 | null }}
 *   draw: true если ничья
 *   winnerIndex: 0 если победил player1, 1 если player2, null если ничья
 */
export function resolve(move1, move2) {
  if (move1 === move2) return { draw: true, winnerIndex: null };

  const winner =
    RULES[move1].beats === move2 ? 0 :
    RULES[move2].beats === move1 ? 1 :
    null;

  return { draw: winner === null, winnerIndex: winner };
}
