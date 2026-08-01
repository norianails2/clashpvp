ALTER TABLE roulette_rounds ADD COLUMN IF NOT EXISTS server_seed_hash TEXT;
ALTER TABLE roulette_rounds ADD COLUMN IF NOT EXISTS server_seed TEXT;
ALTER TABLE roulette_rounds ADD COLUMN IF NOT EXISTS client_seed TEXT;
ALTER TABLE roulette_rounds ADD COLUMN IF NOT EXISTS nonce BIGINT;
