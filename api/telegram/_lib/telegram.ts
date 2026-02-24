// Telegram Bot API helpers

import { TELEGRAM_API, BOT_TOKEN } from './config.js';

export async function sendMessage(
  chatId: number,
  text: string,
  options?: { reply_markup?: object; parse_mode?: string }
) {
  if (!BOT_TOKEN) {
    console.error('[Telegram] BOT_TOKEN is empty — cannot send messages');
    return;
  }

  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ description: response.statusText }));
    console.error('[Telegram] sendMessage failed:', response.status, error);
  }
}

/**
 * Check if a Telegram user has at least one profile photo.
 * Uses getUserProfilePhotos with limit=1 for minimal data transfer.
 * Returns true/false for definitive results, or null if the check failed
 * (so callers can fall back to the previously stored value).
 */
export async function hasProfilePhoto(userId: number): Promise<boolean | null> {
  if (!BOT_TOKEN) return null;

  try {
    const response = await fetch(`${TELEGRAM_API}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, limit: 1 }),
    });

    if (!response.ok) {
      console.error(`[Telegram] getUserProfilePhotos failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as { ok: boolean; result?: { total_count: number } };
    if (!data.ok) return null;
    return (data.result?.total_count ?? 0) > 0;
  } catch (err) {
    console.error('[Telegram] getUserProfilePhotos error:', err);
    return null;
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!BOT_TOKEN) {
    console.error('[Telegram] BOT_TOKEN is empty — cannot answer callback');
    return;
  }

  const response = await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ description: response.statusText }));
    console.error('[Telegram] answerCallbackQuery failed:', response.status, error);
  }
}
