CREATE TABLE IF NOT EXISTS crash_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number BIGINT NOT NULL UNIQUE,
  server_seed_hash TEXT NOT NULL,
  server_seed TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  crash_point NUMERIC(10, 2) NOT NULL CHECK (crash_point >= 1),
  revealed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revealed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crash_rounds_created_at
  ON crash_rounds(created_at DESC);
