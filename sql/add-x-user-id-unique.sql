-- Add x_user_id to trust_scores for uniqueness enforcement.
-- Prevents two Convenu users from verifying the same X account.
-- Uses X's stable numeric user ID (not username, which can change).
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_user_id TEXT;

-- Unique index only on non-null values — multiple users can have NULL (unverified)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_scores_x_user_id_unique
  ON trust_scores (x_user_id)
  WHERE x_user_id IS NOT NULL;
