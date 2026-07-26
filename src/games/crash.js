import { query } from '../db/pool.js';
import provablyFair from '../services/provablyFairService.js';

class CrashEngine {
  constructor() {
    this.phase = 'idle';
    this.round = 0;
    this.countdown = 10;
    this.mult = 1.0;
    this.crashPoint = 0;
    this.players = [];
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
        this.doCrash();
      }
    }, 50);
  }

  doCrash() {
    if (this.phase === 'crashed') return;
    this.phase = 'crashed';
    if (this.timers.main) { clearInterval(this.timers.main); this.timers.main = null; }
    if (this.timers.countdown) { clearInterval(this.timers.countdown); this.timers.countdown = null; }

    const revealed = provablyFair.revealRound(this.round);
    if (revealed) {
      this.seedRevealed = revealed.serverSeed;
    }
    console.log('[crash] doCrash round=' + this.round + ' seed=' + (this.seedRevealed ? this.seedRevealed.slice(0,16) : 'NULL') + ' hash=' + (this.seedHash ? this.seedHash.slice(0,16) : 'NULL'));

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
    if (!betAmount || betAmount < 1) return { error: 'Minimum bet is 1' };
    if (this.players.find(p => p.userId === userId)) return { error: 'Already bet this round' };

    try {
      const { rows } = await query(
        `UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance`,
        [betAmount, userId]
      );
      if (rows.length === 0) return { error: 'Insufficient balance' };

      await query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type)
         VALUES ($1, 'bet', $2, $3, $4, 'crash')`,
        [userId, betAmount, Number(rows[0].balance) + betAmount, Number(rows[0].balance)]
      );

      this.players.push({
        userId, username, bet: betAmount,
        cashedAt: null, payout: 0, autoCashoutAt: autoCashoutAt || null,
      });

      this.broadcast();
      return { success: true, balance: Number(rows[0].balance) };
    } catch (err) {
      return { error: err.message };
    }
  }

  async cashout(userId, multiplier) {
    const player = this.players.find(p => p.userId === userId);
    if (!player) return { error: 'No bet placed' };
    if (player.cashedAt) return { error: 'Already cashed out' };
    if (this.phase !== 'flying') return { error: 'Not flying phase' };

    const cashoutMult = Math.min(multiplier || this.mult, this.mult);
    const grossPayout = Math.floor(player.bet * cashoutMult);
    const netPayout = Math.floor(grossPayout * (1 - this.HOUSE_EDGE));

    try {
      const { rows } = await query(
        `UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
        [netPayout, userId]
      );

      await query(
        `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, game_type)
         VALUES ($1, 'win', $2, $3, $4, 'crash')`,
        [userId, netPayout, Number(rows[0].balance) - netPayout, Number(rows[0].balance)]
      );

      player.cashedAt = cashoutMult;
      player.payout = netPayout;
      this.broadcast();

      return { success: true, cashoutAt: cashoutMult, payout: netPayout, balance: Number(rows[0].balance) };
    } catch (err) {
      return { error: err.message };
    }
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
