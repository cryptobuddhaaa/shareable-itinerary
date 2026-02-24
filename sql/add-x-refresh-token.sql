-- Add x_refresh_token to trust_scores for X verification re-checks.
-- The refresh token is used to verify the user still has the app authorized on X.
-- No client-side access — trust_scores has no INSERT/UPDATE RLS for clients.
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_refresh_token TEXT;
