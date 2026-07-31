import crypto from 'crypto';
import { query } from '../db/pool.js';

const RANDOM_ORG_URL = 'https://www.random.org/cgi-bin/randbyte?format=f&nbytes=32';
const HOUSE_EDGE = 0.10;

class ProvablyFairService {
  constructor() {
    this.seeds = [];
    this.refillThreshold = 20;
    this.refillLock = false;
    this.currentRound = 0;
    this.rounds = new Map();
    this.clientSeed = crypto.randomBytes(16).toString('hex');
  }

  async load() {
    const { rows } = await query(
      `SELECT round_number, server_seed_hash, server_seed, client_seed, nonce, crash_point, revealed
       FROM crash_rounds
       ORDER BY round_number DESC
       LIMIT 50`
    );

    this.rounds.clear();
    for (const row of rows.reverse()) {
      const round = Number(row.round_number);
      this.rounds.set(round, {
        round,
        serverSeedHash: row.server_seed_hash,
        serverSeed: row.server_seed,
        clientSeed: row.client_seed,
        nonce: Number(row.nonce),
        crashPoint: Number(row.crash_point),
        revealed: row.revealed,
      });
      this.currentRound = Math.max(this.currentRound, round);
    }
  }

  async refillSeeds() {
    if (this.refillLock) return;
    this.refillLock = true;
    try {
      const response = await fetch(RANDOM_ORG_URL, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const text = await response.text();
        const bytes = text.trim().split(/\s+/).map(b => parseInt(b, 16));
        if (bytes.length >= 32) {
          for (let i = 0; i < Math.floor(bytes.length / 32); i++) {
            const seed = Buffer.from(bytes.slice(i * 32, (i + 1) * 32)).toString('hex');
            this.seeds.push({
              serverSeed: seed,
              hash: crypto.createHash('sha256').update(seed).digest('hex'),
            });
          }
        }
      }
    } catch {
      // fallback to crypto
    }
    if (this.seeds.length < 10) {
      for (let i = 0; i < 50; i++) {
        const seed = crypto.randomBytes(32).toString('hex');
        this.seeds.push({
          serverSeed: seed,
          hash: crypto.createHash('sha256').update(seed).digest('hex'),
        });
      }
    }
    this.refillLock = false;
  }

  async getNextRound() {
    const nextRound = this.currentRound + 1;
    if (this.seeds.length <= this.refillThreshold) {
      this.refillSeeds();
    }
    const entry = this.seeds.shift();
    if (!entry) {
      const seed = crypto.randomBytes(32).toString('hex');
      entry = { serverSeed: seed, hash: crypto.createHash('sha256').update(seed).digest('hex') };
    }

    const nonce = nextRound;
    const round = {
      round: nextRound,
      serverSeedHash: entry.hash,
      serverSeed: entry.serverSeed,
      clientSeed: this.clientSeed,
      nonce,
      crashPoint: 0,
      revealed: false,
    };

    round.crashPoint = this._crashPointFromSeed(entry.serverSeed, this.clientSeed, nonce);
    try {
      await query(
        `INSERT INTO crash_rounds
         (round_number, server_seed_hash, server_seed, client_seed, nonce, crash_point)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [round.round, round.serverSeedHash, round.serverSeed, round.clientSeed, round.nonce, round.crashPoint]
      );
    } catch (err) {
      if (err.code !== '23505') throw err;
      this.seeds.unshift(entry);
      await this.load();
      return this.getNextRound();
    }
    this.currentRound = nextRound;
    this.rounds.set(nextRound, round);

    return {
      round: nextRound,
      serverSeedHash: entry.hash,
      clientSeed: this.clientSeed,
      nonce,
      crashPoint: round.crashPoint,
    };
  }

  async revealRound(roundNum, txClient = null) {
    const round = this.rounds.get(roundNum);
    if (!round) return null;
    const client = txClient || { query };
    await client.query(
      `UPDATE crash_rounds
       SET revealed = TRUE, revealed_at = NOW()
       WHERE round_number = $1`,
      [roundNum]
    );
    round.revealed = true;
    return round;
  }

  _crashPointFromSeed(serverSeed, clientSeed, nonce) {
    const hmac = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}-${nonce}`).digest();
    const n = hmac.readUInt32BE(0);
    const r = Math.max(1, (4294967296 / (n + 1)) * (1 - HOUSE_EDGE));
    return Math.round(Math.min(r, 100) * 100) / 100;
  }

  getState() {
    return {
      currentRound: this.currentRound,
      clientSeed: this.clientSeed,
    };
  }

  getRoundInfo(roundNum) {
    const round = this.rounds.get(roundNum);
    if (!round) return null;
    const info = {
      round: round.round,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      revealed: round.revealed,
    };
    if (round.revealed) {
      info.serverSeed = round.serverSeed;
      info.crashPoint = round.crashPoint;
    }
    return info;
  }
}

const provablyFair = new ProvablyFairService();
export default provablyFair;
export { ProvablyFairService };
