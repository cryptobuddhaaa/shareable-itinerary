/**
 * Vercel Serverless Function: Telegram Mini App Authentication
 * POST /api/auth/telegram
 *
 * Verifies Telegram Mini App initData, finds or creates a Supabase user,
 * and returns a magic link token that the client can use to establish a session.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { estimateTelegramAccountAgeDays } from '../_lib/telegram-age.js';
import { computeTrustCategories } from '../trust/compute.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/** Synthetic email domain for Telegram-only users */
const TG_EMAIL_DOMAIN = 'tg.convenu.app';

/**
 * Verify Telegram Mini App initData using HMAC-SHA-256.
 * Key derivation: secret = HMAC-SHA256("WebAppData", bot_token)
 * Then: hash = HMAC-SHA256(secret, data_check_string)
 */
function verifyInitData(initData: string): { valid: boolean; user?: TelegramWebAppUser } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  // Remove hash from params for verification
  params.delete('hash');

  // Build data-check-string: sorted key=value pairs joined by \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // Secret key: HMAC-SHA256("WebAppData", bot_token)
  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  // Computed hash: HMAC-SHA256(secret, data_check_string)
  const computed = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (
    computed.length !== hash.length ||
    !crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash))
  ) {
    return { valid: false };
  }

  // Check auth_date freshness (reject if older than 1 hour)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600) {
    return { valid: false };
  }

  // Parse user data
  const userStr = params.get('user');
  if (!userStr) return { valid: false };

  try {
    const user = JSON.parse(userStr);
    return { valid: true, user };
  } catch {
    return { valid: false };
  }
}

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for Mini App context — restrict to our own origin
  const allowedOrigin = process.env.WEBAPP_URL || 'https://app.convenu.xyz';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { initData } = req.body || {};
  if (!initData || typeof initData !== 'string') {
    return res.status(400).json({ error: 'Missing initData' });
  }

  // 1. Verify the initData signature
  const verification = verifyInitData(initData);
  if (!verification.valid || !verification.user) {
    return res.status(401).json({ error: 'Invalid or expired Telegram data' });
  }

  const tgUser = verification.user;
  const telegramUserId = tgUser.id;

  try {
    // 2. Check if this Telegram user is already linked to a Supabase user
    const { data: link } = await supabase
      .from('telegram_links')
      .select('user_id')
      .eq('telegram_user_id', telegramUserId)
      .single();

    let userId: string;
    let userEmail: string;
    let isNewAccount = false;

    if (link?.user_id) {
      // Existing linked user — get their email
      userId = link.user_id;
      const { data: existingUser } = await supabase.auth.admin.getUserById(userId);
      if (!existingUser?.user) {
        return res.status(500).json({ error: 'Linked user not found in auth system' });
      }
      userEmail = existingUser.user.email || `tg_${telegramUserId}@${TG_EMAIL_DOMAIN}`;
    } else {
      // 3. No link found — either new user or previously unlinked
      const syntheticEmail = `tg_${telegramUserId}@${TG_EMAIL_DOMAIN}`;

      // Try to create a new user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: {
          telegram_id: telegramUserId,
          first_name: tgUser.first_name,
          last_name: tgUser.last_name || '',
          username: tgUser.username || '',
          full_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '),
          avatar_url: tgUser.photo_url || '',
          provider: 'telegram',
        },
      });

      if (createError) {
        // User already exists (e.g. previously unlinked) — look them up by email
        // Paginate through users in small batches instead of loading all into memory
        let existingUser = null;
        let page = 1;
        const perPage = 50;

        while (!existingUser) {
          const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
            page,
            perPage,
          });

          if (listError) {
            console.error('Error listing users:', listError);
            return res.status(500).json({ error: 'Failed to create or find user account' });
          }

          const users = listData?.users || [];
          existingUser = users.find((u: { email?: string }) => u.email === syntheticEmail);

          if (existingUser || users.length < perPage) break;
          page++;
        }

        if (!existingUser) {
          console.error('Error finding existing user: User not found');
          return res.status(500).json({ error: 'Failed to create or find user account' });
        }

        userId = existingUser.id;
        userEmail = syntheticEmail;
      } else if (!newUser?.user) {
        return res.status(500).json({ error: 'Failed to create user account' });
      } else {
        userId = newUser.user.id;
        userEmail = syntheticEmail;
        isNewAccount = true;
      }

      // 4. Re-create the telegram_links entry
      await supabase.from('telegram_links').upsert({
        telegram_user_id: telegramUserId,
        user_id: userId,
        telegram_username: tgUser.username || null,
        linked_at: new Date().toISOString(),
      });
    }

    // 5. Write Telegram trust signals and compute trust score (0-100)
    {
      const { data: existing } = await supabase
        .from('trust_scores')
        .select('wallet_connected, wallet_age_days, wallet_tx_count, wallet_has_tokens, total_handshakes, telegram_account_age_days, x_verified, x_premium')
        .eq('user_id', userId)
        .single();

      const telegramPremium = tgUser.is_premium || false;
      const hasUsername = !!tgUser.username;
      const walletConnected = existing?.wallet_connected || false;
      const totalHandshakes = existing?.total_handshakes || 0;
      const accountAgeDays = existing?.telegram_account_age_days
        ?? estimateTelegramAccountAgeDays(telegramUserId);
      const walletAgeDays = existing?.wallet_age_days ?? null;
      const walletTxCount = existing?.wallet_tx_count ?? null;
      const walletHasTokens = existing?.wallet_has_tokens || false;
      const xVerified = existing?.x_verified || false;
      const xPremium = existing?.x_premium || false;

      const scores = computeTrustCategories({
        totalHandshakes,
        walletConnected,
        walletAgeDays,
        walletTxCount,
        walletHasTokens,
        telegramPremium,
        hasUsername,
        telegramAccountAgeDays: accountAgeDays,
        xVerified,
        xPremium,
      });

      await supabase.from('trust_scores').upsert(
        {
          user_id: userId,
          telegram_premium: telegramPremium,
          has_username: hasUsername,
          telegram_account_age_days: accountAgeDays,
          wallet_connected: walletConnected,
          wallet_age_days: walletAgeDays,
          wallet_tx_count: walletTxCount,
          wallet_has_tokens: walletHasTokens,
          x_verified: xVerified,
          x_premium: xPremium,
          total_handshakes: totalHandshakes,
          trust_score: scores.trustScore,
          score_handshakes: scores.scoreHandshakes,
          score_wallet: scores.scoreWallet,
          score_socials: scores.scoreSocials,
          score_events: scores.scoreEvents,
          score_community: scores.scoreCommunity,
          trust_level: scores.trustLevel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }

    // 6. Generate a magic link token for the user (creates a real Supabase session)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('Error generating magic link:', linkError);
      return res.status(500).json({ error: 'Failed to generate session' });
    }

    // 7. Return the token hash to the client
    return res.status(200).json({
      token_hash: linkData.properties.hashed_token,
      user_id: userId,
      new_account: isNewAccount,
      telegram_user: {
        id: tgUser.id,
        first_name: tgUser.first_name,
        last_name: tgUser.last_name,
        username: tgUser.username,
      },
    });
  } catch (error) {
    console.error('Telegram auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
