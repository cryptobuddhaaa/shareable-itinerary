-- Add position and notes columns to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS position TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add check constraint for notes length (max 100 characters)
ALTER TABLE contacts
ADD CONSTRAINT notes_length_check CHECK (length(notes) <= 100);
