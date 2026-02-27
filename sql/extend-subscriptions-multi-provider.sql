-- Extend subscriptions table for multi-provider support (Stripe, Solana Pay, Telegram Stars, Admin)
-- Run this in Supabase SQL Editor after supabase-premium-schema.sql

-- Add payment provider column
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'stripe';

-- Add Solana fields
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS solana_tx_signature TEXT;

-- Add Telegram Stars fields
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS telegram_charge_id TEXT;

-- Add billing period
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'monthly';

-- Add admin grant fields
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS admin_granted_by UUID;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS admin_grant_reason TEXT;

-- Update tier constraint: only free and premium (drop pro)
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS valid_tier;
ALTER TABLE subscriptions ADD CONSTRAINT valid_tier CHECK (tier IN ('free', 'premium'));

-- Migrate any existing 'pro' users to 'premium'
UPDATE subscriptions SET tier = 'premium' WHERE tier = 'pro';

-- Update status constraint to include 'expired'
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE subscriptions ADD CONSTRAINT valid_status
  CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete', 'expired'));

-- Add payment_provider constraint (separate step so ALTER succeeds even if column existed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'valid_payment_provider'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT valid_payment_provider
      CHECK (payment_provider IN ('stripe', 'solana', 'telegram_stars', 'admin'));
  END IF;
END $$;

-- Add billing_period constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'valid_billing_period'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT valid_billing_period
      CHECK (billing_period IN ('monthly', 'annual'));
  END IF;
END $$;

-- Index for expiration checks (used by reminder queries)
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end)
  WHERE payment_provider IN ('solana', 'telegram_stars') AND status = 'active';

-- Index for provider breakdown in admin stats
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider ON subscriptions(payment_provider);

-- Update get_user_tier function to check period expiry
CREATE OR REPLACE FUNCTION get_user_tier(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_tier TEXT;
  v_period_end TIMESTAMPTZ;
  v_provider TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Access denied: can only query own tier';
  END IF;

  SELECT tier, current_period_end, payment_provider
  INTO v_tier, v_period_end, v_provider
  FROM subscriptions
  WHERE user_id = p_user_id
  AND status IN ('active', 'trialing')
  LIMIT 1;

  -- No subscription found
  IF v_tier IS NULL THEN
    RETURN 'free';
  END IF;

  -- Admin-granted subscriptions with no period end are perpetual
  IF v_provider = 'admin' AND v_period_end IS NULL THEN
    RETURN v_tier;
  END IF;

  -- Check if subscription period has expired
  IF v_period_end IS NOT NULL AND v_period_end < NOW() THEN
    RETURN 'free';
  END IF;

  RETURN COALESCE(v_tier, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DO $$
BEGIN
  RAISE NOTICE 'Multi-provider subscription schema applied successfully!';
  RAISE NOTICE 'New columns: payment_provider, solana_tx_signature, telegram_charge_id, billing_period, admin_granted_by, admin_grant_reason';
END $$;
