CREATE TABLE IF NOT EXISTS roulette_rounds (
  round_number BIGINT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('betting', 'spinning', 'settled')),
  result_number SMALLINT CHECK (result_number BETWEEN 0 AND 36),
  result_color TEXT CHECK (result_color IN ('red', 'black', 'green')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS roulette_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number BIGINT NOT NULL REFERENCES roulette_rounds(round_number) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('red', 'black', 'green')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'refunded')),
  payout BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  UNIQUE (round_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_roulette_bets_active ON roulette_bets(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_roulette_rounds_recent ON roulette_rounds(round_number DESC);
