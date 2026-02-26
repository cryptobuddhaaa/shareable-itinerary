-- Contact Enrichments: AI-powered profile enrichment for contacts
-- Run in Supabase SQL Editor

-- Table: contact_enrichments
-- Stores AI-generated professional profiles for contacts
CREATE TABLE IF NOT EXISTS contact_enrichments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_name TEXT NOT NULL,
  query_context TEXT,
  enrichment_data JSONB NOT NULL DEFAULT '{}',
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  sources TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: users can only read their own enrichments (writes via service role)
ALTER TABLE contact_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own enrichments"
  ON contact_enrichments FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- Indexes
CREATE INDEX idx_enrichments_contact ON contact_enrichments(contact_id);
CREATE INDEX idx_enrichments_user ON contact_enrichments(user_id);

-- Table: enrichment_usage
-- Tracks monthly enrichment usage per user for rate limiting
CREATE TABLE IF NOT EXISTS enrichment_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- 'YYYY-MM' format
  usage_count INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, month)
);

-- RLS: users can only read their own usage (writes via service role)
ALTER TABLE enrichment_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own usage"
  ON enrichment_usage FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
