ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'referral_commission';

CREATE TABLE IF NOT EXISTS referral_loss_commissions (
  loss_key TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  source_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loss_amount BIGINT NOT NULL CHECK (loss_amount > 0),
  commission_amount BIGINT NOT NULL CHECK (commission_amount > 0),
  game_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (loss_key, level)
);

CREATE INDEX IF NOT EXISTS idx_referral_loss_commissions_beneficiary
  ON referral_loss_commissions(beneficiary_id, created_at DESC);
