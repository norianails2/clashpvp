-- Add 'deposit' and 'withdraw' back to tx_type enum (removed in 004_cleanup.sql)
-- Note: ALTER TYPE ... ADD VALUE cannot run in a transaction block with PgBouncer.
-- Run this manually if needed, or it will be handled by migrate.js.
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'deposit';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'withdraw';
