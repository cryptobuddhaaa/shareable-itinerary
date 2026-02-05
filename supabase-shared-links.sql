-- Create table for shared itinerary links
-- This allows us to generate short URLs like ?share=abc123 instead of embedding entire itinerary in URL

CREATE TABLE IF NOT EXISTS shared_itineraries (
  id TEXT PRIMARY KEY, -- Short ID like "abc123" for the URL
  itinerary_id UUID NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration date
  view_count INTEGER DEFAULT 0, -- Track how many times it's been viewed
  UNIQUE(itinerary_id) -- One share link per itinerary
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_shared_itineraries_itinerary_id ON shared_itineraries(itinerary_id);

-- Enable Row Level Security
ALTER TABLE shared_itineraries ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read shared itineraries (public access)
DROP POLICY IF EXISTS "Anyone can view shared itineraries" ON shared_itineraries;
CREATE POLICY "Anyone can view shared itineraries"
  ON shared_itineraries
  FOR SELECT
  USING (true);

-- Policy: Users can create share links for their own itineraries
DROP POLICY IF EXISTS "Users can share their own itineraries" ON shared_itineraries;
CREATE POLICY "Users can share their own itineraries"
  ON shared_itineraries
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM itineraries
      WHERE itineraries.id = shared_itineraries.itinerary_id
      AND itineraries.user_id = auth.uid()
    )
  );

-- Policy: Users can delete share links for their own itineraries
DROP POLICY IF EXISTS "Users can delete their own share links" ON shared_itineraries;
CREATE POLICY "Users can delete their own share links"
  ON shared_itineraries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM itineraries
      WHERE itineraries.id = shared_itineraries.itinerary_id
      AND itineraries.user_id = auth.uid()
    )
  );

-- Policy: Users can update share links for their own itineraries (e.g., view count)
DROP POLICY IF EXISTS "Users can update their own share links" ON shared_itineraries;
CREATE POLICY "Users can update their own share links"
  ON shared_itineraries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM itineraries
      WHERE itineraries.id = shared_itineraries.itinerary_id
      AND itineraries.user_id = auth.uid()
    )
  );

-- Function to generate a secure random ID (12 characters for better security)
-- 12 chars = 36^12 = 4.7 × 10^18 combinations (much harder to guess than 8 chars)
CREATE OR REPLACE FUNCTION generate_share_id()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
