// /points, /trust, /shakehistory — trust & points commands

import { supabase } from '../_lib/config';
import { sendMessage } from '../_lib/telegram';
import { getLinkedUserId } from '../_lib/state';
import { escapeHtml } from '../_lib/utils';

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
    .select('trust_level, telegram_premium, has_profile_photo, has_username, telegram_account_age_days, wallet_connected, total_handshakes')
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

  const levelNames: Record<number, string> = {
    1: 'Newcomer',
    2: 'Verified',
    3: 'Trusted',
    4: 'Established',
    5: 'Champion',
  };

  const stars = '★'.repeat(trust.trust_level) + '☆'.repeat(5 - trust.trust_level);
  const check = (v: boolean) => v ? '✅' : '❌';

  await sendMessage(
    chatId,
    `📊 <b>Trust Score: ${trust.trust_level}/5</b> — ${levelNames[trust.trust_level] || 'Unknown'}\n` +
      `${stars}\n\n` +
      `<b>Signals:</b>\n` +
      `${check(trust.telegram_premium)} Telegram Premium (+2.0)\n` +
      `${check(trust.has_profile_photo)} Profile Photo (+0.5)\n` +
      `${check(trust.has_username)} Username (+0.5)\n` +
      `${check(trust.telegram_account_age_days > 365)} Account Age > 1yr (+0.5)\n` +
      `${check(trust.wallet_connected)} Verified Wallet (+0.5)\n` +
      `${check(trust.total_handshakes >= 3)} 3+ Handshakes (+0.5)\n\n` +
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
