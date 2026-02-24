// /start command handler — account linking & welcome

import { supabase, WEBAPP_URL } from '../_lib/config.js';
import { sendMessage } from '../_lib/telegram.js';
import { getLinkedUserId } from '../_lib/state.js';
import { estimateTelegramAccountAgeDays } from '../../_lib/telegram-age.js';
import { computeTrustCategories } from '../../trust/compute.js';
import { mergeAccounts } from '../../_lib/account-merge.js';

export async function handleStart(
  chatId: number,
  telegramUserId: number,
  telegramUsername: string | undefined,
  args: string,
  telegramUser?: { is_premium?: boolean }
) {
  if (!args) {
    const linked = await getLinkedUserId(telegramUserId);
    if (linked) {
      await sendMessage(
        chatId,
        '👋 <b>Welcome back!</b> Your account is linked.\n\n' +
          '📋 <b>Plan your trip</b>\n' +
          '/newitinerary — Create a new trip\n' +
          '/newevent — Add events (or paste Luma links)\n' +
          '/itineraries — View trips & events\n' +
          '/today — Today\'s events at a glance\n\n' +
          '👥 <b>Manage contacts</b>\n' +
          '/newcontact — Add a contact\n' +
          '/contacts — Browse contacts by trip or event\n' +
          '/contacted @handle — Log a follow-up\n\n' +
          '💡 <b>Quick actions</b>\n' +
          '• <b>Forward a message</b> → adds a note if the contact exists, or creates a new contact\n' +
          '• Tag and annotate contacts in the web app\n\n' +
          'Use /help for the full command list.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );
    } else {
      await sendMessage(
        chatId,
        '👋 <b>Welcome to Convenu!</b>\n\n' +
          'Your all-in-one trip planner and networking companion.\n\n' +
          '✈️ Create and manage trip itineraries\n' +
          '📅 Import events from Luma links\n' +
          '👥 Track contacts you meet at events\n' +
          '🏷 Tag and add notes to contacts\n' +
          '💬 Follow up via Telegram DMs\n' +
          '📨 Bulk-invite contacts from the web app\n\n' +
          'Tap <b>Open App</b> to get started, or link an existing account from the web app → Contacts → Link Telegram.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );
    }
    return;
  }

  // Code provided — attempt to link account
  const code = args.trim();
  const { data: linkCode } = await supabase
    .from('telegram_link_codes')
    .select('user_id, expires_at, used')
    .eq('code', code)
    .single();

  if (!linkCode || linkCode.used || new Date(linkCode.expires_at) < new Date()) {
    await sendMessage(
      chatId,
      '❌ Invalid or expired link code. Please generate a new one from the web app.'
    );
    return;
  }

  // UNIQUENESS CHECK: Ensure this Telegram account isn't linked to a different user
  const { data: existingLink } = await supabase
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (existingLink && existingLink.user_id !== linkCode.user_id) {
    // Check if the existing linked user is a synthetic Telegram-only account
    // (auto-created by Mini App login). If so, allow re-linking to the real account.
    const { data: existingUser } = await supabase.auth.admin.getUserById(existingLink.user_id);
    const existingEmail = existingUser?.user?.email || '';
    const isSyntheticAccount = existingEmail.startsWith('tg_') && existingEmail.endsWith('@tg.convenu.app');

    if (!isSyntheticAccount) {
      await sendMessage(
        chatId,
        '❌ This Telegram account is already linked to a different account.\n\n' +
          'You must unlink it from the other account first (web app → Contacts → Unlink Telegram).'
      );
      return;
    }

    // Synthetic account — merge all its data into the real account, then delete it.
    // mergeAccounts() handles: itineraries, contacts, handshakes, trust scores,
    // user profiles, wallets, points, tags, subscriptions, AI data, and deletes
    // the synthetic auth user + its telegram_links entry.
    try {
      await mergeAccounts(existingLink.user_id, linkCode.user_id);
    } catch (mergeErr) {
      console.error('[account] Merge failed:', mergeErr);
      // Non-fatal: link will still be re-created below.
      // Worst case: some data stays orphaned on the deleted synthetic account.
    }
  }

  // UNIQUENESS CHECK: Ensure the target user doesn't already have a different Telegram linked
  const { data: existingUserLink } = await supabase
    .from('telegram_links')
    .select('telegram_user_id')
    .eq('user_id', linkCode.user_id)
    .single();

  if (existingUserLink && existingUserLink.telegram_user_id !== telegramUserId) {
    await sendMessage(
      chatId,
      '❌ That web account already has a different Telegram account linked.\n\n' +
        'Unlink the existing Telegram first (web app → Contacts → Unlink Telegram), then try again.'
    );
    return;
  }

  // Upsert the link (handles both new links and re-links)
  await supabase.from('telegram_links').upsert({
    telegram_user_id: telegramUserId,
    user_id: linkCode.user_id,
    telegram_username: telegramUsername || null,
    linked_at: new Date().toISOString(),
  });

  // Mark code as used
  await supabase
    .from('telegram_link_codes')
    .update({ used: true })
    .eq('code', code);

  // Store trust signals from Telegram user profile and compute trust score (0-100)
  if (telegramUser) {
    const { data: existing } = await supabase
      .from('trust_scores')
      .select('wallet_connected, wallet_age_days, wallet_tx_count, wallet_has_tokens, total_handshakes, telegram_account_age_days, x_verified, x_premium')
      .eq('user_id', linkCode.user_id)
      .single();

    const telegramPremium = telegramUser.is_premium || false;
    const hasUsername = !!telegramUsername;
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
        user_id: linkCode.user_id,
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

  await sendMessage(
    chatId,
    '✅ <b>Account linked successfully!</b>\n\n' +
      'You\'re all set. Here\'s what you can do:\n\n' +
      '📋 <b>Trip Planning</b>\n' +
      '/newitinerary — Create a trip\n' +
      '/newevent — Add events (or paste Luma links)\n' +
      '/itineraries — View trips & events\n' +
      '/today — Today\'s events at a glance\n\n' +
      '👥 <b>Contacts</b>\n' +
      '/newcontact — Add a contact\n' +
      '/contacts — Browse contacts by trip or event\n' +
      '/contacted @handle — Log a follow-up\n\n' +
      '💡 <b>Forward a message</b> from someone → saves them as a contact, or adds a note if they already exist!\n\n' +
      'Use /help for the full command list.'
  );
}
