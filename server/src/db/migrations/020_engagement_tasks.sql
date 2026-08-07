CREATE TABLE IF NOT EXISTS engagement_task_claims (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, task_key, claim_date)
);

CREATE INDEX IF NOT EXISTS idx_engagement_task_claims_user_date
  ON engagement_task_claims(user_id, claim_date DESC);
