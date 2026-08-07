CREATE TABLE IF NOT EXISTS system_game_rooms (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  round_id UUID NOT NULL UNIQUE,
  game_type TEXT NOT NULL CHECK (game_type IN ('rps', 'dice', 'coin')),
  bet_amount BIGINT NOT NULL CHECK (bet_amount >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_game_rooms_created_at
  ON system_game_rooms(created_at);
