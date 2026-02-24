-- Add x_premium to trust_scores for X Premium (blue checkmark) detection.
-- Replaces profile photo signal in socials scoring (+3 points).
ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS x_premium BOOLEAN NOT NULL DEFAULT false;
