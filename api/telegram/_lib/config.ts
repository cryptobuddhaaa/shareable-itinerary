// Shared configuration for the Telegram bot

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
export const WEBAPP_URL = process.env.WEBAPP_URL || 'https://shareable-itinerary.vercel.app';

// Webhook secret derived from bot token
export const WEBHOOK_SECRET = crypto
  .createHash('sha256')
  .update(BOT_TOKEN + ':webhook')
  .digest('hex')
  .substring(0, 32);

// Supabase client with service role (bypasses RLS)
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
