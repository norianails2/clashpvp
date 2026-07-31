-- 003_rooms.sql — Дуэльные комнаты

-- Статусы комнаты
DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('WAITING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Типы игр
DO $$ BEGIN
  CREATE TYPE game_type AS ENUM ('rps', 'dice', 'coin', 'mines', 'blackjack', 'crash');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type   game_type NOT NULL,
  status      room_status NOT NULL DEFAULT 'WAITING',
  bet_amount  BIGINT NOT NULL CHECK (bet_amount >= 1),
  creator_id  UUID NOT NULL REFERENCES users(id),
  opponent_id UUID REFERENCES users(id),
  winner_id   UUID REFERENCES users(id),
  game_data   JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_game_type ON rooms(game_type);
CREATE INDEX IF NOT EXISTS idx_rooms_creator ON rooms(creator_id);
CREATE INDEX IF NOT EXISTS idx_rooms_opponent ON rooms(opponent_id);

-- Триггер авто-обновления updated_at
DROP TRIGGER IF EXISTS trg_rooms_updated_at ON rooms;
CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
