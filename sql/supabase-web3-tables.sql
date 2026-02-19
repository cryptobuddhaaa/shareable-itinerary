-- ============================================================================
-- Web3: Proof of Handshake tables
-- ============================================================================

-- User wallets: links Supabase auth users to Solana wallets
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, wallet_address)
);

-- Ensure only one primary wallet per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_primary
  ON user_wallets (user_id) WHERE is_primary = true;

ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own wallets"
  ON user_wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wallets"
  ON user_wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wallets"
  ON user_wallets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own wallets"
  ON user_wallets FOR DELETE
  USING (auth.uid() = user_id);

-- Handshakes: tracks proof-of-handshake state between two users
CREATE TABLE IF NOT EXISTS handshakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  receiver_identifier TEXT NOT NULL, -- telegram handle or email
  contact_id UUID, -- FK to contacts table
  event_id TEXT, -- itinerary event ID
  event_title TEXT,
  event_date DATE,
  initiator_wallet TEXT, -- Solana pubkey used for initiator's mint
  receiver_wallet TEXT, -- Solana pubkey used for receiver's mint
  initiator_minted_at TIMESTAMPTZ,
  receiver_minted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'matched', 'minted', 'expired')),
  initiator_nft_address TEXT, -- cNFT asset ID on Solana
  receiver_nft_address TEXT,
  initiator_tx_signature TEXT, -- Solana transaction signature
  receiver_tx_signature TEXT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  mint_fee_lamports BIGINT NOT NULL DEFAULT 10000000, -- 0.01 SOL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_handshakes_initiator ON handshakes (initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_handshakes_receiver ON handshakes (receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_handshakes_receiver_id ON handshakes (receiver_identifier);
CREATE INDEX IF NOT EXISTS idx_handshakes_status ON handshakes (status);

ALTER TABLE handshakes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own handshakes"
  ON handshakes FOR SELECT
  USING (auth.uid() = initiator_user_id OR auth.uid() = receiver_user_id);

CREATE POLICY "Users can create handshakes"
  ON handshakes FOR INSERT
  WITH CHECK (auth.uid() = initiator_user_id);

CREATE POLICY "Users can update own handshakes"
  ON handshakes FOR UPDATE
  USING (auth.uid() = initiator_user_id OR auth.uid() = receiver_user_id);

-- User points ledger
CREATE TABLE IF NOT EXISTS user_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  handshake_id UUID REFERENCES handshakes(id) ON DELETE SET NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL, -- 'handshake_complete', 'bonus_premium', 'bonus_same_event', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_points_user ON user_points (user_id);

ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own points"
  ON user_points FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert points (server-side only)
CREATE POLICY "Service can insert points"
  ON user_points FOR INSERT
  WITH CHECK (true); -- Controlled by service role key on server

-- Trust scores for anti-sybil
CREATE TABLE IF NOT EXISTS trust_scores (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_premium BOOLEAN NOT NULL DEFAULT false,
  has_profile_photo BOOLEAN NOT NULL DEFAULT false,
  has_username BOOLEAN NOT NULL DEFAULT false,
  telegram_account_age_days INTEGER,
  wallet_connected BOOLEAN NOT NULL DEFAULT false,
  total_handshakes INTEGER NOT NULL DEFAULT 0,
  trust_level INTEGER NOT NULL DEFAULT 1 CHECK (trust_level BETWEEN 1 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trust_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trust score"
  ON trust_scores FOR SELECT
  USING (auth.uid() = user_id);

-- Helper: get total points for a user
CREATE OR REPLACE FUNCTION get_user_total_points(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(SUM(points), 0)::INTEGER
  FROM user_points
  WHERE user_id = p_user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
