ALTER TABLE star_invoices DROP CONSTRAINT IF EXISTS star_invoices_status_check;
ALTER TABLE star_invoices
  ADD CONSTRAINT star_invoices_status_check
  CHECK (status IN ('pending', 'paid', 'expired'));

UPDATE star_invoices
SET status = 'expired'
WHERE status = 'pending'
  AND expires_at < NOW() - INTERVAL '24 hours';
