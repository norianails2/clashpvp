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

-- Transactions table for audit trail
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit','withdraw','win','lose','bet','refund')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'stars',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on rooms
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Realtime for transactions
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS transactions;

-- Disable RLS (app-level auth handles security)
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
