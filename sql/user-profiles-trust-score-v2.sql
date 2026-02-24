-- ============================================================================
-- User Profiles & Trust Score v2 (0-100 with 5 categories)
-- ============================================================================

-- 1. User profiles: editable user info displayed in handshakes, etc.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  position TEXT,
  bio TEXT,
  twitter_handle TEXT,
  linkedin_url TEXT,
  website TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Extend trust_scores with new 0-100 scoring columns
-- Main composite score (0-100)
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 0;

-- Category scores
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS score_handshakes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS score_wallet INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS score_socials INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS score_events INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS score_community INTEGER NOT NULL DEFAULT 0;

-- Additional wallet metrics
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS wallet_age_days INTEGER;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS wallet_tx_count INTEGER;
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS wallet_has_tokens BOOLEAN NOT NULL DEFAULT false;

-- Social verification
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_verified BOOLEAN NOT NULL DEFAULT false;

-- Constraints for category scores
ALTER TABLE trust_scores ADD CONSTRAINT chk_trust_score CHECK (trust_score BETWEEN 0 AND 100);
ALTER TABLE trust_scores ADD CONSTRAINT chk_score_handshakes CHECK (score_handshakes BETWEEN 0 AND 30);
ALTER TABLE trust_scores ADD CONSTRAINT chk_score_wallet CHECK (score_wallet BETWEEN 0 AND 20);
ALTER TABLE trust_scores ADD CONSTRAINT chk_score_socials CHECK (score_socials BETWEEN 0 AND 20);
ALTER TABLE trust_scores ADD CONSTRAINT chk_score_events CHECK (score_events BETWEEN 0 AND 20);
ALTER TABLE trust_scores ADD CONSTRAINT chk_score_community CHECK (score_community BETWEEN 0 AND 10);
