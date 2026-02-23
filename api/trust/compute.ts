/**
 * POST /api/trust/compute
 * Computes and stores the 0-100 trust score for a user across 5 categories:
 *   Handshakes (30), Wallet (20), Socials (20), Events (20), Community (10)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../_lib/auth.js';
import { enrichWalletData } from '../_lib/wallet-enrich.js';
import { estimateTelegramAccountAgeDays } from '../_lib/telegram-age.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/** Scoring constants */
const MAX_HANDSHAKES = 30;
const MAX_WALLET = 20;
const MAX_SOCIALS = 20;

export function computeTrustCategories(signals: {
  totalHandshakes: number;
  walletConnected: boolean;
  walletAgeDays: number | null;
  walletTxCount: number | null;
  walletHasTokens: boolean;
  telegramPremium: boolean;
  hasProfilePhoto: boolean;
  hasUsername: boolean;
  telegramAccountAgeDays: number | null;
  xVerified: boolean;
}) {
  // --- Handshakes (max 30): 1 point per minted handshake ---
  const scoreHandshakes = Math.min(MAX_HANDSHAKES, signals.totalHandshakes);

  // --- Wallet (max 20) ---
  let scoreWallet = 0;
  if (signals.walletConnected) scoreWallet += 5;
  if (signals.walletAgeDays != null && signals.walletAgeDays > 90) scoreWallet += 5;
  if (signals.walletTxCount != null && signals.walletTxCount > 10) scoreWallet += 5;
  if (signals.walletHasTokens) scoreWallet += 5;
  scoreWallet = Math.min(MAX_WALLET, scoreWallet);

  // --- Socials (max 20) ---
  let scoreSocials = 0;
  if (signals.telegramPremium) scoreSocials += 8;
  if (signals.hasProfilePhoto) scoreSocials += 3;
  if (signals.hasUsername) scoreSocials += 3;
  if (signals.telegramAccountAgeDays != null && signals.telegramAccountAgeDays > 365) scoreSocials += 3;
  if (signals.xVerified) scoreSocials += 3;
  scoreSocials = Math.min(MAX_SOCIALS, scoreSocials);

  // --- Events (max 20): TBD — placeholder, always 0 for now ---
  const scoreEvents = 0;

  // --- Community (max 10): TBD — placeholder, always 0 for now ---
  const scoreCommunity = 0;

  const trustScore = scoreHandshakes + scoreWallet + scoreSocials + scoreEvents + scoreCommunity;

  // Legacy 1-5 mapping (approximate: 0-100 → 1-5)
  let trustLevel: number;
  if (trustScore >= 60) trustLevel = 5;
  else if (trustScore >= 40) trustLevel = 4;
  else if (trustScore >= 25) trustLevel = 3;
  else if (trustScore >= 10) trustLevel = 2;
  else trustLevel = 1;

  return {
    trustScore,
    scoreHandshakes,
    scoreWallet,
    scoreSocials,
    scoreEvents,
    scoreCommunity,
    trustLevel,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const userId = authUser.id;

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

    const verifiedWallet = wallets?.find((w: { verified_at: string | null }) => w.verified_at != null);
    const walletConnected = !!verifiedWallet;

    // Enrich wallet data from Solana RPC (age, tx count, token holdings)
    let walletAgeDays = existing?.wallet_age_days as number | null;
    let walletTxCount = existing?.wallet_tx_count as number | null;
    let walletHasTokens = existing?.wallet_has_tokens || false;

    if (walletConnected && verifiedWallet) {
      // Fetch wallet address for RPC enrichment
      const { data: walletRow } = await supabase
        .from('user_wallets')
        .select('wallet_address')
        .eq('user_id', userId)
        .not('verified_at', 'is', null)
        .limit(1)
        .single();

      if (walletRow?.wallet_address) {
        try {
          const enrichment = await enrichWalletData(walletRow.wallet_address);
          walletAgeDays = enrichment.walletAgeDays;
          walletTxCount = enrichment.walletTxCount;
          walletHasTokens = enrichment.walletHasTokens;
        } catch (err) {
          console.error('Wallet enrichment failed, using cached values:', err);
        }
      }
    }

    // Estimate Telegram account age if not yet computed
    let telegramAccountAgeDays = existing?.telegram_account_age_days as number | null;
    if (telegramAccountAgeDays == null) {
      const { data: tgLink } = await supabase
        .from('telegram_links')
        .select('telegram_user_id')
        .eq('user_id', userId)
        .single();

      if (tgLink?.telegram_user_id) {
        telegramAccountAgeDays = estimateTelegramAccountAgeDays(tgLink.telegram_user_id);
      }
    }

    // Count completed handshakes
    const { count: handshakeCount } = await supabase
      .from('handshakes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'minted')
      .or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`);

    const totalHandshakes = handshakeCount || 0;

    // Gather all signals
    const signals = {
      totalHandshakes,
      walletConnected,
      walletAgeDays,
      walletTxCount,
      walletHasTokens,
      telegramPremium: existing?.telegram_premium || false,
      hasProfilePhoto: existing?.has_profile_photo || false,
      hasUsername: existing?.has_username || false,
      telegramAccountAgeDays,
      xVerified: existing?.x_verified || false,
    };

    const scores = computeTrustCategories(signals);

    const trustData = {
      user_id: userId,
      telegram_premium: signals.telegramPremium,
      has_profile_photo: signals.hasProfilePhoto,
      has_username: signals.hasUsername,
      telegram_account_age_days: telegramAccountAgeDays,
      wallet_connected: walletConnected,
      wallet_age_days: walletAgeDays,
      wallet_tx_count: walletTxCount,
      wallet_has_tokens: walletHasTokens,
      x_verified: signals.xVerified,
      total_handshakes: totalHandshakes,
      trust_score: scores.trustScore,
      score_handshakes: scores.scoreHandshakes,
      score_wallet: scores.scoreWallet,
      score_socials: scores.scoreSocials,
      score_events: scores.scoreEvents,
      score_community: scores.scoreCommunity,
      trust_level: scores.trustLevel,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('trust_scores').upsert(trustData, { onConflict: 'user_id' });

    return res.status(200).json({
      trustScore: scores.trustScore,
      scoreHandshakes: scores.scoreHandshakes,
      scoreWallet: scores.scoreWallet,
      scoreSocials: scores.scoreSocials,
      scoreEvents: scores.scoreEvents,
      scoreCommunity: scores.scoreCommunity,
      totalHandshakes,
      walletConnected,
    });
  } catch (error) {
    console.error('Trust compute error:', error);
    return res.status(500).json({ error: 'Failed to compute trust score' });
  }
}
