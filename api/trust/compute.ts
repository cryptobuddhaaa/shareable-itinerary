/**
 * POST /api/trust/compute
 * Computes and stores trust score for a user based on available signals.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_lib/auth';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;
  const userId = authUser.id;

  try {
    // Fetch existing trust data
    const { data: existing } = await supabase
      .from('trust_scores')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Fetch wallet data
    const { data: wallets } = await supabase
      .from('user_wallets')
      .select('verified_at')
      .eq('user_id', userId);

    const walletConnected = wallets?.some((w: { verified_at: string | null }) => w.verified_at != null) || false;

    // Count completed handshakes
    const { count: handshakeCount } = await supabase
      .from('handshakes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'minted')
      .or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`);

    const totalHandshakes = handshakeCount || 0;

    // Compute trust level (1-5)
    let score = 1; // Base score
    const telegramPremium = existing?.telegram_premium || false;
    const hasProfilePhoto = existing?.has_profile_photo || false;
    const hasUsername = existing?.has_username || false;
    const accountAgeDays = existing?.telegram_account_age_days;

    if (telegramPremium) score += 2;
    if (hasProfilePhoto) score += 0.5;
    if (hasUsername) score += 0.5;
    if (accountAgeDays && accountAgeDays > 365) score += 0.5;
    if (walletConnected) score += 0.5;
    if (totalHandshakes >= 3) score += 0.5;

    const trustLevel = Math.min(5, Math.max(1, Math.round(score)));

    const trustData = {
      user_id: userId,
      telegram_premium: telegramPremium,
      has_profile_photo: hasProfilePhoto,
      has_username: hasUsername,
      telegram_account_age_days: accountAgeDays,
      wallet_connected: walletConnected,
      total_handshakes: totalHandshakes,
      trust_level: trustLevel,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('trust_scores').upsert(trustData, { onConflict: 'user_id' });

    return res.status(200).json({ trustLevel, totalHandshakes, walletConnected });
  } catch (error) {
    console.error('Trust compute error:', error);
    return res.status(500).json({ error: 'Failed to compute trust score' });
  }
}
