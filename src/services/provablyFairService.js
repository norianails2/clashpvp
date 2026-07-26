import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RANDOM_ORG_URL = 'https://www.random.org/cgi-bin/randbyte?format=f&nbytes=32';
const HOUSE_EDGE = 0.10;
const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'crash_state.json');

class ProvablyFairService {
  constructor() {
    this.seeds = [];
    this.refillThreshold = 20;
    this.refillLock = false;
    this.currentRound = 0;
    this.rounds = new Map();
    this.clientSeed = crypto.randomBytes(16).toString('hex');
    this._load();
  }

  _save() {
    try {
      const data = JSON.stringify({
        currentRound: this.currentRound,
        clientSeed: this.clientSeed,
        seeds: this.seeds.slice(0, 100),
        rounds: Array.from(this.rounds.entries()).slice(-50).map(([k, v]) => [k, { ...v }]),
      });
      fs.writeFileSync(STATE_FILE, data, 'utf8');
    } catch {}
  }

  _load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        this.currentRound = data.currentRound || 0;
        this.clientSeed = data.clientSeed || this.clientSeed;
        if (Array.isArray(data.seeds)) this.seeds = data.seeds;
        if (Array.isArray(data.rounds)) {
          this.rounds = new Map(data.rounds.filter(([k]) => k > this.currentRound - 50));
        }
      }
    } catch {}
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
    this.currentRound++;
    if (this.seeds.length <= this.refillThreshold) {
      this.refillSeeds();
    }
    const entry = this.seeds.shift();
    if (!entry) {
      const seed = crypto.randomBytes(32).toString('hex');
      entry = { serverSeed: seed, hash: crypto.createHash('sha256').update(seed).digest('hex') };
    }

    const nonce = this.currentRound;
    const round = {
      round: this.currentRound,
      serverSeedHash: entry.hash,
      serverSeed: entry.serverSeed,
      clientSeed: this.clientSeed,
      nonce,
      crashPoint: 0,
      revealed: false,
    };

    round.crashPoint = this._crashPointFromSeed(entry.serverSeed, this.clientSeed, nonce);
    this.rounds.set(this.currentRound, round);
    this._save();

    return {
      round: this.currentRound,
      serverSeedHash: entry.hash,
      clientSeed: this.clientSeed,
      nonce,
      crashPoint: round.crashPoint,
    };
  }

  revealRound(roundNum) {
    const round = this.rounds.get(roundNum);
    if (!round) return null;
    round.revealed = true;
    this._save();
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
    return {
      round: round.round,
      serverSeedHash: round.serverSeedHash,
      serverSeed: round.serverSeed,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      crashPoint: round.crashPoint,
      revealed: round.revealed,
    };
  }
}

const provablyFair = new ProvablyFairService();
export default provablyFair;
export { ProvablyFairService };
