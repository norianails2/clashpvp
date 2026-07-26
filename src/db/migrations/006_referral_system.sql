-- Add referrer_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_referrer_id ON users(referrer_id);

-- Referral bonus transaction type
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'referral_bonus';
