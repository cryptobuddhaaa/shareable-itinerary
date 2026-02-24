-- trust-scores-x-columns.sql
-- Adds X (Twitter) verification columns to trust_scores.
-- Run this ONCE in Supabase SQL Editor. All statements are idempotent.
--
-- Columns added:
--   x_refresh_token  — OAuth refresh token for re-verification checks
--   x_premium        — X Premium (blue checkmark) status, +3 trust points
--   x_user_id        — X's stable numeric ID for uniqueness enforcement

-- 1. Refresh token for X re-verification
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_refresh_token TEXT;

-- 2. X Premium detection (replaces profile photo signal)
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_premium BOOLEAN NOT NULL DEFAULT false;

-- 3. X user ID for uniqueness enforcement
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_user_id TEXT;

-- Unique index: only one Convenu user per X account (NULL = unverified, allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_scores_x_user_id_unique
  ON trust_scores (x_user_id)
  WHERE x_user_id IS NOT NULL;
