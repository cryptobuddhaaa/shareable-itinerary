-- Fix: Cascade cleanup when unlinking Telegram account.
-- 1. Add FK from telegram_bot_state → telegram_links so deleting a link
--    automatically deletes the bot conversation state.
-- 2. Add DELETE policy on telegram_link_codes so users can clean up their codes.

-- Add foreign key with cascade delete
ALTER TABLE telegram_bot_state
  ADD CONSTRAINT fk_bot_state_telegram_link
  FOREIGN KEY (telegram_user_id) REFERENCES telegram_links(telegram_user_id)
  ON DELETE CASCADE;

-- Allow users to delete their own link codes
CREATE POLICY "Users can delete own link codes"
  ON telegram_link_codes FOR DELETE
  USING (user_id = auth.uid());
