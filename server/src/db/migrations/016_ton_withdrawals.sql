CREATE TABLE IF NOT EXISTS ton_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars_amount BIGINT NOT NULL CHECK (stars_amount > 0),
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  ton_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ton_withdrawals_status_created
  ON ton_withdrawal_requests(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ton_withdrawals_one_pending_per_user
  ON ton_withdrawal_requests(user_id) WHERE status = 'pending';
