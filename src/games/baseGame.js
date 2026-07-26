/**
 * Base interface for all game handlers.
 * Each game extends this and overrides the methods it needs.
 */
export class BaseGame {
  constructor(type) {
    this.type = type;
  }

  /**
   * Called after room is created (before opponent joins).
   * Return modified roomData or null.
   */
  async onRoomCreated(room) {
    return null;
  }

  /**
   * Called when both players are in the room and the game starts.
   * Return the initial game state to send to players.
   */
  async onGameStart(room) {
    return {};
  }

  /**
   * Called when a player makes a move.
   * - room: current room row from DB (with creator_data, opponent_data as parsed objects)
   * - userId: who made the move
   * - move: the move payload from client
   * Returns { action, winnerId?, result?, state?, error? }
   *   action: 'awaiting_move' | 'finished' | 'error'
   *   winnerId: if game is finished
   *   result: optional result data
   *   state: updated game state
   */
  async handleMove(room, userId, move) {
    return { action: 'error', error: 'Not implemented' };
  }

  /**
   * Called when the game needs to be resolved (both players made final moves).
   * Returns { winnerId, draw, result }
   */
  resolveGame(room) {
    throw new Error('resolveGame not implemented');
  }

  /**
   * Generate a deterministic seed or game state for provably fair games.
   */
  static generateSeed() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  }
}
