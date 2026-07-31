-- Historical migration.
-- This file previously reset production tables and must remain a no-op because
-- migrations are evaluated during every service start.
SELECT 1;
