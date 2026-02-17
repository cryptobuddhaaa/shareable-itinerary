/**
 * Telegram Bot Service (client-side)
 * Handles account linking between the web app and the Telegram bot.
 */

import { supabase } from '../lib/supabase';

const BOT_USERNAME = 'itinerarycontactbot';

/**
 * Generate a one-time linking code and return the Telegram deep link.
 * The code expires in 10 minutes.
 */
export async function generateTelegramLinkCode(): Promise<{
  code: string;
  deepLink: string;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Generate a random 8-character code
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .substring(0, 8);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabase.from('telegram_link_codes').insert({
    code,
    user_id: user.id,
    expires_at: expiresAt,
  });

  if (error) throw error;

  return {
    code,
    deepLink: `https://t.me/${BOT_USERNAME}?start=${code}`,
  };
}

/**
 * Check if the current user has a linked Telegram account.
 */
export async function getTelegramLinkStatus(): Promise<{
  linked: boolean;
  username?: string;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { linked: false };

  const { data } = await supabase
    .from('telegram_links')
    .select('telegram_username')
    .eq('user_id', user.id)
    .single();

  return data
    ? { linked: true, username: data.telegram_username || undefined }
    : { linked: false };
}

/**
 * Unlink the current user's Telegram account.
 */
export async function unlinkTelegram(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('telegram_links')
    .delete()
    .eq('user_id', user.id);

  if (error) throw error;
}
