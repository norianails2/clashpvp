import provablyFair from '../services/provablyFairService.js';
import { holdBet, payout, refund } from '../services/balanceService.js';
import { getClient } from '../db/pool.js';

class CrashEngine {
  constructor() {
    this.phase = 'idle';
    this.round = 0;
    this.countdown = 10;
    this.mult = 1.0;
    this.crashPoint = 0;
    this.players = [];
    this.pendingBets = new Set();
    this.pendingBetCount = 0;
    this.pendingCashoutCount = 0;
    this.history = [];
    this.timers = { main: null, countdown: null };
    this.HOUSE_EDGE = 0;
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  broadcast() {
    if (!this.io) return;
    const info = {
      phase: this.phase,
      round: this.round,
      countdown: this.countdown,
      mult: this.mult,
      players: this.players.map(p => ({
        userId: p.userId,
        username: p.username,
        bet: p.bet,
        status: p.cashedAt ? 'cashed' : (this.phase === 'crashed' ? 'busted' : 'waiting'),
        cashedAt: p.cashedAt,
        payout: p.payout,
      })),
    };
    if (this.phase === 'crashed') info.crashPoint = this.crashPoint;
    if (this.seedHash) info.serverSeedHash = this.seedHash;
    if (this.seedNonce) info.nonce = this.seedNonce;
    if (this.seedClient) info.clientSeed = this.seedClient;
    if (this.seedRevealed) info.serverSeed = this.seedRevealed;
    this.io.to('game:crash').emit('crash:state', info);
  }

  broadcastHistory() {
    if (!this.io) return;
    this.io.to('game:crash').emit('crash:history', { history: this.history.slice(0, 20) });
  }

  async startBetting() {
    try {
      this.round++;
      const pf = await provablyFair.getNextRound();
      this.crashPoint = pf.crashPoint;
      this.seedHash = pf.serverSeedHash;
      this.seedNonce = pf.nonce;
      this.seedClient = pf.clientSeed;
      this.mult = 1.0;
      this.phase = 'betting';
    this.countdown = 10;
      this.players = [];
      this.provablyFair = pf;
      this.broadcast();

      this.timers.countdown = setInterval(() => {
        this.countdown--;
        this.broadcast();
        if (this.countdown <= 0) {
          clearInterval(this.timers.countdown);
          this.timers.countdown = null;
          this.beginFly();
        }
      }, 1000);
    } catch (err) {
      console.error('[crash] startBetting error:', err.message);
      setTimeout(() => this.startBetting(), 3000);
    }
  }

  beginFly() {
    this.phase = 'flying';
    this.mult = 1.0;
    this.startTime = Date.now();
    this.broadcast();

    this.timers.main = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      this.mult = Math.round(Math.exp(elapsed * 0.06) * 100) / 100;
      this.broadcast();

      this.players.forEach(p => {
        if (!p.cashedAt && p.autoCashoutAt && this.mult >= p.autoCashoutAt) {
          this.cashout(p.userId, p.autoCashoutAt);
        }
      });

      if (this.mult >= this.crashPoint || this.mult >= 100) {
          void this.doCrash();
      }
    }, 50);
  }

  async doCrash() {
    if (this.phase === 'crashed') return;
    this.phase = 'crashed';
    if (this.timers.main) { clearInterval(this.timers.main); this.timers.main = null; }
    if (this.timers.countdown) { clearInterval(this.timers.countdown); this.timers.countdown = null; }

    try {
      const client = await getClient();
      let revealed;
      try {
        await client.query('BEGIN');
        revealed = await provablyFair.revealRound(this.round, client);
        await client.query(
          `UPDATE crash_bets SET status = 'busted', settled_at = NOW()
           WHERE round_number = $1 AND status = 'active'`,
          [this.round]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      if (revealed) {
        this.seedRevealed = revealed.serverSeed;
      }
    } catch (err) {
      console.error('[crash] failed to reveal round:', err.message);
    }
    this.history.unshift({ crashPoint: this.crashPoint, players: this.players.length });
    if (this.history.length > 20) this.history.pop();

    this.broadcast();
    this.broadcastHistory();

    setTimeout(async () => {
      try {
        this.seedHash = null;
        this.seedRevealed = null;
        this.provablyFair = null;
        await this.startBetting();
      } catch (err) {
        console.error('[crash] restart error:', err.message);
        setTimeout(() => this.startBetting(), 3000);
      }
    }, 1500);
  }

  async placeBet(userId, username, betAmount, autoCashoutAt) {
    if (this.phase !== 'betting') return { error: 'Not betting phase' };
    if (!Number.isInteger(betAmount) || betAmount < 1) return { error: 'Minimum bet is 1' };
    if (this.players.find(p => p.userId === userId) || this.pendingBets.has(userId)) return { error: 'Already bet this round' };
    if (autoCashoutAt !== null && autoCashoutAt !== undefined && (!Number.isFinite(autoCashoutAt) || autoCashoutAt < 1)) {
      return { error: 'Invalid auto cashout multiplier' };
    }

    this.pendingBets.add(userId);
    this.pendingBetCount++;
    try {
      const client = await getClient();
      let balanceAfter;
      try {
        await client.query('BEGIN');
        ({ balanceAfter } = await holdBet(userId, betAmount, 'crash', null, client));
        if (this.phase !== 'betting') throw new Error('Betting phase has ended');
        await client.query(
          `INSERT INTO crash_bets (round_number, user_id, username, amount, auto_cashout_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.round, userId, username, betAmount, autoCashoutAt || null]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      this.players.push({
        userId, username, bet: betAmount,
        cashedAt: null, payout: 0, autoCashoutAt: autoCashoutAt || null,
      });

      this.broadcast();
      return { success: true, balance: balanceAfter };
    } catch (err) {
      return { error: err.message };
    } finally {
      this.pendingBets.delete(userId);
      this.pendingBetCount--;
    }
  }

  async cashout(userId, multiplier) {
    const player = this.players.find(p => p.userId === userId);
    if (!player) return { error: 'No bet placed' };
    if (player.cashedAt || player.cashingOut) return { error: 'Already cashed out' };
    if (this.phase !== 'flying') return { error: 'Not flying phase' };

    const requestedMultiplier = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : this.mult;
    const cashoutMult = Math.min(requestedMultiplier, this.mult);
    const grossPayout = Math.ceil(player.bet * cashoutMult);
    player.cashingOut = true;
    this.pendingCashoutCount++;

    try {
      const client = await getClient();
      let balanceAfter, netAmount;
      try {
        await client.query('BEGIN');
        ({ balanceAfter, netAmount } = await payout(userId, grossPayout, 'crash', null, client, this.HOUSE_EDGE));
        const { rowCount } = await client.query(
          `UPDATE crash_bets SET status = 'cashed', cashout_at = $1, payout = $2, settled_at = NOW()
           WHERE round_number = $3 AND user_id = $4 AND status = 'active'`,
          [cashoutMult, netAmount, this.round, userId]
        );
        if (rowCount !== 1) throw new Error('Bet is already settled');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      player.cashedAt = cashoutMult;
      player.payout = netAmount;
      this.broadcast();

      return { success: true, cashoutAt: cashoutMult, payout: netAmount, balance: balanceAfter };
    } catch (err) {
      return { error: err.message };
    } finally {
      player.cashingOut = false;
      this.pendingCashoutCount--;
    }
  }

  async stopForShutdown() {
    if (this.phase === 'stopped') return;
    this.phase = 'stopped';
    if (this.timers.main) clearInterval(this.timers.main);
    if (this.timers.countdown) clearInterval(this.timers.countdown);
    this.timers.main = null;
    this.timers.countdown = null;

    const deadline = Date.now() + 8000;
    while ((this.pendingBetCount > 0 || this.pendingCashoutCount > 0) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const unsettled = this.players.filter(player => !player.cashedAt && !player.cashingOut);
    const refunds = await Promise.allSettled(
      unsettled.map(async (player) => {
        const client = await getClient();
        let balanceAfter;
        try {
          await client.query('BEGIN');
          const result = await client.query(
            `UPDATE crash_bets SET status = 'refunded', settled_at = NOW()
             WHERE round_number = $1 AND user_id = $2 AND status = 'active' RETURNING amount`,
            [this.round, player.userId]
          );
          if (result.rowCount !== 1) throw new Error('Bet is already settled');
          ({ balanceAfter } = await refund(player.userId, Number(result.rows[0].amount), 'crash', null, client));
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        player.refunded = true;
        return balanceAfter;
      })
    );
    const failedRefunds = refunds.filter(result => result.status === 'rejected');
    if (failedRefunds.length) {
      console.error(`[crash] ${failedRefunds.length} shutdown refunds failed`);
    }
    return { refunded: unsettled.length - failedRefunds.length };
  }

  getState() {
    const info = {
      phase: this.phase,
      round: this.round,
      countdown: this.countdown,
      mult: this.mult,
      crashPoint: this.crashPoint,
      history: this.history.slice(0, 20),
      players: this.players.map(p => ({
        userId: p.userId, username: p.username, bet: p.bet,
        status: p.cashedAt ? 'cashed' : (this.phase === 'crashed' ? 'busted' : 'waiting'),
        cashedAt: p.cashedAt, payout: p.payout,
      })),
    };
    if (this.seedHash) info.serverSeedHash = this.seedHash;
    if (this.seedNonce) info.nonce = this.seedNonce;
    if (this.seedClient) info.clientSeed = this.seedClient;
    if (this.seedRevealed) info.serverSeed = this.seedRevealed;
    return info;
  }
}

const crashEngine = new CrashEngine();
export default crashEngine;
export { CrashEngine };
