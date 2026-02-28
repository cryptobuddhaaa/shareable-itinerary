/**
 * Vercel Serverless Function: Register Telegram Webhook
 * POST /api/telegram/setup  (Authorization: Bearer <BOT_TOKEN>)
 * GET  /api/telegram/setup?token=<BOT_TOKEN>  (browser-friendly)
 *
 * Call this once after deployment to register the webhook URL with Telegram.
 * The webhook secret is derived from the bot token so it stays in sync.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
  }

  // Authenticate: caller must provide the bot token
  // POST: via Authorization: Bearer <token> header
  // GET:  via ?token=<token> query parameter (for browser use)
  let providedToken: string | undefined;

  if (req.method === 'GET') {
    const tokenParam = req.query.token;
    providedToken = typeof tokenParam === 'string' ? tokenParam : undefined;
  } else {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.substring('Bearer '.length);
    }
  }

  if (!providedToken) {
    return res.status(401).json({ error: 'Unauthorized — provide token via ?token= query param (GET) or Authorization header (POST)' });
  }

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

  const tgApi = (method: string, body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());

  // 1. Register webhook
  const webhookResult = await tgApi('setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
  });

  // 2. Register bot commands (visible in the "/" menu)
  const commandsResult = await tgApi('setMyCommands', {
    commands: [
      { command: 'newitinerary', description: 'Create a new trip' },
      { command: 'newevent', description: 'Add an event (manual or Luma import)' },
      { command: 'itineraries', description: 'View your trips & events' },
      { command: 'today', description: 'Today\'s events at a glance' },
      { command: 'newcontact', description: 'Add a contact' },
      { command: 'contacts', description: 'Browse contacts by trip or event' },
      { command: 'contacted', description: 'Mark a follow-up (@handle)' },
      { command: 'handshake', description: 'Send a Proof of Handshake' },
      { command: 'enrich', description: 'AI-research a contact' },
      { command: 'subscribe', description: 'Upgrade to Convenu Premium' },
      { command: 'trust', description: 'View your trust score' },
      { command: 'points', description: 'Check your points balance' },
      { command: 'shakehistory', description: 'View handshake history' },
      { command: 'help', description: 'Full command reference' },
      { command: 'cancel', description: 'Cancel current operation' },
    ],
  });

  // 3. Set bot description (shown when someone opens the chat for the first time, max 512 chars)
  const descriptionResult = await tgApi('setMyDescription', {
    description:
      'Convenu is your event networking companion.\n\n' +
      'Plan trips, import Luma events, track contacts you meet, ' +
      'and mint soulbound NFTs on Solana as Proof of Handshake.\n\n' +
      'Features:\n' +
      '- Trip & event planning with Luma import\n' +
      '- Contact management with tags & notes\n' +
      '- AI-powered contact enrichment\n' +
      '- Proof of Handshake (soulbound cNFTs)\n' +
      '- Trust scores & points\n' +
      '- Google Calendar sync\n' +
      '- X/Twitter verification\n\n' +
      'Tap Start to get going!',
  });

  // 4. Set short description (shown on bot profile page, max 120 chars)
  const shortDescResult = await tgApi('setMyShortDescription', {
    short_description: 'Event networking with trip planning, contact management, AI enrichment & Proof of Handshake on Solana.',
  });

  return res.status(200).json({
    webhookUrl,
    webhook: webhookResult,
    commands: commandsResult,
    description: descriptionResult,
    shortDescription: shortDescResult,
  });
}
