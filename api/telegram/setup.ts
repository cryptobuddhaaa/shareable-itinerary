/**
 * Vercel Serverless Function: Register Telegram Webhook
 * POST /api/telegram/setup
 *
 * Call this once after deployment to register the webhook URL with Telegram.
 * The webhook secret is derived from the bot token so it stays in sync.
 *
 * Requires Authorization: Bearer <BOT_TOKEN> to prevent unauthorized access.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
  }

  // Authenticate: caller must provide the bot token as Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const providedToken = authHeader.substring('Bearer '.length);
  if (
    providedToken.length !== botToken.length ||
    !crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(botToken))
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const webhookSecret = crypto
    .createHash('sha256')
    .update(botToken + ':webhook')
    .digest('hex')
    .substring(0, 32);

  // Build webhook URL from the stable production domain (not deployment-specific URL)
  const webappUrl = process.env.WEBAPP_URL;
  const host = webappUrl
    ? new URL(webappUrl).host
    : req.headers.host;
  const webhookUrl = `https://${host}/api/telegram/webhook`;

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      }),
    }
  );

  const result = await response.json();

  return res.status(200).json({
    webhookUrl,
    telegramResponse: result,
  });
}
