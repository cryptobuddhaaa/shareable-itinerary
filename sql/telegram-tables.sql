-- Telegram Bot Integration Tables
-- Run this in your Supabase SQL Editor

-- 1. telegram_links: Maps Telegram user ID to web app user ID
CREATE TABLE telegram_links (
  telegram_user_id BIGINT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_username TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. telegram_link_codes: One-time codes for account linking
CREATE TABLE telegram_link_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. telegram_bot_state: Conversation state for each Telegram user
--    FK cascade: deleting from telegram_links auto-deletes bot state
CREATE TABLE telegram_bot_state (
  telegram_user_id BIGINT PRIMARY KEY
    REFERENCES telegram_links(telegram_user_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'idle',
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_bot_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for telegram_links
-- Users can read their own link status from the web app
CREATE POLICY "Users can view own telegram link"
  ON telegram_links FOR SELECT
  USING (user_id = auth.uid());

-- Users can delete their own link (unlink from web app)
CREATE POLICY "Users can delete own telegram link"
  ON telegram_links FOR DELETE
  USING (user_id = auth.uid());

-- RLS Policies for telegram_link_codes
-- Users can create link codes for themselves
CREATE POLICY "Users can insert own link codes"
  ON telegram_link_codes FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can view their own codes
CREATE POLICY "Users can view own link codes"
  ON telegram_link_codes FOR SELECT
  USING (user_id = auth.uid());

-- Users can delete their own codes (cleanup on unlink)
CREATE POLICY "Users can delete own link codes"
  ON telegram_link_codes FOR DELETE
  USING (user_id = auth.uid());

-- telegram_bot_state: No client-side policies needed
-- Only accessed by the webhook via service role key
-- Bot state is auto-deleted via FK cascade when telegram_links row is removed
