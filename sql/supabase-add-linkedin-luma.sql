-- Add linkedin and luma_event_url columns to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS linkedin TEXT,
ADD COLUMN IF NOT EXISTS luma_event_url TEXT;
