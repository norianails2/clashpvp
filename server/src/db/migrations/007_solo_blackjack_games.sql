CREATE TABLE IF NOT EXISTS solo_blackjack_games (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  game_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solo_blackjack_games_updated_at
  ON solo_blackjack_games(updated_at);
