/**
 * POST /api/auth/wallet-login
 *
 * Generates a one-time magic link URL so Telegram-authenticated users
 * can open the app in a wallet browser (Phantom) and stay
 * signed in without Telegram initData.
 *
 * Requires: valid Supabase session (Authorization header).
 * Returns: { url: "https://...?wallet_login=<token_hash>" }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_lib/auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://convenu.xyz';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Look up the user's email to generate a magic link
    const { data: userData } = await supabase.auth.admin.getUserById(authUser.id);
    if (!userData?.user?.email) {
      return res.status(400).json({ error: 'User has no email on file' });
    }

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('Error generating wallet login link:', linkError);
      return res.status(500).json({ error: 'Failed to generate login link' });
    }

    const url = `${WEBAPP_URL}?wallet_login=${linkData.properties.hashed_token}`;

    return res.status(200).json({ url });
  } catch (error) {
    console.error('Wallet login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
