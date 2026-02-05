-- Add creator name and email fields to itineraries table
-- This allows us to show who created a shared itinerary without joining auth.users

-- Add columns for creator information
ALTER TABLE itineraries
ADD COLUMN IF NOT EXISTS created_by_name TEXT,
ADD COLUMN IF NOT EXISTS created_by_email TEXT;

-- Create index for faster lookups by email (optional but helpful)
CREATE INDEX IF NOT EXISTS idx_itineraries_created_by_email ON itineraries(created_by_email);

-- Update existing records to populate creator info from auth.users
-- This is a one-time backfill for existing data
UPDATE itineraries
SET
  created_by_name = COALESCE(
    (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = itineraries.user_id),
    (SELECT split_part(email, '@', 1) FROM auth.users WHERE id = itineraries.user_id),
    'Unknown'
  ),
  created_by_email = (SELECT email FROM auth.users WHERE id = itineraries.user_id)
WHERE created_by_name IS NULL OR created_by_email IS NULL;
