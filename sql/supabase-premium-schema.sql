-- Premium Features Database Schema
-- Run this in Supabase SQL Editor to add premium features support

-- ============================================================================
-- SUBSCRIPTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',  -- 'free', 'premium', 'pro'
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'canceled', 'past_due', 'trialing'
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_tier CHECK (tier IN ('free', 'premium', 'pro')),
  CONSTRAINT valid_status CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete'))
);

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Enable Row Level Security
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subscriptions
DROP POLICY IF EXISTS "Users can view their own subscription" ON subscriptions;
CREATE POLICY "Users can view their own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own subscription" ON subscriptions;
CREATE POLICY "Users can insert their own subscription"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own subscription" ON subscriptions;
CREATE POLICY "Users can update their own subscription"
  ON subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscriptions_updated_at_trigger ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at_trigger
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_subscriptions_updated_at();

-- ============================================================================
-- AI USAGE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_type TEXT NOT NULL,  -- 'event_creation', 'analysis', 'transcription', 'briefing'
  tokens_used INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,  -- Track actual cost in cents
  success BOOLEAN DEFAULT TRUE,  -- Track if the query succeeded
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_feature_type CHECK (feature_type IN ('event_creation', 'analysis', 'transcription', 'briefing', 'optimization'))
);

-- Indexes for ai_usage
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_type ON ai_usage(feature_type);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at DESC);

-- Enable Row Level Security
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_usage
DROP POLICY IF EXISTS "Users can view their own usage" ON ai_usage;
CREATE POLICY "Users can view their own usage"
  ON ai_usage FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own usage" ON ai_usage;
