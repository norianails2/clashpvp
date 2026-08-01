import { getClient, query } from '../db/pool.js';
import { holdBet, payout, refund } from '../services/balanceService.js';
import { MAX_BET, MIN_BET, getMultiplier, isValidColor, spinRoulette } from './roulette.js';

const BETTING_SECONDS = 15;
const SPINNING_SECONDS = 4;
const RESULT_SECONDS = 5;

class RouletteEngine {
  constructor() {
    this.io = null;
    this.round = 0;
    this.phase = 'idle';
    this.countdown = BETTING_SECONDS;
    this.result = null;
    this.bets = [];
    this.history = [];
    this.timer = null;
    this.pendingBets = new Set();
  }

  setIO(io) { this.io = io; }

  state() {
    return {
      round: this.round,
      phase: this.phase,
      countdown: this.countdown,
      result: this.phase === 'settled' ? this.result : null,
      history: this.history,
      bets: this.bets.map(({ userId, username, amount, color }) => ({ userId, username, amount, color })),
    };
  }

  broadcast() { this.io?.to('game:roulette').emit('roulette:state', this.state()); }

  async restore() {
    const { rows: active } = await query("SELECT round_number, user_id, amount FROM roulette_bets WHERE status = 'active'");
    for (const bet of active) {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          "UPDATE roulette_bets SET status = 'refunded', settled_at = NOW() WHERE round_number = $1 AND user_id = $2 AND status = 'active' RETURNING amount",
          [bet.round_number, bet.user_id]
        );
        if (updated.rowCount) await refund(bet.user_id, Number(updated.rows[0].amount), 'roulette', null, client);
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
    }
    const { rows: rounds } = await query("SELECT round_number, result_number, result_color FROM roulette_rounds WHERE status = 'settled' ORDER BY round_number DESC LIMIT 12");
    this.history = rounds.map(row => ({ number: row.result_number, color: row.result_color }));
    const { rows: latest } = await query('SELECT COALESCE(MAX(round_number), 0) AS round FROM roulette_rounds');
    this.round = Number(latest[0].round);
  }

  async start() { await this.restore(); await this.startBetting(); }

  async startBetting() {
    clearInterval(this.timer);
    this.round += 1;
    this.phase = 'betting';
    this.countdown = BETTING_SECONDS;
    this.result = null;
    this.bets = [];
    await query("INSERT INTO roulette_rounds (round_number, status) VALUES ($1, 'betting')", [this.round]);
    this.broadcast();
    this.timer = setInterval(() => {
      this.countdown -= 1;
      this.broadcast();
      if (this.countdown <= 0) void this.beginSpin();
    }, 1000);
  }

  async beginSpin() {
    if (this.phase !== 'betting') return;
    clearInterval(this.timer);
    this.phase = 'spinning';
    this.countdown = SPINNING_SECONDS;
    this.broadcast();
    this.timer = setInterval(() => {
      this.countdown -= 1;
      this.broadcast();
      if (this.countdown <= 0) void this.settle();
    }, 1000);
  }

  async settle() {
    if (this.phase !== 'spinning') return;
    clearInterval(this.timer);
    this.result = spinRoulette();
    const settled = await Promise.allSettled(this.bets.map(bet => this.settleBet(bet)));
    const failed = settled.filter(entry => entry.status === 'rejected');
    if (failed.length) console.error(`[roulette] ${failed.length} bet settlement(s) failed`);
    await query(
      "UPDATE roulette_rounds SET status = 'settled', result_number = $2, result_color = $3, settled_at = NOW() WHERE round_number = $1",
      [this.round, this.result.number, this.result.color]
    );
    this.phase = 'settled';
    this.history.unshift(this.result);
    this.history = this.history.slice(0, 12);
    this.broadcast();
    setTimeout(() => void this.startBetting().catch(err => console.error('[roulette] new round failed:', err.message)), RESULT_SECONDS * 1000);
  }

  async settleBet(bet) {
    const won = bet.color === this.result.color;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      let balanceAfter = null;
      let payoutAmount = 0;
      if (won) {
        payoutAmount = bet.amount * getMultiplier(bet.color);
        ({ balanceAfter } = await payout(bet.userId, payoutAmount, 'roulette', null, client, 0));
      }
      const update = await client.query(
        "UPDATE roulette_bets SET status = $3, payout = $4, settled_at = NOW() WHERE round_number = $1 AND user_id = $2 AND status = 'active'",
        [this.round, bet.userId, won ? 'won' : 'lost', payoutAmount]
      );
      if (update.rowCount !== 1) throw new Error('Bet is already settled');
      await client.query('COMMIT');
      if (balanceAfter !== null) this.io?.to(`user:${bet.userId}`).emit('balance:update', { balance: balanceAfter });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }

  async placeBet(userId, username, amount, color) {
    if (this.phase !== 'betting') return { error: 'Betting is closed' };
    if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET) return { error: `Bet must be between ${MIN_BET} and ${MAX_BET}` };
    if (!isValidColor(color)) return { error: 'Invalid roulette color' };
    if (this.bets.some(bet => bet.userId === userId) || this.pendingBets.has(userId)) return { error: 'Only one bet per round' };
    this.pendingBets.add(userId);
    try {
      const client = await getClient();
      let balanceAfter;
      try {
        await client.query('BEGIN');
        ({ balanceAfter } = await holdBet(userId, amount, 'roulette', null, client));
        if (this.phase !== 'betting') throw new Error('Betting is closed');
        await client.query(
          `INSERT INTO roulette_bets (round_number, user_id, username, color, amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (round_number, user_id) DO UPDATE
             SET username = EXCLUDED.username, color = EXCLUDED.color, amount = EXCLUDED.amount,
                 status = 'active', payout = 0, created_at = NOW(), settled_at = NULL`,
          [this.round, userId, username, color, amount]
        );
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
      this.bets.push({ userId, username, amount, color });
      this.io?.to(`user:${userId}`).emit('balance:update', { balance: balanceAfter });
      this.broadcast();
      return { success: true, balance: balanceAfter };
    } catch (err) { return { error: err.message }; } finally { this.pendingBets.delete(userId); }
  }

  async cancelBet(userId) {
    if (this.phase !== 'betting') return { error: 'Betting is closed' };
    const bet = this.bets.find(entry => entry.userId === userId);
    if (!bet) return { error: 'No active bet' };
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        "UPDATE roulette_bets SET status = 'refunded', settled_at = NOW() WHERE round_number = $1 AND user_id = $2 AND status = 'active' RETURNING amount",
        [this.round, userId]
      );
      if (updated.rowCount !== 1) throw new Error('Bet is already settled');
      if (this.phase !== 'betting') throw new Error('Betting is closed');
      const { balanceAfter } = await refund(userId, Number(updated.rows[0].amount), 'roulette', null, client);
      if (this.phase !== 'betting') throw new Error('Betting is closed');
      await client.query('COMMIT');
      this.bets = this.bets.filter(entry => entry.userId !== userId);
      this.io?.to(`user:${userId}`).emit('balance:update', { balance: balanceAfter });
      this.broadcast();
      return { success: true, balance: balanceAfter };
    } catch (err) {
      await client.query('ROLLBACK');
      return { error: err.message };
    } finally { client.release(); }
  }

  async stopForShutdown() {
    clearInterval(this.timer);
    const active = [...this.bets];
    await Promise.allSettled(active.map(bet => this.refundBet(bet)));
  }

  async refundBet(bet) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        "UPDATE roulette_bets SET status = 'refunded', settled_at = NOW() WHERE round_number = $1 AND user_id = $2 AND status = 'active' RETURNING amount",
        [this.round, bet.userId]
      );
      if (updated.rowCount) await refund(bet.userId, Number(updated.rows[0].amount), 'roulette', null, client);
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }
}

const rouletteEngine = new RouletteEngine();
export default rouletteEngine;
