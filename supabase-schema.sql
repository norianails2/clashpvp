-- Profiles (users + balance)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  balance DOUBLE PRECISION DEFAULT 128.50,
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
