-- ============================================================================
-- Audit 2 Security Fixes — Run in Supabase SQL Editor
-- ============================================================================

-- C2: Remove handshake UPDATE policy (all updates go through API with service role key)
DROP POLICY IF EXISTS "Users can update own handshakes" ON handshakes;

-- C3: Remove subscriptions INSERT/UPDATE policies (managed by Stripe webhooks only)
DROP POLICY IF EXISTS "Users can insert their own subscription" ON subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscription" ON subscriptions;

-- H6: Fix generate_share_id() to use CSPRNG instead of random()
CREATE OR REPLACE FUNCTION generate_share_id()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  random_bytes BYTEA;
  i INTEGER;
BEGIN
  random_bytes := gen_random_bytes(16);
  FOR i IN 0..15 LOOP
    result := result || substr(chars, (get_byte(random_bytes, i) % 36) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
