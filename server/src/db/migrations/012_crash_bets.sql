CREATE TABLE IF NOT EXISTS crash_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number BIGINT NOT NULL REFERENCES crash_rounds(round_number) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  auto_cashout_at NUMERIC(10, 2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cashed', 'busted', 'refunded')),
  cashout_at NUMERIC(10, 2),
  payout BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  UNIQUE (round_number, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crash_bets_active ON crash_bets(status) WHERE status = 'active';
