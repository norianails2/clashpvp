ALTER TABLE star_invoices
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE star_invoices
SET expires_at = created_at + INTERVAL '30 minutes'
WHERE expires_at IS NULL;

ALTER TABLE star_invoices
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_star_invoices_pending_expiry
  ON star_invoices (expires_at)
  WHERE status = 'pending';
