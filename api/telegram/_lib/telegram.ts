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
