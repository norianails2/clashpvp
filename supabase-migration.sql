ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_id TEXT UNIQUE;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE profiles ALTER COLUMN username DROP NOT NULL;

-- Rooms table for real PvP matchmaking
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type TEXT NOT NULL,
  creator_id UUID NOT NULL,
  creator_name TEXT,
  creator_avatar TEXT,
  opponent_id UUID,
  opponent_name TEXT,
  opponent_avatar TEXT,
  bet INTEGER NOT NULL CHECK (bet >= 5),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','playing','finished','cancelled')),
  creator_move JSONB,
  opponent_move JSONB,
  winner_id UUID,
  seed TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime for rooms
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS rooms;

-- Disable RLS on rooms (app-level auth handles security)
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