CREATE POLICY "Users can insert their own usage"
  ON ai_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- AI CONVERSATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  itinerary_id UUID REFERENCES itineraries(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of message objects
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ai_conversations
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_itinerary_id ON ai_conversations(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_created_at ON ai_conversations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_conversations
DROP POLICY IF EXISTS "Users can view their own conversations" ON ai_conversations;
CREATE POLICY "Users can view their own conversations"
  ON ai_conversations FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own conversations" ON ai_conversations;
CREATE POLICY "Users can insert their own conversations"
  ON ai_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own conversations" ON ai_conversations;
CREATE POLICY "Users can update their own conversations"
  ON ai_conversations FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own conversations" ON ai_conversations;
CREATE POLICY "Users can delete their own conversations"
  ON ai_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at for conversations
DROP TRIGGER IF EXISTS update_ai_conversations_updated_at_trigger ON ai_conversations;
CREATE TRIGGER update_ai_conversations_updated_at_trigger
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_subscriptions_updated_at();  -- Reuse the same function

-- ============================================================================
-- HELPER FUNCTIONS FOR USAGE TRACKING
-- ============================================================================

-- Function to get user's current tier
CREATE OR REPLACE FUNCTION get_user_tier(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_tier TEXT;
BEGIN
  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = p_user_id
  AND status IN ('active', 'trialing')
  LIMIT 1;

  -- If no subscription found, return 'free'
  RETURN COALESCE(v_tier, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has reached their monthly AI query limit
CREATE OR REPLACE FUNCTION check_ai_usage_limit(p_user_id UUID, p_feature_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier TEXT;
  v_usage_count INTEGER;
  v_limit INTEGER;
BEGIN
  -- Get user's tier
  v_tier := get_user_tier(p_user_id);

  -- Set limit based on tier
  CASE v_tier
    WHEN 'free' THEN v_limit := 3;  -- 3 AI events for free tier (trial)
    WHEN 'premium' THEN v_limit := 50;  -- 50 AI queries per month for premium
    WHEN 'pro' THEN RETURN TRUE;  -- Unlimited for pro tier
    ELSE v_limit := 0;
  END CASE;

  -- Count usage in current month
  SELECT COUNT(*) INTO v_usage_count
  FROM ai_usage
  WHERE user_id = p_user_id
  AND feature_type = p_feature_type
  AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
  AND success = TRUE;

  -- Return true if under limit
  RETURN v_usage_count < v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get remaining AI queries for current month
CREATE OR REPLACE FUNCTION get_remaining_ai_queries(p_user_id UUID)
RETURNS TABLE(
  tier TEXT,
  limit_value INTEGER,
  used INTEGER,
  remaining INTEGER
) AS $$
DECLARE
  v_tier TEXT;
  v_limit INTEGER;
  v_used INTEGER;
BEGIN
  -- Get user's tier
  v_tier := get_user_tier(p_user_id);

  -- Set limit based on tier
  CASE v_tier
    WHEN 'free' THEN v_limit := 3;
    WHEN 'premium' THEN v_limit := 50;
    WHEN 'pro' THEN v_limit := -1;  -- -1 means unlimited
    ELSE v_limit := 0;
  END CASE;

  -- Count usage in current month (only successful queries)
  SELECT COUNT(*) INTO v_used
  FROM ai_usage
  WHERE user_id = p_user_id
  AND feature_type = 'event_creation'
  AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
  AND success = TRUE;

  -- Return results
  RETURN QUERY SELECT
    v_tier,
    v_limit,
    v_used::INTEGER,
    CASE
      WHEN v_limit = -1 THEN -1  -- Unlimited
      ELSE GREATEST(0, v_limit - v_used)
    END::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ABUSE DETECTION FUNCTIONS
-- ============================================================================

-- Function to detect suspicious activity patterns
CREATE OR REPLACE FUNCTION detect_abuse_patterns(p_user_id UUID)
RETURNS TABLE(
  is_suspicious BOOLEAN,
  reason TEXT,
  action TEXT
) AS $$
DECLARE
  v_queries_last_hour INTEGER;
  v_queries_last_day INTEGER;
  v_failed_queries_percent DECIMAL;
  v_account_age INTERVAL;
BEGIN
  -- Check queries in last hour
  SELECT COUNT(*) INTO v_queries_last_hour
  FROM ai_usage
  WHERE user_id = p_user_id
  AND created_at >= NOW() - INTERVAL '1 hour';

  -- Check queries in last 24 hours
  SELECT COUNT(*) INTO v_queries_last_day
  FROM ai_usage
  WHERE user_id = p_user_id
  AND created_at >= NOW() - INTERVAL '24 hours';

  -- Check failed query percentage
  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE (COUNT(*) FILTER (WHERE success = FALSE)::DECIMAL / COUNT(*) * 100)
    END INTO v_failed_queries_percent
  FROM ai_usage
  WHERE user_id = p_user_id
  AND created_at >= NOW() - INTERVAL '7 days';

  -- Check account age
  SELECT NOW() - created_at INTO v_account_age
  FROM auth.users
  WHERE id = p_user_id;

  -- Pattern 1: Excessive queries per hour (>30/hour)
  IF v_queries_last_hour > 30 THEN
    RETURN QUERY SELECT TRUE, 'Excessive queries per hour: ' || v_queries_last_hour::TEXT, 'rate_limit';
  END IF;

  -- Pattern 2: Excessive queries per day for free tier (>100/day)
  IF v_queries_last_day > 100 AND get_user_tier(p_user_id) = 'free' THEN
    RETURN QUERY SELECT TRUE, 'Excessive daily queries for free tier: ' || v_queries_last_day::TEXT, 'temp_block';
  END IF;

  -- Pattern 3: High failure rate (>50%)
  IF v_failed_queries_percent > 50 AND v_queries_last_day > 10 THEN
    RETURN QUERY SELECT TRUE, 'High failure rate: ' || v_failed_queries_percent::TEXT || '%', 'review';
  END IF;

  -- Pattern 4: New account with high usage
  IF v_account_age < INTERVAL '1 day' AND v_queries_last_day > 20 THEN
    RETURN QUERY SELECT TRUE, 'New account with high usage', 'review';
  END IF;

  -- No suspicious activity detected
  RETURN QUERY SELECT FALSE, 'No suspicious activity', 'none';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_user_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_ai_usage_limit(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_remaining_ai_queries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION detect_abuse_patterns(UUID) TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE subscriptions IS 'Stores user subscription information for premium tiers';
COMMENT ON TABLE ai_usage IS 'Tracks AI API usage for billing and rate limiting';
COMMENT ON TABLE ai_conversations IS 'Stores conversation history for context (optional, can be cleared)';
COMMENT ON FUNCTION get_user_tier(UUID) IS 'Returns the current tier for a user (free, premium, pro)';
COMMENT ON FUNCTION check_ai_usage_limit(UUID, TEXT) IS 'Checks if user has exceeded their monthly AI query limit';
COMMENT ON FUNCTION get_remaining_ai_queries(UUID) IS 'Returns remaining AI queries for current month';
COMMENT ON FUNCTION detect_abuse_patterns(UUID) IS 'Detects suspicious usage patterns for abuse prevention';

-- ============================================================================
-- INITIALIZATION
-- ============================================================================

-- Create default free tier subscription for all existing users
INSERT INTO subscriptions (user_id, tier, status)
SELECT id, 'free', 'active'
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM subscriptions)
ON CONFLICT (user_id) DO NOTHING;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Premium features schema created successfully!';
  RAISE NOTICE 'Tables created: subscriptions, ai_usage, ai_conversations';
  RAISE NOTICE 'Functions created: get_user_tier, check_ai_usage_limit, get_remaining_ai_queries, detect_abuse_patterns';
  RAISE NOTICE 'All existing users have been assigned free tier subscriptions';
END $$;
