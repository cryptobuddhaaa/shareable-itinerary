// /points, /trust, /shakehistory — trust & points commands

import { supabase } from '../_lib/config.js';
import { sendMessage } from '../_lib/telegram.js';
import { getLinkedUserId } from '../_lib/state.js';
import { escapeHtml } from '../_lib/utils.js';

export async function handlePoints(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet.');
    return;
  }

  // Get accurate total from DB function (sums ALL points, not just recent)
  const { data: totalData } = await supabase.rpc('get_user_total_points', { p_user_id: userId });
  const total = (typeof totalData === 'number' ? totalData : 0);

  // Get recent entries for display
  const { data: points } = await supabase
    .from('user_points')
    .select('points, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  let msg = `🏆 <b>Your Points: ${total}</b>\n\n`;

  if (points && points.length > 0) {
    msg += '<b>Recent:</b>\n';
    for (const p of points) {
      const date = new Date(p.created_at as string).toLocaleDateString();
      msg += `  +${p.points} — ${escapeHtml(p.reason as string)} (${date})\n`;
    }
  } else {
    msg += 'No points earned yet. Complete handshakes to earn points!';
  }

  await sendMessage(chatId, msg);
}

export async function handleTrust(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet.');
    return;
  }

  const { data: trust } = await supabase
    .from('trust_scores')
    .select('trust_score, trust_level, score_handshakes, score_wallet, score_socials, score_events, score_community, telegram_premium, has_username, telegram_account_age_days, wallet_connected, wallet_age_days, wallet_tx_count, wallet_has_tokens, x_verified, x_premium, total_handshakes')
    .eq('user_id', userId)
    .single();

  if (!trust) {
    await sendMessage(
      chatId,
      '📊 <b>Trust Score: Not computed yet</b>\n\n' +
        'Your trust score will be computed after you:\n' +
        '• Link your Telegram account ✅ (done!)\n' +
        '• Connect & verify a Solana wallet\n' +
        '• Complete handshakes'
    );
    return;
  }

  const score = trust.trust_score || 0;
  let label: string;
  if (score >= 60) label = 'Champion';
  else if (score >= 40) label = 'Established';
  else if (score >= 25) label = 'Trusted';
  else if (score >= 10) label = 'Verified';
  else label = 'Newcomer';

  const check = (v: boolean) => v ? '✅' : '❌';
  const bar = (val: number, max: number) => {
    const filled = max > 0 ? Math.round((val / max) * 10) : 0;
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
  };

  await sendMessage(
    chatId,
    `📊 <b>Trust Score: ${score}/100</b> — ${label}\n\n` +
      `<b>Categories:</b>\n` +
      `🤝 Handshakes ${bar(trust.score_handshakes || 0, 30)} ${trust.score_handshakes || 0}/30\n` +
      `💰 Wallet     ${bar(trust.score_wallet || 0, 20)} ${trust.score_wallet || 0}/20\n` +
      `👥 Socials    ${bar(trust.score_socials || 0, 20)} ${trust.score_socials || 0}/20\n` +
      `📅 Events     ${bar(trust.score_events || 0, 20)} ${trust.score_events || 0}/20\n` +
      `🏘 Community  ${bar(trust.score_community || 0, 10)} ${trust.score_community || 0}/10\n\n` +
      `<b>Wallet signals:</b>\n` +
      `${check(trust.wallet_connected)} Connected (+5)\n` +
      `${check(trust.wallet_age_days != null && trust.wallet_age_days > 90)} Age > 90d (+5)\n` +
      `${check(trust.wallet_tx_count != null && trust.wallet_tx_count > 10)} Txs > 10 (+5)\n` +
      `${check(trust.wallet_has_tokens)} Holds tokens (+5)\n\n` +
      `<b>Social signals:</b>\n` +
      `${check(trust.telegram_premium)} Telegram Premium (+4)\n` +
      `${check(trust.has_username)} Username (+4)\n` +
      `${check(trust.telegram_account_age_days != null && trust.telegram_account_age_days > 365)} Account Age > 1yr (+4)\n` +
      `${check(trust.x_verified)} Verified X account (+4)\n` +
      `${check(trust.x_premium)} X Premium (+4)\n\n` +
      `Total Handshakes: ${trust.total_handshakes}`
  );
}

export async function handleMyHandshakes(chatId: number, telegramUserId: number) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet.');
    return;
  }

  const { data: handshakes } = await supabase
    .from('handshakes')
    .select('id, status, receiver_identifier, event_title, created_at, points_awarded')
    .or(`initiator_user_id.eq.${userId},receiver_user_id.eq.${userId}`)
    .in('status', ['pending', 'matched', 'minted'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (!handshakes || handshakes.length === 0) {
    await sendMessage(
      chatId,
      '🤝 <b>No handshakes yet.</b>\n\nUse /handshake to send your first one!'
    );
    return;
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    matched: '🔄',
    minted: '✅',
  };

  let msg = '🤝 <b>Your Handshakes</b>\n\n';
  for (const h of handshakes) {
    const emoji = statusEmoji[h.status] || '📋';
    const name = h.event_title || h.receiver_identifier || 'Unknown';
    const date = new Date(h.created_at).toLocaleDateString();
    const pts = h.points_awarded > 0 ? ` (+${h.points_awarded}pts)` : '';
    msg += `${emoji} ${escapeHtml(name)} — ${h.status}${pts} (${date})\n`;
  }

  msg += '\nUse /handshake to send a new one.';
  await sendMessage(chatId, msg);
}
