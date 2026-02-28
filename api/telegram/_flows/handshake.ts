// /handshake flow — Proof of Handshake initiation from Telegram

import { supabase, WEBAPP_URL } from '../_lib/config.js';
import { sendMessage, answerCallbackQuery } from '../_lib/telegram.js';
import { getLinkedUserId } from '../_lib/state.js';
import { escapeHtml } from '../_lib/utils.js';

export async function handleHandshake(chatId: number, telegramUserId: number, args: string) {
  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) {
    await sendMessage(chatId, '❌ Your account is not linked yet.\n\nGo to your web app → Contacts → Link Telegram.');
    return;
  }

  // Check if user has a verified wallet
  const { data: wallets } = await supabase
    .from('user_wallets')
    .select('wallet_address, verified_at')
    .eq('user_id', userId);

  const verifiedWallet = wallets?.find((w: { verified_at: string | null }) => w.verified_at != null);
  if (!verifiedWallet) {
    await sendMessage(
      chatId,
      '❌ You need a verified Solana wallet to send handshakes.\n\n' +
        'Open the web app → connect your wallet → verify it first.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Open App', web_app: { url: WEBAPP_URL } }],
          ],
        },
      }
    );
    return;
  }

  if (!args) {
    // Show contacts list to pick from
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, telegram_handle, email')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!contacts || contacts.length === 0) {
      await sendMessage(chatId, '📋 You have no contacts yet. Add contacts first, then send handshakes.');
      return;
    }

    const keyboard = contacts.map((c: { id: string; first_name: string; last_name: string; telegram_handle: string | null }) => [{
      text: `${c.first_name} ${c.last_name || ''}`.trim() + (c.telegram_handle ? ` (@${c.telegram_handle.replace('@', '')})` : ''),
      callback_data: `hs:${c.id}`,
    }]);

    await sendMessage(
      chatId,
      '🤝 <b>Send a Handshake</b>\n\n' +
        'Select a contact to send a Proof of Handshake.\n' +
        'Both parties pay 0.01 SOL and receive a soulbound NFT.\n\n' +
        'Pick a contact:',
      { reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }

  // Direct handshake by @username
  const handle = args.replace('@', '').trim();
  if (!handle) {
    await sendMessage(chatId, 'Usage: /handshake @username');
    return;
  }

  // Find contact with this telegram handle
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, telegram_handle, email')
    .eq('user_id', userId)
    .ilike('telegram_handle', handle)
    .single();

  if (!contact) {
    await sendMessage(
      chatId,
      `❌ No contact found with handle @${handle}.\n\nMake sure they're in your contacts list first.`
    );
    return;
  }

  await initiateHandshakeFromBot(chatId, userId, contact.id, verifiedWallet.wallet_address, contact);
}

export async function handleHandshakeSelection(
  chatId: number,
  telegramUserId: number,
  contactId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(callbackQueryId);

  const userId = await getLinkedUserId(telegramUserId);
  if (!userId) return;

  const { data: wallets } = await supabase
    .from('user_wallets')
    .select('wallet_address, verified_at')
    .eq('user_id', userId);

  const verifiedWallet = wallets?.find((w: { verified_at: string | null }) => w.verified_at != null);
  if (!verifiedWallet) {
    await sendMessage(chatId, '❌ No verified wallet found. Connect one in the web app first.');
    return;
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, telegram_handle, email')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();

  if (!contact) {
    await sendMessage(chatId, '❌ Contact not found or not yours.');
    return;
  }

  await initiateHandshakeFromBot(chatId, userId, contactId, verifiedWallet.wallet_address, contact);
}

async function initiateHandshakeFromBot(
  chatId: number,
  userId: string,
  contactId: string,
  walletAddress: string,
  contact: { id: string; first_name: string; last_name: string; telegram_handle: string | null; email: string | null }
) {
  const receiverIdentifier = contact.telegram_handle
    ? `@${contact.telegram_handle.replace('@', '')}`
    : contact.email;

  if (!receiverIdentifier) {
    await sendMessage(chatId, '❌ This contact has no Telegram handle or email — cannot send a handshake.');
    return;
  }

  // Check for existing handshake
  const { data: existing } = await supabase
    .from('handshakes')
    .select('id, status')
    .eq('contact_id', contactId)
    .in('status', ['pending', 'matched', 'minted'])
    .single();

  if (existing) {
    const statusEmoji: Record<string, string> = { pending: '⏳', matched: '🔄', minted: '✅' };
    await sendMessage(
      chatId,
      `${statusEmoji[existing.status] || '📋'} A handshake with ${escapeHtml(contact.first_name)} already exists (${existing.status}).`
    );
    return;
  }

  // Create the handshake
  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + 48 * 60 * 60 * 1000); // 48 hours

  const { data: handshake, error: hsError } = await supabase
    .from('handshakes')
    .insert({
      initiator_user_id: userId,
      receiver_identifier: receiverIdentifier,
      contact_id: contactId,
      initiator_wallet: walletAddress,
      status: 'pending',
      mint_fee_lamports: 10000000, // 0.01 SOL
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (hsError || !handshake) {
    await sendMessage(chatId, '❌ Failed to create handshake. Please try again.');
    return;
  }

  const contactName = escapeHtml(`${contact.first_name} ${contact.last_name || ''}`.trim());
  const claimUrl = `${WEBAPP_URL}?claim=${handshake.id}`;

  await sendMessage(
    chatId,
    `🤝 <b>Handshake sent to ${contactName}!</b>\n\n` +
      `Receiver: ${escapeHtml(receiverIdentifier)}\n` +
      `Fee: 0.01 SOL each (pay in the web app)\n` +
      `Expires: ${expiresAt.toLocaleDateString()}\n\n` +
      `⚠️ <b>Next steps:</b>\n` +
      `1. Pay your 0.01 SOL fee in the web app\n` +
      `2. Share this claim link with ${contactName}:\n\n` +
      `<code>${claimUrl}</code>\n\n` +
      `They'll need to sign in, connect a wallet, and pay their 0.01 SOL to complete the handshake.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Pay in App', web_app: { url: WEBAPP_URL } }],
        ],
      },
    }
  );

  // Try to notify the receiver if they have a linked Telegram account
  if (contact.telegram_handle) {
    const { data: receiverLink } = await supabase
      .from('telegram_links')
      .select('telegram_user_id')
      .eq('telegram_username', contact.telegram_handle.replace('@', ''))
      .single();

    if (receiverLink) {
      // Get initiator name
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      const initiatorName = escapeHtml(authUser?.user?.user_metadata?.full_name || authUser?.user?.email || 'Someone');

      await sendMessage(
        receiverLink.telegram_user_id,
        `🤝 <b>New Handshake Request!</b>\n\n` +
          `<b>${initiatorName}</b> wants to prove you met.\n\n` +
          `To accept, open this link:\n` +
          `<code>${claimUrl}</code>\n\n` +
          `You'll need to connect a wallet and pay 0.01 SOL.\n` +
          `Both of you will receive a soulbound NFT as proof!`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🤝 Claim Handshake', web_app: { url: `${WEBAPP_URL}?claim=${handshake.id}` } }],
            ],
          },
        }
      );
    }
  }
}
