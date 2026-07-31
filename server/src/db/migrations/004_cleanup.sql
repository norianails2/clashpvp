-- Drop old tables (compatible with old schema)
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS crash_rounds CASCADE;

DROP TYPE IF EXISTS tx_type CASCADE;
DROP TYPE IF EXISTS game_type CASCADE;
DROP TYPE IF EXISTS room_status CASCADE;

-- Re-run init
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE tx_type AS ENUM ('bet', 'win', 'refund', 'admin');
CREATE TYPE game_type AS ENUM ('rps', 'dice', 'coin', 'mines', 'blackjack', 'crash');
CREATE TYPE room_status AS ENUM ('WAITING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  balance BIGINT NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type tx_type NOT NULL,
  amount BIGINT NOT NULL,
  balance_before BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  game_type TEXT,
  room_id TEXT,
  metadata JSONB,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- Rooms
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type game_type NOT NULL,
  bet_amount BIGINT NOT NULL CHECK (bet_amount > 0),
  creator_id UUID NOT NULL REFERENCES users(id),
  opponent_id UUID REFERENCES users(id),
  status room_status NOT NULL DEFAULT 'WAITING',
  game_data JSONB DEFAULT '{}',
  winner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_game_type ON rooms(game_type);
CREATE INDEX idx_rooms_creator_id ON rooms(creator_id);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_rooms_updated_at ON rooms;
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Realtime for rooms table
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
