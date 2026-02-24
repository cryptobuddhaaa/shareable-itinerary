/**
 * Lightweight trust score recomputation from stored signals.
 * Call this after any endpoint modifies a trust signal (x_verified, wallet_connected, etc.)
 * to keep the composite trust_score and score_* columns in sync.
 *
 * Does NOT call external APIs (Solana RPC, X API, Telegram Bot API).
 * The full enrichment still happens in POST /api/trust/compute (dashboard load).
 */

import { createClient } from '@supabase/supabase-js';
import { computeTrustCategories } from '../trust/compute.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export async function recomputeFromStored(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('trust_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!existing) return;

  const scores = computeTrustCategories({
    totalHandshakes: existing.total_handshakes || 0,
    walletConnected: existing.wallet_connected || false,
    walletAgeDays: existing.wallet_age_days ?? null,
    walletTxCount: existing.wallet_tx_count ?? null,
    walletHasTokens: existing.wallet_has_tokens || false,
    telegramPremium: existing.telegram_premium || false,
    hasUsername: existing.has_username || false,
    telegramAccountAgeDays: existing.telegram_account_age_days ?? null,
    xVerified: existing.x_verified || false,
    xPremium: existing.x_premium || false,
  });

  await supabase
    .from('trust_scores')
    .update({
      trust_score: scores.trustScore,
      score_handshakes: scores.scoreHandshakes,
      score_wallet: scores.scoreWallet,
      score_socials: scores.scoreSocials,
      score_events: scores.scoreEvents,
      score_community: scores.scoreCommunity,
      trust_level: scores.trustLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}
