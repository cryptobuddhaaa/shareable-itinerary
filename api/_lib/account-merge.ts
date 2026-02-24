/**
 * Account merge helper: migrates all data from a source (synthetic Telegram)
 * account into a target (real, e.g. Google) account, then deletes the source.
 *
 * Called by the /start linking flow when a Telegram ID is currently linked to
 * a synthetic tg_*@tg.convenu.app account and being re-linked to a real account.
 */

import { createClient } from '@supabase/supabase-js';
import { recomputeFromStored } from './trust-recompute.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Merge all data from sourceUserId into targetUserId, then delete the source
 * auth user. The source is expected to be a synthetic Telegram-only account.
 *
 * Non-atomic by design (Supabase JS client doesn't support transactions).
 * If a step fails, data remains consistent — just spread across two accounts.
 * The merge can be retried safely.
 */
export async function mergeAccounts(sourceUserId: string, targetUserId: string): Promise<void> {
  console.log(`[merge] Starting merge: ${sourceUserId} → ${targetUserId}`);

  // --- Bulk moves (no unique conflicts expected) ---

  // Itineraries
  await supabase
    .from('itineraries')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId);

  // Contacts
  await supabase
    .from('contacts')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId);

  // Contact notes
  await supabase
    .from('contact_notes')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId);

  // AI usage & conversations
  await supabase
    .from('ai_usage')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId);

  await supabase
    .from('ai_conversations')
    .update({ user_id: targetUserId })
    .eq('user_id', sourceUserId);

  // Handshakes — update both sides
  await supabase
    .from('handshakes')
    .update({ initiator_user_id: targetUserId })
    .eq('initiator_user_id', sourceUserId);

  await supabase
    .from('handshakes')
    .update({ receiver_user_id: targetUserId })
    .eq('receiver_user_id', sourceUserId);

  // --- User tags: UNIQUE(user_id, name) — skip duplicates ---
  {
    const { data: sourceTags } = await supabase
      .from('user_tags')
      .select('id, name')
      .eq('user_id', sourceUserId);

    if (sourceTags && sourceTags.length > 0) {
      const { data: targetTags } = await supabase
        .from('user_tags')
        .select('name')
        .eq('user_id', targetUserId);

      const existingNames = new Set((targetTags || []).map((t: { name: string }) => t.name));
      const movable = sourceTags.filter((t: { name: string }) => !existingNames.has(t.name));

      for (const tag of movable) {
        await supabase
          .from('user_tags')
          .update({ user_id: targetUserId })
          .eq('id', tag.id);
      }
    }
    // Delete remaining source tags (duplicates)
    await supabase.from('user_tags').delete().eq('user_id', sourceUserId);
  }

  // --- User wallets: UNIQUE(user_id, wallet_address) — skip conflicts ---
  {
    const { data: sourceWallets } = await supabase
      .from('user_wallets')
      .select('id, wallet_address')
      .eq('user_id', sourceUserId);

    if (sourceWallets && sourceWallets.length > 0) {
      const { data: targetWallets } = await supabase
        .from('user_wallets')
        .select('wallet_address')
        .eq('user_id', targetUserId);

      const existingAddrs = new Set(
        (targetWallets || []).map((w: { wallet_address: string }) => w.wallet_address)
      );
      const movable = sourceWallets.filter(
        (w: { wallet_address: string }) => !existingAddrs.has(w.wallet_address)
      );

      for (const wallet of movable) {
        await supabase
          .from('user_wallets')
          .update({ user_id: targetUserId })
          .eq('id', wallet.id);
      }
    }
    // Delete remaining source wallets (conflicts)
    await supabase.from('user_wallets').delete().eq('user_id', sourceUserId);
  }

  // --- User points: UNIQUE(handshake_id, user_id) — skip conflicts ---
  {
    const { data: sourcePoints } = await supabase
      .from('user_points')
      .select('id, handshake_id')
      .eq('user_id', sourceUserId);

    if (sourcePoints && sourcePoints.length > 0) {
      const { data: targetPoints } = await supabase
        .from('user_points')
        .select('handshake_id')
        .eq('user_id', targetUserId);

      const existingHsIds = new Set(
        (targetPoints || [])
          .filter((p: { handshake_id: string | null }) => p.handshake_id)
          .map((p: { handshake_id: string | null }) => p.handshake_id)
      );

      for (const pt of sourcePoints) {
        if (pt.handshake_id && existingHsIds.has(pt.handshake_id)) {
          // Conflict — delete the duplicate
          await supabase.from('user_points').delete().eq('id', pt.id);
        } else {
          await supabase
            .from('user_points')
            .update({ user_id: targetUserId })
            .eq('id', pt.id);
        }
      }
    }
  }

  // --- Trust scores: merge signals (take best from both) ---
  {
    const { data: sourceTrust } = await supabase
      .from('trust_scores')
      .select('*')
      .eq('user_id', sourceUserId)
      .single();

    if (sourceTrust) {
      const { data: targetTrust } = await supabase
        .from('trust_scores')
        .select('*')
        .eq('user_id', targetUserId)
        .single();

      if (targetTrust) {
        // Both exist — merge source's Telegram signals into target
        await supabase
          .from('trust_scores')
          .update({
            telegram_premium: sourceTrust.telegram_premium || targetTrust.telegram_premium,
            has_username: sourceTrust.has_username || targetTrust.has_username,
            telegram_account_age_days:
              targetTrust.telegram_account_age_days ?? sourceTrust.telegram_account_age_days,
            wallet_connected: sourceTrust.wallet_connected || targetTrust.wallet_connected,
            wallet_age_days: targetTrust.wallet_age_days ?? sourceTrust.wallet_age_days,
            wallet_tx_count:
              Math.max(sourceTrust.wallet_tx_count || 0, targetTrust.wallet_tx_count || 0) || null,
            wallet_has_tokens: sourceTrust.wallet_has_tokens || targetTrust.wallet_has_tokens,
            x_verified: sourceTrust.x_verified || targetTrust.x_verified,
            x_premium: sourceTrust.x_premium || targetTrust.x_premium,
            x_user_id: targetTrust.x_user_id || sourceTrust.x_user_id,
            x_refresh_token: targetTrust.x_refresh_token || sourceTrust.x_refresh_token,
            total_handshakes: Math.max(
              sourceTrust.total_handshakes || 0,
              targetTrust.total_handshakes || 0
            ),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', targetUserId);
      } else {
        // Only source has trust_scores — create for target with source's data
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { user_id: _, ...signals } = sourceTrust;
        await supabase.from('trust_scores').upsert(
          { ...signals, user_id: targetUserId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      }

      // Delete source's trust_scores
      await supabase.from('trust_scores').delete().eq('user_id', sourceUserId);
    }
  }

  // --- User profiles: target takes precedence, fill blanks from source ---
  {
    const { data: sourceProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', sourceUserId)
      .single();

    if (sourceProfile) {
      const { data: targetProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', targetUserId)
        .single();

      if (targetProfile) {
        // Fill in empty fields from source
        const fillable = [
          'first_name', 'last_name', 'company', 'position', 'bio',
          'twitter_handle', 'linkedin_url', 'website', 'avatar_url',
        ] as const;
        const updates: Record<string, unknown> = {};
        for (const field of fillable) {
          if (!targetProfile[field] && sourceProfile[field]) {
            updates[field] = sourceProfile[field];
          }
        }
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('user_profiles')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('user_id', targetUserId);
        }
      } else {
        // Only source has profile — copy to target
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { user_id: _, created_at: _c, updated_at: _u, ...fields } = sourceProfile;
        await supabase.from('user_profiles').upsert(
          { ...fields, user_id: targetUserId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      }

      await supabase.from('user_profiles').delete().eq('user_id', sourceUserId);
    }
  }

  // --- Subscriptions: move only if target doesn't have one ---
  {
    const { data: sourceSub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', sourceUserId)
      .single();

    if (sourceSub) {
      const { data: targetSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', targetUserId)
        .single();

      if (!targetSub) {
        await supabase
          .from('subscriptions')
          .update({ user_id: targetUserId })
          .eq('user_id', sourceUserId);
      } else {
        await supabase.from('subscriptions').delete().eq('user_id', sourceUserId);
      }
    }
  }

  // --- Clean up source's Telegram artifacts ---
  await supabase.from('telegram_link_codes').delete().eq('user_id', sourceUserId);
  await supabase.from('telegram_links').delete().eq('user_id', sourceUserId);

  // --- Delete the synthetic auth user ---
  // All data has been migrated, so CASCADE won't affect target's data.
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(sourceUserId);
  if (deleteErr) {
    console.error(`[merge] Failed to delete source user ${sourceUserId}:`, deleteErr);
  }

  // Recompute trust score for the target account with merged signals
  await recomputeFromStored(targetUserId);

  console.log(`[merge] Complete: ${sourceUserId} merged into ${targetUserId}`);
}
