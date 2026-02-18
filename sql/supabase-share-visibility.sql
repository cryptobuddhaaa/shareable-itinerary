-- Add visibility column to shared_itineraries for selective sharing
-- This allows users to choose which days and events are visible in the shared view

ALTER TABLE shared_itineraries
ADD COLUMN IF NOT EXISTS visibility JSONB DEFAULT NULL;

-- The visibility JSON structure:
-- {
--   "hiddenDays": ["2024-01-15", "2024-01-16"],   -- ISO date strings of hidden days
--   "hiddenEvents": ["event-id-1", "event-id-2"]   -- Event IDs to hide
-- }
-- NULL means everything is visible (default behavior for existing shares)

COMMENT ON COLUMN shared_itineraries.visibility IS 'JSONB config for selective sharing. NULL = all visible. Contains hiddenDays (ISO dates) and hiddenEvents (event IDs).';
