-- Profiles (users + balance)
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  username TEXT,
  balance DOUBLE PRECISION DEFAULT 1000,
  stars_balance BIGINT DEFAULT 1000,
  avatar TEXT DEFAULT '😎',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions history
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT DEFAULT 'USDT',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crash game rounds
CREATE TABLE crash_rounds (
  id BIGSERIAL PRIMARY KEY,
  crash_point DOUBLE PRECISION NOT NULL,
  round_number INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PvP rooms for real-time matchmaking
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

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', 'User' || substr(NEW.id::text, 1, 6)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
